# Windows-Notch

A MacBook-style **notch** for Windows. It sits at the top centre of your screen, shows what's going on, and gets out of the way when it isn't needed.

![Windows Notch in its different states: idle, now playing, volume bar, file drop zone, and the open panel](docs/screenshot.png)

## Features

- **The notch itself:** sits flush with the top edge of the screen, with curved "shoulders" and smooth animations as it grows and shrinks.
- **Idle:** time on the left, battery on the right (green while charging, red when low).
- **Now playing:** album art and a waveform tinted to match the cover. Works with Spotify, YouTube in Chrome or Edge, Media Player, and anything else that uses Windows media controls.
- **Volume and brightness bar:** the notch widens to show the level whenever volume or brightness changes. Scroll over the notch to change the volume.
- **Volume keys:** the notch takes over your keyboard's volume keys, so the Windows volume pop-up no longer appears. You can turn this off from the tray menu, and the keys go back to Windows while a fullscreen app is in front.
- **File Shelf:** drag files or folders from File Explorer onto the notch to park them there. Open the panel to find them again:
  - drag a file out to drop it into any app
  - double-click to open it
  - right-click to show it in its folder
  - × to remove it

  Files are never moved or copied; the Shelf only remembers where they are.
- **Privacy dots:** an orange dot shows while an app uses the microphone, a green dot while it uses the camera, and a short alert names the app.
- **Alerts:** track changes, charger plugged in or unplugged, low battery, timer finished.
- **Quick toggles:** one-click **Wi‑Fi**, **Bluetooth**, **microphone mute** and **dark/light mode**, right in the panel.
- **Clipboard history:** your last 15 copied texts. Click one to copy it again.
  - It's kept in memory only, never saved to disk.
  - Passwords that password managers mark as private are skipped.
  - You can turn it off in the tray menu.

  <img src="docs/clipboard.png" width="380" alt="Clipboard history page in the notch panel">
- **Panel (click the notch; move the pointer away or click the notch again to close it):**
  - media controls with a progress bar, or a big clock, the date and a battery ring when nothing is playing
  - quick toggles
  - volume and brightness sliders
  - your Shelf
  - quick timers (1, 5, 15, 25 minutes) and the clipboard button
- **Fullscreen aware:** the notch hides while a game or video is fullscreen.
- **Stays out of the way:** the window is shaped to the notch itself, so everything around it stays clickable.

## Download

1. Get the latest **`Windows-Notch-Setup-x.y.z.exe`** from the [Releases page](https://github.com/Nithin0029/Windows-Notch/releases).
2. Run it. It installs for your user only (no admin needed) and starts the notch straight away.

The notch starts with Windows automatically. To change that, right-click its tray icon. To uninstall, go to **Settings → Apps → Installed apps → Windows Notch**.

> **"Windows protected your PC"?** The installer isn't code-signed (that costs money), so SmartScreen warns about it the first time. Click **More info → Run anyway**.

Right-click the tray icon to:
- quit or reload the notch
- clear the Shelf
- turn the volume-key takeover on or off
- turn clipboard history on or off
- turn **Start with Windows** on or off

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

### Build the installer

```bash
npm run dist
```

This creates `dist/Windows-Notch-Setup-<version>.exe`. To publish a new version:
1. Raise `"version"` in `package.json`.
2. Run the build.
3. Attach the `.exe` to a new GitHub Release.

## How it works

| File | What it does |
|---|---|
| `main.js` | Electron main process: a transparent, always-on-top window shaped to the notch, the volume keys, the Shelf and the tray menu |
| `notch.html` / `notch.js` | The notch UI and all its states (idle, alert, volume bar, panel, drop zone) |
| `preload.js` | A small, safe bridge between the UI and the main process |
| `build/icon.png` | The app icon, used by the installer |
| `helper.ps1` | A background PowerShell process that talks to Windows (see below) |

`helper.ps1` reads these from Windows:
- now playing, through the WinRT media controls
- volume, through Core Audio
- brightness, through WMI
- which apps are using the mic or camera, through Windows' privacy records
- whether the PC has a battery
- whether a fullscreen app is in front
- Wi‑Fi and Bluetooth state, through WinRT radios, plus mic mute and dark mode (it also switches them)

It sends JSON lines to the main process, and has no extra dependencies to install.

## Roadmap

- [x] Hide the built-in Windows volume pop-up
- [x] File shelf: drop files into the notch, then drag them out later
- [x] Clipboard history
- [x] Quick toggles: Wi‑Fi, Bluetooth, mic mute, dark mode
- [ ] Do Not Disturb / Focus toggle (Windows has no public API for it yet)
- [ ] Auto-update from GitHub Releases
- [ ] Calendar: "next meeting in 5 min"
- [x] Packaged installer (`.exe`)

## License

[MIT](LICENSE) © Nithin0029
