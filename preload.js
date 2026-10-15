const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('omni', {
  scan: () => ipcRenderer.invoke('scan'),
  launch: (game) => ipcRenderer.invoke('launch', game),
  openDir: (dir) => ipcRenderer.invoke('openDir', dir),
  openUrl: (url) => ipcRenderer.invoke('openUrl', url),
  getConfig: () => ipcRenderer.invoke('getConfig'),
  setConfig: (cfg) => ipcRenderer.invoke('setConfig', cfg),
  resolveCover: (game) => ipcRenderer.invoke('art:resolve', game),
  getArtKey: () => ipcRenderer.invoke('art:getKey'),
  setArtKey: (k) => ipcRenderer.invoke('art:setKey', k),
  clearArtCache: () => ipcRenderer.invoke('art:clearCache')
});
