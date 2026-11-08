// Run against a dedicated bridge with a fresh context. No Codex connection or model call.
async (page, disconnectStreams, _directory, streamCount) => {
  const context = page.context();
  const started = Date.now();
  const timeline = [], errors = [], samples = [];
  const tabs = [];
  const mark = (event, data) => timeline.push({ ms: Date.now() - started, event, ...data });
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  let pending;
  const step = async (name, action, timeout = 10000) => {
    pending = name;
    mark('begin', { name });
    let timer;
    try {
      const result = await Promise.race([action(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Deadline: ' + name)), timeout);
      })]);
      mark('end', { name });
      pending = null;
      return result;
    } finally { clearTimeout(timer); }
  };
  const until = (name, predicate, timeout) => step(name, async () => {
    const deadline = Date.now() + (timeout ?? 10000);
    do {
      if (await predicate()) return;
      await pause(75);
    } while (Date.now() < deadline);
    throw new Error('Unmet condition: ' + name);
  }, timeout);
  const state = tab => tab.evaluate(() => ({
    visible: document.visibilityState, focused: document.hasFocus(),
    connection: document.querySelector('#connection')?.textContent,
    approval: !document.querySelector('#approval')?.hidden,
    approvalCount: document.querySelector('#approval-count')?.textContent,
    privateCards: document.querySelector('#approval-list')?.childElementCount,
    mode: document.querySelector('#live-mode')?.getAttribute('aria-pressed') === 'true' ? 'live' : 'demo',
    canConnect: !document.querySelector('#connect')?.disabled,
    outcome: document.querySelector('#result')?.textContent,
    canvas: document.querySelector('#performance')?.dataset.sample ?? null,
  }));
  const approvalVisible = async tab => {
    const view = await state(tab);
    return view.mode === 'demo' && view.connection === '本地模拟已就绪' &&
      view.approval && view.approvalCount === '1 个请求 · 本地模拟';
  };
  const attach = async (tab, label) => {
    const session = await context.newCDPSession(tab);
    const streams = new Set();
    const entry = { tab, label, session, streams, opens: 0, last: null };
    tabs.push(entry);
    await session.send('Page.enable');
    await session.send('Network.enable');
    await session.send('Performance.enable');
    session.on('Page.frameNavigated', ({ frame }) => {
      if (frame.parentId) return;
      // Navigation can abandon a request without emitting Network.loadingFailed.
      // The new document must earn its own SSE response and snapshot.
      streams.clear();
      entry.last = null;
      mark('navigation', { label });
    });
    session.on('Network.responseReceived', ({ requestId, response }) => {
      if (new URL(response.url).pathname !== '/api/events') return;
      mark('sse-http', { label, status: response.status });
      if (response.status === 200) { streams.add(requestId); entry.opens++; }
    });
    session.on('Network.eventSourceMessageReceived', ({ requestId, data }) => {
      if (!streams.has(requestId)) return;
      const { revision, demo, live } = JSON.parse(data);
      entry.last = { revision, demo: demo.state, approvals: demo.approvals.length, live: live.connection };
      mark('sse-message', { label, ...entry.last });
    });
    for (const event of ['Network.loadingFinished', 'Network.loadingFailed']) {
      session.on(event, ({ requestId, canceled }) => {
        if (streams.delete(requestId)) mark('sse-end', { label, eventName: event, canceled });
      });
    }
    tab.on('pageerror', error => errors.push({ label, type: error.name }));
    tab.on('crash', () => errors.push({ label, type: 'crash' }));
    tab.on('domcontentloaded', () => mark('domcontentloaded', { label }));
    return entry;
  };
  const collect = async () => {
    const rows = [];
    for (const { tab, label, session, streams, opens, last } of tabs) {
      if (tab.isClosed()) continue;
      const { metrics } = await session.send('Performance.getMetrics');
      rows.push({ label, view: await state(tab), opens, streams: streams.size, last,
        timing: Object.fromEntries(metrics.filter(({ name }) =>
          ['TaskDuration', 'ScriptDuration', 'JSHeapUsedSize', 'LayoutDuration'].includes(name))
          .map(({ name, value }) => [name, value])) });
    }
    return rows;
  };
  const api = (tab, action, fields) => tab.evaluate(async ({ action, fields }) => {
    const response = await fetch('/api/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        'X-HaloFlux-Token': document.querySelector('meta[name=haloflux-token]').content },
      body: JSON.stringify({ action, ...fields }),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  }, { action, fields });
  const origin = page.url();
  let second;
  try {
    const first = await attach(page, 'first');
    await step('A: single-tab reload', () => page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 }));
    await until('A: single-tab SSE snapshot', async () =>
      streamCount() === 1 && first.streams.size === 1 && (await state(page)).connection === '本地模拟已就绪');
    second = await context.newPage();
    const other = await attach(second, 'second');
    await step('B: open second tab', () => second.goto(origin, { waitUntil: 'domcontentloaded', timeout: 10000 }));
    await until('B: both tabs ready', async () =>
      streamCount() === 2 && other.streams.size === 1 && (await state(second)).connection === '本地模拟已就绪');
    await step('C: start simulated approval', () => second.getByRole('button', { name: '模拟审批' }).click({ timeout: 10000 }));
    await until('C: same approval snapshot in both tabs', async () =>
      first.last?.approvals === 1 && other.last?.approvals === 1 &&
      first.last.revision === other.last.revision && await approvalVisible(page) && await approvalVisible(second));
    const card = tab => tab.getByRole('button', { name: '批准本次请求' });
    await step('C: open second tab approval', () => second.getByText('查看请求并决定').click({ timeout: 10000 }));
    await until('C: second tab private preview', async () => (await state(second)).privateCards === 1);
    const opens = other.opens;
    await step('C: end both SSE responses', async () => disconnectStreams());
    await until('C: both tabs offline with private preview cleared', async () => {
      const views = await Promise.all([state(page), state(second)]);
      return streamCount() === 0 && views.every(view => view.connection === '本地桥接未连接' && view.privateCards === 0);
    });
    await until('C: both tabs recover the pending snapshot', async () =>
      streamCount() === 2 && other.opens > opens && first.opens > 1 &&
      first.streams.size === 1 && other.streams.size === 1 &&
      await approvalVisible(page) && await approvalVisible(second));
    check(await card(second).count() === 0, 'SSE reconnect reopened a private preview');
    for (let cycle = 1; cycle <= 12; cycle++) {
      await step('E: reload second tab ' + cycle, async () => {
        await second.bringToFront();
        await second.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      });
      await until('E: fresh SSE and approval after reload ' + cycle, async () =>
        streamCount() === 2 && other.opens === opens + 1 + cycle && other.streams.size === 1 &&
        other.last?.approvals === 1 && await approvalVisible(second));
      check(await card(second).count() === 0, 'Reload reopened a private preview');
      await step('D: switch to live ' + cycle, () => second.locator('#live-mode').click({ timeout: 10000 }));
      await until('D: live and connected to bridge ' + cycle, async () => {
        const view = await state(second);
        return view.mode === 'live' && view.canConnect && !view.approval;
      });
      await step('D: switch to demo ' + cycle, () => second.locator('#demo-mode').click({ timeout: 10000 }));
      await until('D: pending demo approval restored ' + cycle, () => approvalVisible(second));
      await step('bring first tab forward ' + cycle, () => page.bringToFront());
      // Preserve the old 120-second dwell. The host owns the timer, not a page.
      await pause(10000);
      await step('collect garbage ' + cycle, () => first.session.send('HeapProfiler.collectGarbage'));
      samples.push(await step('capture both tabs ' + cycle, collect));
    }
    check(await card(page).count() === 0, 'Unexpected private card after tab activity');
    for (const [tab, label] of [[second, 'second'], [page, 'first']]) {
      await step('F: open private approval in ' + label, async () => {
        await tab.bringToFront();
        await tab.getByText('查看请求并决定').click({ timeout: 10000 });
      });
      await until('F: private card in ' + label, async () => (await state(tab)).privateCards === 1);
    }
    const contexts = await step('F: get same request in both tabs', () =>
      Promise.all([api(page, 'demo-context'), api(second, 'demo-context')]));
    const ticket = contexts[0].body.ticket;
    check(contexts.every(row => row.status === 200 && row.body.ticket === ticket) && typeof ticket === 'string',
      'Tabs disagree about the pending ticket');
    const decisions = await step('F: simultaneous decisions from two tabs', () =>
      Promise.all([page, second].map(tab => api(tab, 'demo-decision', { ticket, decision: 'decline' }))));
    check(decisions.map(row => row.status).sort().join() === '200,400', 'Expected exactly one accepted decision');
    await until('F: both tabs show completed and clear private cards', async () =>
      (await Promise.all([state(page), state(second)])).every(view =>
        view.outcome === '已完成' && !view.approval && view.privateCards === 0));
    const task = (await step('F: read the demo timeline', () => api(page, 'demo-details'))).body.task;
    check(task.timeline.filter(item => item.event === 'approval-result' && item.status === 'decline').length === 1,
      'Expected one decline in the task timeline');
    await step('F: start a new approval', () => page.getByRole('button', { name: '模拟审批' }).click({ timeout: 10000 }));
    await until('F: new approval in both tabs', async () => await approvalVisible(page) && await approvalVisible(second));
    const stale = await step('F: try old ticket in the new turn', () =>
      api(second, 'demo-decision', { ticket, decision: 'decline' }));
    check(stale.status === 400 && await approvalVisible(page), 'Old ticket affected the new turn');
    const natural = (await state(second)).visible;
    await step('G: capture hidden tab behavior', async () => {
      await second.evaluate(controlled => {
        const doc = document.querySelector('iframe').contentDocument;
        if (controlled) {
          Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
          doc.dispatchEvent(new Event('visibilitychange'));
        }
        document.querySelector('#performance').removeAttribute('data-sample');
      }, natural !== 'hidden');
      await page.evaluate(() => document.querySelector('#performance').removeAttribute('data-sample'));
    });
    await until('G: new front-tab Canvas sample', async () => (await state(page)).canvas !== null, 20000);
    check((await state(second)).canvas === null, 'Hidden tab emitted a Canvas sample');
    await step('G: restore second tab', async () => {
      await second.bringToFront();
      await second.evaluate(controlled => {
        if (!controlled) return;
        const doc = document.querySelector('iframe').contentDocument;
        delete doc.hidden;
        doc.dispatchEvent(new Event('visibilitychange'));
      }, natural !== 'hidden');
    });
    await until('G: restored second tab draws again', async () => (await state(second)).canvas !== null, 20000);
    await step('close second tab', () => second.close());
    await until('second tab SSE removed on server', () => streamCount() === 1);
    await step('bring first tab forward and reset sample', async () => {
      await page.bringToFront();
      await page.evaluate(() => document.querySelector('#performance').removeAttribute('data-sample'));
    });
    await until('fresh Canvas sample after second tab closes', async () => (await state(page)).canvas !== null, 20000);
    check(errors.length === 0, 'Browser page errors: ' + JSON.stringify(errors));
    return { durationMs: Date.now() - started, refreshes: 12, modeSwitches: 24,
      freshCanvasSampleAfterClose: true, nativeBackground: natural === 'hidden', samples, timeline };
  } catch (error) {
    const waiting = pending;
    const snapshot = await Promise.race([collect().catch(() => null), pause(2000).then(() => null)]);
    error.evidence = { pending: waiting, serverStreams: streamCount(), timeline, errors, samples, snapshot };
    throw error;
  } finally {
    await Promise.allSettled(tabs.map(({ session }) => session.detach()));
    if (second && !second.isClosed()) await second.close();
  }
}
