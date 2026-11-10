// Notch renderer: compact notch, volume/brightness HUD, alerts, expanded panel.
const notch = document.getElementById('notch');
const L = { compact: document.getElementById('compact'), toast: document.getElementById('toast'), expanded: document.getElementById('expanded') };

const st = {
  media: null, art: null, battery: null, timer: null,
  volume: null,       // { level 0..1, muted }
  brightness: null,   // 0..100, null when the screen has no software brightness
  privacy: { mic: [], cam: [] },
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
  return `<div class="cin">${left}<span class="cr">${privacyDots()}${right}</span></div>`;
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
  return s ? `<div class="sliders">${s}</div>` : '';
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
    top = `<div class="clock"><div><div class="bigtime" id="e-time"></div><div class="date" id="e-date"></div></div>${batteryRing()}</div>`;
  }
  const trow = st.timer
    ? `<div class="trow"><span class="tl">${ICON.timer}<span id="e-timer"></span> remaining</span><div class="chips"><button class="chip warn" data-act="cancel-timer">Cancel</button></div></div>`
    : `<div class="trow"><span class="tl">${ICON.timer}Timer</span><div class="chips">${[1, 5, 15, 25].map((n) => `<button class="chip" data-timer="${n}">${n}m</button>`).join('')}</div>${m ? batteryChip() : ''}</div>`;
  return `<div class="exp">${top}${slidersHTML()}${trow}</div>`;
}

// ------------------------------------------------------------ render
function render() {
  const state = st.expanded ? 'expanded' : st.toast ? 'toast' : 'compact';
  const m = st.media, b = st.battery, p = st.privacy;
  const key = [state, m && m.track, m && m.status, m && m.dur > 0, st.art && st.art.length, !!st.timer,
    b && b.charging, b && Math.round(b.level * 100), st.toast && st.toast.id, p.mic.length > 0, p.cam.length > 0,
    !!st.volume, st.brightness !== null].join('|');
  if (key !== lastKey) {
    lastKey = key;
    const layer = L[state];
    layer.innerHTML = state === 'compact' ? compactHTML() : state === 'toast' ? toastHTML(st.toast) : expandedHTML();
    for (const k in L) L[k].classList.toggle('on', k === state);
    let w, h, r;
    if (state === 'compact') {
      w = (m || st.timer) ? 244 : 204;
      if (p.mic.length || p.cam.length) w += 18;
      h = 34; r = 14;
    } else if (state === 'toast') {
      if (HUD_KINDS.has(st.toast.kind)) { w = 330; h = 34; r = 14; }
      else { w = 360; h = 60; r = 22; }
    } else { w = 400; h = layer.firstElementChild.offsetHeight; r = 30; }
    notch.style.width = w + 'px';
    notch.style.height = h + 'px';
    document.getElementById('body').style.borderRadius = `0 0 ${r}px ${r}px`;
    notch.dataset.state = state;
    notch.classList.toggle('lift', state === 'compact' && st.hover);
  }
  tick();
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
  setText('c-time', shortTime());
  setText('c-date', new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric' }));
  setText('e-time', shortTime());
  setText('e-date', new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
  if (st.timer) {
    const left = (st.timer.end - Date.now()) / 1000;
    if (left <= 0) { finishTimer(); return; }
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
  api.setIgnore(!v);
  notch.classList.toggle('lift', v && notch.dataset.state === 'compact');
  clearTimeout(collapseTimer);
  if (!v && st.expanded && !dragging) collapseTimer = setTimeout(() => { st.expanded = false; render(); }, 900);
}
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setHover(!!(el && el.closest('#notch')) || !!dragging);
  if (dragging) dragSlider(e);
});
document.addEventListener('mouseleave', () => { if (!dragging) setHover(false); });

// scroll anywhere on the notch = change volume
let wheelAcc = 0;
notch.addEventListener('wheel', (e) => {
  e.preventDefault();
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

notch.addEventListener('click', (e) => {
  if (suppressClick || e.target.closest('[data-slider]')) return;
  const btn = e.target.closest('button');
  if (btn) {
    e.stopPropagation();
    if (btn.dataset.timer) return startTimer(Number(btn.dataset.timer));
    const act = btn.dataset.act;
    if (act === 'cancel-timer') { st.timer = null; render(); return; }
    if (act) {
      api.media(act);
      if (act === 'toggle' && st.media) { st.media.pos = mediaPos(); st.media.updated = Date.now(); st.media.status = playing() ? 'Paused' : 'Playing'; render(); }
    }
    return;
  }
  if (st.toast) { clearTimeout(toastTimer); st.toast = null; st.queue = []; }
  st.expanded = !st.expanded;
  render();
});

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
