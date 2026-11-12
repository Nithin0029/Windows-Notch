// Bridge for the Settings window: a small, explicit API, nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),   // resolves to { error, state }
  searchCity: (query) => ipcRenderer.invoke('settings:search-city', query),  // resolves to { results } or { error }
  checkUpdates: () => ipcRenderer.send('settings:check-updates'),
  installUpdate: () => ipcRenderer.send('settings:install-update'),
  resetShortcut: () => ipcRenderer.send('settings:reset-shortcut'),
  onState: (cb) => ipcRenderer.on('settings:state', (_e, state) => cb(state)),
});
