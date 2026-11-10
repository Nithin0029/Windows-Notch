const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('api', {
  ready: () => ipcRenderer.send('ready'),
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  media: (action) => ipcRenderer.send('notch:media', action),          // 'toggle' | 'next' | 'prev'
  volume: (change) => ipcRenderer.send('notch:volume', change),        // { delta } or { level }
  brightness: (level) => ipcRenderer.send('notch:brightness', level),  // 0..100
  onMedia: on('notch:media'),
  onSystem: on('notch:system'),                                         // volume / brightness / privacy / power
});
