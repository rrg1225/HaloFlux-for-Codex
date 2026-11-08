import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexRpc } from '../src/codex-rpc.mjs';
import { startBridge } from '../src/server.mjs';

const duration = Number(process.env.HALOFLUX_SOAK_MS ?? 8000);
assert.ok(Number.isSafeInteger(duration) && duration >= 3000 && duration <= 3600000);
// A dedicated child uses production JSONL transport. It never starts Codex.
const fixture = String.raw`
const readline = require('node:readline');
const send = msg => console.log(JSON.stringify(msg));
const note = (method, params) => send({ method, params });
let turn, sequence = 0;
const end = status => { note('turn/completed', { ...turn, turn: { id: turn.turnId, status } }); turn = null; };
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line), { method, id, params } = msg;
  const reply = result => send({ id, result });
  if (method === 'initialized') return;
  if (method === 'thread/resume' || method === 'thread/start') {
    return reply({ thread: { id: params.threadId ?? 'thread-new', status: { type: 'idle' } } });
  }
  if (method === 'turn/start') {
    const turnId = 'turn-' + process.argv[1] + '-' + (++sequence);
    turn = { threadId: params.threadId, turnId };
    reply({ turn: { id: turnId, status: 'inProgress' } });
    note('turn/started', { ...turn, turn: { id: turnId } });
    for (let i = 0; i < (sequence % 4 === 0 ? 210 : 2); i++) {
      note('item/completed', { ...turn, item: { id: 'event-' + i, type: 'commandExecution', status: 'completed' } });
    }
    send({ id: 'approval-' + sequence, method: 'item/tool/requestUserInput', params: {
      ...turn, itemId: 'question', questions: [{ id: 'answer', question: 'Fixture question', options: null }],
      autoResolutionMs: 1000,
    } });
    return;
  }
  if (method === 'turn/interrupt') { end('interrupted'); return reply({}); }
  if (!method && turn && id === 'approval-' + sequence) {
    note('serverRequest/resolved', { threadId: turn.threadId, requestId: id });
    return end('completed');
  }
  if (method) reply({});
});
`;
const children = new Set();
let starts = 0;
let now = Date.now();
const bridge = await startBridge({ port: 0, clock: () => now, makeRpc() {
  const rpc = new CodexRpc({ command: process.execPath, args: ['-e', fixture, String(++starts)] });
  children.add(rpc);
  rpc.child.once('close', () => children.delete(rpc));
  rpc.approvalContract = { input: true, permissions: true, elicitation: true };
  rpc.initialize = async () => {
    await rpc.call('initialize', {});
    rpc.send({ method: 'initialized' });
  };
  return rpc;
} });
const token = (await (await fetch(bridge.origin)).text()).match(/name="haloflux-token" content="([a-f0-9]+)"/)[1];
const api = async (action, fields, status = 200) => {
  const response = await fetch(bridge.origin + '/api/action', {
    method: 'POST', headers: { Origin: bridge.origin, 'X-HaloFlux-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...fields, action }),
  });
  if (status === null) {
    await response.arrayBuffer();
    return response.status;
  }
  assert.equal(response.status, status, action);
  return response.json();
};
async function client() {
  const response = await fetch(bridge.origin + '/api/events');
  assert.equal(response.status, 200);
  const done = (async () => {
    let latest, buffer = '';
    for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const payload = packet.match(/^data: (.*)$/m)?.[1];
        if (payload) {
          latest = JSON.parse(payload);
          assert.doesNotMatch(payload, /fixture prompt|Fixture question|requestId|threadId|turnId|ticket/);
        }
      }
    }
    return latest;
  })();
  // Track rejection immediately while leaving the promise awaitable at disconnect.
  done.catch(() => {});
  return { done };
}
async function until(check, label) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(15);
  }
  throw new Error('Soak fixture timed out waiting for ' + label + ' (cycle ' + cycles + ', child generation ' + starts + ')');
}
const memory = () => {
  global.gc();
  const { heapUsed, rss } = process.memoryUsage();
  return { heapUsed, rss };
};
let cycles = 0, expiries = 0, interrupts = 0, reconnects = 0, contests = 0, maxTimeline = 0;
const samples = [];
const started = performance.now();
try {
  await api('connect');
  let tabs = await Promise.all([client(), client()]);
  while (performance.now() - started < duration || cycles < 10) {
    const threadId = 'thread-' + (cycles % 4);
    await api('resume', { threadId });
    await api('run', { prompt: 'fixture prompt' });
    const ticket = await until(async () => (await api('context', { review: true })).approvals[0], 'approval');
    const decide = { ...ticket, decision: 'answer', answers: { answer: 'local answer' } };
    if (cycles % 7 === 0) {
      now += 1001;
      await api('decision', decide, 400);
      expiries++;
    } else if (cycles % 7 === 1) {
      await api('interrupt');
      await api('decision', decide, 400);
      interrupts++;
    } else {
      const replies = await Promise.all([api('decision', decide, null), api('decision', decide, null)]);
      assert.deepEqual(replies.sort(), [200, 400]);
      contests++;
    }
    const task = await until(async () => {
      const { task } = await api('details');
      return task?.outcome && task;
    }, 'terminal task');
    assert.equal(task.threadId, threadId);
    assert.equal(task.outcome, cycles % 7 === 1 ? 'interrupted' : 'completed');
    maxTimeline = Math.max(maxTimeline, task.timeline.length);
    assert.ok(task.timeline.length <= 200);
    assert.deepEqual((await api('context', { review: true })).approvals, []);
    if (++cycles % 10 === 0) {
      bridge.disconnectStreams();
      for (const { done } of tabs) assert.equal((await done).live.hasThread, true);
      tabs = await Promise.all([client(), client()]);
      reconnects++;
      if (cycles % 20 === 0) {
        const [rpc] = children;
        const exited = once(rpc.child, 'close');
        rpc.child.kill();
        await exited;
        await until(() => children.size === 1, 'replacement child');
        await until(() => api('context', {}, 200).catch(() => false), 'restored context');
      }
      samples.push(memory());
      // Keep the measurement list bounded during operator-selected long runs.
      if (samples.length > 60) samples.splice(1, 1);
    }
    await delay(80);
  }
  bridge.disconnectStreams();
  await Promise.all(tabs.map(({ done }) => done));
  assert.equal(maxTimeline, 200);
} finally {
  const exited = [...children].map(rpc => once(rpc.child, 'close'));
  bridge.close();
  await Promise.all(exited);
  assert.equal(children.size, 0);
}
console.log(JSON.stringify({ durationMs: Math.round(performance.now() - started), cycles,
  starts, reconnects, expiries, interrupts, contests, maxTimeline, childrenAfterClose: children.size,
  gcSamples: samples, final: memory() }, null, 2));
