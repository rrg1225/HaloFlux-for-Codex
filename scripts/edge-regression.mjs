import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { startBridge } from '../src/server.mjs';
import { FAILURE } from '../src/diagnostics.mjs';

const modulePath = process.env.HALOFLUX_PLAYWRIGHT;
assert.ok(modulePath, 'Set HALOFLUX_PLAYWRIGHT to playwright/index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)));
const directory = process.env.HALOFLUX_EDGE_OUTPUT ?? 'output/playwright/v032-regression';
await mkdir(directory, { recursive: true });
const jobs = process.argv.slice(2);
assert.ok(jobs.every(job => job === 'smoke' || job === 'soak'));
const repeats = Number(process.env.HALOFLUX_EDGE_REPEATS ?? 1);
assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 10);
const headless = process.env.HALOFLUX_EDGE_HEADED !== '1';
const running = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
for (const job of jobs.length ? jobs : ['smoke', 'soak']) {
  const source = await readFile(new URL('edge-' + job + '.js', import.meta.url), 'utf8');
  const run = new Function('return (' + source + '\n)')();
  for (let repeat = 1; repeat <= (job === 'soak' ? repeats : 1); repeat++) {
    const bridge = await startBridge({ port: 0, resolveCodex() {
      throw Object.assign(new Error('Browser fixture has no CLI'), { category: FAILURE.cliMissing });
    } });
    const cpuStart = process.cpuUsage();
    const report = { headless, repeat };
    let browser, cdp, failure;
    const pids = new Set();
    try {
      browser = await chromium.launch({ channel: 'msedge', headless, timeout: 20000 });
      report.browser = browser.version();
      cdp = await browser.newBrowserCDPSession();
      const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const measure = async () => {
        const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
        for (const { id } of processInfo) pids.add(id);
        return processInfo;
      };
      report.processStart = await measure();
      await page.goto(bridge.origin, { timeout: 10000 });
      try { report.result = await run(page, bridge.disconnectStreams, directory, () => bridge.streamCount); }
      finally { report.processEnd = await measure(); }
    } catch (error) {
      failure = error;
      report.failure = { message: error.message, ...error.evidence };
    } finally {
      bridge.close();
      await cdp?.detach().catch(() => {});
      await browser?.close();
      const deadline = Date.now() + 5000;
      while ([...pids].some(running) && Date.now() < deadline) await delay(100);
      report.childProcessesAfterClose = [...pids].filter(running).length;
      report.bridgeCpuUs = process.cpuUsage(cpuStart);
      await writeFile(directory + '/' + job + (job === 'soak' && repeats > 1 ? '-' + repeat : '') +
        '.json', JSON.stringify(report, null, 2) + '\n');
    }
    if (failure) throw failure;
    assert.equal(report.childProcessesAfterClose, 0, 'Dedicated Edge processes survived browser close');
    console.log(job + ' ' + repeat + ' passed.');
  }
}
