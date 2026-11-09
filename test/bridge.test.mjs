import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { CodexSession } from '../src/session.mjs';
import { startBridge } from '../src/server.mjs';
import { codexFailure, FAILURE } from '../src/diagnostics.mjs';
import { safetyContract } from '../src/protocol.mjs';

class FixtureRpc extends EventEmitter {
  constructor() {
    super();
    this.calls = [];
    this.sent = [];
    this.approvalContract = { command: ['accept', 'decline', 'cancel'], file: ['accept', 'decline'],
      permissions: true, input: true, elicitation: true };
  }

  async initialize() {}
  send(message) { this.sent.push(message); }

  async call(method, params) {
    this.calls.push([method, params]);
    const thread = { id: 'thread', status: { type: method === 'thread/resume' ? 'active' : 'idle' } };
    const turn = { id: 'turn', status: 'inProgress', items: [] };
    if (method === 'thread/turns/list' || method === 'thread/list') return { data: [method === 'thread/list' ? thread : turn] };
    if (method === 'turn/start') return { turn };
    if (method === 'turn/interrupt') {
      this.emit('notification', {
        method: 'turn/completed', params: { threadId: 'thread', turn: { ...turn, status: 'interrupted' } },
      });
      return {};
    }
    return { thread };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('closed');
  }
}

test('session routes explicit decline, recovers active turn after exit and interrupts', async () => {
  const children = [];
  const session = new CodexSession({
    cwd: process.cwd(), publish() {},
    makeRpc() { const rpc = new FixtureRpc(); children.push(rpc); return rpc; },
  });
  try {
    await session.connect();
    await session.action({ action: 'run', prompt: 'Private prompt' });
    const first = children[0];
    assert.equal(session.snapshot.canInterrupt, false);
    await assert.rejects(session.action({ action: 'interrupt' }), /没有可中断/);
    first.emit('notification', {
      method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn', status: 'inProgress' } },
    });
    assert.equal(session.snapshot.canInterrupt, true);
    const request = { id: 27, method: 'item/fileChange/requestApproval',
      params: { threadId: 'thread', turnId: 'turn', grantRoot: 'PRIVATE_PATH' } };
    first.emit('request', request);
    first.emit('request', request);
    assert.equal(session.snapshot.state, 'approval_required');
    assert.equal(first.sent.length, 0);
    const { approvals: [approval] } = await session.action({ action: 'context', review: true });
    assert.doesNotMatch(JSON.stringify(session.snapshot), /PRIVATE_PATH|grantRoot|turnId|threadId/);
    const decline = { ...approval, action: 'decision', decision: 'decline' };
    await session.action(decline);
    await assert.rejects(session.action(decline), /失效/);
    assert.deepEqual(first.sent, [{ id: 27, result: { decision: 'decline' } }]);
    first.close();
    assert.equal(session.snapshot.connection, 'disconnected');
    assert.equal(session.snapshot.active, false);
    for (let i = 0; i < 100 && session.snapshot.connection !== 'connected'; i++) await delay(20);
    assert.equal(session.snapshot.connection, 'connected');
    assert.equal(session.snapshot.active, true);
    const second = children[1];
    assert.deepEqual(second.calls.map(([method]) => method), ['thread/resume', 'thread/turns/list']);
    await session.action({ action: 'interrupt' });
    assert.equal(session.snapshot.outcome, 'interrupted');
    assert.deepEqual(second.calls.at(-1), ['turn/interrupt', { threadId: 'thread', turnId: 'turn' }]);
  } finally {
    session.stop();
  }
});

test('loopback HTTP rejects untrusted writes and sends only aggregate event snapshots', async () => {
  const rpc = new FixtureRpc();
  const bridge = await startBridge({ port: 0, makeRpc: () => rpc,
    resolveCodex() { throw new Error('PRIVATE_BINARY_PATH'); } });
  try {
    const page = await (await fetch(bridge.origin)).text();
    const token = page.match(/name="haloflux-token" content="([a-f0-9]+)"/)[1];
    const endpoint = bridge.origin + '/api/action';
    const send = (origin, token, action) => fetch(endpoint, {
      method: 'POST', headers: { Origin: origin, 'X-HaloFlux-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    assert.equal((await send('https://example.com', token, { action: 'connect' })).status, 403);
    assert.equal((await send(bridge.origin, 'bad', { action: 'connect' })).status, 403);
    assert.equal((await send(bridge.origin, 'bad', { action: 'context', review: true })).status, 403);
    assert.equal((await send(bridge.origin, 'bad', { action: 'health' })).status, 403);
    assert.equal((await send(undefined, token, { action: 'details' })).status, 403);
    assert.equal((await fetch(bridge.origin + '/api/events', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(bridge.origin + '/src/session.mjs')).status, 404);
    assert.equal((await send(bridge.origin, token, { action: 'connect' })).status, 200);
    assert.equal((await send(bridge.origin, token, { action: 'run', prompt: 'PRIVATE_PROMPT' })).status, 200);
    rpc.emit('request', { id: 2, method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread', turnId: 'turn', itemId: 'cmd', cwd: 'PRIVATE_CWD', command: 'PRIVATE_COMMAND' } });
    const { task } = await (await send(bridge.origin, token, { action: 'details' })).json();
    assert.equal(task.prompt, 'PRIVATE_PROMPT');
    const { approvals } = await (await send(bridge.origin, token, { action: 'context', review: true })).json();
    assert.equal(approvals[0].command, 'PRIVATE_COMMAND');
    rpc.emit('notification', { method: 'item/completed', params: { threadId: 'thread', turnId: 'turn',
      item: { id: 'other-command', type: 'commandExecution', status: 'failed',
        aggregatedOutput: 'windows sandbox: helper_unknown_error: setup refresh had errors PRIVATE_SANDBOX_PATH' } } });
    const health = await (await send(bridge.origin, token, { action: 'health' })).json();
    assert.equal(health.cli.status, 'failed');
    assert.equal(health.login.status, 'unchecked');
    assert.equal(health.sandbox.status, 'failed');
    assert.equal(health.sandbox.evidence, 'bridge-failure');
    assert.equal(health.lastFailure, FAILURE.sandbox);
    assert.doesNotMatch(JSON.stringify(health), /PRIVATE_|token|threadId|turnId/);
    const stream = await fetch(bridge.origin + '/api/events');
    const reader = stream.body.getReader();
    try {
      const packet = new TextDecoder().decode((await reader.read()).value);
      const { live, demo } = JSON.parse(packet.match(/^data: (.*)$/m)[1]);
      assert.equal(live.state, 'approval_required');
      assert.equal(demo.state, 'idle');
      assert.doesNotMatch(packet, /PRIVATE_|threadId|turnId|requestId|ticket|token/);
    } finally {
      await reader.cancel();
    }
    bridge.disconnectStreams();
    const restored = (await fetch(bridge.origin + '/api/events')).body.getReader();
    try {
      const packet = new TextDecoder().decode((await restored.read()).value);
      assert.equal(JSON.parse(packet.match(/^data: (.*)$/m)[1]).live.state, 'approval_required');
      const starts = rpc.calls.filter(([method]) => method === 'turn/start');
      assert.equal(starts.length, 1);
      assert.deepEqual(starts[0][1].sandboxPolicy, { type: 'readOnly', networkAccess: false });
      assert.equal(starts[0][1].approvalsReviewer, 'user');
      rpc.emit('notification', { method: 'turn/completed', params: { threadId: 'thread',
        turn: { id: 'turn', status: 'completed' } } });
      const terminal = new TextDecoder().decode((await restored.read()).value);
      assert.equal(JSON.parse(terminal.match(/^data: (.*)$/m)[1]).live.outcome, 'completed');
      assert.equal(rpc.calls.filter(([method]) => method === 'turn/start').length, 1);
    } finally { await restored.cancel(); }
  } finally {
    bridge.close();
  }
});

test('rejects an incompatible safety schema and reports structured external failures', async () => {
  assert.equal(await safetyContract(async () => ({ definitions: {} })), false);
  assert.equal(codexFailure({ codexErrorInfo: 'sandboxError' }), FAILURE.sandbox);
  assert.equal(codexFailure({ codexErrorInfo: 'unauthorized' }), FAILURE.auth);
  assert.equal(codexFailure({ code: -32602 }), FAILURE.protocol);
  assert.equal(codexFailure({ message: 'PRIVATE_LOG' }), FAILURE.environment);
  const rpc = new FixtureRpc();
  rpc.safetyContract = false;
  const session = new CodexSession({ cwd: '.', publish() {}, makeRpc: () => rpc });
  try {
    await assert.rejects(session.action({ action: 'connect' }), /协议不兼容/);
    assert.equal(session.lastFailure, FAILURE.protocol);
    assert.equal(session.snapshot.connection, 'disconnected');
    assert.equal(rpc.closed, true);
    assert.deepEqual(rpc.calls, []);
  } finally { session.stop(); }
});

test('an incompatible App Server leaves the HTTP demo usable', async () => {
  const rpc = new FixtureRpc();
  rpc.safetyContract = false;
  const bridge = await startBridge({ port: 0, makeRpc: () => rpc });
  try {
    const page = await (await fetch(bridge.origin)).text();
    const token = page.match(/name="haloflux-token" content="([a-f0-9]+)"/)[1];
    const send = body => fetch(bridge.origin + '/api/action', {
      method: 'POST',
      headers: { Origin: bridge.origin, 'X-HaloFlux-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const rejected = await send({ action: 'connect' });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /协议不兼容/);
    const demo = await send({ action: 'demo', scenario: 'approval' });
    assert.equal(demo.status, 200);
    assert.deepEqual(await demo.json(), {});
    assert.equal(rpc.closed, true);
    assert.deepEqual(rpc.calls, []);
    const closing = bridge.close();
    assert.equal(bridge.close(), closing);
    await closing;
  } finally { await bridge.close(); }
});

test('scopes early requests and cleans up cancellation, resolution, expiry and concurrent decisions', async () => {
  let now = 1000;
  const rpc = new FixtureRpc();
  const call = rpc.call.bind(rpc);
  const scope = { threadId: 'thread', turnId: 'turn' };
  const request = (id, method, details, scoped = scope) => rpc.emit('request',
    { id, method, params: { ...scoped, ...details } });
  const input = 'item/tool/requestUserInput';
  const questions = [{ id: 'text', header: 'Free', question: 'What should run?', options: null }];
  rpc.call = (method, params) => {
    if (method === 'turn/start') request('early', input, { questions, autoResolutionMs: 600 });
    return call(method, params);
  };
  const session = new CodexSession({ cwd: '.', publish() {}, makeRpc: () => rpc, clock: () => now });
  const reviews = async () => (await session.action({ action: 'context', review: true })).approvals;
  const decide = (view, decision, answers) => session.action({ ...view, action: 'decision', decision, answers });
  try {
    await session.connect();
    await session.action({ action: 'run', prompt: 'offline fixture' });
    const [early] = await reviews();
    assert.equal(early.requestId, 'early');
    assert.equal(early.questions[0].free, true);
    await decide(early, 'answer', { text: 'Test value' });
    request('expiry', input, { questions, autoResolutionMs: 500 });
    now += 501;
    assert.deepEqual(await reviews(), []);
    request('cancel', input, { questions });
    await decide((await reviews())[0], 'decline');
    request('network', 'item/commandExecution/requestApproval', {
      networkApprovalContext: { host: '127.0.0.1:9000', protocol: 'http' }, availableDecisions: ['accept', 'decline'],
    });
    request('permissions', 'item/permissions/requestApproval', { cwd: 'test', permissions: { network: { enabled: true } } });
    const [network, permissions] = await reviews();
    assert.equal(network.host, '127.0.0.1:9000');
    assert.equal(network.protocol, 'http');
    const competing = await Promise.allSettled([decide(network, 'accept'), decide(network, 'decline')]);
    assert.deepEqual(competing.map(result => result.status), ['fulfilled', 'rejected']);
    await decide(permissions, 'decline');
    request('resolved', input, { questions });
    rpc.emit('notification', { method: 'serverRequest/resolved', params: { threadId: 'thread', requestId: 'resolved' } });
    assert.deepEqual(await reviews(), []);
    request('mcp', 'mcpServer/elicitation/request', { turnId: null, mode: 'url', url: 'https://example.invalid' });
    request('wrong', input, { questions }, { ...scope, turnId: 'different-turn' });
    request('unknown', 'unknown/method', {});
    assert.deepEqual(await reviews(), []);
    assert.deepEqual(rpc.sent, [
      { id: 'early', result: { answers: { text: { answers: ['Test value'] } } } },
      { id: 'expiry', result: { answers: {} } },
      { id: 'cancel', result: { answers: {} } },
      { id: 'network', result: { decision: 'accept' } },
      { id: 'permissions', result: { permissions: {}, scope: 'turn' } },
      { id: 'mcp', result: { action: 'decline', content: null, _meta: null } },
      { id: 'wrong', error: { code: -32601, message: 'Request unavailable in HaloFlux.' } },
      { id: 'unknown', error: { code: -32601, message: 'Request unavailable in HaloFlux.' } },
    ]);
  } finally { session.stop(); }
});

test('approval requires a scoped, current patch and expires exactly once', async () => {
  let now = 1000;
  const rpc = new FixtureRpc();
  const session = new CodexSession({ cwd: '.', publish() {}, makeRpc: () => rpc, clock: () => now });
  const scope = { threadId: 'thread', turnId: 'turn' };
  const request = id => rpc.emit('request', { id, method: 'item/fileChange/requestApproval',
    params: { ...scope, itemId: 'patch', startedAtMs: 1000 } });
  const review = async () => (await session.action({ action: 'context', review: true })).approvals[0];
  const decide = (entry, scopeOverride) => session.action({ ...entry, ...scopeOverride, action: 'decision', decision: 'accept' });
  const patch = diff => rpc.emit('notification', { method: 'item/fileChange/patchUpdated',
    params: { ...scope, itemId: 'patch', changes: [{ path: 'sample.txt', kind: { type: 'add' }, diff }] } });
  try {
    await session.connect();
    await session.action({ action: 'run', prompt: 'create sample' });
    request(8);
    await assert.rejects(decide(await review()), /不可用/);
    patch('+version 1');
    const old = await review();
    patch('+version 2');
    await assert.rejects(decide(old), /已变化/);
    const current = await review();
    await assert.rejects(decide(current, { threadId: 'other-thread' }), /失效/);
    await assert.rejects(decide(current, { turnId: 'other' }), /失效/);
    await assert.rejects(decide(current, { requestId: '8' }), /失效/);
    await decide(current);
    await assert.rejects(decide(current), /失效/);
    request(8);
    assert.equal(await review(), undefined);
    request(9);
    const expired = await review();
    now += 120001;
    await assert.rejects(decide(expired), /失效/);
    assert.deepEqual(rpc.sent, [
      { id: 8, result: { decision: 'accept' } }, { id: 9, result: { decision: 'decline' } },
    ]);
  } finally {
    session.stop();
  }
});

test('network, permission and input responses follow their own wire formats', async () => {
  const rpc = new FixtureRpc();
  const session = new CodexSession({ cwd: '.', publish() {}, makeRpc: () => rpc });
  const scope = { threadId: 'thread', turnId: 'turn', itemId: 'item' };
  function request(id, method, fields) {
    rpc.emit('request', { id, method, params: { ...scope, ...fields } });
  }
  const review = async () => (await session.action({ action: 'context', review: true })).approvals[0];
  const decide = (view, decision, answers) => session.action({ ...view, action: 'decision', decision, answers });
  try {
    await session.connect();
    await session.action({ action: 'run', prompt: 'probe' });
    request(1, 'item/commandExecution/requestApproval', {
      networkApprovalContext: { host: 'example.invalid:443', protocol: 'https' },
      availableDecisions: ['acceptForSession', 'decline'],
    });
    const network = await review();
    assert.equal(network.kind, 'network');
    assert.deepEqual(network.decisions, ['decline']);
    await assert.rejects(decide(network, 'accept'), /不可用/);
    await decide(network, 'decline');
    const permissions = { network: { enabled: true } };
    request(2, 'item/permissions/requestApproval', { cwd: 'sandbox', permissions });
    await decide(await review(), 'accept', { permissions: { fileSystem: {} }, scope: 'session' });
    request(3, 'item/tool/requestUserInput', { questions: [
      { id: '__proto__', header: 'Question', question: 'Choose', options: [{ label: 'Yes', description: 'Opt in' }] },
    ] });
    const input = await review();
    await assert.rejects(decide(input, 'answer', { wrong: 'Yes' }), /答案不完整/);
    await decide(input, 'answer', { ['__proto__']: 'Yes' });
    request(4, 'mcpServer/elicitation/request', { serverName: 'fixture', mode: 'url', url: 'https://example.invalid' });
    const mcp = await review();
    assert.deepEqual(mcp.decisions, ['decline']);
    assert.equal(mcp.url, undefined);
    await decide(mcp, 'decline');
    assert.deepEqual(rpc.sent, [
      { id: 1, result: { decision: 'decline' } },
      { id: 2, result: { permissions, scope: 'turn' } },
      { id: 3, result: { answers: { ['__proto__']: { answers: ['Yes'] } } } },
      { id: 4, result: { action: 'decline', content: null, _meta: null } },
    ]);
  } finally {
    session.stop();
  }
});

test('interrupt locks pending decisions until Codex reports the terminal state', async () => {
  const rpc = new FixtureRpc();
  const call = rpc.call.bind(rpc);
  rpc.call = (method, params) => method === 'turn/interrupt' ? Promise.resolve({}) : call(method, params);
  const session = new CodexSession({ cwd: '.', publish() {}, makeRpc: () => rpc });
  const scope = { threadId: 'thread', turnId: 'turn' };
  try {
    await session.connect();
    await session.action({ action: 'run', prompt: 'interrupt test' });
    rpc.emit('notification', { method: 'turn/started', params: { ...scope, turn: { id: 'turn' } } });
    const request = id => rpc.emit('request', { id, method: 'item/commandExecution/requestApproval',
      params: { ...scope, itemId: 'cmd', command: 'probe', cwd: 'scratch' } });
    request(7);
    const { approvals: [view] } = await session.action({ action: 'context', review: true });
    await session.action({ action: 'interrupt' });
    await assert.rejects(session.action({ ...view, action: 'decision', decision: 'accept' }), /失效/);
    request(8);
    assert.deepEqual(rpc.sent, [{ id: 8, result: { decision: 'decline' } }]);
    rpc.emit('notification', { method: 'turn/completed', params: { ...scope, turn: { id: 'turn', status: 'interrupted' } } });
    assert.equal(session.snapshot.interrupting, false);
    assert.equal(session.snapshot.outcome, 'interrupted');
    assert.deepEqual((await session.action({ action: 'context', review: true })).approvals, []);
  } finally {
    session.stop();
  }
});
