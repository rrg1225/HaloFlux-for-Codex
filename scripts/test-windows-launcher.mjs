import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pkg from '../package.json' with { type: 'json' };

assert.equal(process.platform, 'win32');
const system = join(process.env.SystemRoot, 'System32');
const expectMissing = process.argv.includes('--missing-cli');
const env = { ...process.env, HALOFLUX_PORT: '0', HALOFLUX_NO_BROWSER: '1', HALOFLUX_NO_PAUSE: '1' };
// The missing-CLI probe uses a caller-provided PATH containing Node and Windows tools only.
if (expectMissing) delete env.CODEX_BIN;
else env.CODEX_BIN = 'invalid';
const child = spawn(join(system, 'cmd.exe'), ['/d', '/c', 'Start-HaloFlux.cmd'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)), windowsHide: true,
  env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
const done = once(child, 'close');
const lines = createInterface({ input: child.stdout });
let stderr = '';
child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
const timeout = (ms, message) => delay(ms, null, { ref: false }).then(() => { throw new Error(message); });
try {
  const origin = await Promise.race([
    new Promise(resolve => lines.on('line', line => {
      const match = /^HaloFlux for Codex\s+(http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
      if (match) resolve(match[1]);
    })),
    done.then(() => { throw new Error('Launcher exited before serving.'); }),
    timeout(15000, 'Launcher did not print its loopback origin.'),
  ]);
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200);
  assert.ok((await response.text()).includes(pkg.version));
  const stream = await fetch(origin + '/api/events', { signal: AbortSignal.timeout(5000) });
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    let data = '';
    while (!data.includes('\n\n')) {
      const frame = await reader.read();
      assert.equal(frame.done, false, 'SSE ended before its initial state.');
      data += frame.value;
    }
    const packet = JSON.parse(data.match(/^data: (.+)$/m)[1]);
    assert.equal(packet.demo.state, 'idle');
    assert.equal(packet.live.connection, 'disconnected');
    child.stdin.write('Q\r\nQ\r\n');
    assert.equal((await reader.read()).done, true, 'Active SSE did not receive a clean EOF on shutdown.');
  } finally { await reader.cancel(); }
  const [code] = await Promise.race([done, timeout(10000, 'Launcher did not stop after Q.')]);
  assert.equal(code, 0);
  const reason = expectMissing ? 'missing' : 'invalid-path';
  assert.ok(stderr.includes('Codex CLI unavailable (' + reason + '). Demo mode is available.'));
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(3000) }),
    error => error.cause?.code === 'ECONNREFUSED');
  console.log('Extracted CMD launcher, initial SSE and Q shutdown verified without a Codex CLI.');
} finally {
  lines.close();
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    await promisify(execFile)(join(system, 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'],
      { windowsHide: true, timeout: 5000 }).catch(() => {});
  }
  child.stdin.destroy();
  await done.catch(() => {});
}
