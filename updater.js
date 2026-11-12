// Auto-update from GitHub Releases (electron-updater).
// Each release needs the installer .exe and the latest.yml that `npm run dist` creates in dist/.
const { app } = require('electron');

let autoUpdater = null;
let listener = () => {};
const state = { status: 'idle', version: null, progress: 0, error: null, checkedAt: null };
// status: 'dev' | 'idle' | 'checking' | 'downloading' | 'ready' | 'uptodate' | 'error'

function set(patch) {
  Object.assign(state, patch);
  listener({ ...state });
}

function friendlyError(err) {
  const msg = String((err && err.message) || err || 'Unknown error');
  if (/No published versions/i.test(msg)) return 'No regular release on GitHub yet (pre-releases are skipped).';
  if (/latest\.yml|404|Cannot find channel/i.test(msg)) return 'The newest GitHub release has no update info (latest.yml isn’t attached).';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_|network/i.test(msg)) return 'Couldn’t reach GitHub. Check your internet connection.';
  if (/rate limit/i.test(msg)) return 'GitHub is rate-limiting update checks. Try again later.';
  return msg.split('\n')[0].slice(0, 200);
}

function init(onChange) {
  listener = onChange || listener;
  if (!app.isPackaged) { set({ status: 'dev' }); return; }   // updates only apply to the installed app
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;            // download in the background…
  autoUpdater.autoInstallOnAppQuit = true;    // …and install the next time the app quits
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ status: 'uptodate', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version, progress: 100, checkedAt: Date.now() }));
  autoUpdater.on('error', (err) => set({ status: 'error', error: friendlyError(err), checkedAt: Date.now() }));
}

function check() {
  if (!autoUpdater) { set({ status: 'dev' }); return; }
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'ready') return;
  autoUpdater.checkForUpdates().catch((err) => {
    // the 'error' event usually reports the same failure first; only report it here if it didn't
    if (state.status !== 'error') set({ status: 'error', error: friendlyError(err), checkedAt: Date.now() });
  });
}

/** Quit now and install the downloaded update (the app restarts afterwards). */
function installNow() {
  if (autoUpdater && state.status === 'ready') autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, installNow, getState: () => ({ ...state }) };
