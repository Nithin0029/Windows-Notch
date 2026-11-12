// Notch renderer: compact notch, volume/brightness HUD, alerts, expanded panel.
const notch = document.getElementById('notch');
const L = { compact: document.getElementById('compact'), toast: document.getElementById('toast'), expanded: document.getElementById('expanded'), drop: document.getElementById('drop') };

const st = {
  media: null, art: null, battery: null, timer: null,
  volume: null,       // { level 0..1, muted }
  brightness: null,   // 0..100, null when the screen has no software brightness
  privacy: { mic: [], cam: [] },
  shelf: [],          // [{ path, name, dir, thumb }]
  dropping: false,    // files are being dragged over the notch
  toggles: null,      // { wifi: 'on'|'off'|null, bt: ..., mic: 'live'|'muted'|null, dark: bool }
  clips: [],          // clipboard history: [{ id, preview, at }]
  view: 'main',       // which page of the open panel: 'main' | 'clip'
  weather: null,      // { temp, code, isDay, hi, lo, place, units } once a city is set in Settings
  keyOpened: false,   // the panel was opened with the keyboard shortcut (pointer may be elsewhere)
  prefs: { size: 'normal', accent: 'blue', sections: { toggles: true, sliders: true, shelf: true, timers: true }, clipboard: true },
  expanded: false, toast: null, queue: [], hover: false,
};
const bootAt = Date.now();
const HUD_KINDS = new Set(['volume', 'brightness']);
let lastKey = '';
let toastTimer = null;
let collapseTimer = null;
let lowWarned = false;
let toastSeq = 0;

const ICON = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 6.6v10.8c0 .7.8 1.1 1.4.7l8.1-5.4c.5-.4.5-1.1 0-1.5L3.9 5.9c-.6-.4-1.4 0-1.4.7zm10 0v10.8c0 .7.8 1.1 1.4.7l8.1-5.4c.5-.4.5-1.1 0-1.5l-8.1-5.3c-.6-.4-1.4 0-1.4.7z"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor" style="transform:scaleX(-1)"><path d="M2.5 6.6v10.8c0 .7.8 1.1 1.4.7l8.1-5.4c.5-.4.5-1.1 0-1.5L3.9 5.9c-.6-.4-1.4 0-1.4.7zm10 0v10.8c0 .7.8 1.1 1.4.7l8.1-5.4c.5-.4.5-1.1 0-1.5l-8.1-5.3c-.6-.4-1.4 0-1.4.7z"/></svg>',
  timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="13.5" r="8"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3.5v11.2a3.3 3.3 0 1 1-2-3V7.6l-8 1.8v7.3a3.3 3.3 0 1 1-2-3V6.3c0-.5.3-.9.8-1l10-2.2c.6-.1 1.2.3 1.2 1z"/></svg>',
  bolt: '<path d="M13.6 1.6 8.2 7.4h3.4l-1.4 5 5.4-5.8h-3.4z" fill="#fff" stroke="#000" stroke-width=".9" stroke-linejoin="round"/>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2" fill="currentColor"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2.5" y="6" width="13.5" height="12" rx="3"/><path d="M17.5 10.2 21.5 7.5v9l-4-2.7z"/></svg>',
  tray: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13.5l2.6-7.2c.3-.8 1-1.3 1.9-1.3h9c.9 0 1.6.5 1.9 1.3l2.6 7.2V18c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M2.5 7c0-1.1.9-2 2-2h4.6l2 2.2h8.4c1.1 0 2 .9 2 2V18c0 1.1-.9 2-2 2h-15c-1.1 0-2-.9-2-2z" fill="#4aa8ff"/><path d="M2.5 9.5h19V18c0 1.1-.9 2-2 2h-15c-1.1 0-2-.9-2-2z" fill="#7cc4ff"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9.2 9.2 0 0 1 12.4 0M9.1 16.1a4.5 4.5 0 0 1 5.8 0"/><circle cx="12" cy="19.3" r="1.3" fill="currentColor" stroke="none"/></svg>',
  bt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 7.5l11 9-5.5 4.5V3l5.5 4.5-11 9"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15.5 10.5V6a3.5 3.5 0 0 0-6.6-1.6M8.5 9v2.5a3.5 3.5 0 0 0 5.6 2.8M5.5 11a6.5 6.5 0 0 0 10.3 5.3M18.5 11a6.4 6.4 0 0 1-.5 2.5M12 17.5V21M3 3l18 18"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a.6.6 0 0 0-.8-.7A9.5 9.5 0 1 0 21.2 15.4a.6.6 0 0 0-.7-.8z"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5" fill="currentColor"/><path d="M8.5 11h7M8.5 15h5" stroke-linecap="round"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M6 2.5h8l5 5V20c0 .8-.7 1.5-1.5 1.5h-11.5c-.8 0-1.5-.7-1.5-1.5V4c0-.8.7-1.5 1.5-1.5z" fill="#e9e9ee"/><path d="M14 2.5v4c0 .6.4 1 1 1h4" fill="#b9b9c2"/></svg>',
};
function speaker(level, muted) {
  const waves = muted ? '<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
    : (level > 0 ? '<path d="M15.5 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '') +
      (level > 0.5 ? '<path d="M18.3 6.4a8 8 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' : '');
  return `<svg viewBox="0 0 24 24"><path d="M3.5 9.2v5.6c0 .6.4 1 1 1h2.8l4.4 3.7c.6.5 1.6.1 1.6-.8V5.3c0-.9-1-1.3-1.6-.8L7.3 8.2H4.5c-.6 0-1 .4-1 1z" fill="currentColor"/>${waves}</svg>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const shortTime = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M$/i, '');
const playing = () => st.media && st.media.status === 'Playing';

function appName(id) {
  const s = String(id || '').toLowerCase();
  const map = [['spotify', 'Spotify'], ['chrome', 'Chrome'], ['msedge', 'Edge'], ['firefox', 'Firefox'], ['308046b0af4a39cb', 'Firefox'],
    ['zunemusic', 'Media Player'], ['brave', 'Brave'], ['opera', 'Opera'], ['vlc', 'VLC'], ['applemusic', 'Apple Music'], ['itunes', 'iTunes']];
  for (const [k, v] of map) if (s.includes(k)) return v;
  return (id || '').replace(/\.exe$/i, '').split(/[!\\.]/).pop() || 'Media';
}

// ------------------------------------------------------------ pieces
function batteryColor() {
  const b = st.battery;
  if (!b) return '#fff';
  if (b.charging) return '#30d158';
  if (b.level <= 0.2) return '#ff453a';
  return '#fff';
}
function batterySvg() {
  const b = st.battery;
  return `<svg class="bat" viewBox="0 0 28 14"><rect x=".7" y=".7" width="23.4" height="12.6" rx="3.6" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>` +
    `<rect x="25" y="4.6" width="2.2" height="4.8" rx="1.1" fill="#fff" fill-opacity=".45"/><rect x="2.5" y="2.5" width="${(19.6 * b.level).toFixed(1)}" height="9" rx="2" fill="${batteryColor()}"/>` +
    (b.charging ? `<g transform="translate(1.5 0)">${ICON.bolt}</g>` : '') + `</svg>`;
}
function batteryChip() {
  if (!st.battery) return '';
  return `<span class="batw" style="color:${st.battery.charging ? '#30d158' : '#fff'}">${Math.round(st.battery.level * 100)}%${batterySvg()}</span>`;
}
function batteryRing() {
  if (!st.battery) return '';
  const c = 2 * Math.PI * 25, l = st.battery.level;
  return `<div class="bring"><svg viewBox="0 0 58 58"><circle cx="29" cy="29" r="25" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="5"/>` +
    `<circle cx="29" cy="29" r="25" fill="none" stroke="${batteryColor() === '#fff' ? '#30d158' : batteryColor()}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * l).toFixed(1)} ${c.toFixed(1)}"/></svg>` +
    `<span>${Math.round(l * 100)}%</span></div>`;
}
const wave = () => '<div class="wave"><i></i><i></i><i></i><i></i><i></i></div>';
function art(size) {
  if (st.art) return `<div class="art ${size}" style="background-image:url('${st.art}')"></div>`;
  return `<div class="art ${size} empty">${ICON.note}</div>`;
}
function timerRing() {
  return `<svg class="ring" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="none" stroke="rgba(255,159,10,.25)" stroke-width="3"/>` +
    `<circle id="ring-fg" cx="10" cy="10" r="8" fill="none" stroke="#ff9f0a" stroke-width="3" stroke-linecap="round" stroke-dasharray="50.3 50.3"/></svg>`;
}
function privacyDots() {
  const p = st.privacy;
  const d = (p.cam.length ? '<i class="pdot cam"></i>' : '') + (p.mic.length ? '<i class="pdot mic"></i>' : '');
  return d ? `<span class="dots">${d}</span>` : '';
}

// ------------------------------------------------------------ layers
function compactHTML() {
  const left = st.media ? art('sm') : `<span class="ctime" id="c-time"></span>`;
  let right;
  if (st.timer) right = `<span class="ctimer">${timerRing()}<span id="c-timer"></span></span>`;
  else if (playing()) right = wave();
  else if (st.media) right = `<span class="ctime" id="c-time"></span>`;
  else right = st.battery ? batteryChip() : `<span class="ctime" id="c-date" style="opacity:.6;font-weight:500"></span>`;
  return `<div class="cin">${left}<span class="cr">${privacyDots()}${shelfBadge()}${right}</span></div>`;
}

// ------------------------------------------------------------ shelf pieces
const shelfBadge = () => (st.shelf.length && st.prefs.sections.shelf ? `<span class="sbadge" title="Shelf">${ICON.tray}${st.shelf.length}</span>` : '');

function shelfHTML() {
  if (!st.shelf.length) return '';
  const tiles = st.shelf.map((s, i) =>
    `<div class="tile" draggable="true" data-i="${i}" title="${esc(s.name)}&#10;Drag out to use · double-click to open · right-click to show in folder">` +
    `<div class="thumb">${s.thumb ? `<img src="${s.thumb}" alt="">` : (s.dir ? ICON.folder : ICON.file)}</div>` +
    `<div class="tname">${esc(s.name)}</div><button class="tx" data-act="shelf-remove" data-i="${i}" title="Remove from Shelf">×</button></div>`).join('');
  return `<div class="shelf"><div class="shead"><span class="tl">${ICON.tray}Shelf <span class="muted">${st.shelf.length}</span></span>` +
    `<button class="chip" data-act="shelf-clear">Clear</button></div><div class="tiles">${tiles}</div></div>`;
}

function dropHTML() {
  return `<div class="dropzone"><div class="dz">${ICON.tray}<div><div class="t">Drop to add to Shelf</div>` +
    `<div class="s">Files stay where they are. The Shelf just keeps them handy.</div></div></div></div>`;
}

function hudHTML(kind) {
  return `<div class="hud" id="hud" data-kind="${kind}"><span class="hicon" id="h-icon"></span><div class="hbar"><i id="h-bar"></i></div><span class="hval" id="h-val"></span></div>`;
}

function toastHTML(t) {
  if (HUD_KINDS.has(t.kind)) return hudHTML(t.kind);
  let icon = '', title = esc(t.title), sub = esc(t.sub || ''), right = '';
  switch (t.kind) {
    case 'track':
      icon = art('lg');
      right = wave();
      break;
    case 'battery': {
      const color = t.color || '#fff';
      icon = `<div style="color:${color};transform:scale(1.5)">${batterySvg()}</div>`;
      right = `<span style="color:${color}">${Math.round((st.battery?.level || 0) * 100)}%</span>`;
      break;
    }
    case 'privacy':
      icon = `<div style="color:${t.color};width:26px;height:26px">${t.cam ? ICON.cam : ICON.mic}</div>`;
      right = `<i class="pdot ${t.cam ? 'cam' : 'mic'}"></i>`;
      break;
    case 'shelf':
      icon = t.thumb ? `<img src="${t.thumb}" alt="" style="object-fit:contain">` : `<div style="color:#64b5ff;width:28px;height:28px">${ICON.tray}</div>`;
      right = `<span class="sbadge">${ICON.tray}${st.shelf.length}</span>`;
      break;
    case 'update':
      icon = `<div style="color:#a597ff;width:28px;height:28px">${ICON.download}</div>`;
      right = '';
      break;
    case 'timer':
      icon = `<div style="color:#ff9f0a;width:28px;height:28px">${ICON.timer}</div>`;
      right = `<span style="color:#ff9f0a">0:00</span>`;
      break;
  }
  return `<div class="tin"><div class="ticon">${icon}</div><div class="ttext"><div class="t">${title}</div><div class="s">${sub}</div></div><div class="tright">${right}</div></div>`;
}

function slidersHTML() {
  let s = '';
  if (st.volume) s += `<div class="srow"><span class="hicon" id="s-vol-icon"></span><div class="hbar" data-slider="volume"><i id="s-vol"></i></div><span class="hval" id="s-vol-val"></span></div>`;
  if (st.brightness !== null) s += `<div class="srow"><span class="hicon">${ICON.sun}</span><div class="hbar" data-slider="brightness"><i id="s-bri"></i></div><span class="hval" id="s-bri-val"></span></div>`;
  // With files on the Shelf, volume (left) and brightness (right) share one row to keep the panel short.
  return s ? `<div class="sliders${st.shelf.length ? ' row' : ''}">${s}</div>` : '';
}

function expandedHTML() {
  const m = st.media;
  let top;
  if (m) {
    top = `<div class="player">${art('lg')}<div class="meta"><div class="t">${esc(m.title || 'Unknown title')}</div>` +
      `<div class="a">${esc(m.artist || m.album || '')}</div><div class="app">${esc(appName(m.app))}</div></div>${playing() ? wave() : ''}</div>` +
      (m.dur > 0 ? `<div class="prog"><span id="e-pos">0:00</span><div class="bar"><i id="e-bar"></i></div><span>-<span id="e-left">0:00</span></span></div>` : '') +
      `<div class="ctrls"><button data-act="prev" title="Previous">${ICON.prev}</button>` +
      `<button data-act="toggle" class="big" title="Play/Pause">${playing() ? ICON.pause : ICON.play}</button>` +
      `<button data-act="next" title="Next">${ICON.next}</button></div>`;
  } else {
    top = `<div class="clock"><div><div class="bigtime" id="e-time"></div><div class="date" id="e-date"></div>${weatherLine()}</div>${batteryRing()}</div>`;
  }
  if (st.view === 'clip' && st.prefs.clipboard) return clipViewHTML();
  const sec = st.prefs.sections;
  // footer: timers (optional) on the left, clipboard (if history is on) and Settings on the right
  const tools = (st.prefs.clipboard ? `<button class="chip clipbtn" data-act="view-clip" title="Clipboard history">${ICON.clip}${st.clips.length || ''}</button>` : '') +
    `<button class="chip iconbtn" data-act="settings" title="Settings">${ICON.gear}</button>`;
  let trow;
  if (st.timer) {
    // a running timer always shows, even with the Timers section hidden, so it can be cancelled
    trow = `<div class="trow"><span class="tl">${ICON.timer}<span id="e-timer"></span> left</span><div class="chips"><button class="chip warn" data-act="cancel-timer">Cancel</button><span class="csep"></span>${tools}</div></div>`;
  } else if (sec.timers) {
    trow = `<div class="trow"><span class="tl" title="Timer">${ICON.timer}</span><div class="chips">${[1, 5, 15, 25].map((n) => `<button class="chip" data-timer="${n}" title="${n}-minute timer">${n}m</button>`).join('')}<span class="csep"></span>${tools}</div></div>`;
  } else {
    trow = `<div class="trow"><span></span><div class="chips">${tools}</div></div>`;
  }
  return `<div class="exp">${top}${sec.toggles ? togglesHTML() : ''}${sec.sliders ? slidersHTML() : ''}${sec.shelf ? shelfHTML() : ''}${trow}</div>`;
}

// ------------------------------------------------------------ weather (city is chosen in Settings)
function weatherLine() {
  const w = st.weather;
  if (!w || w.off || typeof w.temp !== 'number') return '';
  const hl = w.hi != null && w.lo != null ? ` · H ${w.hi}° L ${w.lo}°` : '';
  return `<div class="wxl" title="${esc(WeatherIcons.label(w.code))} in ${esc(w.place || '')}">${WeatherIcons.icon(w.code, w.isDay)}` +
    `<b>${w.temp}°</b><span>${esc(w.place || WeatherIcons.label(w.code))}${hl}</span></div>`;
}

// ------------------------------------------------------------ quick toggles
function togglesHTML() {
  const t = st.toggles;
  if (!t) return '';
  const btn = (what, on, icon, label, cls = '') =>
    `<button class="tg ${on ? 'on' : ''} ${cls}" data-toggle="${what}" title="${label}"><span class="tgi">${icon}</span><span class="tgl">${label}</span></button>`;
  let s = '';
  if (t.wifi) s += btn('wifi', t.wifi === 'on', ICON.wifi, 'Wi‑Fi');
  if (t.bt) s += btn('bt', t.bt === 'on', ICON.bt, 'Bluetooth');
  if (t.mic) s += btn('mic', t.mic === 'muted', t.mic === 'muted' ? ICON.micOff : ICON.mic, t.mic === 'muted' ? 'Mic off' : 'Mic on', 'warn');
  s += btn('dark', t.dark, t.dark ? ICON.moon : ICON.sun, t.dark ? 'Dark' : 'Light', 'violet');
  return `<div class="toggles">${s}</div>`;
}

// ------------------------------------------------------------ clipboard history page
function ago(at) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}
function clipViewHTML() {
  const list = st.clips.length
    ? st.clips.map((c) => `<div class="citem" data-clip="${c.id}" title="Click to copy"><span class="ctext">${esc(c.preview)}</span>` +
        `<span class="cago" data-at="${c.at}">${ago(c.at)}</span><button class="cx" data-act="clip-remove" data-clip="${c.id}" title="Remove">×</button></div>`).join('')
    : `<div class="cempty">${ICON.clip}<div>Copy some text and it shows up here.<br><span class="muted">Kept in memory only · passwords are skipped</span></div></div>`;
  return `<div class="exp clipview"><div class="chead"><button class="chip" data-act="view-main">${ICON.back}Back</button>` +
    `<span class="ctitle">Clipboard</span>${st.clips.length ? '<button class="chip" data-act="clip-clear">Clear</button>' : '<span style="width:52px"></span>'}</div>` +
    `<div class="clist">${list}</div></div>`;
}

// ------------------------------------------------------------ render
function render() {
  if (!st.expanded) st.view = 'main';          // the panel always reopens on its main page
  const state = st.dropping ? 'drop' : st.expanded ? 'expanded' : st.toast ? 'toast' : 'compact';
  const m = st.media, b = st.battery, p = st.privacy;
  const key = [state, m && m.track, m && m.status, m && m.dur > 0, st.art && st.art.length, !!st.timer,
    b && b.charging, b && Math.round(b.level * 100), st.toast && st.toast.id, p.mic.length > 0, p.cam.length > 0,
    !!st.volume, st.brightness !== null, st.shelf.map((s) => s.path).join('|'),
    st.view, JSON.stringify(st.toggles), st.clips.map((c) => c.id).join(','), JSON.stringify(st.weather), JSON.stringify(st.prefs)].join('|');
  if (key !== lastKey) {
    lastKey = key;
    const layer = L[state];
    const tilesScroll = layer.querySelector('.tiles')?.scrollLeft || 0;
    layer.innerHTML = state === 'compact' ? compactHTML() : state === 'toast' ? toastHTML(st.toast)
      : state === 'drop' ? dropHTML() : expandedHTML();
    const tiles = layer.querySelector('.tiles');
    if (tiles) tiles.scrollLeft = tilesScroll;
    for (const k in L) L[k].classList.toggle('on', k === state);
    fillText();   // put the clock/date/timer text in BEFORE measuring, or empty lines measure as 0px tall
    let w, h, r;
    if (state === 'compact') {
      w = (m || st.timer) ? 244 : 204;
      if (p.mic.length || p.cam.length) w += 18;
      if (st.shelf.length && st.prefs.sections.shelf) w += 44;
      h = 34; r = 14;
    } else if (state === 'toast') {
      if (HUD_KINDS.has(st.toast.kind)) { w = 330; h = 34; r = 14; }
      else { w = 360; h = 60; r = 22; }
    } else if (state === 'drop') { w = 400; h = 100; r = 28; }
    else { w = 400; h = layer.firstElementChild.offsetHeight; r = 30; }
    notch.style.width = w + 'px';
    notch.style.height = h + 'px';
    document.getElementById('body').style.borderRadius = `0 0 ${r}px ${r}px`;
    notch.dataset.state = state;
    notch.classList.toggle('lift', state === 'compact' && st.hover);
    updateShape(w, h);
    watchPanelSize(state === 'expanded' ? layer.firstElementChild : null);
  }
  tick();
}

// The open panel can change height after it's drawn (weather arriving, a font finishing loading,
// the clipboard list growing). Follow its real size so nothing is ever cut off.
const panelObserver = new ResizeObserver((entries) => {
  if (notch.dataset.state !== 'expanded') return;
  const h = Math.ceil(entries[entries.length - 1].target.offsetHeight);
  if (h && h !== parseInt(notch.style.height, 10)) { notch.style.height = h + 'px'; updateShape(400, h); }
});
let observedPanel = null;
function watchPanelSize(el) {
  if (observedPanel === el) return;
  if (observedPanel) panelObserver.unobserve(observedPanel);
  observedPanel = el;
  if (el) panelObserver.observe(el);
}

// ------------------------------------------------------------ window shape
// Only the notch (plus a small margin for the hover "lift" and the shoulders) is part of the window,
// so the rest of the screen stays clickable and Explorer can drop files straight onto the notch.
// When the notch grows the shape grows at once; when it shrinks we wait for the animation to finish.
let shapeApplied = null;
let shapeTimer = null;
function shapeFor(w, h) {
  const z = SIZE_SCALE[st.prefs.size] || 1;   // the notch is drawn scaled from its top centre
  const side = 10 + 8;                       // shoulder + margin
  const W = (w + side * 2) * z;
  return { x: Math.round((window.innerWidth - W) / 2), y: 0, width: Math.round(W), height: Math.round((h + 8) * z) };
}
function updateShape(w, h) {
  const target = shapeFor(w, h);
  const a = shapeApplied;
  const now = a ? {
    x: Math.min(a.x, target.x), y: 0,
    width: Math.max(a.x + a.width, target.x + target.width) - Math.min(a.x, target.x),
    height: Math.max(a.height, target.height),
  } : target;
  api.setShape(now);
  shapeApplied = now;
  clearTimeout(shapeTimer);
  shapeTimer = setTimeout(() => { api.setShape(target); shapeApplied = target; }, 700);
}

function mediaPos() {
  const m = st.media;
  if (!m || !(m.dur > 0)) return 0;
  let pos = m.pos || 0;
  if (m.status === 'Playing' && m.updated) pos += (Date.now() - m.updated) / 1000;
  return Math.max(0, Math.min(m.dur, pos));
}

function setText(id, v) { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; }
function setHTML(id, v) { const el = document.getElementById(id); if (el && el.dataset.v !== v) { el.dataset.v = v; el.innerHTML = v; } }
function setWidth(id, frac) { const el = document.getElementById(id); if (el) el.style.width = (Math.max(0, Math.min(1, frac)) * 100).toFixed(1) + '%'; }

function updateLevels() {
  const v = st.volume;
  const hud = document.getElementById('hud');
  if (hud) {
    if (hud.dataset.kind === 'volume' && v) {
      setHTML('h-icon', speaker(v.level, v.muted));
      setWidth('h-bar', v.muted ? 0 : v.level);
      setText('h-val', v.muted ? '—' : String(Math.round(v.level * 100)));
      hud.classList.toggle('muted', v.muted);
    } else if (hud.dataset.kind === 'brightness' && st.brightness !== null) {
      setHTML('h-icon', ICON.sun);
      setWidth('h-bar', st.brightness / 100);
      setText('h-val', String(st.brightness));
    }
  }
  if (v) {
    setHTML('s-vol-icon', speaker(v.level, v.muted));
    setWidth('s-vol', v.muted ? 0 : v.level);
    setText('s-vol-val', v.muted ? '—' : String(Math.round(v.level * 100)));
  }
  if (st.brightness !== null) { setWidth('s-bri', st.brightness / 100); setText('s-bri-val', String(st.brightness)); }
}

function tick() {
  if (st.timer && st.timer.end <= Date.now()) { finishTimer(); return; }
  fillText();
}

/** Fill in every live text/bar (clock, date, timers, media position, levels). No side effects. */
function fillText() {
  setText('c-time', shortTime());
  setText('c-date', new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric' }));
  setText('e-time', shortTime());
  setText('e-date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
  for (const el of document.querySelectorAll('.citem:not(.copied) .cago')) el.textContent = ago(Number(el.dataset.at));
  if (st.timer) {
    const left = Math.max(0, (st.timer.end - Date.now()) / 1000);
    setText('c-timer', fmt(Math.ceil(left)));
    setText('e-timer', fmt(Math.ceil(left)));
    const ring = document.getElementById('ring-fg');
    if (ring) ring.setAttribute('stroke-dasharray', `${(50.3 * left / st.timer.total).toFixed(2)} 50.3`);
  }
  if (st.media && st.media.dur > 0) {
    const pos = mediaPos();
    setText('e-pos', fmt(pos));
    setText('e-left', fmt(st.media.dur - pos));
    setWidth('e-bar', pos / st.media.dur);
  }
  updateLevels();
}
setInterval(tick, 500);

// ------------------------------------------------------------ alerts & HUD
function showToast(t) {
  t.id = ++toastSeq;
  if (st.expanded) {
    if (!t.important) return;
    st.expanded = false;
  }
  if (st.toast) {
    if (HUD_KINDS.has(st.toast.kind)) { st.queue.unshift(t); return; }   // let the HUD finish first
    st.queue.push(t);
    return;
  }
  st.toast = t;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(nextToast, t.duration || 2800);
}
function nextToast() {
  st.toast = st.queue.shift() || null;
  render();
  if (st.toast) toastTimer = setTimeout(nextToast, st.toast.duration || 2800);
}
function showHud(kind) {
  if (st.expanded) { updateLevels(); return; }          // the open panel already shows the sliders
  const cur = st.toast;
  if (cur && cur.kind === kind) {
    updateLevels();
  } else {
    if (cur && !HUD_KINDS.has(cur.kind)) st.queue.unshift(cur);  // resume the interrupted alert afterwards
    st.toast = { kind, id: ++toastSeq };
    render();
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(nextToast, 1600);
}

// ------------------------------------------------------------ timer
function startTimer(min) {
  st.timer = { end: Date.now() + min * 60000, total: min * 60 };
  render();
}
function finishTimer() {
  st.timer = null;
  chime();
  showToast({ kind: 'timer', title: 'Timer', sub: 'Time’s up', important: true, duration: 5000 });
  render();
}
function chime() {
  try {
    const ctx = new AudioContext();
    [0, 0.28, 0.56].forEach((t, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = i === 2 ? 1318.5 : 1046.5;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.18, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.5);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.55);
    });
    setTimeout(() => ctx.close(), 1500);
  } catch { /* no audio */ }
}

// ------------------------------------------------------------ interaction
function setHover(v) {
  if (v === st.hover) return;
  st.hover = v;
  notch.classList.toggle('lift', v && notch.dataset.state === 'compact');
  clearTimeout(collapseTimer);
  if (!v && st.expanded && !dragging) scheduleCollapse();
}
document.addEventListener('mousemove', (e) => {
  draggingOut = false;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setHover(!!(el && el.closest('#notch')) || !!dragging);
  if (dragging) dragSlider(e);
});
document.addEventListener('mouseleave', () => { if (!dragging) setHover(false); });

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => { st.expanded = false; render(); }, 900);
}
// The main process watches the real pointer position. It's the source of truth for "the pointer
// left the notch", so an open panel always closes when you move away, whatever the hover state says.
// ------------------------------------------------------------ appearance (Settings → Appearance)
const SIZE_SCALE = { compact: 0.88, normal: 1, large: 1.12 };
const ACCENT_COLORS = { blue: '#0a84ff', violet: '#8b7cf6', pink: '#ff375f', orange: '#ff9f0a', green: '#30d158', teal: '#40c8e0', graphite: '#8e8e93' };
api.onPrefs((p) => {
  if (!p) return;
  st.prefs = { ...st.prefs, ...p, sections: { ...st.prefs.sections, ...(p.sections || {}) } };
  const root = document.documentElement.style;
  root.setProperty('--z', String(SIZE_SCALE[st.prefs.size] || 1));
  root.setProperty('--brand', ACCENT_COLORS[st.prefs.accent] || ACCENT_COLORS.blue);
  if (!st.prefs.clipboard && st.view === 'clip') st.view = 'main';
  lastKey = '';            // force a full redraw + re-measure with the new size
  render();
});

// Keyboard shortcut (set in Settings): open/close the panel on this screen.
api.onCommand((cmd) => {
  if (cmd !== 'toggle-panel') return;
  clearTimeout(collapseTimer);
  if (st.expanded) { st.expanded = false; st.keyOpened = false; render(); return; }
  if (st.toast) { clearTimeout(toastTimer); st.toast = null; st.queue = []; }
  st.expanded = true;
  st.keyOpened = true;
  render();
  // Opened from the keyboard while the mouse is somewhere else: close by itself after a few seconds,
  // unless the pointer comes over the panel (then the normal "move away to close" applies).
  collapseTimer = setTimeout(() => { if (!st.hover) { st.expanded = false; st.keyOpened = false; render(); } }, 6000);
});

api.onPointer((inside) => {
  if (inside) { clearTimeout(collapseTimer); return; }
  if (dragging) return;
  setHover(false);
  if (st.expanded) scheduleCollapse();
});

// scroll anywhere on the notch = change volume
let wheelAcc = 0;
notch.addEventListener('wheel', (e) => {
  e.preventDefault();
  const tiles = e.target.closest('.tiles');
  if (tiles) { tiles.scrollLeft += e.deltaY || e.deltaX; return; }   // scrolling the shelf, not the volume
  wheelAcc += e.deltaY;
  while (Math.abs(wheelAcc) >= 40) {
    const step = wheelAcc < 0 ? 0.04 : -0.04;
    wheelAcc -= Math.sign(wheelAcc) * 40;
    if (st.volume) { st.volume.level = Math.max(0, Math.min(1, st.volume.level + step)); st.volume.muted = st.volume.level === 0; }
    api.volume({ delta: step });
    showHud('volume');
  }
}, { passive: false });

// sliders in the expanded panel (click or drag)
let dragging = null;
function dragSlider(e) {
  const r = dragging.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  if (dragging.dataset.slider === 'volume') {
    st.volume = { level: f, muted: f === 0 };
    api.volume({ level: f });
  } else {
    st.brightness = Math.round(f * 100);
    api.brightness(st.brightness);
  }
  updateLevels();
}
notch.addEventListener('mousedown', (e) => {
  const s = e.target.closest('[data-slider]');
  if (!s) return;
  e.preventDefault();
  dragging = s;
  dragSlider(e);
});
document.addEventListener('mouseup', () => { if (dragging) { dragging = null; suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); } });
let suppressClick = false;

// Listen on the whole (notch-shaped) window, so a click on the thin margin around the notch counts too.
document.addEventListener('click', (e) => {
  if (suppressClick || e.target.closest('[data-slider]')) return;
  const btn = e.target.closest('button');
  if (btn) {
    e.stopPropagation();
    if (btn.dataset.timer) return startTimer(Number(btn.dataset.timer));
    const act = btn.dataset.act;
    if (act === 'cancel-timer') { st.timer = null; render(); return; }
    if (btn.dataset.toggle) { flipToggle(btn.dataset.toggle); return; }
    if (act === 'settings') { api.openSettings(); st.expanded = false; render(); return; }
    if (act === 'view-clip') { st.view = 'clip'; render(); return; }
    if (act === 'view-main') { st.view = 'main'; render(); return; }
    if (act === 'clip-clear') { api.clipClear(); return; }
    if (act === 'clip-remove') { api.clipRemove(Number(btn.dataset.clip)); return; }
    if (act === 'shelf-clear') { api.shelfClear(); return; }
    if (act === 'shelf-remove') { const s = st.shelf[Number(btn.dataset.i)]; if (s) api.shelfRemove(s.path); return; }
    if (act) {
      api.media(act);
      if (act === 'toggle' && st.media) { st.media.pos = mediaPos(); st.media.updated = Date.now(); st.media.status = playing() ? 'Paused' : 'Playing'; render(); }
    }
    return;
  }
  if (e.target.closest('.tile')) return;     // tiles: double-click opens, drag moves out
  const citem = e.target.closest('.citem');
  if (citem) {                                // clipboard item: copy it again
    api.clipCopy(Number(citem.dataset.clip));
    citem.classList.add('copied');
    citem.querySelector('.cago').textContent = 'Copied';
    return;
  }
  // Inside the open panel, only the top strip (where the notch sits) closes it; clicking the clock,
  // the date or empty space does nothing. Moving the pointer away also closes it.
  if (st.expanded && e.clientY > 40) return;
  if (st.toast) { clearTimeout(toastTimer); st.toast = null; st.queue = []; }
  st.expanded = !st.expanded;
  clearTimeout(collapseTimer);
  render();
});

// ------------------------------------------------------------ file shelf: drag in, drag out
let draggingOut = false;   // true while one of our own tiles is being dragged out
let dropTimer = null;
const tileItem = (el) => { const t = el.closest('.tile'); return t ? st.shelf[Number(t.dataset.i)] : null; };

notch.addEventListener('dblclick', (e) => { const s = tileItem(e.target); if (s) api.shelfOpen(s.path); });
notch.addEventListener('contextmenu', (e) => { const s = tileItem(e.target); if (s) { e.preventDefault(); api.shelfReveal(s.path); } });
notch.addEventListener('dragstart', (e) => {
  const s = tileItem(e.target);
  e.preventDefault();               // the OS drag is started by the main process so real files are dragged
  if (!s) return;
  draggingOut = true;
  api.shelfDrag(s.path);
});

const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
function endDrop() { clearTimeout(dropTimer); if (st.dropping) { console.info('[drop] zone closed'); st.dropping = false; render(); } }
// Windows stops sending dragover while the pointer is held still, so silence must NOT close the
// drop zone. It closes only on a real "left the window" dragleave (or after the drop itself).
function dragOver(e) {
  if (!hasFiles(e) || !st.prefs.sections.shelf) return;   // Shelf hidden in Settings: don't accept drops
  e.preventDefault();
  clearTimeout(dropTimer);
  if (draggingOut) { e.dataTransfer.dropEffect = 'none'; return; }
  e.dataTransfer.dropEffect = 'copy';
  if (!st.dropping) { st.dropping = true; console.info(`[drop] ${e.type} effectAllowed=${e.dataTransfer.effectAllowed}`); render(); }
}
document.addEventListener('dragenter', dragOver);
document.addEventListener('dragover', dragOver);
document.addEventListener('dragleave', (e) => {
  // dragleave also fires when the notch redraws or its window shape changes under a pointer that
  // hasn't moved. Those must not close the zone (the drop would then land on whatever is behind
  // the shrunken notch). Only a pointer that is really outside the notch's area counts as leaving.
  const a = shapeApplied;
  const x = e.clientX, y = e.clientY;
  const inside = a && !(x === 0 && y === 0) && x > a.x + 1 && x < a.x + a.width - 1 && y >= 0 && y < a.height - 1;
  if (inside) return;
  clearTimeout(dropTimer);
  dropTimer = setTimeout(endDrop, 120);
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  endDrop();
  if (draggingOut) { draggingOut = false; return; }
  const files = [...(e.dataTransfer.files || [])];
  const paths = files.map((f) => api.pathForFile(f)).filter(Boolean);
  console.info(`[drop] files=${files.length} paths=${paths.length} types=${[...(e.dataTransfer.types || [])].join(',')}`);
  if (!paths.length) {
    if (files.length) showToast({ kind: 'shelf', title: 'Couldn’t add that', sub: 'Only files and folders from your PC can go on the Shelf' });
    return;
  }
  const added = await api.shelfAdd(paths);
  if (added) {
    const first = st.shelf.find((s) => s.path === paths[0]);
    showToast({ kind: 'shelf', title: added === 1 ? 'Added to Shelf' : `Added ${added} items to Shelf`,
      sub: added === 1 && first ? first.name : 'Click the notch to see them', thumb: added === 1 && first ? first.thumb : null });
  } else {
    showToast({ kind: 'shelf', title: 'Already on the Shelf', sub: paths.length === 1 ? paths[0].split('\\').pop() : `${paths.length} items` });
  }
});

api.onShelf((items) => { st.shelf = Array.isArray(items) ? items : []; render(); });
api.onClip((items) => {
  st.clips = Array.isArray(items) ? items : [];
  // a click on an item just copied it; keep the "Copied" mark visible for a moment before redrawing
  const copied = document.querySelector('.citem.copied');
  if (copied) setTimeout(render, 700); else render();
});

// Flip a quick toggle right away (so the button feels instant); the helper reports the real state within a moment.
function flipToggle(what) {
  const t = st.toggles;
  if (!t) return;
  if (what === 'wifi' || what === 'bt') t[what] = t[what] === 'on' ? 'off' : 'on';
  else if (what === 'mic') t.mic = t.mic === 'muted' ? 'live' : 'muted';
  else if (what === 'dark') t.dark = !t.dark;
  api.toggle(what);
  render();
}

// ------------------------------------------------------------ data sources
api.onMedia((m) => {
  if (m.type === 'art') {
    if (st.media && st.media.track === m.track) { st.art = m.data; applyAccent(); render(); }
    return;
  }
  if (!m.active) { st.media = null; st.art = null; applyAccent(); render(); return; }
  const prev = st.media;
  if (m.newTrack || !prev || prev.track !== m.track) { st.art = m.art || null; applyAccent(); }
  st.media = m;
  if (m.status === 'Playing' && Date.now() - bootAt > 4000 && (!prev || prev.track !== m.track)) {
    showToast({ kind: 'track', title: m.title || 'Now Playing', sub: m.artist || appName(m.app) });
  }
  render();
});

api.onSystem((m) => {
  if (m.type === 'volume') {
    const changed = !m.init && st.volume && (Math.abs(st.volume.level - m.level) > 0.004 || st.volume.muted !== m.muted);
    st.volume = { level: m.level, muted: m.muted };
    if (dragging) return;
    if (changed) showHud('volume'); else render();
  } else if (m.type === 'brightness') {
    const changed = !m.init && st.brightness !== null && st.brightness !== m.level;
    st.brightness = m.level;
    if (dragging) return;
    if (changed) showHud('brightness'); else render();
  } else if (m.type === 'weather') {
    st.weather = m.off ? null : m;
    render();
  } else if (m.type === 'update') {
    if (!m.init) showToast({ kind: 'update', title: 'Update ready', sub: `Version ${m.version} installs when you quit (or restart from the tray)`, duration: 6000 });
  } else if (m.type === 'toggles') {
    st.toggles = { wifi: m.wifi || null, bt: m.bt || null, mic: m.mic || null, dark: !!m.dark };
    render();
  } else if (m.type === 'power') {
    hasBattery = !!m.hasBattery;
    if (batteryRef) { st.battery = hasBattery ? { level: batteryRef.level, charging: batteryRef.charging } : null; render(); }
  } else if (m.type === 'privacy') {
    const before = st.privacy;
    st.privacy = { mic: m.mic || [], cam: m.cam || [] };
    const newCam = st.privacy.cam.filter((a) => !before.cam.includes(a));
    const newMic = st.privacy.mic.filter((a) => !before.mic.includes(a));
    if (Date.now() - bootAt > 3000) {
      if (newCam.length) showToast({ kind: 'privacy', cam: true, title: 'Camera in use', sub: newCam.join(', '), color: '#30d158' });
      else if (newMic.length) showToast({ kind: 'privacy', title: 'Microphone in use', sub: newMic.join(', '), color: '#ff9f0a' });
    }
    render();
  }
});

function applyAccent() {
  if (!st.art) { document.documentElement.style.setProperty('--accent', '#fff'); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let best = [0, 0, 1], bestScore = -1;
    for (let i = 0; i < d.length; i += 4) {
      const hsl = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      const score = hsl[1] * (1 - Math.abs(hsl[2] - 0.55));
      if (score > bestScore) { bestScore = score; best = hsl; }
    }
    const [h, s] = best;
    document.documentElement.style.setProperty('--accent', s < 0.15 ? '#fff' : `hsl(${Math.round(h * 360)} ${Math.round(Math.min(1, s * 1.2) * 100)}% 68%)`);
  };
  img.src = st.art;
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

// Whether a battery exists comes from Windows (via the helper); the browser API alone
// can't tell a desktop apart from a laptop that is plugged in at 100%.
let hasBattery = null;
let batteryRef = null;
if (navigator.getBattery) {
  navigator.getBattery().then((b) => {
    batteryRef = b;
    const read = () => ({ level: b.level, charging: b.charging });
    const isDesktop = () => hasBattery === false || (hasBattery === null && b.charging && b.level === 1 && b.chargingTime === 0);
    st.battery = isDesktop() ? null : read();
    render();
    b.addEventListener('chargingchange', () => {
      if (isDesktop()) return;
      st.battery = read();
      showToast(b.charging
        ? { kind: 'battery', title: 'Charging', color: '#30d158' }
        : { kind: 'battery', title: 'On Battery', sub: 'Power adapter disconnected' });
      render();
    });
    b.addEventListener('levelchange', () => {
      if (isDesktop()) return;
      st.battery = read();
      if (!b.charging && b.level <= 0.2 && !lowWarned) { lowWarned = true; showToast({ kind: 'battery', title: 'Low Battery', sub: 'Plug in soon', color: '#ff453a', important: true }); }
      if (b.charging || b.level > 0.25) lowWarned = false;
      render();
    });
  });
}

render();
requestAnimationFrame(() => notch.classList.add('ready'));
api.ready();
