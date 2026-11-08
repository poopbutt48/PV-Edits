// Gives the editor a few safe desktop features (native Save/Open windows).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sproutNative', {
  platform: process.platform,
  saveFile: (options) => ipcRenderer.invoke('sprout:save-file', options),
  openFile: (options) => ipcRenderer.invoke('sprout:open-file', options),
});
