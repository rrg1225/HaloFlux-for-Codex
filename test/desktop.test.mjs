import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopNotifications } from '../desktop/notifications.mjs';
import { renderBudget } from '../desktop/render-budget.mjs';
import { defaults, visibleBounds } from '../desktop/preferences.mjs';

test('balanced budget raises the overlay only after sustained main-window headroom', () => {
  const budget = renderBudget();
  const limits = () => budget.limits(defaults, true, true);
  const healthy = { fps: 50, p95: 24 };
  assert.deepEqual(limits(), { main: 60, overlay: 20 });
  assert.equal(budget.measure(healthy, 60, 0), false);
  assert.equal(budget.measure(healthy, 60, 1), false);
  assert.equal(budget.measure(healthy, 60, 2000), false);
  assert.equal(budget.measure(healthy, 60, 4000), true);
  assert.deepEqual(limits(), { main: 60, overlay: 24 });
  assert.equal(budget.measure({ fps: 29, p95: 60 }, 60, 6000), true);
  assert.deepEqual(limits(), { main: 60, overlay: 20 });
  assert.deepEqual(budget.limits(defaults, false, false), { main: 60, overlay: 30 });
  assert.deepEqual(budget.limits({ ...defaults, budget: 'overlay' }, true, false), { main: 20, overlay: 30 });
});

test('notification dedupe and cooldown work independently per category', () => {
  let now = 0;
  const messages = [];
  const notices = desktopNotifications(defaults, () => false, message => messages.push(message), () => now);
  const live = { connection: 'connected' };
  notices.observe(live, { approvals: ['a', 'b'] });
  notices.observe({ ...live, outcome: 'failed' }, { approvals: ['a'], turn: 'failure-1' });
  assert.equal(messages.length, 2);
  now = 3100;
  notices.observe(live, { approvals: ['a', 'b', 'c'] });
  assert.equal(messages.length, 3);
  notices.disconnected();
  notices.observe(live, { approvals: [] });
  notices.disconnected();
  assert.equal(messages.length, 4);
  now = 18200;
  notices.observe(live, { approvals: [] });
  notices.disconnected();
  assert.equal(messages.length, 5);
});

test('restore clamps oversized window bounds into a display with negative coordinates', () => {
  const workArea = { x: -1280, y: -170, width: 1280, height: 680 };
  assert.deepEqual(visibleBounds({ x: -2000, y: 800, width: 1400, height: 40 }, workArea,
    { width: 420, height: 350 }, { width: 220, height: 180 }),
  { x: -1280, y: 330, width: 1280, height: 180 });
});
