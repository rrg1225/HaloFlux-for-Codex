// Native visibility check in a separate headed Edge session. No model or Codex process.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { startBridge } from '../src/server.mjs';

assert.ok(process.env.HALOFLUX_PLAYWRIGHT, 'Set HALOFLUX_PLAYWRIGHT to playwright/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(process.env.HALOFLUX_PLAYWRIGHT)));
const root = await realpath(tmpdir());
const profile = await mkdtemp(join(root, 'haloflux-native-edge-'));
const bridge = await startBridge({ port: 0 });
const report = {};
let browser, child, exited;
async function until(label, predicate) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(80);
  }
  throw new Error('Unmet state: ' + label);
}
const read = tab => tab.evaluate(() => ({
  visibility: document.visibilityState,
  focus: document.hasFocus(),
  connection: document.querySelector('#connection')?.textContent,
  approval: !document.querySelector('#approval')?.hidden,
  canvas: !!document.querySelector('#performance')?.dataset.sample,
  rafProbe: window.haloFluxTestRaf ?? null,
}));

try {
  const edge = process.env.HALOFLUX_EDGE_BIN ??
    join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
  child = spawn(edge, ['--user-data-dir=' + profile, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore', windowsHide: true });
  exited = new Promise(resolve => child.once('close', resolve));
  await once(child, 'spawn');
  let port;
  await until('dedicated Edge CDP port', async () => {
    const endpoint = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    port = Number(endpoint.split(/\r?\n/, 1)[0]);
    return port > 0 && port <= 65535;
  });
  // The default browser context keeps its native focus and visibility settings.
  browser = await chromium.connectOverCDP('http://127.0.0.1:' + port, { noDefaults: true, timeout: 10000 });
  const [context] = browser.contexts();
  const front = context.pages()[0] ?? await context.newPage();
  const background = await context.newPage();
  const controller = await browser.newBrowserCDPSession();
  const [frontWindow, backWindow] = await Promise.all([front, background].map(async tab => {
    const session = await context.newCDPSession(tab);
    const { targetInfo } = await session.send('Target.getTargetInfo');
    await session.detach();
    return controller.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
  }));
  const separateWindows = frontWindow.windowId !== backWindow.windowId;
  await Promise.all([front, background].map(tab => tab.goto(bridge.origin, { timeout: 10000 })));
  await until('both streams', () => bridge.streamCount === 2);
  const setBackground = windowState => controller.send('Browser.setWindowBounds',
    { windowId: backWindow.windowId, bounds: { windowState } });
  if (separateWindows) await setBackground('minimized');
  await front.bringToFront();
  report.initial = await Promise.all([read(front), read(background)]);
  await until('native background visibility', async () =>
    (await read(background)).visibility === 'hidden' && (await read(front)).visibility === 'visible');
  await background.evaluate(() => {
    window.haloFluxTestRaf = false;
    requestAnimationFrame(() => { window.haloFluxTestRaf = true; });
    document.querySelector('#performance').removeAttribute('data-sample');
  });
  await front.getByRole('button', { name: '模拟审批' }).click({ timeout: 10000 });
  await until('hidden page receives SSE and renders approval state', async () => (await read(background)).approval);
  report.hidden = await read(background);
  report.front = await read(front);
  assert.equal(report.hidden.visibility, 'hidden');
  assert.equal(report.hidden.rafProbe, false, 'Background rAF fired while native window was hidden.');
  assert.equal(report.hidden.canvas, false, 'Hidden renderer sent a fresh Canvas sample.');
  assert.equal(report.front.approval, true);
  assert.equal(bridge.streamCount, 2);
  if (separateWindows) await setBackground('normal');
  await background.bringToFront();
  await until('native foreground and new Canvas sample', async () => {
    const view = await read(background);
    return view.visibility === 'visible' && view.rafProbe && view.canvas;
  });
  report.restored = await read(background);
  report.result = 'MOCK VERIFIED';
} catch (error) {
  report.result = 'FAILED';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  bridge.close();
  if (browser) {
    const controller = await browser.newBrowserCDPSession().catch(() => null);
    await controller?.send('Browser.close').catch(() => {});
    await browser.close();
  }
  if (exited) {
    await Promise.race([exited, delay(2500, null, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  }
  const directory = await realpath(profile);
  if (dirname(directory) === root && directory === profile) {
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
  console.log(JSON.stringify(report, null, 2));
}
