const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('api', {
  ready: () => ipcRenderer.send('ready'),
  setShape: (rect) => ipcRenderer.send('set-shape', rect),             // the clickable / droppable area
  // file shelf
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  shelfAdd: (paths) => ipcRenderer.invoke('shelf:add', paths),         // resolves to how many were added
  shelfRemove: (p) => ipcRenderer.send('shelf:remove', p),
  shelfClear: () => ipcRenderer.send('shelf:clear'),
  shelfOpen: (p) => ipcRenderer.send('shelf:open', p),
  shelfReveal: (p) => ipcRenderer.send('shelf:reveal', p),
  shelfDrag: (p) => ipcRenderer.send('shelf:drag', p),
  onPointer: (cb) => ipcRenderer.on('notch:pointer', (_e, inside) => cb(inside)),   // pointer entered / left the notch
  onShelf: (cb) => ipcRenderer.on('notch:shelf', (_e, items) => cb(items)),
  media: (action) => ipcRenderer.send('notch:media', action),          // 'toggle' | 'next' | 'prev'
  volume: (change) => ipcRenderer.send('notch:volume', change),        // { delta } or { level }
  brightness: (level) => ipcRenderer.send('notch:brightness', level),  // 0..100
  onMedia: on('notch:media'),
  onSystem: on('notch:system'),                                         // volume / brightness / privacy / power
});
