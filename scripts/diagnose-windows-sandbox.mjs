import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readdir, readFile, rmdir, stat } from 'node:fs/promises';
import { homedir, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { CodexRpc, codexBinary } from '../src/codex-rpc.mjs';
import { codexFailure, FAILURE } from '../src/diagnostics.mjs';
import { withSchema } from '../src/protocol.mjs';
import { RESULT, verifyExecution } from './test-results.mjs';

if (process.platform !== 'win32') {
  console.error('This diagnostic requires native Windows.');
  process.exit(1);
}
const execute = promisify(execFile);
const expected = 'HALOFLUX_SANDBOX_PROBE';
const command = ['cmd.exe', '/d', '/c', 'echo ' + expected];
const options = { windowsHide: true, timeout: 12000, maxBuffer: 64 * 1024 };
const report = { os: release(), cli: null, appServer: RESULT.skipped, probes: [] };
const temporary = await mkdtemp(join(tmpdir(), 'haloflux-sandbox-'));
const start = Date.now();
const folder = join(process.env.CODEX_HOME || join(homedir(), '.codex'), '.sandbox');
let rpc;
let childClosed;

async function logs() {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    const paths = entries.filter(file => file.isFile() && file.name.endsWith('.log'))
      .map(file => join(folder, file.name));
    const sizes = await Promise.all(paths.map(path => stat(path).catch(() => null)));
    return new Map(paths.map((path, i) => [path, sizes[i]]).filter(([, info]) => info));
  } catch { return new Map(); }
}
const before = await logs();

function probe(route, directory, { stdout, exitCode = null, failure }) {
  return { route, directory, exitCode, ...(failure ? { failure } : {}),
    result: verifyExecution({ exitCode, stdout, expected, environmentBlocked: failure === FAILURE.sandbox }) };
}

async function logEvidence() {
  const result = { freshSetupFailure: false, appendedLog: false, sharingViolation32: false,
    nodeReplSharingViolation32: false, rootOnlyAclOpen: false };
  try {
    const errorFile = join(folder, 'setup_error.json');
    const info = await stat(errorFile);
    if (info.mtimeMs >= start && info.size <= 8192) {
      result.freshSetupFailure = codexFailure(JSON.parse(await readFile(errorFile, 'utf8'))) === FAILURE.sandbox;
    }
  } catch { /* Missing, old or inaccessible evidence is unconfirmed. */ }
  for (const [path, info] of await logs()) {
    try {
      if (info.mtimeMs < start) continue;
      const previous = before.get(path);
      const offset = previous?.ino === info.ino ? previous.size : 0;
      if (info.size <= offset) continue;
      const size = Math.min(info.size - offset, 32768);
      const handle = await open(path, 'r');
      try {
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, info.size - buffer.length);
        const tail = buffer.toString('utf8', 0, bytesRead);
        result.appendedLog ||= bytesRead > 0;
        result.sharingViolation32 ||= /os error 32|SetNamedSecurityInfoW failed[^\r\n]+:\s*32\b/i.test(tail);
        result.nodeReplSharingViolation32 ||= /(?:node_repl\.exe)[^\r\n]*(?:os error 32|:\s*32\b)/i.test(tail);
        result.rootOnlyAclOpen ||= /node_repl\.exe[^\r\n]*open ACL target for root-only update[^\r\n]*os error 32/i.test(tail);
      } finally { await handle.close(); }
    } catch { /* Report already observed flags. */ }
  }
  return result;
}

try {
  const binary = codexBinary();
  const { stdout } = await execute(binary, ['--version'], options);
  report.cli = /^codex-cli (\d+\.\d+\.\d+(?:[-.][a-z0-9.-]+)?)$/i.exec(stdout.trim())?.[1] ?? null;
  const fingerprint = async file => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  };
  const helperName = 'codex-windows-sandbox-setup.exe';
  const sibling = dirname(binary);
  const bundled = join(dirname(sibling), 'codex-resources', helperName);
  report.binary = {
    source: process.env.CODEX_BIN ? 'explicit' : /[\\/]node_modules[\\/]@openai[\\/]/i.test(binary)
      ? 'npm' : /[\\/]OpenAI[\\/]Codex[\\/]bin[\\/]/i.test(binary) ? 'desktop-managed' : 'path',
    cliSha256: await fingerprint(binary),
    distributedHelperSha256: await fingerprint(join(sibling, helperName))
      .catch(() => fingerprint(bundled)).catch(() => null),
  };
  const supported = await withSchema(binary, async read => {
    const schema = await read('ClientRequest');
    const has = method => schema.oneOf.some(v => v.properties?.method?.enum?.includes(method));
    const commandParams = schema.definitions?.CommandExecParams?.properties ?? {};
    const readOnly = schema.definitions?.SandboxPolicy?.oneOf?.find(v => v.properties?.type?.enum?.includes('readOnly'));
    return {
      command: has('command/exec') && ['command', 'cwd', 'timeoutMs'].every(key => Object.hasOwn(commandParams, key)) &&
        commandParams.sandboxPolicy?.anyOf?.some(v => v.$ref === '#/definitions/SandboxPolicy') &&
        readOnly?.properties?.networkAccess?.type === 'boolean',
      config: has('config/read'),
      readiness: has('windowsSandbox/readiness'),
    };
  });
  for (const [directory, cwd] of [['workspace', process.cwd()], ['temporary', temporary]]) {
    try {
      const result = await execute(binary, ['sandbox', '-c', 'sandbox_mode="read-only"', '--', ...command],
        { ...options, cwd });
      report.probes.push(probe('cli', directory, { stdout: result.stdout, exitCode: 0 }));
    } catch (error) {
      report.probes.push(probe('cli', directory, { stdout: error.stdout,
        exitCode: Number.isInteger(error.code) ? error.code : null, failure: codexFailure({ message: error.stderr }) }));
    }
  }
  rpc = new CodexRpc({ cwd: temporary, command: binary });
  childClosed = new Promise(resolve => rpc.child.once('close', resolve));
  await rpc.initialize();
  report.appServer = rpc.safetyContract ? RESULT.protocol : RESULT.failure;
  if (supported.config) {
    const { config } = await rpc.call('config/read', { cwd: process.cwd(), includeLayers: false });
    const allowed = (value, values) => values.includes(value) ? value : value == null ? null : 'other';
    report.config = {
      sandboxMode: allowed(config?.sandbox_mode, ['read-only', 'workspace-write', 'danger-full-access']),
      approvals: allowed(config?.approval_policy, ['on-request', 'on-failure', 'never', 'untrusted']),
      windowsSandbox: allowed(config?.windows?.sandbox, ['elevated', 'unelevated', 'mxc']),
      preferMxc: typeof config?.features?.prefer_mxc === 'boolean' ? config.features.prefer_mxc : null,
    };
  }
  if (supported.readiness) {
    const { status } = await rpc.call('windowsSandbox/readiness');
    report.readiness = ['ready', 'notConfigured', 'updateRequired'].includes(status) ? status : 'unknown';
  }
  if (supported.command) {
    for (const [directory, cwd] of [['workspace', process.cwd()], ['temporary', temporary]]) {
      try {
        const { exitCode, stdout, stderr } = await rpc.call('command/exec', {
          command, cwd, timeoutMs: 10000,
          sandboxPolicy: { type: 'readOnly', networkAccess: false },
        });
        report.probes.push(probe('app-server', directory, { stdout, exitCode,
          failure: exitCode === 0 ? null : codexFailure({ message: stderr }) }));
      } catch (error) {
        report.probes.push(probe('app-server', directory, { failure: error.category ?? FAILURE.environment }));
      }
    }
  } else report.commandExec = RESULT.skipped;
} catch (error) {
  report.failure = error.category ?? FAILURE.environment;
} finally {
  rpc?.close();
  await childClosed;
  report.logEvidence = await logEvidence();
  try { await rmdir(temporary); } catch { report.temporaryCleanup = 'failed'; }
  const outcomes = new Set(report.probes.map(row => row.result));
  report.execution = RESULT.skipped;
  if (report.failure || outcomes.has(RESULT.failure)) report.execution = RESULT.failure;
  else if (outcomes.has(RESULT.blocked)) report.execution = RESULT.blocked;
  else if (report.probes.length === 4) report.execution = RESULT.execution;
  console.log(JSON.stringify(report, null, 2));
  if (report.appServer !== RESULT.protocol || report.execution !== RESULT.execution || report.temporaryCleanup) process.exitCode = 1;
}
