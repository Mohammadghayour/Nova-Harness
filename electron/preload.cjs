const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('forgeDesktop', {
  isDesktopApp: true,
  selectDirectory: () => ipcRenderer.invoke('harness:select-directory'),
  getPlatformInfo: () => ipcRenderer.invoke('harness:platform-info'),
});
