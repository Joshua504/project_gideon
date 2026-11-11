# Desktop Mascot Companion

A small, blocky desktop mascot companion built with Electron and plain HTML/CSS/JavaScript. It lives on top of your screen, follows your cursor with expressive eyes, and includes a built-in focus timer and live theme customization.

## Project Structure

```text
desktop-mascot/
├── package.json          # Project metadata, scripts, and Electron dependency
├── main.js               # Main process: window management, cursor polling, IPC, notifications
├── preload.js            # Context-isolated bridge exposing window.mascotAPI
├── settings.js           # Settings schema and JSON persistence in app userData directory
└── renderer/
    ├── index.html        # Mascot inline SVG (swappable expressions) and popup menu markup
    ├── styles.css        # CSS variables (--body, --shade, --eye-white, --pupil) and styling
    └── app.js            # Cursor angle math, lerp loop, click-through hit-testing, timer, drag
```

## Setup & Run Instructions

```bash
cd /home/gamp/desktop-mascot
npm install
npm start
```

Settings are automatically persisted to Electron's `userData` directory (`~/.config/desktop-mascot-companion/settings.json` on Linux, `~/Library/Application Support/desktop-mascot-companion/settings.json` on macOS, or `%APPDATA%\desktop-mascot-companion\settings.json` on Windows).
