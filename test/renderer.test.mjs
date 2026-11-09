import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const renderer = readFileSync(new URL('../public/renderer.js', import.meta.url), 'utf8');

function rendererAt(devicePixelRatio) {
  let onMessage;
  let now = 0;
  let rebuilds = 0;
  const parent = { postMessage() {} };
  const origin = 'http://127.0.0.1';
  const context = {
    BAKED_MINE: {}, document: { hidden: false, addEventListener() {} }, ready: true,
    devicePixelRatio, parent, location: { origin }, performance: { now: () => now },
    stage: { style: { setProperty() {} } }, frame() {}, drawStage() {},
    clearTimeout() {}, setTimeout(callback) { callback(); }, resizeAll() { rebuilds++; },
    addEventListener(_event, listener) { onMessage = listener; },
  };
  context.window = context;
  runInNewContext(renderer, context);
  return {
    configure(settings) {
      onMessage({ source: parent, origin, data: {
        type: 'haloflux-frame', state: 'working', settings: { autoQuality: true, ...settings },
      } });
    },
    slowFrames() {
      for (now = 0; now <= 4100; now += 50) context.frame(now);
    },
    effectiveDpr: () => context.haloFluxDpr(devicePixelRatio),
    rebuilds: () => rebuilds,
  };
}

test('adaptive quality suppresses DPR noise and rebuilds across the tolerance', () => {
  for (const [offset, expected] of [[2.98e-8, 0], [0.99e-6, 0], [1.01e-6, 1]]) {
    const renderer = rendererAt(1 + offset);
    renderer.configure();
    renderer.slowFrames();
    assert.equal(renderer.effectiveDpr(), 1);
    assert.equal(renderer.rebuilds(), expected, 'DPR offset ' + offset);
    renderer.configure({ zoom: 1.2 });
    assert.equal(renderer.rebuilds(), expected + 1, 'Composition changed even with the same DPR.');
  }
});

test('DPR 3 uses the visual quality ceiling and rebuilds for real tier changes', () => {
  const renderer = rendererAt(3);
  renderer.configure();
  assert.equal(renderer.effectiveDpr(), 1.5);
  renderer.slowFrames();
  assert.equal(renderer.effectiveDpr(), 1);
  assert.equal(renderer.rebuilds(), 2);
  renderer.configure({ autoQuality: false });
  assert.equal(renderer.effectiveDpr(), 1.5);
  assert.equal(renderer.rebuilds(), 3);
});
