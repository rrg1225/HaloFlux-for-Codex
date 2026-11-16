// Run with the pinned Windows Electron binary. Uses an isolated profile and Mock RPC.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { app, BrowserWindow, screen, powerMonitor } = require('electron');

const root = resolve(__dirname, '..');
const source = resolve(process.env.HALOFLUX_DESKTOP_SOURCE ?? root);
const output = resolve(process.env.HALOFLUX_DESKTOP_OUTPUT ?? join(root, 'output/desktop/observe'));
const profile = mkdtempSync(join(tmpdir(), 'haloflux-desktop-observe-'));
const soak = process.argv.includes('--soak');
const quick = process.argv.includes('--quick');
const dualOnly = process.argv.includes('--dual-fixed');
const budgetsOnly = process.argv.includes('--budgets');
const matchedOnly = process.argv.includes('--matched');
const priorityOnly = process.argv.includes('--priority');
const repetitions = Number(process.env.HALOFLUX_MATRIX_REPETITIONS ?? 5);
const duration = Number(process.env.HALOFLUX_SOAK_SECONDS ?? 1800);
const report = { runtime: process.versions, started: new Date().toISOString(), samples: [], gpuMemory: 'UNKNOWN' };
const owned = new Set();
const write = () => writeFileSync(join(output, soak ? 'soak.json' : 'matrix.json'), JSON.stringify(report, null, 2) + '\n');
mkdirSync(output, { recursive: true });
app.enableSandbox();
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
if (soak) {
  report.windowEvents = [];
  const record = (event, details) => report.windowEvents.push({ at: new Date().toISOString(), event, ...details });
  app.on('browser-window-created', (_event, win) => {
    const { id } = win;
    win.on('close', () => record('close', { id }));
    win.on('closed', () => record('closed', { id }));
    win.on('unresponsive', () => record('unresponsive', { id }));
    win.webContents.on('render-process-gone', (_event, { reason, exitCode }) => {
      record('render-process-gone', { id, reason, exitCode });
    });
  });
  app.on('child-process-gone', (_event, { type, reason, exitCode, serviceName }) => {
    record('child-process-gone', { type, reason, exitCode, serviceName });
  });
}

const execute = (win, code) => win.webContents.executeJavaScript(code);
const invoke = (win, call) => execute(win, 'window.haloDesktop.' + call);
const preference = (win, key, value) => invoke(win, `preference(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
const action = (win, body) => execute(win, `fetch('/api/action', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: ${JSON.stringify(JSON.stringify(body))}
}).then(response => response.status)`);
const canvasFrame = win => win.webContents.mainFrame.frames.find(frame => new URL(frame.url).pathname.startsWith('/canvas-'));
const canvas = (win, code) => canvasFrame(win).executeJavaScript(code);
const bounds = win => ({ content: win.getContentBounds(), scale: screen.getDisplayMatching(win.getBounds()).scaleFactor });
function placeOverlay(win) {
  const area = screen.getPrimaryDisplay().workArea;
  win.setBounds({ x: area.x + area.width - 428, y: area.y + 20, width: 420, height: 350 });
}
function quantile(values, percentile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percentile) - 1] ?? null;
}
function series(values) {
  return { n: values.length, median: quantile(values, .5), p95: quantile(values, .95), p99: quantile(values, .99) };
}
function frames(data) {
  const intervals = data.draw.slice(1).map((timestamp, index) => timestamp - data.draw[index]);
  return {
    fps: intervals.length ? 1000 * intervals.length / (data.draw.at(-1) - data.draw[0]) : 0,
    ...series(intervals), max: intervals.length ? Math.max(...intervals) : null,
    over50ms: intervals.length ? intervals.filter(ms => ms > 50).length / intervals.length : null,
    raf: series(data.raf.slice(1).map((timestamp, index) => timestamp - data.raf[index])),
    drawMs: series(data.cost), buffers: data.buffers, hidden: data.hidden, dpr: data.dpr,
    jsHeapBytes: data.jsHeapBytes, context: data.context,
  };
}
async function instrument(win) {
  await canvas(win, `(() => {
    if (window.measureDesktop) return;
    const draw = drawStage;
    const callback = frame;
    const schedule = window.haloFluxScheduleFrame;
    let sample, suspended = false;
    window.measureDesktop = {
      start() { sample = { draw: [], cost: [], raf: [] }; },
      stop() {
        const result = { ...sample, hidden: document.hidden, dpr: devicePixelRatio,
          jsHeapBytes: performance.memory?.usedJSHeapSize ?? null,
          buffers: [stage, glowC, trailC, farC, laneC, webBase, ...webLayers, ...slots.map(slot => slot.c)].filter(Boolean)
            .map(buffer => [buffer.width, buffer.height]),
          context: stage.getContext('2d').getContextAttributes() };
        sample = undefined;
        return result;
      },
      pause(value) { suspended = value; if (!suspended) schedule(); },
    };
    frame = function (now) {
      sample?.raf.push(performance.now());
      if (!suspended) callback(now);
    };
    drawStage = function (dt) {
      if (!sample) return draw(dt);
      const start = performance.now();
      draw(dt);
      sample.draw.push(start);
      sample.cost.push(performance.now() - start);
    };
  })()`);
}
function processMetrics(runtime) {
  const { main, overlay, backend } = runtime;
  const processes = app.getAppMetrics();
  for (const row of processes) owned.add(row.pid);
  const windows = new Map([['main renderer', main], ['overlay renderer', overlay]]
    .filter(([, win]) => win && !win.isDestroyed() && !win.webContents.isCrashed())
    .map(([role, win]) => [win.webContents.getOSProcessId(), role]));
  return processes.map(({ pid, type, cpu, memory, serviceName }) => ({
    pid, role: windows.get(pid) ?? (pid === backend.pid ? 'Node Bridge' : type), serviceName,
    cpuPercent: cpu.percentCPUUsage, workingSetKiB: memory?.workingSetSize ?? null,
    privateBytes: memory?.privateBytes == null ? null : memory.privateBytes * 1024,
  }));
}
function osMemory(rows) {
  const pids = rows.map(row => row.pid).join(',');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `@(Get-Process -Id ${pids} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress`],
  { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const processes = [].concat(JSON.parse(output));
  for (const row of rows) {
    const process = processes.find(item => item.Id === row.pid);
    row.osWorkingSetBytes = process?.WorkingSet64 ?? null;
    row.osPrivateBytes = process?.PrivateMemorySize64 ?? null;
  }
}
async function observe(runtime, name, warmup, ms, round) {
  const windows = Object.entries({ main: runtime.main, overlay: runtime.overlay }).filter(([, win]) => win);
  await Promise.all(windows.map(([, win]) => instrument(win)));
  await delay(warmup);
  processMetrics(runtime);
  await Promise.all(windows.map(([, win]) => canvas(win, 'measureDesktop.start()')));
  await delay(ms);
  const data = await Promise.all(windows.map(async ([role, win]) => [
    role, { ...bounds(win), visible: win.isVisible(), focused: win.isFocused(), minimized: win.isMinimized(),
      ...frames(await canvas(win, 'measureDesktop.stop()')) },
  ]));
  const processes = processMetrics(runtime);
  osMemory(processes);
  const sample = { name, round, elapsedSeconds: (Date.now() - Date.parse(report.started)) / 1000,
    windows: Object.fromEntries(data), processes };
  if (soak) {
    sample.mainHeapBytes = process.memoryUsage().heapUsed;
    sample.bridge = await runtime.backend.request('observe');
    assert.equal(sample.bridge.streamCount, 1, 'one control SSE, zero overlay SSE');
  }
  report.samples.push(sample);
  write();
  return sample;
}
async function trace(runtime, name) {
  const client = runtime.main.webContents.debugger;
  client.attach('1.3');
  let onMessage;
  try {
    const complete = new Promise(resolve => {
      onMessage = (_event, method, params) => {
        if (method === 'Tracing.tracingComplete') resolve(params);
      };
      client.on('message', onMessage);
    });
    await client.sendCommand('Tracing.start', {
      categories: 'blink,devtools.timeline,cc,viz,gpu,benchmark,latency,toplevel,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    await observe(runtime, name, 800, 4000);
    await client.sendCommand('Tracing.end');
    const { stream, dataLossOccurred } = await Promise.race([
      complete, delay(15000, {}, { ref: false }),
    ]);
    assert.ok(stream, 'Chromium trace stream');
    const chunks = [];
    for (;;) {
      const { data, eof, base64Encoded } = await client.sendCommand('IO.read', { handle: stream });
      chunks.push(Buffer.from(data, base64Encoded ? 'base64' : 'utf8'));
      if (eof) break;
    }
    await client.sendCommand('IO.close', { handle: stream });
    const json = Buffer.concat(chunks);
    assert.ok(JSON.parse(json).traceEvents.length > 0);
    writeFileSync(join(output, name + '.trace.json'), json);
    report.traces ??= [];
    report.traces.push({ name, bytes: json.length, dataLossOccurred });
  } finally {
    client.off('message', onMessage);
    client.detach();
  }
}
async function both(runtime) {
  const { main, overlay } = runtime;
  if (main.isMinimized()) main.restore();
  main.show();
  overlay.showInactive();
  main.focus();
}
async function matrix(runtime) {
  const { main } = runtime;
  const geometry = runtime.overlay.getContentBounds();
  const fixed = async () => {
    await preference(main, 'autoQuality', false);
    await preference(main, 'overlayAutoQuality', false);
  };
  const solo = async () => {
    main.show();
    main.focus();
    if (runtime.overlay) await invoke(runtime.overlay, 'hideOverlay()').catch(() => {});
    assert.equal(runtime.overlay, undefined);
  };
  const scenarios = {
    'main-only': solo,
    'main-only-auto': async () => {
      await solo();
      await preference(main, 'autoQuality', true);
    },
    'overlay-only': async () => { runtime.overlay.showInactive(); main.hide(); },
    'dual-fixed': () => both(runtime),
    'main-minimized': async () => { runtime.overlay.showInactive(); main.minimize(); },
    'overlay-hidden': async () => { main.show(); runtime.overlay.hide(); },
    'dual-overlay-paused': async () => { await both(runtime); await canvas(runtime.overlay, 'measureDesktop.pause(true)'); },
    'dual-main-paused': async () => { await both(runtime); await canvas(main, 'measureDesktop.pause(true)'); },
    'dual-auto': async () => {
      await both(runtime);
      await preference(main, 'autoQuality', true);
      await preference(main, 'overlayAutoQuality', true);
    },
    'tray-only': async () => { main.hide(); runtime.overlay.hide(); },
  };
  const budgets = ['balanced', 'main', 'overlay', 'power'];
  for (const budget of budgets) {
    scenarios[`budget-${budget}`] = async () => {
      await both(runtime);
      await preference(main, 'budget', budget);
    };
  }
  const reset = async name => {
    if (!name.startsWith('main-only') && !runtime.overlay) {
      await invoke(main, 'overlay()');
      placeOverlay(runtime.overlay);
      assert.deepEqual(runtime.overlay.getContentBounds(), geometry, 'matching overlay measurement geometry');
    }
    for (const win of [main, runtime.overlay].filter(Boolean)) {
      await instrument(win);
      await canvas(win, 'measureDesktop.pause(false)');
    }
    await fixed();
    if (main.isMinimized()) main.restore();
  };
  let names = Object.keys(scenarios).filter(name => !name.startsWith('budget-'));
  if (matchedOnly) names = ['main-only', 'overlay-only', 'dual-fixed', 'dual-overlay-paused', 'main-minimized', 'dual-auto', 'tray-only'];
  if (quick) names = ['main-only', 'dual-fixed', 'dual-auto'];
  if (dualOnly) names = ['dual-fixed'];
  if (budgetsOnly) names = budgets.map(budget => `budget-${budget}`);
  for (let round = 0; round < repetitions; round++) {
    for (let index = 0; index < names.length; index++) {
      const name = names[(index + round) % names.length];
      await reset(name);
      await scenarios[name]();
      const sample = await observe(runtime, name, name.endsWith('-auto') || budgetsOnly ? 7000 : 1150, 4500, round + 1);
      const draws = {
        'main-only': ['main'], 'main-only-auto': ['main'], 'overlay-only': ['overlay'], 'dual-fixed': ['main', 'overlay'],
        'main-minimized': ['overlay'], 'overlay-hidden': ['main'], 'dual-overlay-paused': ['main'],
        'dual-main-paused': ['overlay'], 'dual-auto': ['main', 'overlay'], 'tray-only': [],
      };
      for (const [role, metrics] of Object.entries(sample.windows)) {
        assert.equal(metrics.n > 15, budgetsOnly || draws[name].includes(role), name + ' unexpected draw state for ' + role);
      }
    }
  }
  for (const name of quick || dualOnly || budgetsOnly || matchedOnly ? [] : ['main-only', 'dual-fixed', 'dual-overlay-paused']) {
    await reset(name);
    await scenarios[name]();
    await trace(runtime, name + '-trace');
  }
}

async function comparePriorities(runtime) {
  const { main, overlay } = runtime;
  const initial = overlay.getBounds();
  await preference(main, 'autoQuality', false);
  await preference(main, 'overlayAutoQuality', false);
  const foreground = new BrowserWindow({ width: 280, height: 120, show: false, alwaysOnTop: true });
  try {
    for (const budget of ['balanced', 'main', 'overlay']) {
      await preference(main, 'budget', budget);
      if (budget === 'overlay') foreground.show();
      else main.focus();
      await delay(600);
      assert.equal(main.isFocused(), budget !== 'overlay', 'expected native focus before sampling');
      if (budget === 'overlay') assert.ok(foreground.isFocused());
      const controls = await invoke(main, 'read()');
      const visual = await invoke(overlay, 'read()');
      assert.equal(controls.lifecycle.application, 'MAIN_AND_OVERLAY_VISIBLE');
      assert.equal(visual.signal.state, await execute(main, 'document.querySelector(".visual").dataset.state'));
      const sample = await observe(runtime, budget, 700, 4200, 1);
      assert.equal(sample.windows.main.focused, budget !== 'overlay', 'expected focus throughout sampling');
      assert.ok(sample.windows.overlay.n > 10, 'visible overlay continues drawing');
      assert.equal(sample.windows.main.n === 0, controls.paused, 'main paint follows its pause state');
      assert.deepEqual(overlay.getBounds(), initial, 'priority switch keeps geometry');
      assert.ok(overlay.isAlwaysOnTop(), 'priority switch keeps overlay pinned');
      sample.caps = { main: controls.fps, overlay: visual.fps };
      sample.bridge = await runtime.backend.request('observe');
      assert.equal(sample.bridge.streamCount, 1, 'one control SSE');
      write();
    }
  } finally { foreground.destroy(); }
}

async function run() {
  assert.ok(Number.isInteger(repetitions) && repetitions > 0);
  assert.ok(Number.isInteger(duration) && duration > 0);
  const { launchDesktop } = await import(pathToFileURL(join(source, 'desktop/main.mjs')).href);
  const errors = [];
  const runtime = await launchDesktop({ cwd: profile,
    fixture: pathToFileURL(join(root, 'test/fixtures/desktop-rpc.mjs')).href,
    showError: message => errors.push(message), displayNotice: () => {},
  });
  const { main } = runtime;
  try {
    const display = screen.getPrimaryDisplay();
    report.display = { ...display, featureStatus: app.getGPUFeatureStatus() };
    report.gpu = await Promise.race([
      app.getGPUInfo('complete').catch(() => undefined), delay(4000, undefined, { ref: false }),
    ]) ?? await app.getGPUInfo('basic');
    const scale = display.scaleFactor;
    main.setPosition(display.workArea.x, display.workArea.y);
    main.setContentSize(Math.round(1920 / scale), Math.round(1080 / scale));
    main.setAlwaysOnTop(true);
    assert.equal(await action(main, { action: 'connect' }), 200);
    assert.equal(await invoke(main, 'mode("live")'), true);
    assert.equal(await action(main, { action: 'run', prompt: 'held' }), 200);
    await invoke(main, 'overlay()');
    const { overlay } = runtime;
    if (soak) overlay.setPosition(display.workArea.x + display.workArea.width - 420, display.workArea.y + 20);
    else placeOverlay(overlay);
    main.focus();
    await delay(1300);
    assert.match(await execute(overlay, 'document.getElementById("status").textContent'), /正在运行/);
    if (priorityOnly) await comparePriorities(runtime);
    else if (soak) await runSoak(runtime);
    else await matrix(runtime);
    assert.equal(await action(main, { action: 'interrupt' }), 200);
    assert.deepEqual(errors, []);
    report.passed = true;
  } finally {
    processMetrics(runtime);
    await runtime.cleanup();
    report.finished = new Date().toISOString();
    report.owned = [...owned];
  }
}

async function runSoak(runtime) {
  const { main } = runtime;
  const bridgePid = runtime.backend.pid;
  const original = main.getContentBounds();
  const start = performance.now();
  let cycle = 0;
  let geometry;
  do {
    main.show();
    main.setContentSize(original.width - (cycle % 3) * 48, original.height - (cycle % 3) * 24);
    await preference(main, 'autoQuality', cycle % 2 === 0);
    await preference(main, 'overlayAutoQuality', cycle % 2 === 0);
    if (!runtime.overlay) await invoke(main, 'overlay()');
    await both(runtime);
    const actual = runtime.overlay.getBounds();
    // The first cycle applies the test's initial move to the work-area edge.
    // Subsequent cycles restore that position and the same logical size.
    if (cycle === 1) geometry = actual;
    if (geometry) assert.deepEqual(actual, geometry, 'overlay bounds persist at fractional DPI');
    assert.equal(await action(main, { action: 'demo', scenario: 'success' }), 200);
    await observe(runtime, 'both', 1000, 8500, cycle + 1);
    main.minimize();
    await observe(runtime, 'minimized', 900, 3900, cycle + 1);
    report.windowEvents.push({ at: new Date().toISOString(), event: 'test-close', id: runtime.overlay.id });
    await invoke(runtime.overlay, 'hideOverlay()').catch(() => {});
    assert.equal(runtime.overlay, undefined, 'overlay closes without replacing bridge');
    main.hide();
    const checkRelease = cycle % 8 === 0;
    const tray = await observe(runtime, 'tray', checkRelease ? 16500 : 1800, 5700, cycle + 1);
    assert.equal(tray.windows.main.n, 0, 'tray stops drawing');
    if (checkRelease) assert.deepEqual(tray.windows.main.buffers[0], [0, 0], 'hidden backing surface released');
    if (main.isMinimized()) main.restore();
    powerMonitor.emit('resume');
    assert.equal(runtime.backend.pid, bridgePid);
    const live = await runtime.backend.request('inspect-exit', false);
    assert.equal(live.blocked, true, 'held Mock turn survived window transitions');
    cycle++;
    report.cycles = cycle;
    report.soakSeconds = (performance.now() - start) / 1000;
    write();
  } while (report.soakSeconds < duration);
}

run().catch(error => {
  report.error = error.stack;
  console.error(error);
}).finally(() => {
  write();
  app.exit(report.passed ? 0 : 1);
});
