// Run with the pinned Windows Electron executable, not Node.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { mkdirSync, mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, powerMonitor, screen } = require('electron');

const root = resolve(__dirname, '..');
const output = resolve(process.env.HALOFLUX_DESKTOP_OUTPUT ?? join(root, 'output/desktop'));
const profile = mkdtempSync(join(tmpdir(), 'haloflux-desktop-test-'));
const realHandshake = process.argv.includes('--handshake');
const nativeBalloon = process.argv.includes('--balloon');
const report = { checks: [], frames: {}, pids: [], runtime: process.versions.electron };
const record = name => report.checks.push(name);
const owned = new Set();
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
app.on('will-quit', event => event.preventDefault());
if (realHandshake) process.env.CODEX_HOME = profile;
mkdirSync(output, { recursive: true });

async function until(check, name, timeout = 8000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(75);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + name);
}
function running(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
const execute = (win, source) => win.webContents.executeJavaScript(source);
const request = (win, body) => execute(win, `fetch('/api/action', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: ${JSON.stringify(JSON.stringify(body))}
}).then(async response => ({status: response.status, body: await response.json()}))`);
const invoke = (win, call) => execute(win, 'window.haloDesktop.' + call);
const capture = async (win, name) => writeFileSync(join(output, name + '.png'), (await win.capturePage()).toPNG());
const click = (runtime, name) => {
  const item = runtime.menu.getMenuItemById(name);
  return item.click(item, runtime.main, {});
};
function collectMetrics() {
  const processes = app.getAppMetrics();
  for (const process of processes) owned.add(process.pid);
  const byType = {};
  for (const process of processes) {
    byType[process.type] = (byType[process.type] ?? 0) + (process.memory?.workingSetSize ?? 0) / 1024;
  }
  return {
    processes: processes.length,
    cpu: processes.reduce((sum, process) => sum + process.cpu.percentCPUUsage, 0),
    workingSetMiB: processes.reduce((sum, process) => sum + (process.memory?.workingSetSize ?? 0), 0) / 1024,
    workingSetByTypeMiB: byType,
  };
}
async function sample(name, windows) {
  // Accumulate real frame submissions via the same performance stream as the UI.
  await delay(2300);
  collectMetrics();
  const samples = await Promise.all(windows.map(([win, id]) => execute(win, `new Promise(resolve => {
    const element = document.getElementById(${JSON.stringify(id)});
    const values = [];
    const observer = new MutationObserver(() => {
      if (element.dataset.sample) values.push(JSON.parse(element.dataset.sample));
    });
    observer.observe(element, { attributes: true, attributeFilter: ['data-sample'] });
    setTimeout(() => {
      observer.disconnect();
      resolve({ visible: !document.hidden, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight], values });
    }, 4700);
  })`)));
  if (!windows.length) await delay(4700);
  report.frames[name] = { samples, ...collectMetrics() };
  assert.ok(samples.every(window => window.visible && window.values.length >= 1), 'No visible frame samples for ' + name);
}

async function run() {
  const { launchDesktop } = await import(pathToFileURL(join(root, 'desktop/main.mjs')).href);
  const errors = [];
  const notices = [];
  let choice = 0;
  const exitDialogs = [];
  const launch = options => launchDesktop({
    cwd: profile, showError: message => errors.push(message),
    fixture: realHandshake ? undefined : pathToFileURL(join(root, 'test/fixtures/desktop-rpc.mjs')).href,
    displayNotice: nativeBalloon ? undefined : body => notices.push(body), askExit: async options => {
      exitDialogs.push(options.buttons.length);
      return { response: choice };
    },
    ...options,
  });
  const collision = createServer().listen(0, '127.0.0.1');
  await once(collision, 'listening');
  try {
    await assert.rejects(launch({ port: collision.address().port }), { reason: 'port' });
    assert.equal(collision.listening, true);
    await assert.rejects(launch({ cwd: join(profile, 'missing') }), { reason: 'startup' });
    record('startup failure and owned port collision');
  } finally { await new Promise(resolve => collision.close(resolve)); }

  const runtime = await launch();
  const { main, backend } = runtime;
  const { origin, pid } = backend;
  owned.add(pid);
  try {
    // Keep acceptance windows visible over the developer tools running the test.
    main.setAlwaysOnTop(true);
    main.focus();
    await until(() => execute(main, 'document.getElementById("connection").parentElement.dataset.online === "true"'), 'initial SSE');
    assert.equal((await fetch(origin)).status, 403);
    assert.equal((await fetch(origin + '/api/events')).status, 403);
    assert.equal((await fetch(origin, { headers: { 'X-HaloFlux-Desktop': backend.access.visual } })).status, 403);
    assert.deepEqual(await execute(main, `[typeof require, typeof process, document.querySelector('meta[name=haloflux-token]').content,
      typeof window.haloDesktop.command, typeof document.querySelector('iframe').contentWindow.haloDesktop]`),
    ['undefined', 'undefined', '', 'undefined', 'undefined']);
    assert.equal(await invoke(main, 'preference("cwd", "PRIVATE_PATH")'), false);
    assert.equal(await invoke(main, 'preference("opacity", 110)'), false);
    assert.equal(await execute(main, 'fetch("https://example.com").then(() => true, () => false)'), false);
    await execute(main, 'window.open("https://example.com"); void 0');
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    record('isolated renderer, origin, navigation, token and IPC validation');

    click(runtime, 'live');
    await until(() => execute(main, 'document.getElementById("live-mode").getAttribute("aria-pressed") === "true"'), 'tray mode');
    assert.equal((await request(main, { action: 'connect' })).status, 200);
    record(realHandshake ? 'installed CLI schema and no-model handshake' : 'mock connection and tray mode');
    if (realHandshake) {
      const codex = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid} AND Name='codex.exe'" | Select-Object -ExpandProperty ProcessId`],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim().split(/\s+/).map(Number);
      assert.ok(codex.length === 1 && codex[0] > 0 && running(codex[0]), 'Expected one owned CLI process');
      owned.add(codex[0]);
      main.close();
      await until(() => !running(pid), 'handshake worker exit');
      await until(() => !running(codex[0]), 'owned App Server exit');
      await assert.rejects(fetch(origin));
      record('main close releases handshake worker, owned App Server and loopback listener');
      return;
    }
    if (nativeBalloon) {
      click(runtime, 'demo');
      main.hide();
      const presented = once(runtime.tray, 'balloon-show').then(() => true);
      assert.equal((await request(main, { action: 'run', prompt: 'completed' })).status, 200);
      report.balloonShown = await Promise.race([presented, delay(5500, false)]);
      if (report.balloonShown) record('Windows reported presentation of the mock task notification');
      return;
    }
    click(runtime, 'settings');
    await until(() => execute(main, 'document.getElementById("desktop-settings").open'), 'settings from tray');
    await invoke(main, 'preference("close", "tray")');
    await invoke(main, 'overlay()');
    const overlay = runtime.overlay;
    assert.ok(overlay.isVisible() && overlay.isAlwaysOnTop());
    assert.equal(await execute(overlay, 'fetch("/api/action", {method:"POST"}).then(() => true, () => false)'), false);
    assert.equal(await invoke(overlay, 'mode("demo")'), false);
    await until(() => execute(overlay, 'document.getElementById("status").dataset.sample'), 'original overlay frame');
    assert.deepEqual(await execute(overlay, `(() => {
      const page = document.getElementById('halo').contentDocument;
      const canvas = page.querySelector('#stage');
      const ctx = canvas.getContext('2d');
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let clear = 0, drawn = 0;
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] === 0) clear++;
        if (pixels[index] > 32) drawn++;
      }
      return [ctx.getContextAttributes().alpha, clear > 0, drawn > 0];
    })()`), [true, true, true]);
    assert.equal(await execute(overlay, 'getComputedStyle(document.querySelector(".handle")).getPropertyValue("app-region")'), 'drag');
    const old = overlay.getBounds();
    assert.equal(await invoke(overlay, `resizeOverlay(${old.width + 37}, ${old.height + 31})`), true);
    assert.ok(Math.abs(overlay.getBounds().width - old.width - 37) <= 1);
    click(runtime, 'passthrough');
    assert.equal((await invoke(overlay, 'read()')).clickThrough, true);
    assert.equal(await invoke(overlay, 'resizeOverlay(500, 400)'), false);
    click(runtime, 'passthrough');
    assert.equal((await invoke(overlay, 'read()')).clickThrough, false);
    await invoke(main, 'preference("alwaysOnTop", false)');
    assert.equal(overlay.isAlwaysOnTop(), false);
    await invoke(main, 'preference("alwaysOnTop", true)');
    await invoke(main, 'preference("opacity", 70)');
    assert.ok(Math.abs(overlay.getOpacity() - .7) < .02);
    await invoke(main, 'preference("opacity", 85)');
    record('transparent Canvas pixels, read-only overlay, resize, opacity, pin and passthrough recovery');

    const display = screen.getPrimaryDisplay();
    report.display = { size: display.size, workArea: display.workArea, scaleFactor: display.scaleFactor };
    report.gpu = app.getGPUFeatureStatus();
    const gpu = await app.getGPUInfo('basic');
    report.gpuDevices = gpu.gpuDevice?.map(({ vendorId, deviceId, active }) => ({ vendorId, deviceId, active }));
    assert.equal((await request(main, { action: 'run', prompt: 'held' })).status, 200);
    await until(() => execute(overlay, 'document.getElementById("status").textContent.includes("正在运行")'), 'shared live task');
    const size = (width, height) => {
      main.setPosition(display.workArea.x + 12, display.workArea.y + 12);
      main.setContentSize(Math.round(width / display.scaleFactor), Math.round(height / display.scaleFactor));
    };
    overlay.setPosition(display.workArea.x + display.workArea.width - overlay.getBounds().width - 6, display.workArea.y + 16);
    size(1920, 1080);
    await execute(main, 'document.getElementById("desktop-settings").open = false; window.scrollTo(0, 0); void 0');
    await delay(1200);
    await capture(main, 'main-live');
    await capture(overlay, 'overlay-live');
    await sample('both-1920', [[main, 'performance'], [overlay, 'status']]);
    await invoke(main, 'overlay()');
    await sample('main-1920', [[main, 'performance']]);
    size(1366, 768);
    await sample('main-1366', [[main, 'performance']]);
    await invoke(main, 'overlay()');
    main.close();
    assert.equal(main.isVisible(), false);
    assert.equal((await invoke(main, 'read()')).paused, true);
    const current = await execute(main, 'document.getElementById("performance").dataset.sample');
    await sample('overlay-only', [[runtime.overlay, 'status']]);
    assert.equal(await execute(main, 'document.getElementById("performance").dataset.sample'), current);
    await invoke(runtime.overlay, 'hideOverlay()').catch(() => {});
    await until(() => !runtime.overlay, 'overlay close button');
    await sample('tray-idle', []);
    record('shared active signal, native sampling and hidden main draw suspension');
    click(runtime, 'open');
    assert.equal(main.isVisible(), true);
    powerMonitor.emit('suspend');
    assert.equal((await invoke(main, 'read()')).paused, true);
    powerMonitor.emit('resume');
    assert.equal((await invoke(main, 'read()')).paused, false);
    record('suspend/resume handler simulation');
    const cycles = [];
    for (let index = 0; index < 12; index++) {
      await invoke(main, 'overlay()');
      assert.equal(BrowserWindow.getAllWindows().length, 2);
      await invoke(main, 'overlay()');
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      if (index % 4 === 3) { await delay(350); cycles.push(collectMetrics()); }
    }
    report.cycles = cycles;
    main.hide();
    await delay(5500);
    report.afterCyclesHidden = collectMetrics();
    click(runtime, 'open');
    record('12 overlay create/destroy cycles');

    click(runtime, 'quit');
    await until(() => !main.isVisible(), 'continue in tray');
    assert.equal(exitDialogs.at(-1), 3);
    assert.equal((await backend.request('inspect-exit', false)).blocked, true);
    click(runtime, 'open');
    choice = 1;
    click(runtime, 'quit');
    await until(() => runtime.menu.getMenuItemById('quit').label !== '退出应用', 'waiting to quit');
    assert.equal((await request(main, { action: 'new' })).status, 400);
    click(runtime, 'quit');
    await delay(150);
    assert.ok(running(pid));
    assert.equal((await request(main, { action: 'interrupt' })).status, 200);
    record('explicit keep, wait and cancel with a live fixture turn');

    click(runtime, 'demo');
    assert.equal((await request(main, { action: 'run', prompt: 'approval' })).status, 200);
    await until(() => notices.some(body => body.includes('审批')), 'redacted approval notification');
    const { body: { approvals: [review] } } = await request(main, { action: 'context', review: true });
    assert.equal((await request(main, { ...review, action: 'decision', decision: 'decline' })).status, 200);
    await until(() => notices.some(body => body.includes('完成')), 'redacted completion notification');
    assert.equal((await request(main, { action: 'run', prompt: 'failed' })).status, 200);
    await until(() => notices.some(body => body.includes('失败')), 'redacted failure notification');
    assert.doesNotMatch(notices.join(' '), /PRIVATE_|fixture|token/i);
    report.noticeCounts = notices.length;
    record('redacted mock notification policy and explicit approval decline');

    const crash = once(main.webContents, 'render-process-gone');
    main.webContents.forcefullyCrashRenderer();
    await crash;
    assert.ok(running(pid));
    click(runtime, 'open');
    await until(() => execute(main, '!!document.querySelector("#renderer")').catch(() => false), 'main renderer recovery');
    record('renderer crash and tray recovery');

    assert.equal((await request(main, { action: 'run', prompt: 'held' })).status, 200);
    choice = 2;
    click(runtime, 'quit');
    await until(() => !running(pid), 'interrupt and quit');
    assert.equal(exitDialogs.at(-1), 3);
    await assert.rejects(fetch(origin));
    record('explicit interrupt and complete tray exit');
  } finally { await runtime.cleanup(); }

  const saved = JSON.parse(readFileSync(join(profile, 'desktop-preferences.json'), 'utf8'));
  assert.ok(saved.mainBounds.width > 0 && saved.overlayBounds.width > 0);
  assert.doesNotMatch(JSON.stringify(saved), /PRIVATE_|fixture|prompt|token/i);
  writeFileSync(join(profile, 'desktop-preferences.json'), '{"mainBounds":{"x":90000,"y":90000,"width":99000,"height":99000},"opacity":-10}');
  const reopened = await launch();
  const crashPid = reopened.backend.pid;
  const crashOrigin = reopened.backend.origin;
  owned.add(crashPid);
  try {
    const bounds = reopened.main.getBounds();
    assert.ok(bounds.x < 90000 && bounds.y < 90000 && bounds.width < 99000);
    assert.equal((await invoke(reopened.main, 'read()')).preferences.opacity, 85);
    const diagnostics = errors.length;
    process.kill(crashPid);
    await until(() => errors.length > diagnostics, 'bridge crash diagnostic');
    await assert.rejects(fetch(crashOrigin));
    assert.equal(reopened.backend.origin, undefined);
    record('invalid preference recovery, bridge crash diagnostic and origin invalidation');
  } finally { await reopened.cleanup(); }
}

run().then(() => { report.passed = true; }, error => {
  report.error = error.stack;
  console.error(error);
}).finally(() => {
  collectMetrics();
  report.pids = [...owned];
  const filename = realHandshake ? 'handshake.json' : nativeBalloon ? 'notification.json' : 'desktop.json';
  writeFileSync(join(output, filename), JSON.stringify(report, null, 2) + '\n');
  app.exit(report.passed ? 0 : 1);
});
