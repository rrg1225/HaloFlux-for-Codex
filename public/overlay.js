const desktop = window.haloDesktop;
const canvas = document.getElementById('halo');
const status = document.getElementById('status');
const labels = {
  idle: '待机', working: '正在运行', streaming: '生成消息', tool_running: '执行工具',
  approval_required: '等待审批', completed: '任务完成', failed: '任务失败', interrupted: '任务已中断',
};
let data;
let desktopState;
let online = false;
function render() {
  if (!desktopState) return;
  const { mode, paused, preferences: prefs, clickThrough } = desktopState;
  const signal = online ? data?.[mode] : undefined;
  const nextState = signal?.state ?? 'idle';
  const label = !online ? '本地桥接未连接' :
    mode === 'live' && !['connected', 'resume_failed'].includes(signal?.connection) ? 'Codex 未连接' : labels[nextState];
  const title = (mode === 'live' ? '实时' : '模拟') + ' · ' + label + (clickThrough ? ' · 穿透' : '');
  if (status.textContent !== title) status.textContent = title;
  const fps = desktopState.sharedDrawing && prefs.overlayAutoQuality ? Math.min(prefs.overlayFps, 20) : prefs.overlayFps;
  canvas.contentWindow?.postMessage({
    type: 'haloflux-frame', paused, state: nextState, pulse: mode + '/' + (signal?.pulse ?? 0),
    activity: signal?.activity, activeKind: signal?.activeKind,
    settings: { haloX: 5, light: .8, beams: .62, particles: .55, color: prefs.theme, fps,
      autoQuality: prefs.overlayAutoQuality, completionAnimation: prefs.completionAnimation },
  }, location.origin);
}
canvas.addEventListener('load', render);
const events = new EventSource('/api/events');
events.onmessage = event => { data = JSON.parse(event.data); online = true; render(); };
events.onerror = () => { online = false; render(); };
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
