import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';
import { approvalContract, safetyContract, withSchema } from './protocol.mjs';
import { codexFailure, FAILURE } from './diagnostics.mjs';
import pkg from '../package.json' with { type: 'json' };

const contracts = new Map();

export function codexBinary() {
  if (process.env.CODEX_BIN) {
    const file = process.env.CODEX_BIN;
    if (!isAbsolute(file) || !existsSync(file) || (process.platform === 'win32' && !/\.exe$/i.test(file))) {
      throw new Error('CODEX_BIN must point to an absolute native executable.');
    }
    return file;
  }
  if (process.platform !== 'win32') return 'codex';

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const target = arch === 'arm64' ? 'aarch64' : 'x86_64';
  let paths;
  try {
    paths = execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'where.exe'), ['codex'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().split(/\r?\n/);
  } catch {
    throw new Error('Codex executable not found.');
  }
  for (const path of paths) {
    if (/\.exe$/i.test(path)) return path;
    const scope = join(dirname(path), 'node_modules', '@openai');
    const vendor = ['vendor', target + '-pc-windows-msvc', 'bin', 'codex.exe'];
    for (const root of [join(scope, 'codex', 'node_modules', '@openai', 'codex-win32-' + arch),
      join(scope, 'codex-win32-' + arch), join(scope, 'codex')]) {
      const file = join(root, ...vendor);
      if (existsSync(file)) return file;
    }
  }
  throw new Error('Set CODEX_BIN to the native Codex executable.');
}

export class RpcError extends Error {
  constructor(method, error) {
    const code = error?.code;
    super('Codex rejected ' + method + (Number.isInteger(code) ? ' (' + code + ').' : '.'));
    this.name = 'RpcError';
    this.category = codexFailure(error);
  }
}
export class TransportError extends Error {
  constructor(message, category = FAILURE.environment) {
    super(message);
    this.category = category;
  }
}

export class CodexRpc extends EventEmitter {
  constructor({ cwd, command = codexBinary(), args = ['app-server', '--listen', 'stdio://'] } = {}) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    this.command = command;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.child.stdout.on('data', chunk => this.read(chunk));
    this.child.stdout.on('end', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.child.on('error', () => this.close());
    this.child.on('close', () => this.close());
  }

  read(chunk) {
    this.buffer += this.decoder.write(chunk);
    if (this.buffer.length > 16 * 1024 * 1024) return this.close();
    let end;
    while (!this.closed && (end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { this.close(FAILURE.protocol); return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) {
        this.close(FAILURE.protocol);
        return;
      }
      if (typeof message.method === 'string') {
        this.emit(Object.hasOwn(message, 'id') ? 'request' : 'notification', message);
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      if (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error') ||
        (Object.hasOwn(message, 'error') && !Number.isInteger(message.error?.code))) {
        this.close(FAILURE.protocol);
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new RpcError(pending.method, message.error));
      else pending.resolve(message.result);
    }
  }

  send(message) {
    if (this.closed || !this.child.stdin.writable) throw new TransportError('Codex connection closed.');
    if (this.child.stdin.writableLength > 256 * 1024) throw new TransportError('Codex transport is congested.');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  call(method, params, timeout = 20000) {
    if (this.closed) return Promise.reject(new TransportError('Codex connection closed.'));
    if (this.pending.size >= 64) return Promise.reject(new TransportError('Too many pending Codex calls.'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.close(), timeout);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); } catch { this.close(); }
    });
  }

  async initialize() {
    if (!contracts.has(this.command)) {
      contracts.set(this.command, withSchema(this.command, async read => ({
        safety: await safetyContract(read),
        approvals: await approvalContract(read).catch(() => null),
      })).catch(() => {
        contracts.delete(this.command);
        return null;
      }));
    }
    const contract = await contracts.get(this.command);
    this.safetyContract = contract?.safety === true;
    this.approvalContract = this.safetyContract ? contract.approvals : null;
    await this.call('initialize', {
      clientInfo: { name: 'haloflux_for_codex', title: 'HaloFlux for Codex', version: pkg.version },
      capabilities: this.approvalContract ? { experimentalApi: true } : null,
    });
    this.send({ method: 'initialized' });
  }

  close(category = FAILURE.environment) {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new TransportError('Codex connection lost.', category));
    }
    this.pending.clear();
    this.child.stdin.destroy();
    this.child.kill();
    this.emit('closed', category);
  }
}
