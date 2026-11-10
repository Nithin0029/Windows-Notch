// MacBook-style notch for Windows
const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Keep the transparent always-on-top window painting even when "occluded".
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const NOTCH_W = 640;   // window size: room for the expanded panel; everything outside the notch is click-through
const NOTCH_H = 340;

let notchWin = null;
let tray = null;
let helper = null;
let quitting = false;
let fullscreen = false;
let lastMedia = null;
const lastSystem = {};   // latest volume / brightness / privacy / power, replayed when the notch (re)loads

// ---------------------------------------------------------------- helper (PowerShell: media, volume, brightness, mic/cam)
function startHelper() {
  helper = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'helper.ps1')],
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
      break;
    case 'error':
      console.error('[helper]', m.message);
      break;
  }
}

// ---------------------------------------------------------------- window
function notchBounds() {
  const b = screen.getPrimaryDisplay().bounds;
  return { x: Math.round(b.x + (b.width - NOTCH_W) / 2), y: b.y, width: NOTCH_W, height: NOTCH_H };
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
  notchWin.setAlwaysOnTop(true, 'pop-up-menu');
  notchWin.setIgnoreMouseEvents(true, { forward: true });
  notchWin.setMenu(null);
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
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings(loginOpts()).openAtLogin,
      click: (m) => { app.setLoginItemSettings({ ...loginOpts(), openAtLogin: m.checked }); refreshTray(); } },
    { label: 'Open Folder', click: () => shell.openPath(__dirname) },
    { type: 'separator' },
    { label: 'Reload', click: () => notchWin?.reload() },
    { label: 'Quit Notch', click: () => app.quit() },
  ]));
}

// ---------------------------------------------------------------- IPC
ipcMain.on('set-ignore', (e, ignore) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w) w.setIgnoreMouseEvents(!!ignore, { forward: true });
});
ipcMain.on('ready', (e) => {
  if (lastMedia) e.sender.send('notch:media', lastMedia);
  for (const m of Object.values(lastSystem)) e.sender.send('notch:system', m);
});
ipcMain.on('notch:media', (_e, action) => helperSend({ cmd: 'media', action }));
ipcMain.on('notch:volume', (_e, change) => {
  if (change && typeof change.delta === 'number') helperSend({ cmd: 'volume', delta: change.delta });
  else if (change && typeof change.level === 'number') helperSend({ cmd: 'volume', level: change.level });
});
ipcMain.on('notch:brightness', (_e, level) => {
  if (typeof level === 'number') helperSend({ cmd: 'brightness', level: Math.round(Math.max(0, Math.min(100, level))) });
});

// ---------------------------------------------------------------- lifecycle
app.whenReady().then(() => {
  app.setAppUserModelId('local.windows-notch');
  createWindow();
  startHelper();
  tray = new Tray(trayImage());
  tray.setToolTip('Notch');
  refreshTray();
  const reposition = () => notchWin?.setBounds(notchBounds());
  screen.on('display-metrics-changed', reposition);
  screen.on('display-added', reposition);
  screen.on('display-removed', reposition);
});

app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('before-quit', () => { quitting = true; if (helper) helper.kill(); });
