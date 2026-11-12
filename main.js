// MacBook-style notch for Windows
const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Keep the transparent always-on-top window painting even when "occluded".
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// The window is large enough for the biggest panel, but its *shape* is cut down to the
// notch itself, so everything else on screen stays clickable (and files can be dropped on it).
const NOTCH_W = 640;
const NOTCH_H = 480;

let notchWin = null;
let tray = null;
let helper = null;
let quitting = false;
let fullscreen = false;
let lastMedia = null;
const lastSystem = {};   // latest volume / brightness / privacy / power, replayed when the notch (re)loads

// ---------------------------------------------------------------- settings
const DEFAULTS = { volumeKeys: true };
let settings = { ...DEFAULTS };
const userFile = (name) => path.join(app.getPath('userData'), name);
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')) }; } catch { settings = { ...DEFAULTS }; }
}
function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2));
}

// ---------------------------------------------------------------- helper (PowerShell: media, volume, brightness, mic/cam)
// In the installed app the code is packed into app.asar, which PowerShell can't read; the build
// unpacks helper.ps1 next to it (app.asar.unpacked), so point there.
const HELPER_PATH = path.join(__dirname, 'helper.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function startHelper() {
  helper = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', HELPER_PATH],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  helper.stdout.setEncoding('utf8');
  helper.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { onHelper(JSON.parse(line)); } catch { console.error('[helper] bad line', line.slice(0, 200)); }
    }
  });
  helper.stderr.on('data', (d) => console.error('[helper]', String(d).trim()));
  helper.on('exit', () => {
    helper = null;
    if (!quitting) setTimeout(startHelper, 3000);
  });
}

function helperSend(obj) {
  if (helper && helper.stdin.writable) helper.stdin.write(JSON.stringify(obj) + '\n');
}

function toNotch(channel, data) {
  if (notchWin && !notchWin.isDestroyed()) notchWin.webContents.send(channel, data);
}

function onHelper(m) {
  switch (m.type) {
    case 'media':
      if (m.active && !m.newTrack && lastMedia && lastMedia.art) m.art = m.art || lastMedia.art;
      lastMedia = m;
      toNotch('notch:media', m);
      break;
    case 'art':
      if (lastMedia && lastMedia.track === m.track) lastMedia.art = m.data;
      toNotch('notch:media', m);
      break;
    case 'volume':
    case 'brightness':
    case 'privacy':
    case 'power':
      lastSystem[m.type] = { ...m, init: true };   // replays never trigger the HUD
      toNotch('notch:system', m);
      break;
    case 'fullscreen':
      fullscreen = !!m.value;
      updateVisibility();
      updateVolumeKeys();
      break;
    case 'error':
      console.error('[helper]', m.message);
      break;
  }
}

// ---------------------------------------------------------------- volume keys
// Registering the volume keys as global shortcuts stops Windows from handling them, so its own
// volume pop-up never appears; we change the volume ourselves and the notch shows the level.
// While a fullscreen app is in front (notch hidden) the keys are handed back to Windows.
const VOLUME_KEYS = {
  VolumeUp: () => helperSend({ cmd: 'volume', delta: 0.02, snap: true }),
  VolumeDown: () => helperSend({ cmd: 'volume', delta: -0.02, snap: true }),
  VolumeMute: () => helperSend({ cmd: 'mute' }),
};
let volumeKeysActive = false;
function updateVolumeKeys() {
  const want = settings.volumeKeys && !fullscreen;
  if (want === volumeKeysActive) return;
  if (want) {
    const ok = Object.entries(VOLUME_KEYS).map(([key, fn]) => globalShortcut.register(key, fn));
    if (!ok.every(Boolean)) console.error('[notch] could not take over some volume keys', ok);
  } else {
    for (const key of Object.keys(VOLUME_KEYS)) globalShortcut.unregister(key);
  }
  volumeKeysActive = want;
}

// ---------------------------------------------------------------- file shelf
let shelf = [];   // [{ path, name, dir, thumb }]
const FALLBACK_DRAG_ICON = (() => {
  const S = 48, buf = Buffer.alloc(S * S * 4);
  for (let y = 6; y < 42; y++) for (let x = 10; x < 38; x++) { const i = (y * S + x) * 4; buf[i] = buf[i + 1] = buf[i + 2] = 230; buf[i + 3] = 255; }
  return nativeImage.createFromBitmap(buf, { width: S, height: S });
})();

// Shell thumbnails can be slow (big videos, network drives) or never answer; don't let that block the shelf.
const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

async function shelfItem(p) {
  let dir = false;
  try { dir = fs.statSync(p).isDirectory(); } catch { return null; }
  let thumb = null;
  try {
    const img = await withTimeout(nativeImage.createThumbnailFromPath(p, { width: 128, height: 128 }), 2500);
    if (img && !img.isEmpty()) thumb = img.toDataURL();
  } catch { /* fall back to the file's icon */ }
  if (!thumb) {
    try { const img = await withTimeout(app.getFileIcon(p, { size: 'large' }), 1500); if (img && !img.isEmpty()) thumb = img.toDataURL(); } catch { /* none */ }
  }
  return { path: p, name: path.basename(p) || p, dir, thumb };
}

function saveShelf() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile('shelf.json'), JSON.stringify(shelf.map((s) => s.path), null, 2));
}
function sendShelf() { toNotch('notch:shelf', shelf); }

async function loadShelf() {
  let paths = [];
  try { paths = JSON.parse(fs.readFileSync(userFile('shelf.json'), 'utf8')); } catch { /* empty */ }
  const items = await Promise.all(paths.filter((p) => typeof p === 'string' && fs.existsSync(p)).map(shelfItem));
  shelf = items.filter(Boolean);
  sendShelf();
}

async function addToShelf(paths) {
  const fresh = paths.filter((p) => typeof p === 'string' && p && !shelf.some((s) => s.path.toLowerCase() === p.toLowerCase()));
  const items = (await Promise.all(fresh.map(shelfItem))).filter(Boolean);
  if (!items.length) return 0;
  shelf.push(...items);
  saveShelf();
  sendShelf();
  return items.length;
}

function removeFromShelf(p) {
  shelf = shelf.filter((s) => s.path !== p);
  saveShelf();
  sendShelf();
}

// ---------------------------------------------------------------- window
function notchBounds() {
  const b = screen.getPrimaryDisplay().bounds;
  return { x: Math.round(b.x + (b.width - NOTCH_W) / 2), y: b.y, width: NOTCH_W, height: NOTCH_H };
}

function clampShape(r) {
  const x = Math.max(0, Math.min(NOTCH_W - 1, Math.round(r.x)));
  const y = Math.max(0, Math.round(r.y));
  return { x, y, width: Math.max(1, Math.min(NOTCH_W - x, Math.round(r.width))), height: Math.max(1, Math.min(NOTCH_H - y, Math.round(r.height))) };
}

function createWindow() {
  notchWin = new BrowserWindow({
    ...notchBounds(),
    title: 'Notch',
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    backgroundColor: '#00000000', show: false, type: 'toolbar', thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  // Until the page reports the notch's real size, only the idle notch area is part of the window.
  notchWin.setShape([clampShape({ x: (NOTCH_W - 240) / 2, y: 0, width: 240, height: 46 })]);
  notchWin.setAlwaysOnTop(true, 'pop-up-menu');
  notchWin.setMenu(null);
  // Surface the page's console in the app's own output (handy when something misbehaves).
  notchWin.webContents.on('console-message', (_e, level, message) => { if (level >= 1) console.log('[notch]', message); });
  notchWin.loadFile('notch.html');
  notchWin.once('ready-to-show', updateVisibility);
}

function updateVisibility() {
  if (!notchWin || notchWin.isDestroyed()) return;
  if (!fullscreen && !notchWin.isVisible()) notchWin.showInactive();
  else if (fullscreen && notchWin.isVisible()) notchWin.hide();
}

// ---------------------------------------------------------------- tray
function loginOpts() {
  return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] };
}

function trayImage() {
  const S = 32;
  const buf = Buffer.alloc(S * S * 4);
  const c = nativeTheme.shouldUseDarkColors ? 255 : 30;
  // a notch shape: flat top, rounded bottom
  for (let y = 6; y < 20; y++) for (let x = 6; x < 26; x++) {
    const r = 6, cy = Math.min(y + 0.5, 20 - r), cx = Math.min(Math.max(x + 0.5, 6 + r), 26 - r);
    const a = Math.max(0, Math.min(1, r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy) + 0.5));
    if (a > 0) { const i = (y * S + x) * 4; buf[i] = c; buf[i + 1] = c; buf[i + 2] = c; buf[i + 3] = Math.round(a * 255); }
  }
  return nativeImage.createFromBitmap(buf, { width: S, height: S, scaleFactor: 2 });
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Use notch for volume keys', type: 'checkbox', checked: settings.volumeKeys,
      click: (m) => { settings.volumeKeys = m.checked; saveSettings(); updateVolumeKeys(); } },
    { label: 'Clear Shelf', enabled: shelf.length > 0, click: () => { shelf = []; saveShelf(); sendShelf(); refreshTray(); } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(loginOpts()).openAtLogin,
      click: (m) => { app.setLoginItemSettings({ ...loginOpts(), openAtLogin: m.checked }); refreshTray(); } },
    { label: 'Open Folder', click: () => shell.openPath(app.isPackaged ? path.dirname(process.execPath) : __dirname) },
    { type: 'separator' },
    { label: 'Reload', click: () => notchWin?.reload() },
    { label: 'Quit Notch', click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------- IPC
let currentShape = null;
ipcMain.on('set-shape', (e, rect) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && rect && typeof rect.width === 'number') { currentShape = clampShape(rect); w.setShape([currentShape]); }
});

// A window cut to a custom shape doesn't get told when the pointer leaves it, so the page would
// never know to close the panel. Watch the pointer here and report when it leaves the notch area.
let pointerInside = false;
setInterval(() => {
  if (!notchWin || notchWin.isDestroyed() || !notchWin.isVisible() || !currentShape) return;
  const c = screen.getCursorScreenPoint();
  const b = notchWin.getBounds();
  const x = c.x - b.x, y = c.y - b.y, s = currentShape;
  const inside = x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height;  if (inside !== pointerInside) {
    pointerInside = inside;
    notchWin.webContents.send('notch:pointer', inside);
  }
}, 100);
ipcMain.on('ready', (e) => {
  if (lastMedia) e.sender.send('notch:media', lastMedia);
  for (const m of Object.values(lastSystem)) e.sender.send('notch:system', m);
  e.sender.send('notch:shelf', shelf);
});
ipcMain.on('notch:media', (_e, action) => helperSend({ cmd: 'media', action }));
ipcMain.on('notch:volume', (_e, change) => {
  if (change && typeof change.delta === 'number') helperSend({ cmd: 'volume', delta: change.delta });
  else if (change && typeof change.level === 'number') helperSend({ cmd: 'volume', level: change.level });
});
ipcMain.on('notch:brightness', (_e, level) => {
  if (typeof level === 'number') helperSend({ cmd: 'brightness', level: Math.round(Math.max(0, Math.min(100, level))) });
});

ipcMain.handle('shelf:add', async (_e, paths) => {
  const list = Array.isArray(paths) ? paths : [];
  let n = 0;
  try { n = await addToShelf(list); } catch (err) { console.error('[shelf] add failed:', err); }
  console.log(`[shelf] dropped ${list.length}, added ${n}`);
  refreshTray();
  return n;
});
ipcMain.on('shelf:remove', (_e, p) => { removeFromShelf(p); refreshTray(); });
ipcMain.on('shelf:clear', () => { shelf = []; saveShelf(); sendShelf(); refreshTray(); });
ipcMain.on('shelf:open', (_e, p) => { if (shelf.some((s) => s.path === p)) shell.openPath(p); });
ipcMain.on('shelf:reveal', (_e, p) => { if (shelf.some((s) => s.path === p)) shell.showItemInFolder(p); });
ipcMain.on('shelf:drag', (e, p) => {
  const item = shelf.find((s) => s.path === p);
  if (!item || !fs.existsSync(p)) return;
  let icon = item.thumb ? nativeImage.createFromDataURL(item.thumb) : FALLBACK_DRAG_ICON;
  if (icon.isEmpty()) icon = FALLBACK_DRAG_ICON;
  e.sender.startDrag({ file: p, icon: icon.resize({ width: 64 }) });
});

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(async () => {
  app.setAppUserModelId('io.github.nithin0029.windows-notch');   // must match "appId" in package.json
  loadSettings();
  // The installed app starts with Windows by default (it's a desktop shell piece); the tray menu can turn it off.
  if (app.isPackaged && !settings.firstRunDone) {
    app.setLoginItemSettings({ openAtLogin: true });
    settings.firstRunDone = true;
    saveSettings();
  }
  createWindow();
  startHelper();
  await loadShelf();
  updateVolumeKeys();
  tray = new Tray(trayImage());
  tray.setToolTip('Notch');
  refreshTray();
  const reposition = () => notchWin?.setBounds(notchBounds());
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
});

app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; if (helper) helper.kill(); });
