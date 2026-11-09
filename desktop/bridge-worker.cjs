const { realpath, stat } = require('node:fs/promises');
const parent = process.parentPort;
let bridge;
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  try { await bridge?.close(); }
  finally { process.exit(0); }
}

parent.on('close', stop);
parent.once('message', async ({ data: { cwd, port, access, fixture } }) => {
  try {
    cwd = await realpath(cwd);
    if (!(await stat(cwd)).isDirectory()) throw new Error('Invalid workspace');
    const { startBridge } = await import('../src/server.mjs');
    const options = fixture ? await import(fixture) : {};
    bridge = await startBridge({
      cwd, port, desktop: access, makeRpc: options.makeRpc,
      observe: (snapshot, notices) => parent.postMessage({ type: 'snapshot', snapshot, notices }),
    });
    parent.on('message', async ({ data: { type, id, hold } }) => {
      if (type === 'stop') return stop();
      if (stopping) return;
      try {
        let result;
        if (type === 'inspect-exit') result = bridge.inspectExit(hold === true);
        else if (type === 'interrupt') await bridge.interruptForExit();
        else return;
        parent.postMessage({ type: 'reply', id, result });
      } catch {
        parent.postMessage({ type: 'reply', id, failed: true });
      }
    });
    parent.postMessage({ type: 'ready', origin: bridge.origin });
  } catch (error) {
    parent.postMessage({ type: 'failed', reason: error.code === 'EADDRINUSE' ? 'port' : 'startup' });
    process.exitCode = 1;
    parent.close();
  }
});
