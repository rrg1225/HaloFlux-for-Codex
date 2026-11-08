import assert from 'node:assert/strict';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { startBridge } from '../src/server.mjs';

if (process.env.HALOFLUX_LIVE_TEST !== '1') throw new Error('Set HALOFLUX_LIVE_TEST=1 after authorizing model and scratch-file usage.');

// Browser fixture. Only the browser starts a turn or responds to an approval.
const root = await realpath(tmpdir());
const cwd = await realpath(await mkdtemp(join(root, 'haloflux-edge-live-')));
const bridge = await startBridge({ cwd, port: Number(process.env.HALOFLUX_PORT ?? 4647) });
const abort = new AbortController();
const stop = () => abort.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
console.log('Edge isolated bridge ' + bridge.origin);

try {
  const response = await fetch(bridge.origin + '/api/events', { signal: abort.signal });
  let buffer = '';
  let disconnect;
  const decode = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decode.decode(chunk, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const packet = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = packet.split('\n').find(line => line.startsWith('data: '));
      if (!disconnect && data && JSON.parse(data.slice(6)).live.outcome === 'completed') {
        await assert.rejects(access(join(cwd, 'hf-edge-deny.txt')), { code: 'ENOENT' });
        console.log('Rejected file is absent. Ending the SSE streams once.');
        disconnect = setTimeout(bridge.disconnectStreams, 2500);
        abort.signal.addEventListener('abort', () => clearTimeout(disconnect), { once: true });
      }
    }
  }
  if (!abort.signal.aborted) await new Promise(resolve => abort.signal.addEventListener('abort', resolve, { once: true }));
} catch (error) {
  if (!abort.signal.aborted) throw error;
} finally {
  bridge.close();
  if (dirname(cwd) === root && basename(cwd).startsWith('haloflux-edge-live-')) {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}
