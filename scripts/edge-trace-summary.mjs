import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const summarize = samples => {
  const sorted = samples.sort((a, b) => a - b);
  const percentile = p => sorted[Math.ceil(sorted.length * p) - 1] ?? null;
  return { n: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) ?? null };
};

for (const path of process.argv.slice(2)) {
  const { traceEvents: events } = JSON.parse(gunzipSync(await readFile(path)));
  const raf = events.find(event => event.name === 'FireAnimationFrame' && event.ph === 'X');
  if (!raf) throw new Error('No animation callback in ' + path);
  const main = event => event.pid === raf.pid && event.tid === raf.tid;
  const duration = (name, filter = () => true) => summarize(events
    .filter(event => event.name === name && event.ph === 'X' && filter(event)).map(event => event.dur / 1000));
  // Nestable async trace events are matched by scope and id. These stages
  // describe Chromium's compositor feedback, not physical display scanout.
  const phaseDuration = name => {
    const starts = new Map();
    const intervals = [];
    const stages = events.filter(event => event.name === name && event.pid === raf.pid)
      .sort((a, b) => a.ts - b.ts);
    for (const event of stages) {
      const id = JSON.stringify(event.id2 ?? event.id);
      if (event.ph === 'b') starts.set(id, event.ts);
      if (event.ph !== 'e' || !starts.has(id)) continue;
      intervals.push((event.ts - starts.get(id)) / 1000);
      starts.delete(id);
    }
    return summarize(intervals);
  };
  console.log(JSON.stringify({
    trace: path, unit: 'ms', scope: 'trace including warmup',
    rafCallback: duration('FireAnimationFrame', main),
    minorGc: duration('MinorGC', main),
    majorGc: duration('MajorGC', main),
    beginMainFrame: duration('ProxyMain::BeginMainFrame', main),
    compositorCommit: duration('ProxyImpl::Commit'),
    rasterWorkerTask: duration('RasterTask'),
    gpuProcessRasterCall: duration('RasterDecoderImpl::DoRasterCHROMIUM'),
    displayDrawAndSwap: duration('Display::DrawAndSwap'),
    submitToPresentationFeedback: phaseDuration('SubmitCompositorFrameToPresentationCompositorFrame'),
    swapEndToPresentationFeedback: phaseDuration('SwapEndToPresentationCompositorFrame'),
    swapThrottled: events.filter(event => event.name === 'Swap throttled').length,
  }));
}
