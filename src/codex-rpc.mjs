import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { EventEmitter } from 'node:events';
import { approvalContract, coreContract, withSchema } from './protocol.mjs';
import { codexFailure, FAILURE } from './diagnostics.mjs';
import pkg from '../package.json' with { type: 'json' };

const contracts = new Map();
const windows = process.platform === 'win32';
const localAbsolute = file => isAbsolute(file) && (!windows || /^[a-z]:[\\/]/i.test(file));

function nativeFile(file) {
  if (!localAbsolute(file) || (windows && !/\.exe$/i.test(file))) return null;
  try {
    const path = realpathSync(file);
    if (!localAbsolute(path) || (windows && !/\.exe$/i.test(path)) || !statSync(path).isFile()) return null;
    accessSync(path, constants.X_OK);
    return path;
  } catch { return null; }
}

export function codexBinary() {
  if (process.env.CODEX_BIN) {
    const file = nativeFile(process.env.CODEX_BIN);
    if (!file) throw new TransportError('CODEX_BIN must point to a local native executable.', FAILURE.cliPath);
    return file;
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const target = arch === 'arm64' ? 'aarch64' : 'x86_64';
  // Search only absolute PATH entries. Windows where.exe also searches the working directory.
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(localAbsolute)) {
    const executable = nativeFile(join(directory, windows ? 'codex.exe' : 'codex'));
    if (executable) return executable;
    if (!windows || !existsSync(join(directory, 'codex.cmd'))) continue;
    const scope = join(directory, 'node_modules', '@openai');
    const vendor = ['vendor', target + '-pc-windows-msvc', 'bin', 'codex.exe'];
    for (const root of [join(scope, 'codex', 'node_modules', '@openai', 'codex-win32-' + arch),
      join(scope, 'codex-win32-' + arch), join(scope, 'codex')]) {
      const file = nativeFile(join(root, ...vendor));
      if (file) return file;
    }
  }
  throw new TransportError('Codex executable not found.', FAILURE.cliMissing);
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
  constructor({ cwd, command = codexBinary(), args = ['app-server', '--listen', 'stdio://'],
    env = process.env, readSchema = withSchema } = {}) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.closed = false;
    this.command = command;
    this.env = env;
    this.readSchema = readSchema;
    this.decoder = new StringDecoder('utf8');
    this.buffer = '';
    this.shutdown = new AbortController();
    this.child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.child.stdout.on('data', chunk => this.read(chunk));
    this.child.stdout.on('end', () => this.close());
    this.child.stdin.on('error', () => this.close());
    this.child.on('error', () => this.close());
    this.exited = new Promise(resolve => this.child.once('close', resolve));
    this.child.once('close', () => this.close());
  }

  read(chunk) {
    if (this.closed) return;
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
    const inspect = () => this.readSchema(this.command, async read => ({
      safety: await coreContract(read),
      approvals: await approvalContract(read).catch(() => null),
    }), this.env, this.shutdown.signal);
    // An upgraded file at the same path must have its own protocol cache entry.
    const cacheable = this.readSchema === withSchema && this.env === process.env;
    const stat = cacheable ? statSync(this.command) : null;
    const fingerprint = stat && `${stat.size}/${stat.mtimeMs}/${stat.ctimeMs}`;
    const cached = cacheable && contracts.get(this.command);
    const check = cached?.fingerprint === fingerprint ? Promise.resolve(cached.contract) : inspect();
    this.schemaCheck = check;
    const contract = await check.catch(() => {
      throw new TransportError('Codex schema could not be read.', FAILURE.protocol);
    });
    if (cacheable && !this.closed) contracts.set(this.command, { fingerprint, contract });
    this.safetyContract = contract?.safety === true;
    this.approvalContract = this.safetyContract ? contract.approvals : null;
    if (!this.safetyContract) throw new TransportError('Required Codex methods or safety fields are unavailable.', FAILURE.protocol);
    const result = await this.call('initialize', {
      clientInfo: { name: 'haloflux_for_codex', title: 'HaloFlux for Codex', version: pkg.version },
      capabilities: this.approvalContract ? { experimentalApi: true } : null,
    });
    if (!result || typeof result.userAgent !== 'string' || !result.userAgent) {
      throw new TransportError('Codex handshake response is invalid.', FAILURE.protocol);
    }
    this.send({ method: 'initialized' });
  }

  close(category = FAILURE.environment) {
    if (this.closed) return this.closing;
    this.closed = true;
    // Give the owned App Server an EOF before falling back to terminating it.
    const deadline = setTimeout(() => {
      this.child.stdin.destroy();
      this.child.stdout.destroy();
      this.child.kill();
    }, 350).unref();
    this.closing = Promise.allSettled([this.exited, this.schemaCheck]).finally(() => {
      clearTimeout(deadline);
    });
    this.shutdown.abort();
    this.buffer = '';
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new TransportError('Codex connection lost.', category));
    }
    this.pending.clear();
    this.child.stdin.end();
    this.emit('closed', category);
    return this.closing;
  }
}
