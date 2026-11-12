# Windows-Notch

A MacBook-style **notch** for Windows. It sits at the top centre of your screen, shows what's going on, and gets out of the way when it isn't needed.

![Windows Notch in its different states: idle, now playing, volume bar, file drop zone, and the open panel](docs/screenshot.png)

## Features

- **The notch itself:** sits flush with the top edge of the screen, with curved "shoulders" and smooth animations as it grows and shrinks.
- **Idle:** time on the left, battery on the right (green while charging, red when low).
- **Now playing:** album art and a waveform tinted to match the cover. Works with Spotify, YouTube in Chrome or Edge, Media Player, and anything else that uses Windows media controls.
- **Volume and brightness bar:** the notch widens to show the level whenever volume or brightness changes. Scroll over the notch to change the volume.
- **Volume keys:** the notch takes over your keyboard's volume keys, so the Windows volume pop-up no longer appears. The keys go back to Windows while a fullscreen app is in front.
- **File Shelf:** drag files or folders from File Explorer onto the notch to park them there. Open the panel to find them again:
  - drag a file out to drop it into any app
  - double-click to open it
  - right-click to show it in its folder
  - × to remove it

  Files are never moved or copied; the Shelf only remembers where they are.
- **Quick toggles:** one-click **Wi‑Fi**, **Bluetooth**, **microphone mute** and **dark/light mode**, right in the panel.
- **Weather:** current conditions with today's high and low, next to the clock. Pick your city in Settings.
- **Clipboard history:** your last 15 copied texts. Click one to copy it again.
  - It's kept in memory only, never saved to disk.
  - Passwords that password managers mark as private are skipped.

  <img src="docs/clipboard.png" width="380" alt="Clipboard history page in the notch panel">
- **Privacy dots:** an orange dot shows while an app uses the microphone, a green dot while it uses the camera, and a short alert names the app.
- **Alerts:** track changes, charger plugged in or unplugged, low battery, timer finished, update ready.
- **Keyboard shortcut:** **Ctrl + Alt + N** opens the panel on the screen your mouse is on. You can change it in Settings.
- **Multiple monitors:** show the notch on your main screen, on every screen, or on one you choose. A fullscreen app hides only its own screen's notch.
- **Auto-update:** new versions download in the background from GitHub Releases and install the next time the app quits.
- **Panel (click the notch; move the pointer away or click the notch again to close it):**
  - media controls with a progress bar, or a big clock, the date, the weather and a battery ring when nothing is playing
  - quick toggles
  - volume and brightness sliders
  - your Shelf
  - quick timers (1, 5, 15, 25 minutes), clipboard history and ⚙ Settings
- **Stays out of the way:** the window is shaped to the notch itself, so everything around it stays clickable.

## Settings

Open Settings in any of these ways:
- with the ⚙ button in the panel
- by clicking the tray icon
- by launching **Windows Notch** again from the Start menu

![Windows Notch Settings window](docs/settings.png)

| Section | Options |
|---|---|
| **General** | Start with Windows, use the notch for volume keys, clipboard history |
| **Display** | Main display, all displays, or a specific display |
| **Keyboard shortcut** | On/off, plus a recorder to choose your own keys |
| **Weather** | On/off, city search, °C / °F |
| **Updates** | Update automatically, Check now, Restart & update |

Weather comes from [Open-Meteo](https://open-meteo.com/) (free, no account). Only the city name you search for and that city's coordinates are sent.

## Download

1. Get the latest **`Windows-Notch-Setup-x.y.z.exe`** from the [Releases page](https://github.com/Nithin0029/Windows-Notch/releases).
2. Run it. It installs for your user only (no admin needed) and starts the notch straight away. From then on it updates itself.

The notch starts with Windows automatically; you can change that in Settings. To uninstall, go to **Windows Settings → Apps → Installed apps → Windows Notch**.

> **"Windows protected your PC"?** The installer isn't code-signed (that costs money), so SmartScreen warns about it the first time. Click **More info → Run anyway**.

> **Coming from 0.1.0 or 0.2.0?** Those versions can't update themselves, so install the latest one by hand once. Updates are automatic after that.

Brightness control only works on built-in laptop screens.

## Run from source

You need Windows 10 or 11 and [Node.js](https://nodejs.org/) 18 or later.

```bash
git clone https://github.com/Nithin0029/Windows-Notch.git
cd Windows-Notch
npm install
npm start
```

After installing, you can also double-click **`Start Notch.cmd`** to launch it without a terminal.

### Publishing a release (so auto-update works)

1. Raise `"version"` in `package.json` (for example `0.3.0` → `0.3.1`), then commit and push.
2. Run the build:

   ```bash
   npm run dist
   ```

3. On GitHub, create a release with the tag `v<version>`, for example `v0.3.1`, and attach **both** of these files from `dist/`:
   - `Windows-Notch-Setup-<version>.exe`
   - `latest.yml`

   Optionally attach the `.blockmap` too, which allows smaller downloads.
4. Publish it as a **normal release**, not Pre-release. Installed apps ignore pre-releases.

## How it works

| File | What it does |
|---|---|
| `main.js` | Electron main process: one transparent, always-on-top notch window per chosen display (shaped to the notch), volume keys, keyboard shortcut, Shelf, clipboard, weather, tray, Settings |
| `notch.html` / `notch.js` | The notch UI and all its states (idle, alert, volume bar, panel, drop zone, clipboard page) |
| `settings.html` / `settings.js` | The Settings window |
| `preload.js` / `preload-settings.js` | Small, explicit bridges between each page and the main process |
| `weather.js` / `weather-icons.js` | Open-Meteo city search and forecast, plus weather icons |
| `updater.js` | Auto-update from GitHub Releases (electron-updater) |
| `helper.ps1` | A background PowerShell process that talks to Windows (see below) |
| `build/icon.png` | The app icon |

`helper.ps1` reads these from Windows:
- now playing, through the WinRT media controls
- volume, through Core Audio
- brightness, through WMI
- which apps are using the mic or camera, through Windows' privacy records
- whether the PC has a battery
- which monitor has a fullscreen app in front
- Wi‑Fi and Bluetooth state, through WinRT radios, plus mic mute and dark mode (it also switches them)

It sends JSON lines to the main process, and has no extra dependencies to install.

## Roadmap

- [x] Hide the built-in Windows volume pop-up
- [x] File Shelf: drop files into the notch, then drag them out later
- [x] Clipboard history
- [x] Quick toggles: Wi‑Fi, Bluetooth, mic mute, dark mode
- [x] Packaged installer (`.exe`)
- [x] Settings window
- [x] Multiple monitors
- [x] Keyboard shortcut
- [x] Weather
- [x] Auto-update from GitHub Releases
- [ ] Do Not Disturb / Focus toggle (Windows has no public API for it yet)
- [ ] Calendar: "next meeting in 5 min"

## License

[MIT](LICENSE) © Nithin0029
