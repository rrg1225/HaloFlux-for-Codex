import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 22) {
  console.error('This launcher requires Windows and Node.js 22 or newer.');
  process.exit(1);
}
const { codexBinary } = await import('../src/codex-rpc.mjs');
const { startLocal, startupError } = await import('../src/server.mjs');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const options = { windowsHide: true, cwd, timeout: 7000 };
let codex;
try {
  codex = codexBinary();
  const { stdout } = await execute(codex, ['--version'], options);
  if (!/^codex-cli [\d.]+/m.test(stdout)) throw new Error();
  console.log('Codex CLI detected.');
} catch {
  codex = null;
  console.warn('Codex CLI unavailable. Demo mode is ready. Install Codex CLI or set CODEX_BIN to the native codex.exe.');
}
if (codex) {
  try {
    await execute(codex, ['login', 'status'], options);
    console.log('Codex login detected.');
  } catch {
    console.warn('Codex login could not be verified. Use codex login for live mode. Demo mode is ready.');
  }
}
try {
  const bridge = await startLocal(cwd);
  console.log('Press Ctrl+C to stop the local bridge.');
  const open = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
  if (process.env.HALOFLUX_NO_BROWSER !== '1') {
    execute(open, ['url.dll,FileProtocolHandler', bridge.origin], options).catch(() => {
      console.warn('Could not open the browser automatically. Open the local URL above.');
    });
  }
} catch (error) {
  console.error(startupError(error));
  process.exitCode = 1;
}
