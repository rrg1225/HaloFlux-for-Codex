import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 22) {
  console.error('This launcher requires Windows and Node.js 22 or newer.');
  process.exit(1);
}
const { codexBinary } = await import('../src/codex-rpc.mjs');
const { startLocal, startupError } = await import('../src/server.mjs');
const { inspectCli } = await import('../src/diagnostics.mjs');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const shutdown = new AbortController();
const options = { windowsHide: true, cwd, timeout: 7000, signal: shutdown.signal };
try {
  let consoleInput;
  const bridge = await startLocal(cwd, { onStop() {
    shutdown.abort();
    consoleInput?.close();
    process.stdin.destroy();
  } });
  consoleInput = createInterface({ input: process.stdin, terminal: false });
  consoleInput.on('line', line => { if (line.trim().toLowerCase() === 'q') bridge.stop(); });
  console.log('Type Q and press Enter, or press Ctrl+C to stop the local bridge.');
  const { cli, login } = await inspectCli(codexBinary, shutdown.signal);
  if (!shutdown.signal.aborted) {
    if (cli.status === 'ok') {
      console.log('Codex CLI ' + cli.version + ' detected.');
      if (login.status === 'ok') console.log('Codex login detected.');
      else console.warn('Codex login could not be verified. Check codex login status for live mode.');
    } else {
      console.warn('Codex CLI unavailable (' + cli.evidence + '). Demo mode is available. Check the installation or CODEX_BIN.');
    }
  }
  const open = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
  if (!shutdown.signal.aborted && process.env.HALOFLUX_NO_BROWSER !== '1') {
    execute(open, ['url.dll,FileProtocolHandler', bridge.origin], options).catch(() => {
      if (!shutdown.signal.aborted) console.warn('Could not open the browser automatically. Open the local URL above.');
    });
  }
} catch (error) {
  console.error(startupError(error));
  process.exitCode = 1;
}
