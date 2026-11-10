# Windows-Notch

A MacBook-style **notch** for Windows. It sits at the top centre of your screen, shows what's going on, and gets out of the way when it isn't needed.

<!-- Add a screenshot or GIF here, e.g. ![windows-notch](docs/demo.gif) -->

## Features

- **The notch itself:** sits flush with the top edge of the screen, with curved "shoulders" and smooth animations as it grows and shrinks.
- **Idle:** time on the left, battery on the right (green while charging, red when low).
- **Now playing:** album art and a waveform tinted to match the cover. Works with Spotify, YouTube in Chrome or Edge, Media Player, and anything else that uses Windows media controls.
- **Volume and brightness bar:** the notch widens to show the level whenever volume or brightness changes. Scroll over the notch to change the volume.
- **Privacy dots:** an orange dot shows while an app uses the microphone, a green dot while it uses the camera, and a short alert names the app.
- **Alerts:** track changes, charger plugged in or unplugged, low battery, timer finished.
- **Panel (click the notch):**
  - media controls with a progress bar, or a big clock, the date and a battery ring when nothing is playing
  - volume and brightness sliders
  - quick timers (1, 5, 15, 25 minutes)
- **Fullscreen aware:** the notch hides while a game or video is fullscreen.
- **Click-through:** everything outside the notch passes clicks to the windows underneath.

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 18 or later
- Brightness control only works on built-in laptop screens.

## Getting started

```bash
git clone https://github.com/Nithin0029/windows-notch.git
cd windows-notch
npm install
npm start
```

After installing, you can also double-click **`Start Notch.cmd`** to launch it without a terminal.

Right-click the tray icon to quit, reload, or turn on **Start with Windows**.

## How it works

| File | What it does |
|---|---|
| `main.js` | Electron main process: a transparent, always-on-top, click-through window, plus the tray menu |
| `notch.html` / `notch.js` | The notch UI and all its states (idle, alert, volume bar, panel) |
| `preload.js` | A small, safe bridge between the UI and the main process |
| `helper.ps1` | A background PowerShell process that talks to Windows (see below) |

`helper.ps1` reads these from Windows:
- now playing, through the WinRT media controls
- volume, through Core Audio
- brightness, through WMI
- which apps are using the mic or camera, through Windows' privacy records
- whether the PC has a battery
- whether a fullscreen app is in front

It sends JSON lines to the main process, and has no extra dependencies to install.

## Roadmap

- [ ] Hide the built-in Windows volume pop-up
- [ ] File shelf: drop files into the notch, then drag them out later
- [ ] Clipboard history
- [ ] Quick controls: Wi‑Fi, Bluetooth, Focus
- [ ] Calendar: "next meeting in 5 min"
- [ ] Packaged installer (`.exe`)

## License

[MIT](LICENSE) © Nithin0029
