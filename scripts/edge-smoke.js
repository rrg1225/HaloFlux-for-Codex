async (page, disconnectStreams, directory = 'output/playwright') => {
  const problems = [];
  page.on('pageerror', error => problems.push(error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sample = async count => page.evaluate(count => new Promise((resolve, reject) => {
    const rows = [];
    const listener = event => {
      if (event.source !== document.querySelector('iframe').contentWindow || event.data?.type !== 'haloflux-performance') return;
      const { fps, p95, cap } = event.data;
      rows.push({ fps: +fps.toFixed(2), p95: +p95.toFixed(2), cap });
      if (rows.length === count) { clearTimeout(timer); window.removeEventListener('message', listener); resolve(rows); }
    };
    const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('No Canvas samples')); }, 20000);
    window.addEventListener('message', listener);
  }), count);
  await page.getByText('本地模拟已就绪').waitFor();
  await page.getByRole('checkbox', { name: '低性能模式' }).uncheck();
  await page.getByRole('combobox', { name: '渲染上限' }).selectOption('60');
  await page.getByRole('button', { name: '模拟审批' }).click();
  await page.getByText('1 个请求 · 本地模拟').waitFor();
  const results = [];
  for (const [width, height] of [[1366, 768], [1920, 1080], [2560, 1440], [820, 1180]]) {
    await page.setViewportSize({ width, height });
    const size = await page.evaluate(() => {
      const iframe = document.querySelector('iframe');
      const doc = iframe.contentDocument;
      const stage = doc.querySelector('#stage');
      const bounds = stage.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, pixels: stage.width,
        overflow: doc.documentElement.scrollWidth - iframe.clientWidth,
        rootOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        iframeOverflowStyle: getComputedStyle(doc.documentElement).overflowY };
    });
    check(size.width > 300 && size.height > 250 && size.pixels > 100 && size.overflow <= 1 &&
      size.rootOverflow === 0 && size.iframeOverflowStyle === 'hidden',
    'Canvas layout at ' + width + ': ' + JSON.stringify(size));
    const [, ...rows] = await sample(4);
    check(rows.every(row => row.cap === 60), 'Unexpected benchmark FPS cap');
    results.push({ width, height, rows });
    await page.screenshot({ path: directory + '/layout-' + width + '.png' });
  }
  const canvas = page.frames().find(child => /\/canvas-(desktop|mobile)$/.test(child.url()));
  await page.locator('#autoQuality').uncheck();
  await canvas.waitForFunction(() => Math.abs(DPR - 1) < 1e-6);
  const fixedWidth = await canvas.evaluate(() => stage.width);
  await page.getByRole('checkbox', { name: '低性能模式' }).check();
  await canvas.waitForFunction(() => DPR === .85);
  check(await canvas.evaluate(() => stage.width) < fixedWidth, 'Low mode did not rebuild at its lower backing DPR');
  const [, ...low] = await sample(4);
  check(low.every(row => row.cap === 20), 'Low mode did not cap at 20 FPS');
  await page.evaluate(() => {
    const iframe = document.querySelector('iframe');
    const doc = iframe.contentDocument;
    Object.defineProperty(doc, 'hidden', { configurable: true, value: true });
    doc.dispatchEvent(new Event('visibilitychange'));
    document.querySelector('#performance').removeAttribute('data-sample');
  });
  await page.waitForTimeout(2600);
  check(await page.locator('#performance[data-sample]').count() === 0, 'Canvas drew while visibility was hidden');
  await page.evaluate(() => {
    const doc = document.querySelector('iframe').contentDocument;
    delete doc.hidden;
    doc.dispatchEvent(new Event('visibilitychange'));
  });
  await sample(1);
  await page.reload();
  await page.getByText('1 个请求 · 本地模拟').waitFor();
  check(await page.getByRole('checkbox', { name: '低性能模式' }).isChecked(), 'Visual setting lost after refresh');
  check(await page.getByRole('button', { name: '批准本次请求' }).count() === 0, 'Approval opened itself on reload');
  await page.getByText('查看请求并决定').click();
  await page.getByRole('button', { name: '批准本次请求' }).waitFor();
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sample(1);
  await page.screenshot({ path: directory + '/simulated-approval.png' });
  if (typeof disconnectStreams === 'function') {
    const disconnected = page.getByText('本地桥接未连接', { exact: true }).waitFor({ timeout: 10000 });
    disconnectStreams();
    await disconnected;
    check(await page.locator('#approval-list').evaluate(list => list.childElementCount === 0),
      'Private approval was retained after a real SSE disconnect');
    await page.getByText('1 个请求 · 本地模拟').waitFor();
    check(await page.getByRole('button', { name: '批准本次请求' }).count() === 0, 'Private approval reopened on reconnect');
    await page.getByText('查看请求并决定').click();
    await page.getByRole('button', { name: '拒绝请求' }).waitFor();
  }
  await page.getByRole('button', { name: '拒绝请求' }).click();
  await page.getByText('已完成', { exact: true }).waitFor();
  await page.getByText('任务详情与执行时间线').click();
  await page.getByText('执行时间线', { exact: true }).click();
  await page.getByText('审批处理 · 命令执行 · 已提交拒绝', { exact: false }).waitFor();
  await page.getByRole('button', { name: '实时 Codex' }).click();
  await page.getByRole('button', { name: '连接 Codex' }).waitFor();
  await page.getByRole('button', { name: '模拟演练' }).click();
  await page.getByRole('button', { name: '模拟失败' }).click();
  await page.locator('#state-label').filter({ hasText: '任务失败' }).waitFor();
  await page.getByRole('checkbox', { name: '低性能模式' }).uncheck();
  if (await page.locator('#health-panel').count()) {
    await page.getByText('查看本机状态').click();
    const report = page.locator('#health-list');
    await report.getByText('Node.js', { exact: true }).waitFor();
    await report.getByText('Windows 沙箱', { exact: true }).waitFor();
    check(await report.getByText(/沙箱执行失败|沙箱初始化失败记录|命令执行需单独验证/).count() === 1,
      'Health panel omitted its sandbox evidence boundary');
    const [download] = await Promise.all([page.waitForEvent('download'),
      page.getByRole('button', { name: '导出脱敏诊断报告' }).click()]);
    check(download.suggestedFilename() === 'haloflux-diagnostics.json', 'Unexpected diagnostics filename');
  }
  check(!problems.length, JSON.stringify(problems));
  return { results, low, realSseReconnect: typeof disconnectStreams === 'function',
    browser: await page.evaluate(() => navigator.userAgent.match(/Edg\/[^ ]+/)?.[0]),
    dpr: await page.evaluate(() => devicePixelRatio) };
}
