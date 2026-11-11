# windows-notch

A MacBook-style **notch** for Windows. It sits at the top centre of your screen, shows what's going on, and gets out of the way when it isn't needed.

<!-- Add a screenshot or GIF here, e.g. ![windows-notch](docs/demo.gif) -->

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
- **Panel (click the notch; move the pointer away or click the notch again to close it):**
  - media controls with a progress bar, or a big clock, the date and a battery ring when nothing is playing
  - volume and brightness sliders
  - your Shelf
  - quick timers (1, 5, 15, 25 minutes)
- **Fullscreen aware:** the notch hides while a game or video is fullscreen.
- **Stays out of the way:** the window is shaped to the notch itself, so everything around it stays clickable.

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

Right-click the tray icon to quit, reload, clear the Shelf, turn the volume-key takeover on or off, or turn on **Start with Windows**.

## How it works

| File | What it does |
|---|---|
| `main.js` | Electron main process: a transparent, always-on-top window shaped to the notch, the volume keys, the Shelf and the tray menu |
| `notch.html` / `notch.js` | The notch UI and all its states (idle, alert, volume bar, panel, drop zone) |
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

- [x] Hide the built-in Windows volume pop-up
- [x] File shelf: drop files into the notch, then drag them out later
- [ ] Clipboard history
- [ ] Quick controls: Wi‑Fi, Bluetooth, Focus
- [ ] Calendar: "next meeting in 5 min"
- [ ] Packaged installer (`.exe`)

## License

[MIT](LICENSE) © Nithin0029
