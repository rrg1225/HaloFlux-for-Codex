import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startBridge } from '../src/server.mjs';

if (process.env.HALOFLUX_LIVE_TEST !== '1') throw new Error('Set HALOFLUX_LIVE_TEST=1 after authorizing model and scratch-file usage.');

// Use generated scratch data with the same sandbox and CLI policy as the bridge.
const temporaryRoot = await realpath(tmpdir());
const cwd = await realpath(await mkdtemp(join(temporaryRoot, 'haloflux-approval-')));
let timeAdvance = 0;
const bridge = await startBridge({ cwd, port: 0, clock: () => Date.now() + timeAdvance });

async function openPage() {
  const html = await (await fetch(bridge.origin)).text();
  const token = html.match(/name="haloflux-token" content="([a-f0-9]+)"/)[1];
  return async (action, args = {}, expected = 200) => {
    const response = await fetch(bridge.origin + '/api/action', {
      method: 'POST', headers: { Origin: bridge.origin, 'X-HaloFlux-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...args }), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    assert.equal(response.status, expected, action + ' ' + (data.error ?? ''));
    return data;
  };
}

async function until(probe, label) {
  for (let n = 0; n < 300; n++) {
    const result = await probe();
    if (result) return result;
    await delay(250);
  }
  assert.fail('Timed out: ' + label);
}

const api = await openPage();
const selected = process.argv.slice(2);
const includes = probe => !selected.length || selected.includes(probe);
async function run(prompt, kind, decision, inspect) {
  await api('new');
  await api('run', { prompt });
  let status;
  const view = await until(async () => {
    const { approvals } = await api('context', { review: true });
    if (approvals.length) {
      assert.equal(approvals.length, 1);
      assert.equal(approvals[0].kind, kind);
      if (['expired', 'interrupt'].includes(decision) && approvals[0].decisions.includes('accept')) return approvals[0];
      if (approvals[0].decisions.includes(decision) ||
        (decision === 'decline' && approvals[0].decisions.includes('cancel'))) return approvals[0];
      status = { decisions: approvals[0].decisions };
    }
    const { task } = await api('details');
    assert.ok(!task?.outcome, kind + ' turn ended before a reviewable request (' + task?.outcome + ')');
    if (!approvals.length) status = { timeline: task?.timeline.map(({ event, kind, status }) => ({ event, kind, status })) };
  }, kind + ' ' + decision + ' approval').catch(error => {
    console.error('Last protocol state:', JSON.stringify(status));
    throw error;
  });
  await inspect(view);
  const lifecycle = ['expired', 'interrupt'].includes(decision);
  const wireDecision = lifecycle ? 'accept' : view.decisions.includes(decision) ? decision : 'cancel';
  const { requestId, threadId, turnId, ticket } = view;
  if (decision === 'expired') timeAdvance = Math.max(0, view.expiresAt - Date.now() + 1000);
  else if (decision === 'interrupt') await api('interrupt');
  else await api('decision', { requestId, threadId, turnId, ticket, decision: wireDecision });
  await api('decision', { requestId, threadId, turnId, ticket, decision: wireDecision }, 400);
  timeAdvance = 0;
  const refreshed = await openPage();
  assert.ok(!(await refreshed('context', { review: true })).approvals.some(entry => entry.ticket === ticket));
  const task = await until(async () => {
    const { task } = await api('details');
    return task?.turnId === turnId && task.outcome && task;
  }, kind + ' terminal state');
  const disposition = decision === 'expired' ? 'expired' : decision === 'interrupt' ? 'closed' : wireDecision;
  assert.ok(task.timeline.some(event => event.event === 'approval-result' && event.status === disposition));
  if (wireDecision === 'cancel' || decision === 'interrupt') {
    assert.equal(task.outcome, 'interrupted');
    assert.ok(!task.timeline.some(event => event.event === 'item-completed' && event.kind === kind &&
      event.status === 'completed'), kind + ' ran after cancellation');
  } else {
    assert.ok(task.timeline.some(event => event.event === 'item-completed' && event.kind === kind &&
      event.status === (decision === 'accept' ? 'completed' : 'declined')), kind + ' item outcome');
  }
  console.log(kind + ' ' + disposition + ' | real request, duplicate/reload rejection and terminal state verified');
}

const workspacePath = path => isAbsolute(path) ? path : resolve(cwd, path);
const comparable = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
function fileCheck(name, type) {
  return async view => {
    assert.equal(view.files.length, 1);
    const [file] = view.files;
    assert.equal(comparable(workspacePath(file.path)), comparable(join(cwd, name)));
    assert.equal(file.type, type);
    assert.equal(file.destination, null);
    assert.match(file.diff, /HALOFLUX_APPROVAL/);
    if (type === 'add') await assert.rejects(readFile(join(cwd, name)), { code: 'ENOENT' });
  };
}

try {
  await api('connect');
  const guard = 'Use no other tools, no fallback and no further attempts even if denied. After the single attempt, reply briefly.';
  if (includes('file-accept')) {
    await run('Use the apply_patch tool once to create hf-create.txt in the current directory with exactly one line HALOFLUX_APPROVAL. ' + guard,
      'file', 'accept', fileCheck('hf-create.txt', 'add'));
    assert.equal((await readFile(join(cwd, 'hf-create.txt'), 'utf8')).trimEnd(), 'HALOFLUX_APPROVAL');
  }
  if (includes('file-decline')) {
    await writeFile(join(cwd, 'hf-deny.txt'), 'original\n');
    await run('Use apply_patch once to replace the existing line original with HALOFLUX_APPROVAL in hf-deny.txt in the current directory. ' + guard,
      'file', 'decline', fileCheck('hf-deny.txt', 'update'));
    assert.equal(await readFile(join(cwd, 'hf-deny.txt'), 'utf8'), 'original\n');
  }

  for (const decision of ['accept', 'decline']) {
    if (!includes('command-' + decision)) continue;
    const marker = 'HALOFLUX_' + decision.toUpperCase();
    const command = process.platform === 'win32' ? "[Console]::WriteLine('" + marker + "')" : "printf '%s\\n' " + marker;
    await run('Test the normal human approval flow: call the shell tool with sandbox_permissions=require_escalated and justification "Run the harmless HaloFlux approval probe?" to run exactly this read-only command: ' + command + '. ' + guard, 'command', decision, view => {
      assert.equal(comparable(view.cwd), comparable(cwd));
      assert.ok(view.command === command ||
        (process.platform === 'win32' && view.command.includes(marker) &&
          /^(?:"[A-Za-z]:[^"\r\n]+\\pwsh\.exe"|pwsh(?:\.exe)?) -Command ['"]?\[Console\]::WriteLine\(['"]HALOFLUX_(?:ACCEPT|DECLINE)['"]\)['"]?$/i.test(view.command)),
      'Unexpected shell command; no decision sent.');
    });
  }
  for (const decision of ['expired', 'interrupt']) {
    if (!includes('file-' + decision)) continue;
    const name = 'hf-' + decision + '.txt';
    await run('Use the apply_patch tool once to create ' + name +
      ' in the current directory with exactly one line HALOFLUX_APPROVAL. ' + guard,
    'file', decision, fileCheck(name, 'add'));
    await assert.rejects(readFile(join(cwd, name)), { code: 'ENOENT' });
  }
} finally {
  bridge.close();
  if (dirname(cwd) === temporaryRoot && basename(cwd).startsWith('haloflux-approval-')) {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
}
