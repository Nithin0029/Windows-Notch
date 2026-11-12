// Settings window logic. All changes go through settingsApi.set(), which applies them in the main process
// immediately and answers with the new state (and an error message if something couldn't be applied).
const $ = (id) => document.getElementById(id);
let state = null;

const ICONS = {
  power: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v8M7 6.3a7.5 7.5 0 1 0 10 0"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.5 9.2v5.6c0 .6.4 1 1 1h2.8l4.4 3.7c.6.5 1.6.1 1.6-.8V5.3c0-.9-1-1.3-1.6-.8L7.3 8.2H4.5c-.6 0-1 .4-1 1z"/><path d="M16 9a4 4 0 0 1 0 6M18.6 6.4a7.6 7.6 0 0 1 0 11.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="4.5" width="14" height="17" rx="2.5"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5"/><path d="M8.5 11h7M8.5 15h5" stroke-linecap="round"/></svg>',
  display: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M9 20h6M12 16v4" stroke-linecap="round"/><path d="M10 4h4v1.5a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9" stroke-linecap="round"/></svg>',
  weather: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="9" cy="9" r="3.2"/><path d="M9 2.5v1.5M3.5 9H2M4.6 4.6l1 1M13.4 4.6l-1 1"/><path d="M8 19.5h9a3.5 3.5 0 0 0 .4-7 4.8 4.8 0 0 0-9.2 1.3A2.9 2.9 0 0 0 8 19.5z"/></svg>',
  update: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4.5h-4.5"/></svg>',
};
for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = ICONS[el.dataset.icon] || '';

async function set(key, value) {
  const res = await settingsApi.set(key, value);
  render(res.state);
  return res.error;
}

// ------------------------------------------------------------------ render
function render(s) {
  state = s;
  const st = s.settings;
  $('versionLine').textContent = `Version ${s.version}${s.packaged ? '' : ' · development build'}`;
  $('startWithWindows').checked = s.startWithWindows;
  $('volumeKeys').checked = st.volumeKeys;
  $('clipboard').checked = st.clipboard;

  // display picker
  const sel = $('display');
  const opts = [['primary', 'Main display'], ['all', `All displays (${s.displays.length})`],
    ...s.displays.map((d) => [`id:${d.id}`, `${d.label} · ${d.size}${d.primary ? ' (main)' : ''}`])];
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('');
  }
  sel.value = opts.some(([v]) => v === st.display) ? st.display : 'primary';
  sel.disabled = s.displays.length < 2 && st.display === 'primary';
  sel.title = sel.disabled ? 'Only one display is connected' : '';

  // shortcut
  $('shortcutEnabled').checked = st.shortcutEnabled;
  $('shortcutRow').classList.toggle('hidden', !st.shortcutEnabled);
  if (!recording) $('shortcutKeys').innerHTML = keycaps(st.shortcut);
  if (st.shortcutEnabled && !s.shortcutActive && !recording) {
    $('shortcutError').textContent = 'This shortcut is being used by another app, so it isn’t active. Pick a different one.';
    $('shortcutError').classList.remove('hidden');
  }

  // weather
  $('weatherEnabled').checked = st.weather.enabled;
  $('cityRow').classList.toggle('hidden', !st.weather.enabled);
  if (document.activeElement !== $('cityInput')) {
    $('cityInput').value = st.weather.city ? [st.weather.city.name, st.weather.city.region].filter(Boolean).join(', ') : '';
  }
  for (const b of document.querySelectorAll('#units button')) b.classList.toggle('on', b.dataset.units === st.weather.units);
  const wx = s.weather;
  const deg = st.weather.units === 'fahrenheit' ? '°F' : '°C';
  if (st.weather.city && wx && !wx.off && typeof wx.temp === 'number') {
    $('wxPreview').classList.remove('hidden');
    $('wxPreview').innerHTML = `${WeatherIcons.icon(wx.code, wx.isDay)}<div><div class="t">${wx.temp}${deg}</div>` +
      `<div class="m">${escapeHtml(WeatherIcons.label(wx.code))} · H ${wx.hi}° L ${wx.lo}° · ${escapeHtml(wx.place || '')}</div></div>`;
  } else if (st.weather.city) {
    $('wxPreview').classList.remove('hidden');
    $('wxPreview').innerHTML = `<div class="m">Getting the weather for ${escapeHtml(st.weather.city.name)}…</div>`;
  } else {
    $('wxPreview').classList.add('hidden');
  }

  // updates
  $('autoUpdate').checked = st.autoUpdate;
  renderUpdate(s.update, s.packaged);
}

function renderUpdate(u, packaged) {
  const dot = $('updDot'), text = $('updText'), btn = $('updBtn'), bar = $('updBar');
  dot.className = 'dot';
  bar.classList.add('hidden');
  btn.disabled = false;
  btn.className = '';
  btn.textContent = 'Check now';
  switch (u.status) {
    case 'dev':
      text.textContent = 'Updates work in the installed app (this is a development build).';
      btn.disabled = true;
      break;
    case 'checking':
      dot.classList.add('busy'); text.textContent = 'Checking for updates…'; btn.disabled = true;
      break;
    case 'downloading':
      dot.classList.add('busy'); text.textContent = `Downloading version ${u.version}… ${u.progress || 0}%`; btn.disabled = true;
      bar.classList.remove('hidden'); bar.firstElementChild.style.width = `${u.progress || 0}%`;
      break;
    case 'ready':
      dot.classList.add('ready'); text.textContent = `Version ${u.version} is ready. It installs when you quit, or restart now.`;
      btn.textContent = 'Restart & update'; btn.className = 'primary';
      break;
    case 'uptodate':
      dot.classList.add('ok'); text.textContent = `You're up to date${u.checkedAt ? ` · checked ${timeAgo(u.checkedAt)}` : ''}.`;
      break;
    case 'error':
      dot.classList.add('err'); text.textContent = u.error || 'Couldn’t check for updates.';
      break;
    default:
      text.textContent = packaged ? 'Not checked yet.' : 'Updates work in the installed app.';
  }
}

// ------------------------------------------------------------------ general / display
$('startWithWindows').addEventListener('change', (e) => set('startWithWindows', e.target.checked));
$('volumeKeys').addEventListener('change', (e) => set('volumeKeys', e.target.checked));
$('clipboard').addEventListener('change', (e) => set('clipboard', e.target.checked));
$('display').addEventListener('change', (e) => set('display', e.target.value));

// ------------------------------------------------------------------ shortcut recorder
let recording = false;
const NAMES = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };
function keycaps(acc) {
  if (!acc) return '<span class="note">None</span>';
  return acc.split('+').map((k) => `<kbd>${escapeHtml(NAMES[k] || k)}</kbd>`).join('<span class="plus">+</span>');
}
function keyFromCode(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^F(\d{1,2})$/.exec(code))) return `F${m[1]}`;
  const map = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Backquote: '`', Minus: '-', Equal: '=',
    BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };
  return map[code] || null;
}
function stopRecording() {
  recording = false;
  $('shortcutBtn').classList.remove('recording');
  $('shortcutHint').textContent = 'Click the button, then press the keys you want.';
  $('shortcutKeys').innerHTML = keycaps(state.settings.shortcut);
}
$('shortcutBtn').addEventListener('click', () => {
  if (recording) { stopRecording(); return; }
  recording = true;
  $('shortcutError').classList.add('hidden');
  $('shortcutBtn').classList.add('recording');
  $('shortcutKeys').innerHTML = '<span>Press keys…</span>';
  $('shortcutHint').textContent = 'Use Ctrl, Alt or Shift plus a key (or an F-key on its own). Esc cancels.';
});
window.addEventListener('keydown', async (e) => {
  if (!recording) return;
  e.preventDefault();
  if (e.code === 'Escape') { stopRecording(); return; }
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  const key = keyFromCode(e.code);
  if (!key) {   // just modifiers so far: show them while the user is still pressing
    $('shortcutKeys').innerHTML = mods.length ? keycaps(mods.join('+')) + '<span class="plus">+ …</span>' : '<span>Press keys…</span>';
    return;
  }
  const isFKey = /^F\d+$/.test(key);
  if (!mods.length && !isFKey) {
    $('shortcutError').textContent = 'Add Ctrl, Alt or Shift so the shortcut doesn’t get in the way of normal typing.';
    $('shortcutError').classList.remove('hidden');
    return;
  }
  if (mods.length === 1 && mods[0] === 'Shift' && !isFKey) {
    $('shortcutError').textContent = 'Shift plus a letter would block typing capitals. Add Ctrl or Alt.';
    $('shortcutError').classList.remove('hidden');
    return;
  }
  const acc = [...mods, key].join('+');
  recording = false;
  $('shortcutBtn').classList.remove('recording');
  $('shortcutHint').textContent = 'Click the button, then press the keys you want.';
  const err = await set('shortcut', acc);
  if (err) { $('shortcutError').textContent = err; $('shortcutError').classList.remove('hidden'); }
});
$('shortcutEnabled').addEventListener('change', async (e) => {
  const err = await set('shortcutEnabled', e.target.checked);
  $('shortcutError').classList.toggle('hidden', !err);
  if (err) $('shortcutError').textContent = err;
});
$('shortcutReset').addEventListener('click', () => { $('shortcutError').classList.add('hidden'); settingsApi.resetShortcut(); });

// ------------------------------------------------------------------ weather
$('weatherEnabled').addEventListener('change', (e) => set('weatherEnabled', e.target.checked));
for (const b of document.querySelectorAll('#units button')) b.addEventListener('click', () => set('weatherUnits', b.dataset.units));

let searchTimer = null, searchSeq = 0, results = [], activeIdx = -1;
function showResults(list) {
  results = list; activeIdx = list.length ? 0 : -1;
  const box = $('cityResults');
  if (!list.length) { box.classList.add('hidden'); return; }
  box.innerHTML = list.map((r, i) => `<div class="result${i === activeIdx ? ' active' : ''}" data-i="${i}"><b>${escapeHtml(r.name)}</b><span>${escapeHtml(r.region)}</span></div>`).join('');
  box.classList.remove('hidden');
}
async function pickCity(r) {
  $('cityResults').classList.add('hidden');
  $('cityInput').value = [r.name, r.region].filter(Boolean).join(', ');
  $('cityInput').blur();
  await set('weatherCity', r);
}
$('cityInput').addEventListener('input', () => {
  clearTimeout(searchTimer);
  $('cityError').classList.add('hidden');
  const q = $('cityInput').value.trim();
  if (q.length < 2) { showResults([]); return; }
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const res = await settingsApi.searchCity(q);
    if (seq !== searchSeq) return;                       // an older search finished late, ignore it
    if (res.error) { $('cityError').textContent = res.error; $('cityError').classList.remove('hidden'); showResults([]); return; }
    if (!res.results.length) { $('cityError').textContent = 'No places found with that name.'; $('cityError').classList.remove('hidden'); }
    showResults(res.results);
  }, 350);
});
$('cityInput').addEventListener('keydown', (e) => {
  if (!results.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
    for (const el of document.querySelectorAll('.result')) el.classList.toggle('active', Number(el.dataset.i) === activeIdx);
  } else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pickCity(results[activeIdx]); }
  else if (e.key === 'Escape') { showResults([]); }
});
$('cityResults').addEventListener('mousedown', (e) => {
  const el = e.target.closest('.result');
  if (el) { e.preventDefault(); pickCity(results[Number(el.dataset.i)]); }
});
$('cityInput').addEventListener('blur', () => setTimeout(() => { showResults([]); if (state) render(state); }, 150));

// ------------------------------------------------------------------ updates + links
$('autoUpdate').addEventListener('change', (e) => set('autoUpdate', e.target.checked));
$('updBtn').addEventListener('click', () => {
  if (state.update.status === 'ready') settingsApi.installUpdate(); else settingsApi.checkUpdates();
});
$('repoLink').addEventListener('click', () => window.open(state.repo));
$('releasesLink').addEventListener('click', () => window.open(`${state.repo}/releases`));

// ------------------------------------------------------------------ helpers & start
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}
settingsApi.onState((s) => render(s));
settingsApi.get().then(render);
setInterval(() => { if (state) renderUpdate(state.update, state.packaged); }, 30000);   // keep "checked x min ago" fresh
