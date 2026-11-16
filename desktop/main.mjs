import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, powerMonitor, screen, shell, Tray } from 'electron';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { startBackend } from './backend.mjs';
import { desktopNotifications } from './notifications.mjs';
import { acceptsPreference, defaults, readPreferences, savePreferences, visibleBounds } from './preferences.mjs';
import { renderBudget } from './render-budget.mjs';
import { desktopSession } from './window-security.mjs';

const title = 'HaloFlux for Codex';
const labels = {
  idle: '待机', working: '正在运行', streaming: '生成消息', tool_running: '执行工具',
  approval_required: '等待审批', completed: '任务完成', failed: '任务失败', interrupted: '任务已中断',
};
const mainMinimum = { width: 420, height: 320 };
const overlayMinimum = { width: 220, height: 180 };
const mainSizes = { standard: { width: 1180, height: 820 }, compact: { width: 840, height: 620 } };
const overlaySize = { width: 420, height: 350 };
const alive = win => win && !win.isDestroyed();
const visible = win => alive(win) && win.isVisible() && !win.isMinimized();
const drawable = win => visible(win) && !win.webContents.isCrashed();
const visualKinds = new Set(['command', 'file', 'tool', 'message', 'network', 'permissions', 'input', 'elicitation']);

function displayBounds(bounds, size, minimum) {
  const area = (bounds ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()).workArea;
  return visibleBounds(bounds, area, size, minimum);
}

export async function launchDesktop({ cwd = app.getPath('documents'), port = 0, fixture,
  showError = message => dialog.showErrorBox(title, message),
  askExit = options => dialog.showMessageBox(options),
  displayNotice } = {}) {
  await app.whenReady();
  const file = join(app.getPath('userData'), 'desktop-preferences.json');
  const preferences = readPreferences(file);
  const icon = nativeImage.createFromPath(fileURLToPath(new URL('icon.png', import.meta.url)));
  const preload = fileURLToPath(new URL('preload.cjs', import.meta.url));
  let backend, main, overlay, tray, snapshot, menu;
  let overlayGeometry;
  let stopping = false;
  let mode = 'demo';
  let clickThrough = false;
  let sleeping = false;
  let exitDecision = false;
  let waiting = false;
  let settingsRequest = 0;
  let traySignature;
  let saveTimer, waitTimer;
  let closing;
  let dual = false;
  const budget = renderBudget();
  const sent = new WeakMap();
  const handlers = new Set();
  const secured = await desktopSession(() => backend, () => {
    shell.openExternal('https://github.com/Ryder191/haloflux').catch(() => {});
  });
  const notifications = desktopNotifications(preferences, () => visible(main) && main.isFocused() &&
    !main.webContents.isCrashed() && mode === 'live',
  body => (displayNotice ?? (message => tray?.displayBalloon({ title, content: message })))(
    fixture ? '模拟 · ' + body : body));

  function persist() {
    try { savePreferences(file, preferences); } catch { /* The session can run with in-memory preferences. */ }
  }
  function overlayBounds(win) {
    const actual = win.getBounds();
    const { requested, applied } = overlayGeometry;
    // Windows can round a frameless window's native bounds at fractional DPI.
    // Save the requested size and the movement since that size was applied.
    return { ...requested, x: requested.x + actual.x - applied.x, y: requested.y + actual.y - applied.y };
  }
  function setOverlayBounds(win, bounds) {
    win.setBounds(bounds);
    overlayGeometry = { requested: bounds, applied: win.getBounds() };
    remember(win, 'visual');
  }
  function pinOverlay(win) {
    // On Windows the floating level can leave a transparent window behind the main window.
    win.setAlwaysOnTop(preferences.alwaysOnTop, 'pop-up-menu');
  }
  function remember(win, role) {
    if (!alive(win) || win.isMinimized()) return;
    if (role === 'control') {
      preferences.mainBounds = win.getNormalBounds();
      preferences.maximized = win.isMaximized();
    } else preferences.overlayBounds = overlayBounds(win);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 240);
  }
  function state(win) {
    const mainVisible = drawable(main);
    const overlayVisible = drawable(overlay);
    const both = mainVisible && overlayVisible && !sleeping && !stopping;
    const caps = budget.limits(preferences, both, mainVisible && main.isFocused());
    const lifecycle = {
      main: alive(main) && main.isMinimized() ? 'MAIN_MINIMIZED' : mainVisible ? 'MAIN_VISIBLE' : 'MAIN_HIDDEN',
      overlay: overlayVisible ? 'OVERLAY_VISIBLE' : 'OVERLAY_HIDDEN',
      application: stopping ? 'APPLICATION_EXITING' : both ? 'MAIN_AND_OVERLAY_VISIBLE' :
        mainVisible || overlayVisible ? 'APPLICATION_VISIBLE' : 'TRAY_ONLY',
    };
    const paused = stopping || sleeping || !drawable(win);
    if (win === overlay) {
      const signal = backend?.origin && snapshot?.[mode];
      return {
        mode, paused, lifecycle, fps: caps.overlay, clickThrough, online: !!backend?.origin,
        visual: { theme: preferences.theme, autoQuality: preferences.overlayAutoQuality,
          completionAnimation: preferences.completionAnimation },
        signal: {
          state: Object.hasOwn(labels, signal?.state) ? signal.state : 'idle',
          connected: ['connected', 'resume_failed'].includes(signal?.connection),
          pulse: Number.isSafeInteger(signal?.pulse) ? signal.pulse : 0,
          activity: visualKinds.has(signal?.activity) ? signal.activity : null,
          activeKind: visualKinds.has(signal?.activeKind) ? signal.activeKind : null,
        },
      };
    }
    return {
      mode, paused: paused || caps.main === 0, lifecycle, fps: caps.main, settingsRequest,
      preferences: Object.fromEntries(Object.keys(defaults).map(key => [key, preferences[key]])),
    };
  }
  function updateWindows() {
    const nextDual = drawable(main) && drawable(overlay) && !sleeping && !stopping;
    if (dual !== nextDual) budget.reset();
    dual = nextDual;
    for (const win of [main, overlay]) {
      if (!alive(win) || win.webContents.isCrashed()) continue;
      const next = state(win);
      const signature = JSON.stringify(next);
      if (sent.get(win) !== signature) {
        sent.set(win, signature);
        win.webContents.send('halo:state', next);
      }
    }
  }
  function switchMode(next) {
    if (!['live', 'demo'].includes(next)) return false;
    mode = next;
    updateWindows();
    updateTray();
    return true;
  }
  function openMain(settings = false) {
    if (!alive(main) || stopping) return;
    if (settings) settingsRequest++;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    if (main.webContents.isCrashed() && backend?.origin) {
      main.loadURL(backend.origin + '/').catch(() => showError('无法重新加载主界面。'));
    }
    updateWindows();
  }
  function setClickThrough(enabled) {
    if (!tray || !alive(overlay)) return;
    clickThrough = enabled;
    overlay.setIgnoreMouseEvents(clickThrough);
    updateWindows();
    updateTray();
  }
  function updateTray() {
    if (!tray || stopping) return;
    const signal = snapshot?.[mode];
    const label = !backend?.origin ? '本地桥接已断开' :
      mode === 'live' && !['connected', 'resume_failed'].includes(signal?.connection) ? 'Codex 未连接' :
        labels[signal?.state ?? 'idle'];
    const status = (mode === 'demo' ? '模拟' : '实时') + ' · ' + label;
    const backgroundTurn = mode === 'demo' && snapshot?.live.active === true;
    const signature = JSON.stringify([status, backgroundTurn, !!backend?.origin, !!alive(overlay), clickThrough, waiting]);
    if (signature === traySignature) return;
    traySignature = signature;
    tray.setToolTip(title + ' · ' + status);
    menu = Menu.buildFromTemplate([
      { id: 'open', label: '打开 HaloFlux', click: () => openMain() },
      { label: status + (backgroundTurn ? ' · 真实任务仍在运行' : ''), enabled: false },
      { type: 'separator' },
      { label: '模拟模式', id: 'demo', type: 'radio', checked: mode === 'demo', click: () => switchMode('demo') },
      { label: '实时模式', id: 'live', type: 'radio', checked: mode === 'live', click: () => switchMode('live') },
      { id: 'overlay', label: alive(overlay) ? '隐藏悬浮光环' : '显示悬浮光环', enabled: !!backend?.origin,
        click: () => void toggleOverlay() },
      { id: 'passthrough', label: '悬浮窗点击穿透', type: 'checkbox', checked: clickThrough,
        enabled: alive(overlay) === true, click: item => setClickThrough(item.checked) },
      { id: 'reset-overlay', label: '复位悬浮窗位置', enabled: alive(overlay) === true, click: () => {
        if (!alive(overlay)) return;
        setOverlayBounds(overlay, displayBounds(undefined, overlaySize, overlayMinimum));
        setClickThrough(false);
      } },
      { id: 'settings', label: '打开桌面设置', click: () => openMain(true) },
      { type: 'separator' },
      { id: 'quit', label: waiting ? '取消等待退出' : '退出应用', click: () => {
        if (waiting) void cancelWait();
        else void requestExit();
      } },
    ]);
    tray.setContextMenu(menu);
  }
  function attach(win, role) {
    secured.protect(win, role);
    for (const event of ['move', 'resize', 'maximize', 'unmaximize']) {
      win.on(event, () => remember(win, role));
    }
    for (const event of ['show', 'hide', 'minimize', 'restore', 'focus', 'blur']) win.on(event, updateWindows);
    win.webContents.on('did-finish-load', () => {
      sent.delete(win);
      updateWindows();
    });
    win.webContents.on('render-process-gone', () => {
      if (stopping) return;
      if (role === 'visual') win.destroy();
      else {
        updateWindows();
        showError('主界面进程已断开。请从托盘打开 HaloFlux 恢复界面。');
      }
    });
  }
  function hideOverlay() {
    if (!alive(overlay)) return;
    remember(overlay, 'visual');
    overlay.destroy();
  }
  async function toggleOverlay() {
    if (alive(overlay)) { hideOverlay(); return; }
    if (stopping || !backend?.origin) return;
    const bounds = displayBounds(preferences.overlayBounds, overlaySize, overlayMinimum);
    const win = overlay = new BrowserWindow({
      ...bounds,
      title: 'HaloFlux 光环', icon, transparent: true, backgroundColor: '#00000000',
      frame: false, resizable: false, hasShadow: false, skipTaskbar: true, show: false,
      opacity: preferences.opacity / 100,
      webPreferences: { ...secured.preferences, preload, additionalArguments: ['--haloflux-visual'] },
    });
    overlayGeometry = { requested: bounds, applied: win.getBounds() };
    attach(win, 'visual');
    win.on('closed', () => {
      overlay = undefined;
      overlayGeometry = undefined;
      clickThrough = false;
      updateWindows();
      updateTray();
    });
    try {
      await win.loadURL(backend.origin + '/desktop-overlay');
      if (alive(win)) {
        win.showInactive();
        pinOverlay(win);
        overlayGeometry = { requested: bounds, applied: win.getBounds() };
        remember(win, 'visual');
      }
    } catch {
      if (!alive(win)) return;
      win.destroy();
      showError('悬浮光环加载失败。');
    }
    updateTray();
  }
  function register(channel, role, handler) {
    handlers.add(channel);
    ipcMain.handle(channel, (event, ...args) => {
      const isMain = alive(main) && event.sender === main.webContents;
      const isOverlay = alive(overlay) && event.sender === overlay.webContents;
      const expected = isMain ? '/' : '/desktop-overlay';
      if ((!isMain && !isOverlay) || (role === 'control' && !isMain) || (role === 'visual' && !isOverlay) ||
        !backend?.origin || !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== backend.origin + expected) return false;
      return handler(isMain ? main : overlay, ...args);
    });
  }
  function installIpc() {
    register('halo:read', 'either', win => state(win));
    register('halo:frame-sample', 'control', (_win, fps, p95) => {
      if (!dual || preferences.budget !== 'balanced' ||
        ![fps, p95].every(value => Number.isFinite(value) && value > 0) || fps > 120) return false;
      if (budget.measure({ fps, p95 }, preferences.fps, performance.now())) updateWindows();
      return true;
    });
    register('halo:mode', 'control', (_win, next) => switchMode(next));
    register('halo:overlay', 'control', () => toggleOverlay());
    register('halo:hide-overlay', 'visual', hideOverlay);
    register('halo:resize-overlay', 'visual', (win, width, height) => {
      if (![width, height].every(Number.isInteger) || clickThrough) return false;
      const bounds = { ...overlayBounds(win), width, height };
      const area = screen.getDisplayMatching(win.getBounds()).workArea;
      setOverlayBounds(win, visibleBounds(bounds, area, overlaySize, overlayMinimum));
      return true;
    });
    register('halo:preference', 'control', (_win, key, value) => {
      if (!acceptsPreference(key, value)) return false;
      if (key === 'budget' && preferences[key] !== value) budget.reset();
      preferences[key] = value;
      if (alive(overlay)) {
        if (key === 'opacity') overlay.setOpacity(value / 100);
        if (key === 'opacity' || key === 'alwaysOnTop') pinOverlay(overlay);
      }
      persist();
      updateWindows();
      return true;
    });
  }
  function reflow() {
    for (const [win, size, minimum] of [[main, mainSizes.standard, mainMinimum], [overlay, overlaySize, overlayMinimum]]) {
      if (alive(win) && !win.isMaximized() && !win.isMinimized()) {
        const previous = win === overlay ? overlayBounds(win) : win.getBounds();
        const next = displayBounds(previous, size, minimum);
        if (Object.keys(next).some(key => previous[key] !== next[key])) {
          if (win === overlay) setOverlayBounds(win, next);
          else win.setBounds(next);
        }
      }
    }
  }
  const onSuspend = () => { sleeping = true; updateWindows(); };
  const onResume = () => { sleeping = false; reflow(); updateWindows(); };
  const beforeQuit = event => { if (!stopping) { event.preventDefault(); void requestExit(); } };
  function cleanup() {
    if (closing) return closing;
    stopping = true;
    updateWindows();
    remember(main, 'control');
    remember(overlay, 'visual');
    clearTimeout(saveTimer);
    clearTimeout(waitTimer);
    persist();
    for (const channel of handlers) ipcMain.removeHandler(channel);
    app.off('before-quit', beforeQuit);
    powerMonitor.off('suspend', onSuspend);
    powerMonitor.off('resume', onResume);
    screen.off('display-removed', reflow);
    screen.off('display-metrics-changed', reflow);
    tray?.removeBalloon();
    tray?.destroy();
    if (alive(overlay)) overlay.destroy();
    if (alive(main)) main.destroy();
    closing = Promise.resolve(backend?.close()).finally(() => { backend = undefined; });
    return closing;
  }
  async function finishExit() {
    await cleanup();
    app.quit();
  }
  async function cancelWait() {
    waiting = false;
    clearTimeout(waitTimer);
    updateTray();
    try { await backend?.request('inspect-exit', false); } catch { /* The bridge already disconnected. */ }
  }
  async function checkWait() {
    if (!waiting || stopping) return;
    try {
      const status = await backend.request('inspect-exit', true);
      if (!waiting || stopping) return;
      if (!status.blocked) await finishExit();
      else waitTimer = setTimeout(checkWait, 500);
    } catch { await cancelWait(); }
  }
  async function requestExit() {
    if (stopping || exitDecision || waiting) return;
    exitDecision = true;
    try {
      if (!backend?.origin) { await finishExit(); return; }
      const status = await backend.request('inspect-exit', true);
      if (!status.blocked) { await finishExit(); return; }
      const buttons = ['继续在后台运行', '等任务结束后退出'];
      if (status.canInterrupt) buttons.push('中断任务后退出');
      const { response } = await askExit({
        type: 'warning', title, buttons, defaultId: 0, cancelId: 0, noLink: true,
        message: '真实 Codex 任务仍在运行，或状态仍待确认。',
        detail: '等待期间可打开主窗口处理审批，也可从托盘取消等待。',
      });
      if (response === 0) {
        await cancelWait();
        if (alive(main)) main.hide();
      } else {
        if (response === 2) {
          const current = await backend.request('inspect-exit', true);
          if (current.canInterrupt) await backend.request('interrupt');
        }
        waiting = true;
        updateTray();
        await checkWait();
      }
    } catch {
      await cancelWait();
      showError('无法确认任务状态或中断结果。请检查连接后再退出。');
    } finally { exitDecision = false; }
  }
  try {
    backend = await startBackend({
      cwd, port, fixture,
      onSnapshot(update, notices) {
        if (stopping) return;
        snapshot = update;
        notifications.observe(update.live, notices);
        updateWindows();
        updateTray();
      },
      onExit() {
        if (stopping) return;
        void cancelWait();
        updateWindows();
        updateTray();
        notifications.disconnected();
        showError('本地桥接意外断开，任务终态可能未知。请退出并重新打开 HaloFlux。');
      },
    });
    Menu.setApplicationMenu(null);
    tray = new Tray(icon);
    tray.on('click', () => openMain());
    tray.on('balloon-click', () => { switchMode('live'); openMain(); });
    const saved = preferences.mainBounds;
    const custom = preferences.startupSize === 'remember';
    const bounds = custom || !saved ? saved : { ...saved, ...mainSizes[preferences.startupSize] };
    main = new BrowserWindow({
      ...displayBounds(bounds, mainSizes[preferences.startupSize] ?? mainSizes.standard, mainMinimum),
      title, icon, minWidth: mainMinimum.width, minHeight: mainMinimum.height,
      show: false, backgroundColor: '#08090b', webPreferences: { ...secured.preferences, preload },
    });
    attach(main, 'control');
    installIpc();
    app.on('before-quit', beforeQuit);
    powerMonitor.on('suspend', onSuspend);
    powerMonitor.on('resume', onResume);
    screen.on('display-removed', reflow);
    screen.on('display-metrics-changed', reflow);
    main.on('close', event => {
      if (stopping) return;
      event.preventDefault();
      remember(main, 'control');
      if (preferences.close === 'tray') main.hide();
      else void requestExit();
    });
    await main.loadURL(backend.origin + '/');
    if (custom && preferences.maximized) main.maximize();
    main.show();
    updateTray();
    return { main, backend, tray, cleanup, openMain, get overlay() { return overlay; }, get menu() { return menu; } };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function runDesktop() {
  app.enableSandbox();
  app.setName(title);
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  let runtime;
  app.on('window-all-closed', () => {});
  app.on('second-instance', () => runtime?.openMain());
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  const workspace = args[0] === '--workspace' ? args[1] : undefined;
  launchDesktop({ cwd: workspace }).then(result => { runtime = result; }, error => {
    dialog.showErrorBox(title, error.reason === 'port' ? '本地端口已占用。' :
      '无法启动本地桥接。请完整解压文件并检查工作目录。');
    app.exit(1);
  });
}
