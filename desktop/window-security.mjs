import { session } from 'electron';
import { visualPaths } from './backend.mjs';

const originalProject = 'https://github.com/Ryder191/haloflux';
const mainPaths = new Set([
  '/', '/app.css', '/app.js', '/approval-ui.js',
  '/canvas-desktop', '/canvas-mobile', '/renderer.js', '/renderer.css',
  '/audio/sw421k.mp3', '/api/events', '/api/action', '/favicon.ico',
]);

export async function desktopSession(currentBackend, openOriginal) {
  const isolated = session.fromPartition('haloflux-desktop', { cache: false });
  await isolated.setProxy({ mode: 'direct' });
  const roles = new Map();
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setDevicePermissionHandler(() => false);
  function authorize(details) {
    const role = roles.get(details.webContentsId);
    const backend = currentBackend();
    const url = new URL(details.url);
    const paths = role === 'control' ? mainPaths : visualPaths;
    if (role === 'control' && url.protocol === 'blob:' && backend?.origin && url.origin === backend.origin) {
      return { role, backend, url, localBlob: true };
    }
    if (!role || !backend?.origin || url.origin !== backend.origin ||
      !(role === 'control' ? paths.has(url.pathname) : paths.includes(url.pathname))) return;
    return { role, backend, url };
  }
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !authorize(details) }));
  // Recheck ownership before attaching the capability, including after redirects.
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const access = authorize(details);
    if (!access) {
      callback({ cancel: true });
      return;
    }
    const { role, backend, url, localBlob } = access;
    if (localBlob) { callback({}); return; }
    const headers = details.requestHeaders;
    for (const name of Object.keys(headers)) {
      if (/^x-haloflux-(desktop|token)$/i.test(name)) delete headers[name];
    }
    headers['X-HaloFlux-Desktop'] = backend.access[role];
    if (role === 'control' && url.pathname === '/api/action' && details.method === 'POST') {
      headers['X-HaloFlux-Token'] = backend.access.operation;
    }
    callback({ requestHeaders: headers });
  });
  return {
    preferences: {
      session: isolated, nodeIntegration: false, nodeIntegrationInSubFrames: false,
      contextIsolation: true, sandbox: true, webviewTag: false, devTools: false,
      spellcheck: false,
    },
    protect(win, role) {
      const { webContents } = win;
      const id = webContents.id;
      roles.set(id, role);
      webContents.once('destroyed', () => roles.delete(id));
      webContents.on('will-frame-navigate', event => {
        const url = new URL(event.url);
        const allowed = event.isMainFrame
          ? url.pathname === (role === 'control' ? '/' : '/desktop-overlay')
          : (role === 'control' ? ['/canvas-desktop', '/canvas-mobile'] : ['/canvas-overlay']).includes(url.pathname);
        if (url.origin !== currentBackend()?.origin || !allowed) event.preventDefault();
      });
      webContents.on('will-redirect', event => event.preventDefault());
      webContents.on('will-attach-webview', event => event.preventDefault());
      webContents.setWindowOpenHandler(({ url }) => {
        if (role === 'control' && url === originalProject) openOriginal();
        return { action: 'deny' };
      });
    },
  };
}
