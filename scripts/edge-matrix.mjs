// Playwright is a test-only dependency. Point this at an installed playwright/index.mjs.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const { HALOFLUX_PLAYWRIGHT, HALOFLUX_PERF_CASES, HALOFLUX_PERF_MODES,
  HALOFLUX_PERF_OUTPUT, HALOFLUX_PERF_TRACE, HALOFLUX_PERF_SCREENSHOTS, HALOFLUX_PERF_GATE,
  HALOFLUX_PERF_VIEWPORT, HALOFLUX_PERF_REPEATS } = process.env;
assert.ok(HALOFLUX_PLAYWRIGHT, 'Set HALOFLUX_PLAYWRIGHT to playwright/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(HALOFLUX_PLAYWRIGHT)));
const roots = process.argv.slice(2);
assert.ok(roots.length, 'Pass the paths of the extracted baseline(s) and/or candidate.');
const cases = (HALOFLUX_PERF_CASES || 'fixed,auto,static,original').split(',');
const modes = (HALOFLUX_PERF_MODES || 'headless,headed').split(',');
assert.ok(cases.every(name => ['fixed', 'auto', 'static', 'original', 'detail', 'no-css', 'no-timers',
  'native-raf', 'no-filters', 'quality-toggle'].includes(name)));
assert.ok(modes.every(mode => ['headless', 'headed'].includes(mode)));
const output = resolve(HALOFLUX_PERF_OUTPUT || 'output/playwright/edge-matrix.json');
const duration = 6000;
const repeats = Number(HALOFLUX_PERF_REPEATS ?? 5);
assert.ok(Number.isInteger(repeats) && repeats > 0, 'Invalid repeat count.');
const dimensions = /^(\d+)x(\d+)@(\d+(?:\.\d+)?)(-mobile)?$/.exec(HALOFLUX_PERF_VIEWPORT ?? '1920x1080@1');
assert.ok(dimensions, 'Use WIDTHxHEIGHT@DPR or WIDTHxHEIGHT@DPR-mobile.');
const [, width, height, scale, mobile] = dimensions;
const view = { width: Number(width), height: Number(height) };
const deviceScaleFactor = Number(scale);
const isMobile = Boolean(mobile);
assert.ok(view.width && view.height && deviceScaleFactor);
// Edge can compose its native scale and CDP's deviceScaleFactor with tiny rounding.
const nearDpr = (actual, expected) => Math.abs(actual - expected) < 1e-6;
const bridges = [];
const rows = [];
const invalidRows = [];
const environment = [];

function sample({ duration, scenario }) {
  const original = { frame, drawStage, resizeStage, updateBeat, updateCam, updateOuter, updateRing };
  const timestamps = { raf: [], rafClock: [], draw: [], stage: [], update: [], longTasks: [] };
  const detail = scenario === 'detail';
  let active = false, invalid = false, qualitySwitches = 0, updateMs = 0, skipped = 0;
  const resizeEvents = [];
  const nativeDpr = window.haloFluxDpr;
  let lastTier = nativeDpr?.(2);
  if (nativeDpr) window.haloFluxDpr = function (dpr) {
    // The tier ceiling can change before it affects an actual DPR-1 backing store.
    const tier = nativeDpr(2);
    if (active && tier !== lastTier) qualitySwitches++;
    lastTier = tier;
    return nativeDpr(dpr);
  };
  let initialBacking;
  const visibilityChanged = () => { if (active) invalid = true; };
  document.addEventListener('visibilitychange', visibilityChanged);
  frame = function (now) {
    if (active) {
      timestamps.raf.push(performance.now());
      timestamps.rafClock.push(now);
    }
    original.frame(now);
  };
  resizeStage = function () {
    const before = active && [stage.width, stage.height];
    original.resizeStage();
    if (before) resizeEvents.push({ before, after: [stage.width, stage.height], dpr: DPR });
  };
  drawStage = function (dt) {
    const start = performance.now();
    if (active) timestamps.draw.push(start);
    updateMs = 0;
    if (scenario !== 'static' || skipped++ === 0) original.drawStage(dt);
    if (active) {
      timestamps.stage.push(performance.now() - start);
      if (detail) timestamps.update.push(updateMs);
    }
  };
  if (detail) {
    const timeUpdate = fn => dt => {
      const start = performance.now();
      fn(dt);
      updateMs += performance.now() - start;
    };
    updateBeat = timeUpdate(updateBeat);
    updateCam = timeUpdate(updateCam);
    updateOuter = timeUpdate(updateOuter);
    updateRing = timeUpdate(updateRing);
  }
  const longTasks = PerformanceObserver.supportedEntryTypes.includes('longtask')
    ? new PerformanceObserver(list => {
      if (active) timestamps.longTasks.push(...list.getEntries().map(entry => [entry.startTime, entry.duration]));
    }) : null;
  longTasks?.observe({ entryTypes: ['longtask'] });
  return new Promise(resolve => setTimeout(() => {
    const start = performance.now();
    initialBacking = [stage.width, stage.height];
    invalid = document.hidden;
    active = true;
    if (scenario === 'quality-toggle') {
      const control = parent.document.querySelector('#autoQuality');
      for (const offset of [250, 600, 950, 1300]) setTimeout(() => control.click(), offset);
    }
    setTimeout(() => {
      const end = performance.now();
      active = false;
      longTasks?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChanged);
      ({ frame, drawStage, resizeStage, updateBeat, updateCam, updateOuter, updateRing } = original);
      if (nativeDpr) window.haloFluxDpr = nativeDpr;
      const intervals = times => times.slice(1).map((time, i) => time - times[i]);
      const stats = values => {
        const sorted = values.slice().sort((a, b) => a - b);
        const p = quantile => sorted[Math.ceil(sorted.length * quantile) - 1] ?? null;
        const histogram = [0, 0, 0, 0, 0, 0];
        for (const value of values) histogram[value <= 8.33 ? 0 : value <= 17 ? 1 :
          value <= 33.33 ? 2 : value <= 50 ? 3 : value <= 100 ? 4 : 5]++;
        return { n: sorted.length, p50: p(.5), p95: p(.95), p99: p(.99), max: sorted.at(-1) ?? null, histogram };
      };
      resolve({ durationMs: end - start, timerOverrunMs: end - start - duration,
        valid: !invalid && !document.hidden && timestamps.draw.length >= 2,
        visibility: document.visibilityState, visibilityInvalid: invalid,
        fps: scenario === 'static' ? null : timestamps.draw.length * 1000 / (end - start),
        raf: stats(intervals(timestamps.raf)), rafClock: stats(intervals(timestamps.rafClock)),
        draw: scenario === 'static' ? null : stats(intervals(timestamps.draw)),
        stage: scenario === 'static' ? null : stats(timestamps.stage),
        update: detail ? stats(timestamps.update) : null, rebuilds: resizeEvents.length, resizeEvents, qualitySwitches, initialBacking,
        backing: [stage.width, stage.height], dpr: DPR, pageDpr: devicePixelRatio,
        longTasks: longTasks ? timestamps.longTasks.filter(([time]) => time >= start && time < end) : null,
        timestamps });
    }, duration);
  }, 2000));
}

async function trace(context, page, target, path) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Tracing.start', { transferMode: 'ReturnAsStream',
    categories: 'devtools.timeline,v8,cc,viz,gpu,blink,benchmark,disabled-by-default-devtools.timeline.frame' });
  const result = await target.evaluate(sample, { duration, scenario: 'detail' });
  const completed = once(cdp, 'Tracing.tracingComplete');
  await cdp.send('Tracing.end');
  const [{ stream, dataLossOccurred }] = await completed;
  const chunks = [];
  try {
    for (;;) {
      const { data, base64Encoded, eof } = await cdp.send('IO.read', { handle: stream });
      chunks.push(Buffer.from(data, base64Encoded ? 'base64' : 'utf8'));
      if (eof) break;
    }
  } finally {
    await cdp.send('IO.close', { handle: stream });
    await cdp.detach();
  }
  await writeFile(path + '.json.gz', gzipSync(Buffer.concat(chunks)));
  await writeFile(path + '-sample.json', JSON.stringify({ dataLossOccurred, result }));
}

await mkdir(dirname(output), { recursive: true });
try {
  for (const root of roots) {
    const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
    const { startBridge } = await import(pathToFileURL(resolve(root, 'src/server.mjs')));
    bridges.push({ version, bridge: await startBridge({ port: 0 }) });
  }
  for (const mode of modes) {
    const browser = await chromium.launch({ channel: 'msedge', headless: mode === 'headless',
      args: ['--window-size=2100,1250'] });
    try {
      const cdp = await browser.newBrowserCDPSession();
      const info = await cdp.send('SystemInfo.getInfo');
      environment.push({ mode, browser: browser.version(), gpu: info.gpu.devices,
        features: info.gpu.featureStatus, glRenderer: info.gpu.auxAttributes?.glRenderer });
      await cdp.detach();
      for (const scenario of cases) for (let repeat = 0; repeat < repeats; repeat++) {
        // Rotate version order to distribute temperature and background-load drift.
        for (let offset = 0; offset < bridges.length; offset++) {
          const { version, bridge } = bridges[(repeat + offset) % bridges.length];
          if (scenario === 'original' && version !== bridges[0].version) continue;
          const context = await browser.newContext({ viewport: view, deviceScaleFactor, isMobile, hasTouch: isMobile });
          try {
            const page = await context.newPage();
            await page.bringToFront();
            await page.goto(bridge.origin + (scenario === 'original' ? '/lab.html' : '/'));
            let target = page;
            if (scenario !== 'original') {
              await page.getByText('本地模拟已就绪').waitFor();
              const pending = page.getByText('1 个请求 · 本地模拟');
              if (!(await pending.isVisible())) await page.getByRole('button', { name: '模拟审批' }).click();
              await pending.waitFor();
              await page.locator('#autoQuality').setChecked(scenario === 'auto');
              await page.locator('#low').uncheck();
              await page.locator('#fps').selectOption('60');
              await page.evaluate(() => window.scrollTo(0, 0));
              target = page.frames().find(child => child.url().endsWith(isMobile ? '/canvas-mobile' : '/canvas-desktop'));
            }
            assert.ok(target, 'Requested canvas frame was not loaded.');
            await target.waitForFunction(() => typeof started !== 'undefined' && started && ready);
            await target.evaluate(scenario => {
              if (scenario === 'no-css') stage.style.setProperty('filter', 'none', 'important');
              if (scenario === 'no-timers') {
                // Clear outstanding timers in this fixture's iframe before sampling.
                const lastTimer = setTimeout(() => {}, 0);
                for (let i = 1; i <= lastTimer; i++) clearInterval(i);
              }
              if (scenario === 'native-raf' && window.haloFluxScheduleFrame) {
                window.haloFluxScheduleFrame = () => Boolean(requestAnimationFrame(frame));
              }
              if (scenario === 'no-filters') {
                const { set } = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'filter');
                Object.defineProperty(S_MAIN, 'filter', { set() { set.call(this, 'none'); } });
              }
            }, scenario);
            const heap = await context.newCDPSession(page);
            await heap.send('HeapProfiler.collectGarbage');
            const beforeHeap = (await heap.send('Runtime.getHeapUsage')).usedSize;
            const result = await target.evaluate(sample, { duration, scenario });
            await heap.send('HeapProfiler.collectGarbage');
            result.heap = { beforeBytes: beforeHeap, afterBytes: (await heap.send('Runtime.getHeapUsage')).usedSize };
            await heap.detach();
            const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
              screen: [screen.width, screen.height], dpr: devicePixelRatio, visibility: document.visibilityState,
              focused: document.hasFocus() }));
            if (!result.valid || !nearDpr(viewport.dpr, deviceScaleFactor) ||
              viewport.width !== view.width || viewport.height !== view.height) {
              const invalid = { mode, scenario, version, repeat, viewport, visibility: result.visibility,
                visibilityInvalid: result.visibilityInvalid, durationMs: result.durationMs, drawCount: result.timestamps.draw.length };
              invalidRows.push(invalid);
              await writeFile(output, JSON.stringify({ duration, repeats, environment, rows, invalidRows }));
              throw new Error('Invalid benchmark window: ' + JSON.stringify(invalid));
            }
            if (['fixed', 'quality-toggle'].includes(scenario)) {
              assert.ok(nearDpr(result.dpr, Math.min(deviceScaleFactor, 1.5)), 'Unexpected backing DPR for a fixed-quality sample.');
              assert.deepEqual(result.backing, result.initialBacking);
            }
            rows.push({ mode, scenario, version, repeat, viewport, ...result });
            await writeFile(output, JSON.stringify({ duration, repeats, environment, rows, invalidRows }));
            console.log(mode, scenario, version, repeat + 1, result.fps?.toFixed(2) ?? 'static',
              'rAF p95', result.raf.p95?.toFixed(1), 'longtasks', result.longTasks?.length, 'rebuilds', result.rebuilds);
            if (HALOFLUX_PERF_SCREENSHOTS === '1' && scenario === 'fixed' && repeat === repeats - 1) {
              await page.screenshot({ path: join(dirname(output), `edge-${version}-${mode}-fixed.png`) });
            }
            if (HALOFLUX_PERF_TRACE === '1' && scenario === 'fixed' && repeat === repeats - 1) {
              await trace(context, page, target, join(dirname(output), `edge-trace-${version}-${mode}`));
            }
          } finally { await context.close(); }
        }
      }
    } finally { await browser.close(); }
  }
} finally {
  await Promise.all(bridges.map(({ bridge }) => bridge.close()));
}

if (HALOFLUX_PERF_GATE === '1') {
  const version = bridges.at(-1).version;
  for (const scenario of cases.filter(name => ['fixed', 'auto', 'quality-toggle'].includes(name))) {
    const headed = rows.filter(row => row.version === version && row.mode === 'headed' && row.scenario === scenario);
    assert.equal(headed.length, repeats, 'Missing headed samples for ' + scenario);
    for (const row of headed) {
      assert.ok(row.viewport.focused && row.draw.max < 1000, 'Unfocused or frozen Canvas: ' + scenario);
      if (scenario !== 'auto') assert.equal(row.rebuilds, 0, 'Unexpected Canvas rebuild: ' + scenario);
      for (const { before, after } of row.resizeEvents) assert.notDeepEqual(before, after, 'Duplicate Canvas backing rebuild');
    }
  }
  console.log(version + ' | Headed Canvas response and rebuild assertions verified.');
}
