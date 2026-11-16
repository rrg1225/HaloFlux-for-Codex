import { approvalCard } from './approval-ui.js';

const $ = id => document.getElementById(id);
const frame = $('renderer');
const token = document.querySelector('meta[name="haloflux-token"]').content;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const labels = {
  idle: '待机', working: '正在运行', streaming: '生成消息', tool_running: '执行工具',
  approval_required: '等待审批', completed: '任务完成', failed: '任务失败', interrupted: '任务已中断',
};
const activities = { command: '命令执行', file: '文件修改', tool: '其他工具', message: '模型消息', network: '网络访问', permissions: '额外权限', input: '用户输入', elicitation: 'MCP 请求' };
const outcomes = {
  completed: '已完成', failed: '失败', interrupted: '已中断', declined: '已拒绝', inProgress: '进行中',
  unknown: '终态未知', accept: '已提交批准', decline: '已提交拒绝', reject: '已报告不支持',
  cancel: '已提交拒绝并中断', answer: '已提交答案', expired: '已过期', closed: '已关闭',
};
const eventsLabel = {
  'turn-started': '任务开始', 'turn-completed': '任务结束', 'item-started': '项目启动',
  'item-completed': '项目结束', 'approval-request': '收到审批请求', 'approval-result': '审批处理', error: '任务错误',
};
const connections = { connected: 'Codex 已连接', connecting: 'Codex 连接中', disconnected: 'Codex 未连接', resume_failed: 'Codex 已连接 · 恢复失败' };
const fallback = { state: 'idle', activity: null, pulse: 0, counts: {}, approvals: [], active: false };
const visual = document.querySelector('.visual');
const desktop = window.haloDesktop;
const desktopVisualKeys = { fps: 'fps', color: 'theme', autoQuality: 'autoQuality' };
let desktopState;
let mode = 'demo';
let data;
let online = false;
let pending = false;
let epoch = 0;
let timer;
let loading = false;
let viewKey = '';
let approvalKey = '';
let lastPulse;
let nextCursor;
let loadingThreads = false;
let healthReport;
let healthStale = false;
let connectionState = 'unchecked';
let checkingHealth = false;
const logs = { live: [], demo: [] };
const failureHints = {
  CODEX_SANDBOX_FAILURE: 'Codex 沙箱运行失败。可继续模拟演练。检查 Windows 沙箱日志与 Codex 安装。',
  CODEX_PROTOCOL_ERROR: 'Codex 协议不兼容或响应无效。运行 npm run check:protocol。',
  CODEX_CLI_NOT_FOUND: '未找到 Codex CLI。安装后重启桥接。',
  CODEX_CLI_PATH_INVALID: 'CODEX_BIN 无效。请指定本机原生可执行文件的绝对路径。',
  AUTHENTICATION_ERROR: 'Codex 身份验证失败。请检查 codex login status。',
  UNKNOWN_ENVIRONMENT_ERROR: '检查 CLI、登录状态和本地连接。',
  APPLICATION_BUG: '本地桥接处理失败。可导出诊断报告。',
};

const settings = {
  spin: 1, light: 1, beams: 1, particles: reduced ? .45 : 1, rhythm: reduced ? .55 : 1,
  color: 'state', fps: reduced ? 20 : 60, zoom: 1, haloX: 0, haloY: 0, ratio: 72,
  readability: 100, follow: true, composition: 'fit', autoQuality: true, low: reduced,
};
try {
  const saved = JSON.parse(localStorage.getItem('haloflux.settings.v2') ?? localStorage.getItem('haloflux.settings.v1'));
  for (const key in settings) if (typeof saved?.[key] === typeof settings[key]) settings[key] = saved[key];
} catch {}
for (const key in settings) {
  const field = $(key);
  if (field.type === 'checkbox') field.checked = settings[key];
  else field.value = settings[key];
  const read = () => field.type === 'checkbox' ? field.checked :
    typeof settings[key] === 'string' ? field.value || field.options[0].value : Number(field.value);
  settings[key] = read();
  field.addEventListener('input', () => {
    settings[key] = read();
    if (desktop && Object.hasOwn(desktopVisualKeys, key)) {
      desktop.preference(desktopVisualKeys[key], settings[key]).catch(() => {});
    }
    try { localStorage.setItem('haloflux.settings.v2', JSON.stringify(settings)); } catch {}
    applySettings();
  });
}

function applySettings() {
  document.documentElement.style.setProperty('--ratio', settings.ratio + '%');
  document.documentElement.style.setProperty('--readability', (settings.readability / 100 * 14) + 'px');
  visual.dataset.follow = settings.follow;
  sendFrame();
}

function sendFrame() {
  const { state, activity, activeKind, pulse } = online ? data?.[mode] ?? fallback : fallback;
  const fps = desktopState?.fps ?? settings.fps;
  const dual = desktopState?.lifecycle.application === 'MAIN_AND_OVERLAY_VISIBLE';
  frame.contentWindow?.postMessage({
    type: 'haloflux-frame', state, activity, activeKind, pulse: mode + '/' + pulse,
    paused: desktopState?.paused === true, settings: { ...settings, fps, desktop: !!desktop, qualityTarget: dual ? 30 : fps,
      completionAnimation: desktopState?.preferences.completionAnimation },
  }, location.origin);
}
frame.addEventListener('load', sendFrame);
frame.src = matchMedia('(pointer: coarse)').matches ? '/canvas-mobile' : '/canvas-desktop';
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== frame.contentWindow || event.data?.type !== 'haloflux-performance') return;
  const { fps, p95, cap } = event.data;
  if (![fps, p95, cap].every(Number.isFinite)) return;
  $('performance').dataset.sample = JSON.stringify({ fps, p95, cap });
  text('performance', '绘制 ' + fps.toFixed(1) + ' FPS · 间隔 P95 ' + p95.toFixed(1) + ' ms · 上限 ' + cap);
  if (desktopState?.lifecycle.application === 'MAIN_AND_OVERLAY_VISIBLE' &&
    desktopState.preferences.budget === 'balanced' && cap === desktopState.fps) {
    desktop.frameSample(fps, p95).catch(() => {});
  }
});

function text(id, value) {
  if ($(id).textContent !== value) $(id).textContent = value;
}
function li(value) {
  const item = document.createElement('li');
  item.textContent = value;
  return item;
}
function showError(message) {
  text('error', message);
  $('error').hidden = !message;
}
function isConnected() {
  return online && ['connected', 'resume_failed'].includes(data?.live.connection);
}
function clearPrivate() {
  epoch++;
  viewKey = '';
  approvalKey = '';
  $('approval-review').open = false;
  $('approval-list').replaceChildren();
  $('thread-picker').open = false;
  $('thread-list').replaceChildren();
  $('more-threads').hidden = true;
  nextCursor = null;
  $('thread-id').value = '';
  $('task-detail').open = false;
  text('current-thread', '未选择');
  renderDetail(null);
}

function render() {
  const status = online ? data?.[mode] ?? fallback : fallback;
  const { state, activity, activeKind, activityResult, outcome, active, counts, approvals } = status;
  const live = mode === 'live';
  const connection = data?.live.connection ?? 'disconnected';
  const connected = isConnected();
  text('connection', !online ? '本地桥接未连接' : live ? connections[connection] : '本地模拟已就绪');
  $('connection').parentElement.dataset.online = online && (!live || connected);
  text('mode-note', live ? 'LIVE SIGNAL · CODEX APP SERVER' : 'SIMULATED SIGNAL · 本地模拟');
  $('live-controls').hidden = !live;
  $('demo-controls').hidden = live;
  $('live-mode').setAttribute('aria-pressed', String(live));
  $('demo-mode').setAttribute('aria-pressed', String(!live));
  visual.dataset.state = state;
  visual.dataset.activity = activeKind ?? activity ?? '';
  text('state-code', state.toUpperCase());
  text('state-label', status.interrupting ? '正在中断' : state === 'tool_running' ? activities[activeKind] ?? labels[state] : labels[state]);
  text('activity-label', activity ? activities[activity] + (activityResult ? ' · ' + outcomes[activityResult] : '') : active ? '任务进行中' : '等待活动');
  text('result', outcomes[outcome] ?? '尚无结果');
  const failureHint = live ? failureHints[status.failure] : '';
  text('failure-hint', failureHint ?? '');
  $('failure-hint').hidden = !failureHint;
  for (const key of ['command', 'file', 'tool', 'message']) text('count-' + key, String(counts[key] ?? 0).padStart(2, '0'));
  $('connect').disabled = !online || pending || ['connecting', 'connected'].includes(connection);
  const locked = !connected || active || pending || !!status.busy;
  for (const id of ['new-thread', 'resume', 'run']) $(id).disabled = locked;
  $('thread-list').querySelectorAll('button').forEach(button => { button.disabled = locked; });
  $('interrupt').disabled = !online || !status.canInterrupt || status.interrupting || pending;
  document.querySelectorAll('[data-scenario]').forEach(button => { button.disabled = !online || pending || active; });
  $('approval').hidden = !approvals.length;
  text('approval-count', approvals.length + ' 个请求 · ' + (live ? '实时 Codex' : '本地模拟'));
  if (!approvals.length || status.interrupting) {
    $('approval-review').open = false;
    renderApprovals([]);
  }
  $('approval-list').querySelectorAll('button').forEach(button => { button.disabled = pending || !online || status.interrupting; });
  const entry = labels[state] + (activity ? ' · ' + activities[activity] : '');
  if (entry !== logs[mode][0] && online) {
    logs[mode].unshift(entry);
    logs[mode].length = Math.min(logs[mode].length, 5);
  }
  const log = logs[mode].join('\n');
  if ($('activity-log').dataset.log !== log) {
    $('activity-log').dataset.log = log;
    $('activity-log').replaceChildren(...(logs[mode].length ? logs[mode] : ['等待首个信号']).map(li));
  }
  const pulse = [mode, state, activeKind, activity, status.pulse].join('/');
  if (pulse !== lastPulse) { lastPulse = pulse; sendFrame(); }
  const key = [mode, online, connection, status.detailRevision, status.interrupting, approvals.length].join('/');
  if (key !== viewKey) {
    viewKey = key;
    queueViews();
  }
}

async function api(action, args = {}) {
  const response = await fetch('/api/action', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HaloFlux-Token': token },
    body: JSON.stringify({ action, ...args }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
function errorMessage(error) {
  return error instanceof TypeError ? '本地桥接不可用。' : error.message;
}

async function perform(action, args = {}) {
  if (pending) return;
  pending = true;
  showError('');
  render();
  try {
    await api(action, args);
    if (action === 'run' && $('prompt').value === args.prompt) $('prompt').value = '';
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    pending = false;
    render();
    queueViews();
  }
}

function renderApprovals(approvals) {
  const key = approvals.map(view => view.ticket).join('/');
  if (key === approvalKey) return;
  approvalKey = key;
  const live = mode === 'live';
  $('approval-list').replaceChildren(...approvals.map(view =>
    approvalCard(view, decision => perform(live ? 'decision' : 'demo-decision', decision), !live)));
}
function renderDetail(task) {
  $('detail-content').hidden = !task;
  text('detail-status', task ? (mode === 'live' ? '实时 Codex' : '本地模拟') +
    (task.historical ? ' · 历史任务' : '') + ' · ' + (outcomes[task.outcome] ?? '进行中') : '');
  text('detail-prompt', task?.prompt ?? '暂无输入文本');
  text('detail-reply', task?.reply || '暂无回复');
  text('detail-error', task?.error ?? '');
  $('detail-error').hidden = !task?.error;
  $('timeline').replaceChildren(...(task?.timeline ?? []).map(({ event, kind, status, at }) =>
    li([new Date(at).toLocaleTimeString(), eventsLabel[event], activities[kind], outcomes[status]].filter(Boolean).join(' · '))));
  if (task && !task.timeline.length) $('timeline').replaceChildren(li('无可用实时事件'));
}
const healthFields = {
  node: ['Node.js'], cli: ['Codex CLI', '检查 CLI 是否安装，或设置 CODEX_BIN。'],
  login: ['Codex 登录', '运行 codex login status 核对本机登录状态。'],
  appServer: ['App Server', '在实时模式中连接 Codex。'],
  protocol: ['协议兼容性', '连接后可检查协议。运行 npm run check:protocol 查看兼容情况。'],
  sandbox: ['Windows 沙箱'],
  local: ['本地桥接'],
};
const healthLabels = { ok: '正常', warning: '警告', failed: '失败', unchecked: '未检测' };
function renderingEnvironment() {
  const sample = $('performance').dataset.sample;
  return {
    status: sample ? 'ok' : 'unchecked',
    dpr: devicePixelRatio,
    visibility: document.visibilityState,
    acceleration: 'unchecked',
    connection: { status: connectionState },
  };
}
async function refreshHealth() {
  if (checkingHealth) return;
  checkingHealth = true;
  $('health-export').disabled = true;
  text('health-status', '正在检查本机环境…');
  try {
    healthReport = await api('health');
    healthStale = false;
    const entries = Object.entries(healthFields).map(([key, [label, hint]]) => {
      const { status, version, evidence } = healthReport[key];
      const sandboxHint = {
        'bridge-failure': '本次桥接观察到沙箱执行失败',
        'local-error-marker': '检测到本机沙箱初始化失败记录',
        unverified: '连接与就绪状态仅覆盖初始化检查，命令执行需单独验证',
      }[evidence];
      const cliHint = { missing: '未安装或不在 PATH', 'invalid-path': 'CODEX_BIN 无效', unusable: 'CLI 无法运行' }[evidence];
      return [label, [healthLabels[status], version, sandboxHint, cliHint, status !== 'ok' ? hint : null,
        key === 'sandbox' ? '运行 npm run diagnose:sandbox 核对只读执行' : null].filter(Boolean).join(' · ')];
    });
    const browser = renderingEnvironment();
    entries.push(['浏览器渲染', healthLabels[browser.status] + ' · DPR ' + browser.dpr +
      ' · ' + (browser.visibility === 'visible' ? '前台可见' : '已隐藏') + ' · 图形加速未检测']);
    const failure = healthReport.lastFailure;
    entries.push(['最近一次失败', failure ? failure + ' · ' + failureHints[failure] : '未检测']);
    $('health-list').replaceChildren(...entries.flatMap(([label, value]) => {
      const title = document.createElement('dt');
      const row = document.createElement('dd');
      title.textContent = label;
      row.textContent = value;
      return [title, row];
    }));
    $('health-export').disabled = false;
    text('health-status', '');
  } catch (error) {
    healthStale = true;
    $('health-list').replaceChildren();
    $('health-export').disabled = !healthReport;
    text('health-status', errorMessage(error) + (healthReport ? ' · 可导出上次的检查结果及当前浏览器状态。' : ''));
  } finally {
    checkingHealth = false;
  }
}
$('health-panel').addEventListener('toggle', () => { if ($('health-panel').open) refreshHealth(); });
$('health-refresh').addEventListener('click', refreshHealth);
$('health-export').addEventListener('click', () => {
  if (!healthReport) return;
  const file = new Blob([JSON.stringify({ ...healthReport, stale: healthStale || connectionState === 'failed',
    browser: renderingEnvironment() }, null, 2)],
    { type: 'application/json' });
  const url = URL.createObjectURL(file);
  const download = document.createElement('a');
  download.href = url;
  download.download = 'haloflux-diagnostics.json';
  download.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function queueViews() {
  if (!online || timer) return;
  timer = setTimeout(() => { timer = null; refreshViews(); }, 130);
}
async function refreshViews() {
  if (loading) return queueViews();
  const started = epoch;
  const live = mode === 'live';
  if (live && !isConnected()) return;
  const review = $('approval-review').open && !$('approval').hidden;
  const detail = $('task-detail').open;
  loading = true;
  try {
    const [context, task] = await Promise.allSettled([
      live ? api('context', { review }) : review ? api('demo-context') : null,
      detail ? api(live ? 'details' : 'demo-details') : null,
    ]);
    if (started !== epoch) return;
    if (context.status === 'fulfilled' && context.value) {
      if (live) text('current-thread', context.value.threadId ?? '未选择');
      if (review && $('approval-review').open && !$('approval').hidden) {
        const demo = context.value.ticket ? [{ ticket: context.value.ticket, kind: 'command', decisions: ['accept', 'decline'] }] : [];
        renderApprovals(live ? context.value.approvals : demo);
      }
    }
    if (detail && $('task-detail').open) {
      renderDetail(task.value?.task);
      if (task.status === 'rejected') text('detail-status', errorMessage(task.reason));
      else if (!task.value?.task) text('detail-status', '暂无任务详情。');
    }
    render();
  } finally {
    loading = false;
  }
}
async function loadThreads(cursor) {
  if (!isConnected() || loadingThreads) return;
  loadingThreads = true;
  const started = epoch;
  try {
    const result = await api('threads', { cursor });
    if (started !== epoch || !$('thread-picker').open) return;
    if (!cursor) $('thread-list').replaceChildren();
    for (const thread of result.threads) {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = thread.name ? thread.name + ' · ' + thread.id : thread.id;
      button.addEventListener('click', () => perform('resume', { threadId: thread.id }));
      row.append(button);
      $('thread-list').append(row);
    }
    while ($('thread-list').childElementCount > 250) $('thread-list').firstElementChild.remove();
    if (!cursor && !result.threads.length) $('thread-list').append(li('没有可访问的线程。'));
    nextCursor = result.nextCursor;
    $('more-threads').hidden = !nextCursor;
    render();
  } catch (error) {
    if (started === epoch) showError(errorMessage(error));
  } finally {
    loadingThreads = false;
  }
}

function changeMode(name) {
  if (mode !== name) clearPrivate();
  mode = name;
  showError('');
  render();
}
for (const name of ['demo', 'live']) {
  $(name + '-mode').addEventListener('click', () => {
    if (desktop) desktop.mode(name).catch(() => {});
    else changeMode(name);
  });
}
document.querySelectorAll('[data-scenario]').forEach(button => {
  button.addEventListener('click', () => perform('demo', { scenario: button.dataset.scenario }));
});
$('connect').addEventListener('click', () => perform('connect'));
$('new-thread').addEventListener('click', () => perform('new'));
$('thread-picker').addEventListener('toggle', () => {
  if ($('thread-picker').open) loadThreads();
  else {
    $('thread-list').replaceChildren();
    $('more-threads').hidden = true;
  }
});
$('more-threads').addEventListener('click', () => loadThreads(nextCursor));
$('approval-review').addEventListener('toggle', () => {
  if (!$('approval-review').open) renderApprovals([]);
  else queueViews();
});
$('task-detail').addEventListener('toggle', () => {
  if (!$('task-detail').open) renderDetail(null);
  else queueViews();
});
$('resume-form').addEventListener('submit', event => {
  event.preventDefault();
  perform('resume', { threadId: $('thread-id').value.trim() });
});
$('run-form').addEventListener('submit', event => {
  event.preventDefault();
  perform('run', { prompt: $('prompt').value });
});
$('interrupt').addEventListener('click', () => perform(mode === 'live' ? 'interrupt' : 'demo-interrupt'));

const events = new EventSource('/api/events');
function updateConnectionState(status) {
  connectionState = status;
  text('health-connection', '浏览器事件流 · ' + healthLabels[status]);
}
events.onmessage = event => {
  const wasConnected = isConnected();
  const previousScope = data?.live.scopeRevision;
  data = JSON.parse(event.data);
  online = true;
  if (connectionState !== 'ok') updateConnectionState('ok');
  if (mode === 'live' && wasConnected && (!isConnected() || previousScope !== data.live.scopeRevision)) clearPrivate();
  render();
};
events.onerror = () => {
  online = false;
  updateConnectionState('failed');
  clearPrivate();
  render();
};
updateConnectionState('unchecked');
applySettings();
render();

if (desktop) {
  const controls = [...document.querySelectorAll('[data-preference]')];
  for (const field of controls) {
    field.addEventListener('change', () => {
      const value = field.type === 'checkbox' ? field.checked :
        field.type === 'range' || field.dataset.preference === 'overlayFps' ? Number(field.value) : field.value;
      desktop.preference(field.dataset.preference, value).catch(() => {});
    });
  }
  function sync(next) {
    if (!next) return;
    const openSettings = next.settingsRequest > (desktopState?.settingsRequest ?? 0);
    desktopState = next;
    const prefs = next.preferences;
    for (const field of controls) {
      const value = prefs[field.dataset.preference];
      if (field.type === 'checkbox') field.checked = value;
      else field.value = value;
    }
    for (const [key, preference] of Object.entries(desktopVisualKeys)) {
      settings[key] = prefs[preference];
      if ($(key).type === 'checkbox') $(key).checked = settings[key];
      else $(key).value = settings[key];
    }
    text('desktop-close-note', prefs.close === 'tray' ? '关闭主窗口会保留托盘与后台任务。' :
      '关闭主窗口会退出应用。真实任务运行时会先询问。');
    text('desktop-overlay-toggle', next.lifecycle.overlay === 'OVERLAY_VISIBLE' ? '隐藏悬浮光环' : '显示悬浮光环');
    $('desktop-tools').hidden = false;
    if (openSettings) {
      $('desktop-settings').open = true;
      $('desktop-settings').scrollIntoView({ block: 'nearest' });
    }
    if (mode !== next.mode) changeMode(next.mode);
    applySettings();
  }
  $('desktop-overlay-toggle').addEventListener('click', () => desktop.overlay().catch(() => {}));
  desktop.subscribe(sync);
  desktop.read().then(next => { if (!desktopState) sync(next); }).catch(() => {});
}
