const desktop = window.haloDesktop;
const canvas = document.getElementById('halo');
const status = document.getElementById('status');
const labels = {
  idle: '待机', working: '正在运行', streaming: '生成消息', tool_running: '执行工具',
  approval_required: '等待审批', completed: '任务完成', failed: '任务失败', interrupted: '任务已中断',
};
const activities = { command: '命令执行', file: '文件修改', tool: '工具调用', network: '网络访问' };
let desktopState;
function render() {
  if (!desktopState) return;
  const { mode, paused, visual, signal, online, fps, clickThrough } = desktopState;
  const label = !online ? '本地桥接未连接' :
    mode === 'live' && !signal.connected ? 'Codex 未连接' :
      signal.state === 'tool_running' ? activities[signal.activeKind] ?? labels.tool_running : labels[signal.state];
  const title = (mode === 'live' ? '实时' : '模拟') + ' · ' + label + (clickThrough ? ' · 穿透' : '');
  if (status.textContent !== title) status.textContent = title;
  canvas.contentWindow?.postMessage({
    type: 'haloflux-frame', paused, state: signal.state, pulse: mode + '/' + signal.pulse,
    activity: signal.activity, activeKind: signal.activeKind,
    settings: { haloX: 5, light: .8, beams: .62, particles: .55, color: visual.theme, fps, desktop: true,
      qualityTarget: desktopState.lifecycle.application === 'MAIN_AND_OVERLAY_VISIBLE' ? 20 : fps,
      autoQuality: visual.autoQuality, completionAnimation: visual.completionAnimation },
  }, location.origin);
}
canvas.addEventListener('load', render);
desktop.subscribe(next => { desktopState = next; render(); });
desktop.read().then(next => { if (!desktopState) { desktopState = next; render(); } }).catch(() => {});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== canvas.contentWindow ||
    event.data?.type !== 'haloflux-performance') return;
  const { fps, p95, cap } = event.data;
  if ([fps, p95, cap].every(Number.isFinite)) status.dataset.sample = JSON.stringify({ fps, p95, cap });
});
document.getElementById('hide').addEventListener('click', () => desktop.hideOverlay().catch(() => {}));
const resize = document.getElementById('resize');
let start;
let resizeFrame;
const setSize = (width, height) => desktop.resizeOverlay(Math.round(width), Math.round(height)).catch(() => {});
resize.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  resize.setPointerCapture(event.pointerId);
  start = { x: event.screenX, y: event.screenY, width: outerWidth, height: outerHeight };
});
resize.addEventListener('pointermove', event => {
  if (!start || !resize.hasPointerCapture(event.pointerId)) return;
  const width = start.width + event.screenX - start.x;
  const height = start.height + event.screenY - start.y;
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => setSize(width, height));
});
resize.addEventListener('lostpointercapture', () => { start = undefined; });
resize.addEventListener('keydown', event => {
  const keys = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
  if (!Object.hasOwn(keys, event.key)) return;
  event.preventDefault();
  const [x, y] = keys[event.key];
  setSize(outerWidth + x, outerHeight + y);
});
