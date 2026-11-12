// Windows Notch: a MacBook-style notch for Windows (Electron main process)
const { app, BrowserWindow, screen, ipcMain, shell, Menu, Tray, nativeImage, nativeTheme, globalShortcut, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const updater = require('./updater');
const { searchCity, fetchWeather } = require('./weather');
const calendar = require('./calendar');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// Keep the transparent always-on-top windows painting even when "occluded".
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const REPO_URL = 'https://github.com/Nithin0029/Windows-Notch';
const ICON_PATH = path.join(__dirname, 'build', 'icon.png');

// Each notch window is large enough for the biggest panel, but its *shape* is cut down to the notch
// itself, so everything else on screen stays clickable (and files can be dropped on it).
const NOTCH_W = 640;
const NOTCH_H = 640;

let tray = null;
let helper = null;
let settingsWin = null;
let quitting = false;
let fullscreenDisplayId = null;     // display that has a fullscreen app in front (its notch hides)
let lastMedia = null;
const lastSystem = {};              // latest volume / brightness / privacy / power / toggles / weather, replayed on (re)load

// ================================================================= settings
const DEFAULTS = {
  volumeKeys: true,
  clipboard: true,
  display: 'primary',               // 'primary' | 'all' | 'id:<displayId>'
  shortcutEnabled: true,
  shortcut: 'Ctrl+Alt+N',
  weather: { enabled: true, city: null, units: 'celsius' },   // city: { name, region, lat, lon }
  autoUpdate: true,
  chargingAnimation: true,
  // size: compact | normal | large · style: notch (flush with the top edge) | island (floating pill) · opacity: 40..100 %
  appearance: { size: 'normal', accent: 'blue', style: 'notch', opacity: 100 },
  sections: { toggles: true, sliders: true, shelf: true, timers: true, calendar: true },   // which parts the open panel shows
  calendar: { enabled: true, urls: [], lead: 5 },             // urls: private ICS links · lead: minutes before a meeting to alert
};
const SIZES = ['compact', 'normal', 'large'];
const STYLES = ['notch', 'island'];
const LEADS = [1, 2, 5, 10, 15];
const CAL_MAX = 5;
const ACCENTS = ['blue', 'violet', 'pink', 'orange', 'green', 'teal', 'graphite'];
let settings = structuredClone(DEFAULTS);
const userFile = (name) => path.join(app.getPath('userData'), name);

function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')); } catch { /* first run */ }
  settings = {
    ...structuredClone(DEFAULTS), ...saved,
    weather: { ...DEFAULTS.weather, ...(saved.weather || {}) },
    appearance: { ...DEFAULTS.appearance, ...(saved.appearance || {}) },
    sections: { ...DEFAULTS.sections, ...(saved.sections || {}) },
    calendar: { ...DEFAULTS.calendar, ...(saved.calendar || {}) },
  };
  if (!Array.isArray(settings.calendar.urls)) settings.calendar.urls = [];
}
function saveSettings() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2));
}
function loginOpts() {
  return app.isPackaged ? {} : { path: process.execPath, args: [path.resolve(__dirname)] };
}

// ================================================================= helper (PowerShell: media, volume, brightness, mic/cam, toggles)
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
    case 'toggles':
      lastSystem[m.type] = { ...m, init: true };   // replays never trigger the HUD
      toNotch('notch:system', m);
      break;
    case 'fullscreen':
      fullscreenDisplayId = null;
      if (m.value && m.rect) {
        // the helper reports the fullscreen window's monitor in physical pixels; find that display
        const dip = screen.screenToDipRect(null, { x: m.rect.x, y: m.rect.y, width: m.rect.w, height: m.rect.h });
        fullscreenDisplayId = screen.getDisplayMatching(dip).id;
      } else if (m.value) {
        fullscreenDisplayId = screen.getPrimaryDisplay().id;
      }
      updateVisibility();
      updateVolumeKeys();
      break;
    case 'error':
      console.error('[helper]', m.message);
      break;
  }
}

// ================================================================= notch windows (one per chosen display)
const notches = new Map();   // displayId -> { win, shape, inside }

function toNotch(channel, data) {
  for (const n of notches.values()) if (!n.win.isDestroyed()) n.win.webContents.send(channel, data);
}
/** Look & layout preferences the notch page needs. */
function notchPrefs() {
  const a = settings.appearance;
  return { size: a.size, accent: a.accent, style: a.style, opacity: a.opacity, sections: settings.sections, clipboard: settings.clipboard,
    charging: settings.chargingAnimation, calendarLead: settings.calendar.lead };
}
function sendPrefs() { toNotch('notch:prefs', notchPrefs()); }
function notchFor(webContents) {
  for (const n of notches.values()) if (n.win.webContents === webContents) return n;
  return null;
}

function targetDisplays() {
  const all = screen.getAllDisplays();
  if (settings.display === 'all') return all;
  if (String(settings.display).startsWith('id:')) {
    const d = all.find((x) => String(x.id) === settings.display.slice(3));
    if (d) return [d];
  }
  return [screen.getPrimaryDisplay()];   // also the fallback when a chosen display is unplugged
}
function boundsFor(display) {
  const b = display.bounds;
  return { x: Math.round(b.x + (b.width - NOTCH_W) / 2), y: b.y, width: NOTCH_W, height: NOTCH_H };
}
function clampShape(r) {
  const x = Math.max(0, Math.min(NOTCH_W - 1, Math.round(r.x)));
  const y = Math.max(0, Math.round(r.y));
  return { x, y, width: Math.max(1, Math.min(NOTCH_W - x, Math.round(r.width))), height: Math.max(1, Math.min(NOTCH_H - y, Math.round(r.height))) };
}

function createNotch(display) {
  const win = new BrowserWindow({
    ...boundsFor(display),
    title: 'Notch',
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    backgroundColor: '#00000000', show: false, type: 'toolbar', thickFrame: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const n = { win, shape: null, inside: false, displayId: display.id };
  // Until the page reports the notch's real size, only the idle notch area is part of the window.
  n.shape = clampShape({ x: (NOTCH_W - 240) / 2, y: 0, width: 240, height: 46 });
  win.setShape([n.shape]);
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setMenu(null);
  // Surface the page's console in the app's own output (handy when something misbehaves).
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 1) console.log('[notch]', message); });
  win.loadFile(path.join(__dirname, 'notch.html'));
  win.once('ready-to-show', updateVisibility);
  return n;
}

function syncWindows() {
  const want = targetDisplays();
  const ids = new Set(want.map((d) => d.id));
  for (const [id, n] of notches) {
    if (!ids.has(id)) { if (!n.win.isDestroyed()) n.win.destroy(); notches.delete(id); }
  }
  for (const d of want) {
    const n = notches.get(d.id);
    if (n && !n.win.isDestroyed()) n.win.setBounds(boundsFor(d));
    else notches.set(d.id, createNotch(d));
  }
  updateVisibility();
}

function updateVisibility() {
  for (const [id, n] of notches) {
    if (n.win.isDestroyed()) continue;
    const hide = fullscreenDisplayId === id;
    if (!hide && !n.win.isVisible()) n.win.showInactive();
    else if (hide && n.win.isVisible()) n.win.hide();
  }
}

// A window cut to a custom shape isn't reliably told when the pointer leaves it, so the page might
// not know to close its panel. Watch the real pointer here and report enter/leave per notch.
setInterval(() => {
  if (!notches.size) return;
  const c = screen.getCursorScreenPoint();
  for (const n of notches.values()) {
    if (n.win.isDestroyed() || !n.win.isVisible() || !n.shape) continue;
    const b = n.win.getBounds();
    const x = c.x - b.x, y = c.y - b.y, s = n.shape;
    const inside = x >= s.x && x < s.x + s.width && y >= s.y && y < s.y + s.height;
    if (inside !== n.inside) { n.inside = inside; n.win.webContents.send('notch:pointer', inside); }
  }
}, 100);

// ================================================================= volume keys
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
  const want = settings.volumeKeys && fullscreenDisplayId === null;
  if (want === volumeKeysActive) return;
  if (want) {
    const ok = Object.entries(VOLUME_KEYS).map(([key, fn]) => globalShortcut.register(key, fn));
    if (!ok.every(Boolean)) console.error('[notch] could not take over some volume keys', ok);
  } else {
    for (const key of Object.keys(VOLUME_KEYS)) globalShortcut.unregister(key);
  }
  volumeKeysActive = want;
}

// ================================================================= keyboard shortcut (open/close the panel)
let registeredShortcut = null;
function onShortcut() {
  // open the notch on the screen the mouse is on (or the only notch there is)
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const n = notches.get(d.id) || notches.values().next().value;
  if (n && !n.win.isDestroyed()) n.win.webContents.send('notch:command', 'toggle-panel');
}
/** (Re)register the panel shortcut from settings. Returns false if Windows/another app refused it. */
function applyShortcut() {
  if (registeredShortcut) { globalShortcut.unregister(registeredShortcut); registeredShortcut = null; }
  if (!settings.shortcutEnabled || !settings.shortcut) return true;
  try {
    if (globalShortcut.register(settings.shortcut, onShortcut)) { registeredShortcut = settings.shortcut; return true; }
  } catch { /* invalid accelerator */ }
  return false;
}

// ================================================================= weather
let weatherTimer = null;
async function refreshWeather() {
  const w = settings.weather;
  if (!w.enabled || !w.city) {
    lastSystem.weather = { type: 'weather', off: true };
    toNotch('notch:system', lastSystem.weather);
    broadcastSettingsState();
    return;
  }
  try {
    const data = await fetchWeather({ lat: w.city.lat, lon: w.city.lon, units: w.units });
    lastSystem.weather = { type: 'weather', ...data, place: w.city.name, units: w.units, at: Date.now() };
    toNotch('notch:system', lastSystem.weather);
    broadcastSettingsState();
  } catch (err) {
    console.error('[weather]', err.message);   // keep showing the last good reading
  }
}
function scheduleWeather() {
  clearInterval(weatherTimer);
  refreshWeather();
  weatherTimer = setInterval(refreshWeather, 20 * 60 * 1000);
}

// ================================================================= calendar (private ICS links)
// Every 15 minutes each link is downloaded and the next ~36 hours of events are sent to the notch, which
// shows the next meeting in the panel and alerts before it starts. A link that fails keeps its last good events.
let calTimer = null;
let calSources = [];    // [{ url, name, ok, count, error, at, events }]
let calBusy = false;
let calAgain = false;   // the links changed while a refresh was running: refresh once more afterwards

function calendarPayload() {
  const c = settings.calendar;
  if (!c.enabled || !c.urls.length) return { type: 'calendar', events: [] };
  const seen = new Set();
  const events = calSources.filter((s) => c.urls.includes(s.url)).flatMap((s) => s.events || [])
    .filter((e) => (seen.has(e.id) ? false : seen.add(e.id)))
    .sort((a, b) => a.start - b.start);
  return { type: 'calendar', events };
}
function sendCalendar() {
  lastSystem.calendar = calendarPayload();
  toNotch('notch:system', lastSystem.calendar);
  broadcastSettingsState();
}
async function refreshCalendar() {
  const c = settings.calendar;
  if (!c.enabled || !c.urls.length) { sendCalendar(); return; }
  if (calBusy) { calAgain = true; return; }
  calBusy = true;
  broadcastSettingsState();
  const now = Date.now(), from = now - 12 * 3600e3, to = now + 36 * 3600e3;
  const urls = [...c.urls];
  const results = await Promise.allSettled(urls.map(async (url) => calendar.eventsBetween(await calendar.fetchIcs(url), from, to)));
  calSources = urls.map((url, i) => {
    const r = results[i];
    const prev = calSources.find((s) => s.url === url);
    if (r.status === 'fulfilled') return { url, name: r.value.name, ok: true, count: r.value.events.length, at: Date.now(), events: r.value.events };
    const msg = (r.reason && r.reason.message) || 'Couldn’t load this calendar.';
    console.error(`[calendar] ${calendar.hostOf(url)}: ${msg}`);   // never log the secret link itself
    return { url, name: prev && prev.name, ok: false, error: msg, at: Date.now(), events: prev ? prev.events : [] };
  });
  calBusy = false;
  sendCalendar();
  if (calAgain) { calAgain = false; refreshCalendar(); }
}
function scheduleCalendar() {
  clearInterval(calTimer);
  refreshCalendar();
  calTimer = setInterval(refreshCalendar, 15 * 60 * 1000);
}

// ================================================================= clipboard history
// Text only, kept in memory only (never written to disk), cleared on quit. Items that password
// managers mark as private (the standard Windows clipboard flags) are never recorded.
const CLIP_MAX = 15;
let clipItems = [];        // [{ id, text, at }]
let clipSeq = 0;
let lastClipText = '';

function clipIsPrivate() {
  try { if (clipboard.readBuffer('ExcludeClipboardContentFromMonitorProcessing').length) return true; } catch { /* format not present */ }
  try {
    const b = clipboard.readBuffer('CanIncludeInClipboardHistory');
    if (b.length >= 4 && b.readUInt32LE(0) === 0) return true;
  } catch { /* format not present */ }
  return false;
}
function sendClips() {
  toNotch('notch:clip', clipItems.map((c) => ({ id: c.id, at: c.at, preview: c.text.replace(/\s+/g, ' ').trim().slice(0, 160) })));
}
function pollClipboard() {
  if (!settings.clipboard) return;
  let text = '';
  try { text = clipboard.readText(); } catch { return; }
  if (!text || text === lastClipText) return;
  lastClipText = text;
  if (!text.trim() || clipIsPrivate()) { if (process.env.NOTCH_DEBUG) console.log('[clip] skipped (private or blank)'); return; }
  if (process.env.NOTCH_DEBUG) console.log(`[clip] recorded ${text.length} chars`);
  clipItems = [{ id: ++clipSeq, text: text.slice(0, 20000), at: Date.now() }, ...clipItems.filter((c) => c.text !== text)].slice(0, CLIP_MAX);
  sendClips();
}
function resetClipWatch() { try { lastClipText = clipboard.readText(); } catch { lastClipText = ''; } }

// ================================================================= file shelf
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
function clearShelf() { shelf = []; saveShelf(); sendShelf(); refreshTray(); }

// ================================================================= settings window
function settingsState() {
  const primaryId = screen.getPrimaryDisplay().id;
  return {
    settings,
    displays: screen.getAllDisplays().map((d, i) => ({
      id: String(d.id),
      label: d.label || `Display ${i + 1}`,
      size: `${d.size.width} × ${d.size.height}`,
      primary: d.id === primaryId,
    })),
    version: app.getVersion(),
    packaged: app.isPackaged,
    startWithWindows: app.getLoginItemSettings(loginOpts()).openAtLogin,
    shortcutActive: !!registeredShortcut,
    update: updater.getState(),
    weather: lastSystem.weather || null,
    calendar: {
      sources: settings.calendar.urls.map((url) => {
        const s = calSources.find((x) => x.url === url);
        return { url, host: calendar.hostOf(url), name: s ? s.name : null, ok: s ? s.ok : null, count: s ? s.count : 0, error: s ? s.error : null, at: s ? s.at : null };
      }),
      next: calendarPayload().events.find((e) => !e.allDay && e.end > Date.now()) || null,
      loading: calBusy,
    },
    repo: REPO_URL,
  };
}
function broadcastSettingsState() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('settings:state', settingsState());
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    if (settingsWin.isMinimized()) settingsWin.restore();
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 660, height: 760, minWidth: 560, minHeight: 560,
    title: 'Windows Notch Settings',
    icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
    backgroundColor: '#111116',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#111116', symbolColor: '#d8d8e2', height: 44 },
    webPreferences: { preload: path.join(__dirname, 'preload-settings.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
  // links in the page open in the real browser, never inside the app
  settingsWin.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
}

async function applySetting(key, value) {
  switch (key) {
    case 'volumeKeys': settings.volumeKeys = !!value; updateVolumeKeys(); break;
    case 'clipboard':
      settings.clipboard = !!value;
      if (!value) clipItems = [];
      resetClipWatch();
      sendClips();
      sendPrefs();   // the panel hides its clipboard button when history is off
      break;
    case 'startWithWindows': app.setLoginItemSettings({ ...loginOpts(), openAtLogin: !!value }); break;
    case 'display': settings.display = String(value); syncWindows(); break;
    case 'shortcutEnabled':
      settings.shortcutEnabled = !!value;
      if (!applyShortcut()) return 'That shortcut is already used by another app. Pick a different one below.';
      break;
    case 'shortcut': {
      const prev = settings.shortcut;
      settings.shortcut = String(value || '');
      if (!applyShortcut()) {
        settings.shortcut = prev;
        applyShortcut();
        return 'That shortcut is already used by Windows or another app. Try a different one.';
      }
      break;
    }
    case 'weatherEnabled': settings.weather.enabled = !!value; scheduleWeather(); break;
    case 'weatherCity':
      settings.weather.city = value && typeof value.lat === 'number' && typeof value.lon === 'number'
        ? { name: String(value.name || ''), region: String(value.region || ''), lat: value.lat, lon: value.lon }
        : null;
      scheduleWeather();
      break;
    case 'weatherUnits': settings.weather.units = value === 'fahrenheit' ? 'fahrenheit' : 'celsius'; scheduleWeather(); break;
    case 'autoUpdate': settings.autoUpdate = !!value; if (value) updater.check(); break;
    case 'size':
      if (!SIZES.includes(value)) return 'Unknown size';
      settings.appearance.size = value;
      sendPrefs();
      break;
    case 'accent':
      if (!ACCENTS.includes(value)) return 'Unknown colour';
      settings.appearance.accent = value;
      sendPrefs();
      break;
    case 'section':
      if (!value || !(value.name in DEFAULTS.sections)) return 'Unknown panel section';
      settings.sections[value.name] = !!value.on;
      sendPrefs();
      break;
    case 'style':
      if (!STYLES.includes(value)) return 'Unknown style';
      settings.appearance.style = value;
      sendPrefs();
      break;
    case 'opacity': {
      const v = Math.round(Number(value));
      if (!Number.isFinite(v)) return 'Bad opacity value';
      settings.appearance.opacity = Math.max(40, Math.min(100, v));
      sendPrefs();
      break;
    }
    case 'chargingAnimation': settings.chargingAnimation = !!value; sendPrefs(); break;
    case 'calendarEnabled': settings.calendar.enabled = !!value; scheduleCalendar(); break;
    case 'calendarLead':
      if (!LEADS.includes(Number(value))) return 'Unknown reminder time';
      settings.calendar.lead = Number(value);
      sendPrefs();
      break;
    case 'calendarAdd': {
      const url = calendar.normalizeUrl(value);
      if (!url) return 'That doesn’t look like a calendar link. It should start with https:// or webcal://';
      if (settings.calendar.urls.includes(url)) return 'That calendar is already added.';
      if (settings.calendar.urls.length >= CAL_MAX) return `You can add up to ${CAL_MAX} calendars.`;
      settings.calendar.urls.push(url);
      settings.calendar.enabled = true;
      scheduleCalendar();
      break;
    }
    case 'calendarRemove':
      settings.calendar.urls = settings.calendar.urls.filter((u) => u !== value);
      calSources = calSources.filter((s) => s.url !== value);
      scheduleCalendar();
      break;
    case 'calendarRefresh': refreshCalendar(); break;
    default: return `Unknown setting: ${key}`;
  }
  return null;
}

// ================================================================= tray
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
  const u = updater.getState();
  const items = [
    { label: 'Settings…', click: openSettings },
  ];
  if (u.status === 'ready') items.push({ label: `Restart to update to v${u.version}`, click: () => updater.installNow() });
  else if (app.isPackaged) items.push({ label: 'Check for updates', enabled: u.status !== 'checking' && u.status !== 'downloading', click: () => updater.check() });
  items.push(
    { type: 'separator' },
    { label: 'Clear Shelf', enabled: shelf.length > 0, click: clearShelf },
  );
  if (!app.isPackaged) items.push({ label: 'Reload notch', click: () => { for (const n of notches.values()) n.win.reload(); } });
  items.push({ type: 'separator' }, { label: 'Quit Windows Notch', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(u.status === 'ready' ? `Windows Notch: update v${u.version} ready` : 'Windows Notch');
}

// ================================================================= IPC: notch windows
ipcMain.on('set-shape', (e, rect) => {
  const n = notchFor(e.sender);
  if (n && rect && typeof rect.width === 'number') { n.shape = clampShape(rect); n.win.setShape([n.shape]); }
});
ipcMain.on('ready', (e) => {
  e.sender.send('notch:prefs', notchPrefs());
  if (lastMedia) e.sender.send('notch:media', lastMedia);
  for (const m of Object.values(lastSystem)) e.sender.send('notch:system', m);
  e.sender.send('notch:shelf', shelf);
  e.sender.send('notch:clip', clipItems.map((c) => ({ id: c.id, at: c.at, preview: c.text.replace(/\s+/g, ' ').trim().slice(0, 160) })));
  const u = updater.getState();
  if (u.status === 'ready') e.sender.send('notch:system', { type: 'update', version: u.version, init: true });
});
ipcMain.on('notch:open-settings', () => openSettings());
// "Join" on a meeting: only a link that really is in the calendar, and only a meeting service's https link.
ipcMain.on('notch:open-link', (_e, link) => {
  const known = calendarPayload().events.some((ev) => ev.link === link);
  if (known && typeof link === 'string' && link.startsWith('https://') && calendar.LINK_RE.test(link)) shell.openExternal(link);
});
ipcMain.on('notch:toggle', (_e, what) => {
  if (['wifi', 'bt', 'mic', 'dark'].includes(what)) helperSend({ cmd: 'toggle', what });
});
ipcMain.on('clip:copy', (_e, id) => {
  const item = clipItems.find((c) => c.id === id);
  if (!item) return;
  lastClipText = item.text;                 // don't record our own copy as a new item…
  clipboard.writeText(item.text);
  item.at = Date.now();                     // …but move it back to the top
  clipItems = [item, ...clipItems.filter((c) => c !== item)];
  sendClips();
});
ipcMain.on('clip:remove', (_e, id) => { clipItems = clipItems.filter((c) => c.id !== id); sendClips(); });
ipcMain.on('clip:clear', () => { clipItems = []; sendClips(); });
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
ipcMain.on('shelf:clear', clearShelf);
ipcMain.on('shelf:open', (_e, p) => { if (shelf.some((s) => s.path === p)) shell.openPath(p); });
ipcMain.on('shelf:reveal', (_e, p) => { if (shelf.some((s) => s.path === p)) shell.showItemInFolder(p); });
ipcMain.on('shelf:drag', (e, p) => {
  const item = shelf.find((s) => s.path === p);
  if (!item || !fs.existsSync(p)) return;
  let icon = item.thumb ? nativeImage.createFromDataURL(item.thumb) : FALLBACK_DRAG_ICON;
  if (icon.isEmpty()) icon = FALLBACK_DRAG_ICON;
  e.sender.startDrag({ file: p, icon: icon.resize({ width: 64 }) });
});

// ================================================================= IPC: settings window
ipcMain.handle('settings:get', () => settingsState());
ipcMain.handle('settings:set', async (_e, change) => {
  const error = change && typeof change.key === 'string' ? await applySetting(change.key, change.value) : 'Bad request';
  saveSettings();
  refreshTray();
  return { error, state: settingsState() };
});
ipcMain.handle('settings:search-city', async (_e, query) => {
  try { return { results: await searchCity(query) }; } catch (err) { return { error: `Couldn’t search right now (${err.message}).` }; }
});
ipcMain.on('settings:check-updates', () => updater.check());
ipcMain.on('settings:install-update', () => updater.installNow());
ipcMain.on('settings:reset-shortcut', async () => {
  settings.shortcut = DEFAULTS.shortcut;
  settings.shortcutEnabled = true;
  applyShortcut();
  saveSettings();
  broadcastSettingsState();
});

// ================================================================= lifecycle
app.whenReady().then(async () => {
  app.setAppUserModelId('io.github.nithin0029.windows-notch');   // must match "appId" in package.json
  loadSettings();
  // The installed app starts with Windows by default (it's a desktop shell piece); Settings can turn it off.
  if (app.isPackaged && !settings.firstRunDone) {
    app.setLoginItemSettings({ openAtLogin: true });
    settings.firstRunDone = true;
    saveSettings();
  }
  syncWindows();
  startHelper();
  await loadShelf();
  updateVolumeKeys();
  if (!applyShortcut()) console.error(`[notch] shortcut ${settings.shortcut} is taken by another app`);
  resetClipWatch();                                   // start fresh: don't record what's already copied
  setInterval(pollClipboard, 800);
  scheduleWeather();
  scheduleCalendar();
  // after sleep, the events and the weather may be hours old
  powerMonitor.on('resume', () => setTimeout(() => { refreshCalendar(); refreshWeather(); }, 5000));

  tray = new Tray(trayImage());
  tray.on('click', openSettings);
  updater.init((u) => {
    console.log(`[update] ${u.status}${u.version ? ` v${u.version}` : ''}${u.error ? `: ${u.error}` : ''}`);
    if (u.status === 'ready') toNotch('notch:system', { type: 'update', version: u.version });
    refreshTray();
    broadcastSettingsState();
  });
  refreshTray();
  if (settings.autoUpdate) setTimeout(() => updater.check(), 20 * 1000);
  setInterval(() => { if (settings.autoUpdate) updater.check(); }, 6 * 60 * 60 * 1000);

  const onDisplaysChanged = () => { syncWindows(); broadcastSettingsState(); };
  screen.on('display-metrics-changed', onDisplaysChanged);
  screen.on('display-added', onDisplaysChanged);
  screen.on('display-removed', onDisplaysChanged);
});

// Launching the app again (e.g. from the Start menu) opens Settings instead of a second notch.
app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => { /* stay in the tray */ });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('before-quit', () => { quitting = true; if (helper) helper.kill(); });
