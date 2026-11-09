import { utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

export const visualPaths = [
  '/desktop-overlay', '/overlay.css', '/overlay.js', '/canvas-overlay',
  '/renderer.js', '/renderer.css', '/audio/sw421k.mp3', '/api/events', '/favicon.ico',
];

export async function startBackend({ cwd, port = 0, onSnapshot, onExit, fixture }) {
  const secret = () => randomBytes(32).toString('hex');
  const access = { control: secret(), visual: secret(), operation: secret(), visualPaths };
  const child = utilityProcess.fork(fileURLToPath(new URL('bridge-worker.cjs', import.meta.url)), [], {
    serviceName: 'HaloFlux Local Bridge', stdio: 'ignore',
  });
  const ready = Promise.withResolvers();
  const exited = Promise.withResolvers();
  const calls = new Map();
  let origin;
  let closing;
  let sequence = 0;
  child.on('message', message => {
    if (message.type === 'snapshot') onSnapshot?.(message.snapshot, message.notices);
    if (message.type === 'ready' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(message.origin)) {
      origin = message.origin;
      ready.resolve();
    }
    if (message.type === 'failed') {
      ready.reject(Object.assign(new Error('Bridge startup failed'), { reason: message.reason }));
    }
    if (message.type === 'reply') {
      const call = calls.get(message.id);
      if (message.failed) call?.reject(new Error('Bridge operation failed'));
      else call?.resolve(message.result);
    }
  });
  child.on('exit', () => {
    const wasReady = !!origin;
    origin = undefined;
    exited.resolve();
    const error = new Error('Bridge disconnected');
    ready.reject(error);
    for (const call of calls.values()) call.reject(error);
    if (wasReady && !closing) onExit?.();
  });
  child.on('error', () => ready.reject(new Error('Bridge process failed')));

  function close() {
    if (closing) return closing;
    closing = exited.promise;
    child.postMessage({ type: 'stop' });
    const deadline = setTimeout(() => child.kill(), 5000);
    return closing.finally(() => clearTimeout(deadline));
  }

  child.postMessage({ cwd, port, access, fixture });
  const startup = setTimeout(() => ready.reject(new Error('Bridge startup timed out')), 12000);
  try { await ready.promise; }
  catch (error) { await close(); throw error; }
  finally { clearTimeout(startup); }
  return {
    get origin() { return origin; },
    get pid() { return child.pid; },
    access,
    close,
    async request(type, hold) {
      if (!origin || closing) throw new Error('Bridge disconnected');
      const id = ++sequence;
      const call = Promise.withResolvers();
      calls.set(id, call);
      const deadline = new AbortController();
      try {
        child.postMessage({ type, id, hold });
        return await Promise.race([call.promise, delay(23000, undefined, { signal: deadline.signal }).then(() => {
          throw new Error('Bridge operation timed out');
        })]);
      } finally {
        deadline.abort();
        calls.delete(id);
      }
    },
  };
}
