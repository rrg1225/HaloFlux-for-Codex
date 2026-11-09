import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { CodexRpc, TransportError } from '../src/codex-rpc.mjs';
import { FAILURE } from '../src/diagnostics.mjs';
import { safetyContract } from '../src/protocol.mjs';
import { fixtureSchema } from './fixtures/protocol-schema.mjs';

test('stdio handshake, UTF-8 JSONL, pending-call timeout and process cleanup', async () => {
  const fakeServer = [
    "const readline = require('node:readline');",
    "let initialized = false;",
    "readline.createInterface({input: process.stdin}).on('line', line => {",
    " const msg = JSON.parse(line);",
    " if (msg.method === 'initialize') process.stdout.write(JSON.stringify({id: msg.id, result: {userAgent: \"codex/999.0.0-preview+build\", newField: true}}) + '\\n');",
    " if (msg.method === 'initialized') initialized = true;",
    " if (msg.method === 'probe' && initialized) {",
    "  const data = Buffer.from(JSON.stringify({id: msg.id, result: msg.params}) + '\\n');",
    "  const split = data.indexOf(Buffer.from('光')) + 1;",
    "  process.stdout.write(data.subarray(0, split));",
    "  setTimeout(() => process.stdout.write(data.subarray(split)), 5);",
    " }",
    "});",
  ].join('\n');
  const rpc = new CodexRpc({ command: process.execPath, args: ['-e', fakeServer], readSchema: fixtureSchema() });
  const exited = once(rpc.child, 'close');
  try {
    await rpc.initialize();
    assert.deepEqual(await rpc.call('probe', { value: '光环' }), { value: '光环' });
    await assert.rejects(rpc.call('no-response', {}, 20), TransportError);
    assert.equal(rpc.closed, true);
  } finally {
    rpc.close();
    await exited;
  }
});

test('safety fields must be wired to the requested methods and allow disabling the network', async () => {
  await fixtureSchema()(null, async read => {
    const client = read('ClientRequest');
    const check = () => safetyContract(() => client);
    assert.equal(await check(), true);
    const turn = client.oneOf.find(variant => variant.properties.method.enum.includes('turn/start'));
    turn.properties.params.$ref = '#/definitions/OtherParams';
    assert.equal(await check(), false);
    turn.properties.params.$ref = '#/definitions/TurnStartParams';
    client.definitions.SandboxPolicy.oneOf[0].properties.networkAccess.const = true;
    assert.equal(await check(), false);
  });
});

test('closing during schema inspection aborts the probe and closes the child once', async () => {
  const rpc = new CodexRpc({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 5000)'],
    readSchema(_command, _inspect, _env, signal) {
      return once(signal, 'abort').then(() => { throw signal.reason; });
    } });
  const initialization = assert.rejects(rpc.initialize(), { category: FAILURE.protocol });
  const close = rpc.close();
  assert.equal(rpc.close(), close);
  await close;
  await initialization;
  assert.equal(rpc.child.stdin.destroyed, true);
  assert.equal(rpc.child.stdout.destroyed, true);
});

test('an RPC call after child exit rejects immediately', async () => {
  const rpc = new CodexRpc({ command: process.execPath, args: ['-e', 'process.exit(1)'] });
  await new Promise(resolve => rpc.once('closed', resolve));
  await assert.rejects(rpc.call('initialize', {}), TransportError);
});

test('incompatible methods and malformed handshake cannot open a live connection', async t => {
  for (const [label, schema, result] of [
    ['missing core notification', fixtureSchema({ ServerNotification: { oneOf: [] } }), { userAgent: 'fixture/1' }],
    ['invalid handshake', fixtureSchema(), {}],
  ]) await t.test(label, async () => {
    const child = `require('node:readline').createInterface({input: process.stdin}).on('line', line => {
      const { id } = JSON.parse(line);
      console.log(JSON.stringify({ id, result: ${JSON.stringify(result)} }));
    });`;
    const rpc = new CodexRpc({ command: process.execPath, args: ['-e', child], readSchema: schema });
    const exited = once(rpc.child, 'close');
    try {
      await assert.rejects(rpc.initialize(), { category: FAILURE.protocol });
      assert.equal(rpc.pending.size, 0);
      assert.equal(rpc.sequence, label === 'missing core notification' ? 0 : 1);
    } finally {
      rpc.close();
      await exited;
    }
  });
});
