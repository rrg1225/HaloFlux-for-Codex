// Historical v0.3 harness, kept for replay. Use edge-matrix.mjs for current measurements.
async page => {
  const directory = 'output/playwright';
  const rows = [];
  const modes = [['fixed60', false, false], ['auto', true, false], ['low', false, true]];
  const browser = await page.evaluate(() => ({
    edge: navigator.userAgent.match(/Edg\/[\d.]+/)?.[0] ?? null,
    devicePixelRatio,
  }));
  await page.getByText('本地模拟已就绪').waitFor();
  const pending = page.getByText('1 个请求 · 本地模拟');
  if (!(await pending.isVisible())) await page.getByRole('button', { name: '模拟审批' }).click();
  await pending.waitFor();
  for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440], [820, 1180]]) {
    await page.setViewportSize({ width, height });
    for (const [mode, autoQuality, low] of modes) {
      await page.locator('#autoQuality').setChecked(autoQuality);
      await page.locator('#low').setChecked(low);
      await page.locator('#fps').selectOption('60');
      await page.evaluate(() => window.scrollTo(0, 0));
      const canvas = page.frames().find(frame => /\/canvas-(desktop|mobile)$/.test(frame.url()));
      const result = await canvas.evaluate(async () => {
        const intervals = { raf: [], draw: [], stage: [], update: [], offscreen: [], composite: [] };
        let lastRaf, lastDraw, visibilityChanged = false, rebuilds = 0;
        let updateMs = 0, offscreenMs = 0, compositeMs = 0;
        const changed = () => { visibilityChanged = true; };
        const wrap = (fn, callback) => function (...args) { return callback(fn, this, args); };
        const timed = add => (fn, self, args) => {
          const start = performance.now();
          try { return fn.apply(self, args); } finally { add(performance.now() - start); }
        };
        const original = { frame, drawStage, resizeStage, updateBeat, updateCam, updateOuter, updateRing, drawOuterFar };
        frame = wrap(frame, (fn, self, [now]) => {
          if (lastRaf !== undefined) intervals.raf.push(now - lastRaf);
          lastRaf = now;
          fn.call(self, now);
        });
        drawStage = wrap(drawStage, (fn, self, args) => {
          if (lastDraw !== undefined) intervals.draw.push(lastRaf - lastDraw);
          lastDraw = lastRaf;
          updateMs = offscreenMs = compositeMs = 0;
          timed(ms => intervals.stage.push(ms))(fn, self, args);
          intervals.update.push(updateMs);
          intervals.offscreen.push(offscreenMs);
          intervals.composite.push(compositeMs);
        });
        resizeStage = wrap(resizeStage, (fn, self, args) => { rebuilds++; return fn.apply(self, args); });
        const update = timed(ms => { updateMs += ms; });
        updateBeat = wrap(updateBeat, update);
        updateCam = wrap(updateCam, update);
        updateOuter = wrap(updateOuter, update);
        updateRing = wrap(updateRing, update);
        drawOuterFar = wrap(drawOuterFar, timed(ms => { offscreenMs += ms; }));
        const composite = timed(ms => { compositeMs += ms; });
        S_MAIN.drawImage = wrap(S_MAIN.drawImage, (fn, self, args) =>
          args[0] === glowC || args[0] === farC ? composite(fn, self, args) : fn.apply(self, args));
        const reset = () => {
          for (const values of Object.values(intervals)) values.length = 0;
          lastRaf = lastDraw = undefined;
          rebuilds = 0;
        };
        const summarize = values => {
          const sorted = values.slice().sort((a, b) => a - b);
          const p = percentile => sorted[Math.ceil(sorted.length * percentile) - 1] ?? null;
          return { n: values.length, p50: p(.50), p95: p(.95), p99: p(.99) };
        };
        const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
        document.addEventListener('visibilitychange', changed);
        try {
          await pause(2000);
          const samples = [];
          for (let i = 0; i < 3; i++) {
            reset();
            const start = performance.now(), heapBefore = performance.memory?.usedJSHeapSize ?? null;
            await pause(2500);
            const durationMs = performance.now() - start;
            samples.push({ durationMs, fps: intervals.stage.length * 1000 / durationMs, rebuilds,
              visibility: document.visibilityState, heapBefore, heapAfter: performance.memory?.usedJSHeapSize ?? null,
              backing: [stage.width, stage.height], dpr: DPR, pageDpr: devicePixelRatio,
              ...Object.fromEntries(Object.entries(intervals).map(([name, values]) => [name, summarize(values)])) });
          }
          if (visibilityChanged || samples.some(sample => sample.visibility !== 'visible' || sample.raf.n < 20)) {
            throw new Error('Invalid benchmark window: renderer visibility or scheduling changed');
          }
          return samples;
        } finally {
          document.removeEventListener('visibilitychange', changed);
          ({ frame, drawStage, resizeStage, updateBeat, updateCam, updateOuter, updateRing, drawOuterFar } = original);
          delete S_MAIN.drawImage;
        }
      });
      rows.push({ width, height, mode, samples: result });
      if (width === 1920) await page.screenshot({ path: directory + '/performance-' + mode + '.png' });
    }
  }
  const gpuPage = await page.context().newPage();
  const gpu = await (async () => {
    try {
      await gpuPage.goto('edge://gpu');
      return await gpuPage.evaluate(async () => {
        for (let i = 0; i < 20; i++) {
          const main = document.querySelector('info-view')?.shadowRoot;
          const values = main?.textContent?.match(/(?:Canvas|Compositing|Rasterization):\s*[^*\n]+/g);
          if (values?.length) return values.map(value => value.trim());
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
      });
    } catch { return null; } finally { await gpuPage.close(); }
  })();
  return { browser, gpu, rows };
}
