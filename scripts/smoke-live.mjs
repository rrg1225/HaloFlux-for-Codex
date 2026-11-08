import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { CodexSession } from '../src/session.mjs';
import { FAILURE } from '../src/diagnostics.mjs';
import { RESULT, verifyExecution } from './test-results.mjs';

const report = { protocol: RESULT.skipped, execution: RESULT.skipped, failureHandling: RESULT.skipped,
  sessionChecks: RESULT.skipped };
if (process.env.HALOFLUX_LIVE_TEST !== '1') {
  console.log(JSON.stringify(report));
  process.exit(2);
}

const temporaryRoot = await realpath(tmpdir());
const cwd = await realpath(await mkdtemp(join(temporaryRoot, 'haloflux-live-')));
const seen = new Set();
let latest;
const session = new CodexSession({
  cwd,
  publish(snapshot) {
    latest = snapshot;
    seen.add(snapshot.state);
    if (snapshot.activity) seen.add(snapshot.activity);
  },
});

async function until(predicate, label, timeout = 90000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('Timed out: ' + label);
    await delay(80);
  }
}

try {
  await session.connect();
  if ([FAILURE.auth, FAILURE.environment, FAILURE.sandbox].includes(session.lastFailure)) {
    throw new Error('Codex connection blocked by the local environment.');
  }
  assert.equal(latest.connection, 'connected');
  report.protocol = RESULT.protocol;
  const { threadId } = await session.action({ action: 'new' });
  assert.ok(threadId);
  const terminalCommands = new Map();
  const captureCommand = ({ method, params }) => {
    if (method === 'item/completed' && params?.threadId === threadId &&
      params.item?.type === 'commandExecution' && /\b(?:Write-Output|printf)\b.*HALOFLUX_SMOKE/i.test(params.item.command)) {
      terminalCommands.set(params.turnId, params.item);
    }
  };
  session.rpc.on('notification', captureCommand);
  await session.action({
    action: 'run',
    prompt: 'HaloFlux smoke test. Use one read-only local shell command exactly as follows: ' +
      (process.platform === 'win32' ? "Write-Output 'HALOFLUX_SMOKE'" : "printf '%s\\n' HALOFLUX_SMOKE") +
      '. Then reply with one short sentence. Do not modify files, request escalation, or use other tools.',
  });
  await until(() => latest.outcome || latest.approvals.length, 'turn outcome');
  if (latest.approvals.length) {
    report.execution = RESULT.blocked;
    throw new Error('Local Codex policy requested approval.');
  }
  const { task } = await session.action({ action: 'details' });
  session.rpc?.off('notification', captureCommand);
  assert.match(task.prompt, /HALOFLUX_SMOKE/);
  const command = terminalCommands.get(task.turnId);
  const sandboxBlocked = session.lastFailure === FAILURE.sandbox;
  const terminalReported = task.timeline.some(event =>
    event.event === 'item-completed' && event.kind === 'command' && event.status === command?.status);
  report.execution = verifyExecution({
    exitCode: command?.status === 'completed' ? command.exitCode : null,
    stdout: command?.aggregatedOutput,
    expected: 'HALOFLUX_SMOKE',
    environmentBlocked: sandboxBlocked,
  });
  if (sandboxBlocked && command?.status === 'failed' && terminalReported) {
    report.failureHandling = RESULT.handled;
  }
  assert.equal(report.execution, RESULT.execution, 'Read-only command execution was not verified.');
  assert.ok(terminalReported, 'The bridge timeline omitted the command terminal state.');
  assert.equal(latest.outcome, 'completed');
  assert.ok(task.reply);
  for (const kind of ['working', 'tool_running', 'command', 'streaming', 'completed']) assert.ok(seen.has(kind), kind);
  await until(() => latest.state === 'idle', 'idle');
  const firstRpc = session.rpc;
  firstRpc.child.kill();
  await until(() => session.rpc !== firstRpc && latest.connection === 'connected' && latest.hasThread, 'recovery', 30000);
  assert.equal(session.threadId, threadId);
  await session.action({ action: 'resume', threadId });
  const { threads } = await session.action({ action: 'threads' });
  assert.ok(threads.some(thread => thread.id === threadId));
  await session.action({
    action: 'run',
    prompt: 'This is a HaloFlux interrupt probe. Write a short explanation of Canvas frame timing. Do not use tools or modify files.',
  });
  await until(() => latest.canInterrupt, 'turn/started');
  await session.action({ action: 'interrupt' });
  await until(() => latest.outcome, 'interrupt outcome');
  assert.equal(latest.outcome, 'interrupted');
  report.sessionChecks = RESULT.protocol;
} catch (error) {
  if (report.protocol === RESULT.skipped && [FAILURE.auth, FAILURE.environment, FAILURE.sandbox].includes(session.lastFailure)) {
    report.protocol = RESULT.blocked;
  } else if (report.protocol === RESULT.skipped) {
    report.protocol = RESULT.failure;
  } else if (report.execution === RESULT.skipped) {
    report.execution = [FAILURE.auth, FAILURE.environment, FAILURE.sandbox].includes(session.lastFailure)
      ? RESULT.blocked : RESULT.failure;
  } else if (report.execution === RESULT.execution) {
    report.sessionChecks = RESULT.failure;
  }
  process.exitCode = 1;
  console.error(error.message);
} finally {
  session.stop();
  if (dirname(cwd) === temporaryRoot && basename(cwd).startsWith('haloflux-live-')) {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
  }
  console.log(JSON.stringify(report));
}
