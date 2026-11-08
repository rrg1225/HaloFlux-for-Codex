const kinds = {
  command: '命令执行', file: '文件修改', network: '网络访问', permissions: '额外权限',
  input: '用户输入', elicitation: 'MCP 输入请求', stdin: '终端输入',
};
const decisions = {
  accept: '批准本次请求', answer: '提交答案', decline: '拒绝请求', cancel: '拒绝并中断', reject: '报告不支持',
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function approvalCard(view, onDecision, demo = false) {
  const card = element('form', null, 'approval-card');
  const fields = new Map();
  card.addEventListener('submit', event => event.preventDefault());
  card.append(element('h4', demo ? '模拟命令执行' : kinds[view.kind]));
  const add = (label, value, code = false) => {
    if (value == null) return;
    card.append(element('p', label, 'field-label'), element(code ? 'pre' : 'p', value));
  };
  if (!demo) {
    add('当前线程', view.threadId);
    add('当前任务', view.turnId);
    add('请求原因', view.reason ?? 'Codex 未提供');
    add('有效至', new Date(view.expiresAt).toLocaleTimeString());
  }
  add('命令', view.command, true);
  add('工作目录', view.cwd, true);
  add('访问目标', view.host && view.protocol ? view.protocol + ' · ' + view.host : null, true);
  add('请求权限', view.permissions, true);
  if (view.kind === 'command' && !view.permissions && !demo) add('请求权限', 'Codex 未提供额外权限清单');
  add('写入授权根目录', view.grantRoot, true);
  add('MCP 服务', view.server, true);
  if (view.kind === 'input' && view.blocking !== null) add('输入方式', view.blocking ? '等待答案' : '任务可继续');
  if (view.kind === 'permissions') add('授权范围', '仅当前任务');
  if (view.kind === 'command' || view.kind === 'network') {
    add('授权范围', view.kind === 'network' ? '仅本次网络目标请求' : '仅当前命令请求');
  }
  if (view.kind === 'file') {
    add('影响范围', view.files ? view.files.length + ' 个目标 · 本次补丁' : '缺少可审查的文件变更');
    for (const file of view.files ?? []) {
      const diff = element('details', null, 'patch');
      const kind = { add: '创建', delete: '删除', update: file.destination ? '移动或修改' : '修改' }[file.type];
      diff.open = true;
      diff.append(element('summary', kind + ' · ' + file.path + (file.destination ? ' → ' + file.destination : '')),
        element('pre', file.diff === null ? '无法完整显示差异' : file.diff || '无内容差异'));
      card.append(diff);
    }
  }
  for (const question of view.questions ?? []) {
    if (question.header) card.append(element('p', question.header, 'field-label'));
    const label = element('label', question.question);
    const options = element('select');
    options.append(new Option('请选择', ''));
    for (const option of question.options) options.append(new Option(option.label + ' · ' + option.description, option.label));
    const free = element('textarea');
    free.placeholder = '输入答案';
    free.maxLength = 4000;
    if (question.options.length) label.append(options);
    if (question.free) label.append(free);
    fields.set(question.id, () => (question.free && free.value.trim()) || options.value);
    card.append(label);
  }
  if (!view.decisions.some(decision => ['accept', 'answer'].includes(decision))) {
    add('处理限制', '当前请求无法安全批准或回答。');
  }
  const actions = element('div', null, 'actions');
  for (const decision of view.decisions) {
    const button = element('button', decisions[decision], ['accept', 'answer'].includes(decision) ? 'approve' : '');
    button.type = 'button';
    button.addEventListener('click', () => {
      const answers = decision === 'answer' ? Object.fromEntries([...fields].map(([id, value]) => [id, value()])) : undefined;
      if (answers && Object.values(answers).some(answer => !answer)) {
        card.querySelector('[role="status"]').textContent = '请回答每一个问题。';
        return;
      }
      const { requestId, threadId, turnId, ticket } = view;
      onDecision({ requestId, threadId, turnId, ticket, decision, answers });
    });
    actions.append(button);
  }
  const status = element('p');
  status.setAttribute('role', 'status');
  card.append(actions, status);
  return card;
}
