const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame) {
  const visual = process.argv.includes('--haloflux-visual');
  contextBridge.exposeInMainWorld('haloDesktop', {
    read: () => ipcRenderer.invoke('halo:read'),
    subscribe: callback => {
      const listener = (_event, state) => callback(state);
      ipcRenderer.on('halo:state', listener);
      return () => ipcRenderer.off('halo:state', listener);
    },
    ...(visual ? {
      hideOverlay: () => ipcRenderer.invoke('halo:hide-overlay'),
      resizeOverlay: (width, height) => ipcRenderer.invoke('halo:resize-overlay', width, height),
    } : {
      preference: (key, value) => ipcRenderer.invoke('halo:preference', key, value),
      mode: mode => ipcRenderer.invoke('halo:mode', mode),
      overlay: () => ipcRenderer.invoke('halo:overlay'),
      frameSample: (fps, p95) => ipcRenderer.invoke('halo:frame-sample', fps, p95),
    }),
  });
}
