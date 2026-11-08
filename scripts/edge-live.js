async page => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.getByText('本地模拟已就绪').waitFor();
  await page.getByRole('button', { name: '实时 Codex' }).click();
  const connect = page.getByRole('button', { name: '连接 Codex' });
  if (await connect.isEnabled()) await connect.click();
  await page.getByText('Codex 已连接', { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#current-thread').textContent.length > 0);
  const previousThread = await page.locator('#current-thread').textContent();
  await page.getByRole('button', { name: '新建线程' }).click();
  await page.waitForFunction(previous => {
    const current = document.querySelector('#current-thread').textContent;
    return current !== previous && /^[a-zA-Z0-9_-]{16,128}$/.test(current);
  }, previousThread);
  const thread = await page.locator('#current-thread').textContent();
  await page.getByRole('textbox', { name: '给 Codex 的任务' }).fill(
    'HaloFlux browser smoke test. Use apply_patch exactly once to add hf-edge-deny.txt in the current directory with one line HALOFLUX_EDGE. Do not use other tools, retry, or use a fallback. After the single attempt, reply briefly.');
  await page.getByRole('button', { name: '运行任务' }).click();
  await page.getByText('1 个请求 · 实时 Codex').waitFor({ timeout: 90000 });
  await page.getByText('查看请求并决定').click();
  await page.getByRole('button', { name: '批准本次请求' }).waitFor();
  await page.locator('.approval-card').getByText(/创建 · .*hf-edge-deny\.txt/).waitFor();
  await page.reload();
  await page.getByText('本地模拟已就绪').waitFor();
  await page.getByRole('button', { name: '实时 Codex' }).click();
  await page.getByText('1 个请求 · 实时 Codex').waitFor();
  check(await page.getByRole('button', { name: '批准本次请求' }).count() === 0, 'Reload exposed an approval action');
  await page.getByText('查看请求并决定').click();
  await page.getByRole('button', { name: '拒绝请求' }).click();
  await page.getByText('已完成', { exact: true }).waitFor({ timeout: 90000 });
  check(await page.getByRole('button', { name: '批准本次请求' }).count() === 0, 'Old approval remains actionable');
  // The test bridge ends only its SSE streams periodically. Reconnect must preserve the same completed turn.
  await page.getByText('本地桥接未连接').waitFor({ timeout: 60000 });
  await page.getByText('Codex 已连接', { exact: true }).waitFor({ timeout: 10000 });
  await page.waitForFunction(thread => document.querySelector('#current-thread').textContent === thread, thread);
  await page.getByText('已完成', { exact: true }).waitFor();
  await page.getByText('任务详情与执行时间线').click();
  await page.getByText('执行时间线', { exact: true }).click();
  await page.getByText(/审批处理 · 文件修改 · 已提交拒绝/).waitFor();
  return 'Edge live approval, refresh, private timeline and real SSE reconnect passed';
}
