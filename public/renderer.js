(() => {
  // Runs as a classic script in the original Canvas page's scope.
  const profiles = {
    idle:              [0.28, 0.43, 0.64, 0.55, 0.77, 0.55, ''],
    working:           [0.56, 0.68, 0.82, 0.86, 0.92, 0.85, '178deg'],
    streaming:         [0.86, 1.06, 1.00, 1.05, 1.15, 1.06, '156deg'],
    tool_running:      [0.72, 0.90, 1.06, 1.05, 1.06, 1.14, '203deg'],
    file:              [0.77, 0.87, 1.12, 1.08, 1.09, 1.18, '110deg'],
    approval_required: [0.18, 0.39, 0.92, 0.78, 0.72, 0.70, '7deg'],
    completed:         [0.88, 1.04, 1.20, 1.12, 1.12, 1.30, '107deg'],
    failed:            [0.20, 0.47, 0.84, 0.70, 0.76, 0.74, '328deg'],
    interrupted:       [0.22, 0.38, 0.58, 0.52, 0.58, 0.60, '25deg'],
  };
  const keys = ['ringSpeed', 'tempo', 'glow', 'beamBright', 'runnerCount', 'dashBright'];
  const base = Object.fromEntries(keys.map(key => [key, BAKED_MINE[key]]));
  const frameValues = profiles.idle.slice(0, keys.length);
  let target = profiles.idle;
  const defaults = { spin: 1, light: 1, beams: 1, particles: 1, rhythm: 1, color: 'state', fps: 60,
    zoom: 1, haloX: 0, haloY: 0, composition: 'fit', autoQuality: true, low: false };
  let settings = defaults;
  let pulse = null;
  let kick = false;
  let fileUntil = 0;
  let state = 'idle';
  let entered = 0;
  let lastDraw = null;
  let nextDraw = 0;
  let samples = [];
  let sampledMs = 0;
  let quality = 0;
  let healthy = 0;
  let reflow;
  let frameId = null;
  let wake;
  let releaseTimer;
  let surfacesReleased = false;
  let paused = false;
  let previousHue;
  const tiers = [1.5, 1.25, 1, .85];
  const originalFrame = frame;
  const originalDraw = drawStage;
  const originalResize = resizeAll;
  const overlay = document.body?.classList.contains('codex-overlay') === true;
  // The original small charts show demo data. Only the main Canvas runs in the embedded mode.
  drawAdv = drawDiff = drawVal = drawIdx = agentsTick = drawCallout = () => {};

  window.haloFluxDpr = dpr => Math.min(dpr, settings.low ? .85 : tiers[quality], overlay && settings.autoQuality ? 1 : 1.5);
  // Composed browser scaling can report 1.0000000298 at DPR 1.
  const dprChanged = previous => Math.abs(window.haloFluxDpr(devicePixelRatio) - previous) >= 1e-6;
  window.haloFluxScheduleFrame = () => {
    if (frameId !== null || wake !== undefined || document.hidden || paused) return true;
    const remaining = nextDraw - performance.now();
    // Low-cap desktop windows can skip intervening refresh ticks. The paint
    // itself still runs on rAF and uses the same frame interval measurement.
    if (settings.desktop && frameCap() <= 30 && remaining > 15) {
      wake = setTimeout(() => { wake = undefined; window.haloFluxScheduleFrame(); }, remaining - 10);
    } else {
      frameId = requestAnimationFrame(now => {
        frameId = null;
        frame(now);
      });
    }
    return true;
  };
  function frameCap() {
    return settings.low || state === 'idle' ? Math.min(settings.fps, 20) : settings.fps;
  }

  window.haloFluxCrop = () => settings.composition === 'crop';
  window.haloFluxCompose = () => {
    const fit = !window.haloFluxCrop();
    const size = Math.min(W, H);
    const band = fit ? size * .125 : RO - R;
    if (fit) {
      cx = W * .45;
      cy = H * .50;
      R = size * .30;
    }
    cx += W * settings.haloX / 100;
    cy += H * settings.haloY / 100;
    R *= settings.zoom;
    RO = R + band * settings.zoom;
    RMAX = Math.max(RO + 110, Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 60);
    thV = fit ? Math.PI : Math.asin(Math.min(1, (H / 2 + 60) / R));
    thS = fit ? 1.55 : Math.asin(Math.min(1, (H / 2 + 40) / RO));
  };
  function rebuild() {
    clearTimeout(reflow);
    reflow = setTimeout(resizeAll, 120);
  }
  resizeAll = function () {
    if (surfacesReleased && (document.hidden || paused)) return;
    originalResize();
  };
  function releaseSurfaces() {
    releaseTimer = undefined;
    if (!document.hidden && !paused) return;
    clearTimeout(reflow);
    for (const buffer of [stage, webBase, ...webLayers, trailC, farC, glowC, laneC, ...slots.map(slot => slot.c)]) {
      if (buffer) buffer.width = buffer.height = 0;
    }
    surfacesReleased = true;
  }
  function resetSamples() {
    clearTimeout(wake);
    wake = undefined;
    lastDraw = null;
    nextDraw = 0;
    samples = [];
    sampledMs = 0;
  }
  function syncVisibility() {
    resetSamples();
    last = performance.now();
    if (document.hidden || paused) {
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      if (settings.desktop && !overlay && releaseTimer === undefined && !surfacesReleased) {
        releaseTimer = setTimeout(releaseSurfaces, 15000);
      }
    } else {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      if (surfacesReleased) {
        surfacesReleased = false;
        resizeAll();
      }
      if (started) window.haloFluxScheduleFrame();
    }
  }
  document.addEventListener('visibilitychange', syncVisibility);

  function measure(now, cap) {
    if (lastDraw !== null) {
      const interval = now - lastDraw;
      samples.push(interval);
      sampledMs += interval;
      if (sampledMs >= 2000) {
        const fps = samples.length * 1000 / sampledMs;
        samples.sort((a, b) => a - b);
        const p95 = samples[Math.ceil(samples.length * .95) - 1];
        parent.postMessage({ type: 'haloflux-performance', fps, p95, cap }, location.origin);
        if (settings.autoQuality && !settings.low && state !== 'idle') {
          const previous = quality;
          const previousDpr = window.haloFluxDpr(devicePixelRatio);
          // A larger desktop frame budget must not make auto quality downshift
          // more aggressively than the original dual-window thresholds.
          const goal = Math.min(cap, settings.qualityTarget ?? cap);
          if (fps < goal * .86 || p95 > 1450 / goal) {
            quality = Math.min(tiers.length - 1, quality + 1);
            healthy = 0;
          } else if (++healthy >= 5) {
            quality = Math.max(0, quality - 1);
            healthy = 0;
          }
          if (quality !== previous && dprChanged(previousDpr)) rebuild();
        }
        samples = [];
        sampledMs = 0;
      }
    }
    lastDraw = now;
  }
  frame = function (now) {
    const cap = frameCap();
    if (document.hidden || paused || !ready || now < nextDraw - 1) {
      window.haloFluxScheduleFrame();
      return;
    }
    const step = 1000 / cap;
    nextDraw = nextDraw ? Math.max(nextDraw + step, now - 1) : now + step;
    // The rAF argument identifies the browser frame. Sample actual submission
    // cadence with the wall clock, including time spent waiting for the callback.
    measure(performance.now(), cap);
    originalFrame(now);
  };

  drawStage = function (dt) {
    const now = performance.now();
    const filePulse = Math.max(0, (fileUntil - now) / 550);
    const profile = state === 'failed' && now - entered > 1150 ? profiles.idle : target;
    const breath = state === 'working' ? .88 + .14 * Math.sin(now / 410) : 1;
    const density = settings.low ? .32 : 1 - quality * .17;
    const blend = 1 - Math.exp(-dt * 6);
    const intensity = [settings.spin, settings.rhythm, settings.light * breath, settings.beams,
      settings.particles * density, settings.light];
    keys.forEach((key, i) => {
      const value = profile[i] * intensity[i];
      frameValues[i] += (value - frameValues[i]) * blend;
      C[key] = base[key] * frameValues[i];
    });
    C.runnerCount = Math.round(C.runnerCount);
    C.camera = window.haloFluxCrop() ? BAKED_MINE.camera : 0;
    C.rimDensity = settings.low ? .35 : .65 - quality * .09;
    C.rimBright = BAKED_MINE.rimBright * (1 + filePulse * .65);
    C.runnerSpeed = BAKED_MINE.runnerSpeed * (state === 'streaming' ? 1.6 : 1);
    C.cometBurst = BAKED_MINE.cometBurst * density * (state === 'idle' ? .25 : 1);
    if (kick && !settings.low && state !== 'idle') {
      spawnComet();
      if (target !== profiles.streaming) spawnFlare();
    }
    if (filePulse) layerEnv[1] = Math.max(layerEnv[1], filePulse);
    kick = false;
    originalDraw(dt);
  };

  const range = (value, min, max, fallback = 1) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  const colors = { cyan: '156deg', violet: '235deg', amber: '7deg', native: '' };
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'haloflux-frame') return;
    const { state: signal, activity, activeKind, pulse: nextPulse, settings: s } = event.data;
    if (!s || !Object.hasOwn(profiles, signal)) return;
    const nextState = signal === 'completed' && s.completionAnimation === false ? 'idle' : signal;
    const nextPaused = event.data.paused === true;
    if (state !== nextState) {
      if (state === 'idle' || nextState === 'idle') resetSamples();
      entered = performance.now();
      state = nextState;
    }
    target = state === 'tool_running' && activeKind === 'file' ? profiles.file : profiles[state];
    const next = {
      spin: range(s.spin, 0.15, 1.5), light: range(s.light, 0.2, 1.5),
      beams: range(s.beams, .1, 1.7),
      particles: range(s.particles, 0.15, 1.3), rhythm: range(s.rhythm, 0.25, 1.5),
      color: s.color, fps: [8, 12, 16, 20, 24, 30, 40, 60].includes(s.fps) ? s.fps : 60, desktop: s.desktop === true,
      qualityTarget: s.desktop ? range(s.qualityTarget, 20, 60, 60) : undefined,
      zoom: range(s.zoom, .55, 2), haloX: range(s.haloX, -45, 45, 0), haloY: range(s.haloY, -45, 45, 0),
      composition: s.composition === 'crop' ? 'crop' : 'fit', autoQuality: s.autoQuality === true, low: s.low === true,
    };
    if (settings.fps !== next.fps || settings.low !== next.low) resetSamples();
    const previousDpr = window.haloFluxDpr(devicePixelRatio);
    const geometryChanged = ['zoom', 'haloX', 'haloY', 'composition'].some(key => settings[key] !== next[key]);
    if (!next.autoQuality) quality = 0;
    settings = next;
    if (geometryChanged || dprChanged(previousDpr)) rebuild();
    const hue = Object.hasOwn(colors, settings.color) ? colors[settings.color] : target[6];
    if (hue !== previousHue) {
      stage.style.setProperty('--halo-filter', hue ? 'sepia(.48) saturate(1.5) hue-rotate(' + hue + ')' : 'none');
      previousHue = hue;
    }
    kick ||= pulse !== null && nextPulse !== pulse;
    if (kick && activity === 'file') fileUntil = performance.now() + 550;
    pulse = nextPulse;
    if (paused !== nextPaused) {
      paused = nextPaused;
      syncVisibility();
    } else if (settings.desktop && started) window.haloFluxScheduleFrame();
  });
})();
