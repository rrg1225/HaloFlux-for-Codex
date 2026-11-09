import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRpc, codexBinary } from '../src/codex-rpc.mjs';
import { cliVersion, FAILURE } from '../src/diagnostics.mjs';

// Runs only the locally selected, trusted CLI. Never starts a thread, turn or sandbox probe.
const home = await mkdtemp(join(tmpdir(), 'haloflux-cli-check-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|TMPDIR|USERPROFILE|HOME|LOCALAPPDATA|APPDATA|COMSPEC|PATHEXT)$/i.test(key)));
Object.assign(env, { CODEX_HOME: home, GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: '', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.allow', GIT_CONFIG_VALUE_0: 'never' });
let rpc;
try {
  const command = codexBinary();
  const version = await cliVersion(command, env);
  rpc = new CodexRpc({ command, cwd: home, env });
  await rpc.initialize();
  const approvals = rpc.approvalContract;
  console.log(JSON.stringify({ result: 'VERIFIED', version, core: 'compatible',
    approvals: approvals?.permissions && approvals.input && approvals.elicitation ? 'full' : 'limited',
    sandbox: 'NOT TESTED', modelCalls: 0 }));
} catch (error) {
  const category = Object.values(FAILURE).includes(error.category) ? error.category : FAILURE.environment;
  console.error(JSON.stringify({ result: 'FAILED', category }));
  process.exitCode = 1;
} finally {
  await rpc?.close();
  await rm(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
}
