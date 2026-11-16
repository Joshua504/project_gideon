const {
  app,
  BrowserWindow,
  screen,
  ipcMain,
  Notification,
  powerMonitor,
  clipboard,
  net,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { loadSettings, saveSettings } = require('./settings');

const WINDOW_WIDTH = 500;
const WINDOW_HEIGHT = 500;
const CURSOR_POLL_INTERVAL_MS = 16;
const WAYLAND_HOLE_RADIUS = 20;

let mainWindow = null;
let sensorWindow = null;
let settings = null;
let cursorPollTimer = null;
let statusPollTimer = null;
let gravityTimer = null;
let lastCursorPos = { x: null, y: null };
let lastPowerState = { isCharging: null, level: null };
let lastAudioPlaying = null;
let lastTelemetry = { isHighLoad: null, isOnline: null, cpuLoadPct: 0, memUsedPct: 0 };
let lastFocusedApp = { category: 'other', name: '' };
let registeredShortcut = null;
let voiceActivationProcess = null;
let isIgnoringMouse = false;

let currentWinPos = { x: 0, y: 0 };
let dragSession = {
  active: false,
  startCursorX: 0,
  startCursorY: 0,
  startMascotX: 0,
  startMascotY: 0,
};

// Live screen coordinates of the mascot's top-left corner and its offset inside the 500x500 window
let mascotState = {
  screenX: 0,
  screenY: 0,
  inWinX: 350,
  inWinY: 374,
  peekEdge: null, // 'left' | 'right' | null
};

const isWaylandSession =
  process.platform === 'linux' &&
  (process.env.XDG_SESSION_TYPE === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY));

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.commandLine.appendSwitch('log-level', '3');
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-features', 'VaapiVideoDecode,VaapiVideoEncoder');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('enable-speech-dispatcher');
  app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
}

function getMascotSizePx() {
  if (!settings) return 120;
  return settings.size === 'large' ? 148 : settings.size === 'small' ? 96 : 120;
}

/**
 * Computes the usable screen bounds for the mascot (allows full left-to-right edge travel).
 */
function getDisplayAreaForPoint(pt) {
  const display =
    (pt && screen.getDisplayNearestPoint(pt)) || screen.getPrimaryDisplay();
  return {
    bounds: display.bounds,
    workArea: display.workArea,
  };
}

/**
 * Positions the mascot at `(targetScreenX, targetScreenY)` on screen.
 * Moves `mainWindow` as far as the OS/Window Manager allows, and dynamically adjusts
 * `(inWinX, inWinY)` inside the 500x500 window so the mascot can reach 100% of the
 * left, right, top, and bottom screen edges even when XWayland/Mutter clamps window coords!
 */
function applyMascotScreenPosition(targetScreenX, targetScreenY) {
  const mascotSize = getMascotSizePx();
  const { workArea } = getDisplayAreaForPoint({
    x: Math.round(targetScreenX),
    y: Math.round(targetScreenY),
  });

  // Full horizontal & vertical range across the display's usable workArea
  const minScreenX = workArea.x;
  const maxScreenX = workArea.x + workArea.width - mascotSize;
  const minScreenY = workArea.y;
  const maxScreenY = workArea.y + workArea.height - mascotSize;

  const clampedScreenX = Math.max(minScreenX, Math.min(maxScreenX, Math.round(targetScreenX)));
  const clampedScreenY = Math.max(minScreenY, Math.min(maxScreenY, Math.round(targetScreenY)));

  // Keep 26px margin on the right normally so the mascot only hits `inWinX = WINDOW_WIDTH - mascotSize`
  // when dragged all the way to the right screen edge.
  const defaultInWinX = WINDOW_WIDTH - mascotSize - 26;
  const defaultInWinY = WINDOW_HEIGHT - mascotSize - 6;

  const minWinX = workArea.x;
  const maxWinX = workArea.x + workArea.width - WINDOW_WIDTH;
  const minWinY = workArea.y;
  const maxWinY = workArea.y + workArea.height - WINDOW_HEIGHT;

  const desiredWinX = Math.round(Math.max(minWinX, Math.min(maxWinX, clampedScreenX - defaultInWinX)));
  const desiredWinY = Math.round(Math.max(minWinY, Math.min(maxWinY, clampedScreenY - defaultInWinY)));

  currentWinPos = { x: desiredWinX, y: desiredWinY };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setPosition(desiredWinX, desiredWinY);
  }

  // Exact offset of the mascot inside the 500x500 window:
  // - At the left screen edge (`clampedScreenX === minScreenX`), `inWinX === 0`
  // - At the right screen edge (`clampedScreenX === maxScreenX`), `inWinX === WINDOW_WIDTH - mascotSize`
  let inWinX = Math.max(0, Math.min(WINDOW_WIDTH - mascotSize, clampedScreenX - desiredWinX));
  const inWinY = Math.max(0, Math.min(WINDOW_HEIGHT - mascotSize, clampedScreenY - desiredWinY));

  // Trigger 90° Peek-a-Boo when dragged within 44px of the left or right screen edge,
  // and snap `inWinX` flush to the window edge (`0` or `WINDOW_WIDTH - mascotSize`) so half the body hides!
  let peekEdge = null;
  if (clampedScreenX <= minScreenX + 44) {
    peekEdge = 'left';
    inWinX = 0;
  } else if (clampedScreenX >= maxScreenX - 44) {
    peekEdge = 'right';
    inWinX = WINDOW_WIDTH - mascotSize;
  }

  mascotState = {
    screenX: clampedScreenX,
    screenY: clampedScreenY,
    inWinX,
    inWinY,
    peekEdge,
  };

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('window:mascot-layout', mascotState);
  }

  return mascotState;
}

/**
 * Computes default bottom-right screen position for the mascot on first launch.
 */
function getInitialMascotScreenPos() {
  const mascotSize = getMascotSizePx();
  const primary = screen.getPrimaryDisplay();
  const { workArea } = primary;

  if (
    settings &&
    settings.mascotScreenPos &&
    typeof settings.mascotScreenPos.x === 'number' &&
    typeof settings.mascotScreenPos.y === 'number'
  ) {
    return settings.mascotScreenPos;
  }

  return {
    x: Math.round(workArea.x + workArea.width - mascotSize - 56),
    y: Math.round(workArea.y + workArea.height - mascotSize - 6),
  };
}

/**
 * Reads system battery/charging status via Linux sysfs or Electron powerMonitor.
 */
function readPowerStatus() {
  try {
    if (process.platform === 'linux') {
      const supplyDir = '/sys/class/power_supply';
      if (fs.existsSync(supplyDir)) {
        const entries = fs.readdirSync(supplyDir);
        let isCharging = false;
        let level = null;

        for (const name of entries) {
          const base = path.join(supplyDir, name);
          const statusPath = path.join(base, 'status');
          const onlinePath = path.join(base, 'online');
          const capPath = path.join(base, 'capacity');

          if (fs.existsSync(statusPath)) {
            const st = fs.readFileSync(statusPath, 'utf-8').trim().toLowerCase();
            if (st === 'charging' || st === 'full') {
              isCharging = true;
            }
          }
          if (fs.existsSync(onlinePath) && /^(ac|acad|adp|ucsi)/i.test(name)) {
            const online = fs.readFileSync(onlinePath, 'utf-8').trim();
            if (online === '1') {
              isCharging = true;
            }
          }
          if (level === null && fs.existsSync(capPath)) {
            const cap = parseInt(fs.readFileSync(capPath, 'utf-8').trim(), 10);
            if (!Number.isNaN(cap)) level = cap;
          }
        }
        return { isCharging, level };
      }
    }

    if (powerMonitor && typeof powerMonitor.isOnBatteryPower === 'function') {
      return {
        isCharging: !powerMonitor.isOnBatteryPower(),
        level: null,
      };
    }
  } catch (_err) {
    // Ignore read errors
  }
  return { isCharging: false, level: null };
}

/**
 * Checks if any audio stream is actively playing on the system (Linux /proc/asound PCM status).
 */
function readAudioPlayingStatus() {
  try {
    if (process.platform === 'linux') {
      const asoundDir = '/proc/asound';
      if (fs.existsSync(asoundDir)) {
        const cards = fs.readdirSync(asoundDir).filter((n) => /^card\d+$/.test(n));
        for (const card of cards) {
          const cardPath = path.join(asoundDir, card);
          const pcmDirs = fs.readdirSync(cardPath).filter((n) => /^pcm\d+p$/.test(n));
          for (const pcm of pcmDirs) {
            const pcmPath = path.join(cardPath, pcm);
            const subDirs = fs.readdirSync(pcmPath).filter((n) => /^sub\d+$/.test(n));
            for (const sub of subDirs) {
              const statusFile = path.join(pcmPath, sub, 'status');
              if (fs.existsSync(statusFile)) {
                const content = fs.readFileSync(statusFile, 'utf-8');
                if (/state:\s*RUNNING/i.test(content)) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  } catch (_err) {
    // Ignore errors
  }
  return false;
}

/**
 * Reads CPU load, RAM usage, and Wi-Fi / network online status for Laptop Awareness.
 */
function readSystemTelemetry() {
  let cpuLoadPct = 0;
  let memUsedPct = 0;
  let isHighLoad = false;
  let isOnline = true;

  try {
    const cpuCount = Math.max(1, (os.cpus() || []).length);
    const load1m = os.loadavg()[0] || 0;
    cpuLoadPct = Math.min(100, Math.round((load1m / cpuCount) * 100));

    const totalMem = os.totalmem() || 1;
    const freeMem = os.freemem() || 0;
    memUsedPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

    isHighLoad = cpuLoadPct >= 78 || memUsedPct >= 88;
  } catch (_err) {
    // Ignore
  }

  try {
    if (process.platform === 'linux' && fs.existsSync('/sys/class/net')) {
      const ifaces = fs.readdirSync('/sys/class/net').filter((n) => n !== 'lo');
      if (ifaces.length > 0) {
        let anyUp = false;
        for (const iface of ifaces) {
          const operPath = path.join('/sys/class/net', iface, 'operstate');
          const carrierPath = path.join('/sys/class/net', iface, 'carrier');
          if (fs.existsSync(operPath)) {
            const st = fs.readFileSync(operPath, 'utf-8').trim().toLowerCase();
            if (st === 'up') {
              anyUp = true;
              break;
            }
          }
          if (fs.existsSync(carrierPath)) {
            const c = fs.readFileSync(carrierPath, 'utf-8').trim();
            if (c === '1') {
              anyUp = true;
              break;
            }
          }
        }
        isOnline = anyUp;
      }
    } else if (net && typeof net.isOnline === 'function') {
      isOnline = net.isOnline();
    }
  } catch (_err) {
    // Ignore
  }

  return { isHighLoad, isOnline, cpuLoadPct, memUsedPct };
}

/**
 * Detects the currently focused application and categorizes it.
 * Categories: 'coding', 'gaming', 'video', 'browsing', 'music', 'terminal', 'messaging', 'other'
 * Uses /proc on Linux and process name heuristics.
 */
function readFocusedApp() {
  let name = '';
  let category = 'other';

  try {
    // Linux: try to read the active window's process via xprop or /proc
    if (process.platform === 'linux') {
      // Method 1: Use xprop to get the WM_CLIENT_MACHINE and _NET_WM_PID
      const { execSync } = require('child_process');
      try {
        const pid = execSync(
          'xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk \'{print $5}\'',
          { encoding: 'utf-8', timeout: 2000 }
        ).trim();
        if (pid && pid !== '0x0') {
          const decPid = parseInt(pid, 16);
          if (!Number.isNaN(decPid) && decPid > 1) {
            const commPath = `/proc/${decPid}/comm`;
            if (fs.existsSync(commPath)) {
              name = fs.readFileSync(commPath, 'utf-8').trim().toLowerCase();
            }
            // Fallback: read cmdline for more info
            if (!name) {
              const cmdlinePath = `/proc/${decPid}/cmdline`;
              if (fs.existsSync(cmdlinePath)) {
                const cmdline = fs.readFileSync(cmdlinePath, 'utf-8').split('\0').join(' ').toLowerCase();
                // Extract the first executable name
                const parts = cmdline.split(/\s+/);
                for (const part of parts) {
                  const base = part.split('/').pop();
                  if (base && base.length > 1 && !base.startsWith('-')) {
                    name = base.toLowerCase();
                    break;
                  }
                }
              }
            }
          }
        }
      } catch (_e) {
        // xprop not available or failed — fall through to process scanning
      }

      // Method 2: Fallback — scan known running processes by name
      if (!name) {
        try {
          const { execSync } = require('child_process');
          const procs = execSync(
            'ps -eo pid,comm --sort=-start_time --no-headers 2>/dev/null | head -30',
            { encoding: 'utf-8', timeout: 2000 }
          ).trim();
          // Get the most recently started foreground process (heuristic)
          const lines = procs.split('\n').map(l => l.trim()).filter(l => l);
          for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
              const procName = parts[parts.length - 1].toLowerCase();
              if (procName && procName !== 'ps' && procName !== 'bash') {
                name = procName;
                break;
              }
            }
          }
        } catch (_e2) { /* ignore */ }
      }
    }

    // Method 3: Cross-platform fallback — scan all processes for known apps
    if (!name) {
      const allCpus = os.cpus();
      // On non-Linux, we can at least check os.availableParallelism
      name = '';
    }

    // Categorize the detected process name
    if (name) {
      category = categorizeProcessName(name);
    }
  } catch (_err) {
    // Ignore all detection errors
  }

  return { category, name };
}

/**
 * Maps a process name to an app category based on known patterns.
 */
function categorizeProcessName(procName) {
  const lower = procName.toLowerCase().replace(/[^a-z0-9]/g, '');

  // Coding / IDE
  const codingPatterns = [
    'code', 'vscode', 'code-oss', 'code-insiders',
    'jetbrains', 'idea', 'pycharm', 'webstorm', 'phpstorm', 'rubymine',
    'clion', 'rider', 'goland', 'datagrip', 'rider', 'androidstudio',
    'intellij', 'goland', 'pycharm', 'webstorm',
    'vim', 'nvim', 'emacs', 'nano', 'sublime', 'atom',
    'visualstudiocode', 'vscodium',
    'gimp', 'blender', 'kdenlive', 'obs', 'shotcut',
    'insomnia', 'postman', 'thunderbird',
  ];

  // Gaming
  const gamingPatterns = [
    'steam', 'heroic', 'lutris', 'wine', 'proton', 'bottles',
    'minecraft', 'gamemode', 'gamemoderun',
    'unity', 'unreal', 'godot',
    'dxvk', 'vkd3d',
  ];

  // Video / conferencing
  const videoPatterns = [
    'zoom', 'teams', 'discord', 'slack', 'meet', 'jitsi',
    'skype', 'signal', 'telegram', 'obsidian',
    'vlc', 'mpv', 'totem', 'celluloid', 'smplayer', 'kaffeine',
    'firefox', 'chrome', 'chromium', 'brave', 'edge', 'opera',
    'electron', // many video apps are electron-based
  ];

  // Browsing
  const browsingPatterns = [
    'firefox', 'firefox-esr', 'librewolf', 'waterfox',
    'chrome', 'chromium', 'chromium-browser',
    'brave', 'brave-browser',
    'edge', 'msedge',
    'opera', 'vivaldi',
    'epiphany', 'surf', 'qutebrowser',
    'safari',
  ];

  // Music / audio
  const musicPatterns = [
    'spotify', 'rhythmbox', 'clementine', 'audacious', 'lollypop',
    'popsicle', 'ncmpcpp', 'cmus', 'audacity', 'ardour',
    'vlc', 'mpv', 'pavucontrol', 'qasmixer',
  ];

  // Terminal
  const terminalPatterns = [
    'bash', 'zsh', 'fish', 'sh', 'dash', 'ksh',
    'gnome-terminal', 'konsole', 'tilix', 'alacritty', 'kitty',
    'foot', 'st', 'rxvt', 'xterm', 'urxvt', 'terminator',
    'xfce4-terminal', 'mate-terminal', 'lxterminal',
    'wezterm', 'ghostty', 'tabby', 'warp',
  ];

  // Messaging
  const messagingPatterns = [
    'discord', 'slack', 'telegram', 'signal', 'whatsapp',
    'ferdi', 'ferdium', 'rambox', 'franz',
    'element', 'riot', 'matrix', 'fractal',
    'thunderbird', 'evolution', 'geary', 'sylpheed',
    'mattermost', 'rocket.chat',
  ];

  // Check categories in priority order
  if (matchPatterns(lower, codingPatterns)) return 'coding';
  if (matchPatterns(lower, gamingPatterns)) return 'gaming';
  if (matchPatterns(lower, messagingPatterns)) return 'messaging';
  if (matchPatterns(lower, videoPatterns)) return 'video';
  if (matchPatterns(lower, musicPatterns)) return 'music';
  if (matchPatterns(lower, browsingPatterns)) return 'browsing';
  if (matchPatterns(lower, terminalPatterns)) return 'terminal';

  return 'other';
}

/**
 * Checks if a normalized process name matches any pattern in the list.
 */
function matchPatterns(normalizedName, patterns) {
  for (const pattern of patterns) {
    const p = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedName === p || normalizedName.includes(p) || p.includes(normalizedName)) {
      return true;
    }
  }
  return false;
}

function broadcastSystemStatus(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const power = readPowerStatus();
  if (
    force ||
    power.isCharging !== lastPowerState.isCharging ||
    power.level !== lastPowerState.level
  ) {
    lastPowerState = power;
    mainWindow.webContents.send('power:status', power);
  }

  const isPlaying = readAudioPlayingStatus();
  if (force || isPlaying !== lastAudioPlaying) {
    lastAudioPlaying = isPlaying;
    mainWindow.webContents.send('audio:status', { isPlaying });
  }

  const telemetry = readSystemTelemetry();
  if (
    force ||
    telemetry.isHighLoad !== lastTelemetry.isHighLoad ||
    telemetry.isOnline !== lastTelemetry.isOnline ||
    Math.abs(telemetry.cpuLoadPct - lastTelemetry.cpuLoadPct) >= 8
  ) {
    lastTelemetry = telemetry;
    mainWindow.webContents.send('system:telemetry', telemetry);
  }

  // App Usage Awareness — detect focused app and broadcast category changes
  const focusedApp = readFocusedApp();
  if (
    force ||
    focusedApp.category !== lastFocusedApp.category ||
    focusedApp.name !== lastFocusedApp.name
  ) {
    lastFocusedApp = focusedApp;
    mainWindow.webContents.send('app:awareness', focusedApp);
  }
}

function applyLaunchAtStartup(enable) {
  try {
    if (process.platform === 'darwin' || process.platform === 'win32') {
      app.setLoginItemSettings({
        openAtLogin: Boolean(enable),
        path: process.execPath,
        args: [path.resolve(__dirname)],
      });
      return;
    }

    if (process.platform === 'linux') {
      const autostartDir = path.join(os.homedir(), '.config', 'autostart');
      const desktopFile = path.join(autostartDir, 'desktop-mascot-companion.desktop');
      if (enable) {
        fs.mkdirSync(autostartDir, { recursive: true });
        const content = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=Desktop Mascot Companion',
          'Comment=Cute desktop mascot companion',
          `Exec="${process.execPath}" "${path.resolve(__dirname)}" --no-sandbox`,
          'Terminal=false',
          'X-GNOME-Autostart-enabled=true',
        ].join('\n');
        fs.writeFileSync(desktopFile, content, 'utf-8');
      } else if (fs.existsSync(desktopFile)) {
        fs.unlinkSync(desktopFile);
      }
    }
  } catch (err) {
    console.warn('[main] Could not update startup setting:', err.message);
  }
}

function createWaylandSensorWindow() {
  if (!isWaylandSession || sensorWindow) return;

  const primary = screen.getPrimaryDisplay();
  const { x, y, width, height } = primary.bounds;

  sensorWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
    },
  });

  sensorWindow.setAlwaysOnTop(true);
  sensorWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  sensorWindow.loadURL('data:text/html,<html><body style="margin:0;background:transparent;"></body></html>');

  sensorWindow.once('ready-to-show', () => {
    if (!sensorWindow || sensorWindow.isDestroyed()) return;
    sensorWindow.showInactive();
    const pt = screen.getCursorScreenPoint();
    updateWaylandSensorHole(pt.x, pt.y);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.moveTop();
    }
  });
}

function updateWaylandSensorHole(screenX, screenY) {
  if (!sensorWindow || sensorWindow.isDestroyed()) return;

  const bounds = sensorWindow.getBounds();
  const lx = Math.round(screenX - bounds.x);
  const ly = Math.round(screenY - bounds.y);
  const w = bounds.width;
  const h = bounds.height;
  const r = WAYLAND_HOLE_RADIUS;

  const holeLeft = Math.max(0, lx - r);
  const holeRight = Math.min(w, lx + r);
  const holeTop = Math.max(0, ly - r);
  const holeBottom = Math.min(h, ly + r);

  const rects = [];
  if (holeTop > 0) {
    rects.push({ x: 0, y: 0, width: w, height: holeTop });
  }
  if (holeBottom < h) {
    rects.push({ x: 0, y: holeBottom, width: w, height: h - holeBottom });
  }
  if (holeLeft > 0 && holeBottom > holeTop) {
    rects.push({ x: 0, y: holeTop, width: holeLeft, height: holeBottom - holeTop });
  }
  if (holeRight < w && holeBottom > holeTop) {
    rects.push({ x: holeRight, y: holeTop, width: w - holeRight, height: holeBottom - holeTop });
  }

  sensorWindow.setShape(rects);
}

function destroyWaylandSensorWindow() {
  if (sensorWindow && !sensorWindow.isDestroyed()) {
    sensorWindow.close();
  }
  sensorWindow = null;
}

function stopGravityLoop() {
  if (gravityTimer) {
    clearInterval(gravityTimer);
    gravityTimer = null;
  }
}

function createMainWindow() {
  const initialMascotPos = getInitialMascotScreenPos();
  const primary = screen.getPrimaryDisplay();

  mainWindow = new BrowserWindow({
    x: primary.workArea.x + primary.workArea.width - WINDOW_WIDTH,
    y: primary.workArea.y + primary.workArea.height - WINDOW_HEIGHT,
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  applyMascotScreenPosition(initialMascotPos.x, initialMascotPos.y);

  // On Linux, keep the window able to receive mouse events so the mascot
  // is clickable. The window is focusable:false and transparent, so it
  // won't steal focus from other apps.
  if (process.platform !== 'linux') {
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    isIgnoringMouse = true;
  }

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.showInactive();
    applyMascotScreenPosition(mascotState.screenX, mascotState.screenY);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    lastCursorPos = { x: null, y: null };
    mainWindow.webContents.send('window:mascot-layout', mascotState);
    if (registeredShortcut) {
      mainWindow.webContents.send('voice:shortcut-registered', registeredShortcut);
    }
    syncCursorPolling();
    broadcastSystemStatus(true);
    if (!statusPollTimer) {
      statusPollTimer = setInterval(() => broadcastSystemStatus(false), 2500);
    }
  });

  mainWindow.on('closed', () => {
    stopCursorPolling();
    stopGravityLoop();
    destroyWaylandSensorWindow();
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
    mainWindow = null;
  });
}

function pollCursorPosition() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const cursorPoint = screen.getCursorScreenPoint();

  if (cursorPoint.x === lastCursorPos.x && cursorPoint.y === lastCursorPos.y) {
    return;
  }
  lastCursorPos = { x: cursorPoint.x, y: cursorPoint.y };

  if (isWaylandSession && sensorWindow && !sensorWindow.isDestroyed()) {
    updateWaylandSensorHole(cursorPoint.x, cursorPoint.y);
  }

  if (dragSession.active) {
    const dx = cursorPoint.x - dragSession.startCursorX;
    const dy = cursorPoint.y - dragSession.startCursorY;
    applyMascotScreenPosition(dragSession.startMascotX + dx, dragSession.startMascotY + dy);
  }

  const localX = cursorPoint.x - currentWinPos.x;
  const localY = cursorPoint.y - currentWinPos.y;
  const display = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay();
  const db = display.bounds;

  mainWindow.webContents.send('cursor:move', {
    screenX: cursorPoint.x,
    screenY: cursorPoint.y,
    winX: currentWinPos.x,
    winY: currentWinPos.y,
    localX,
    localY,
    displayX: db.x,
    displayY: db.y,
    displayWidth: db.width,
    displayHeight: db.height,
    eyesFollow: Boolean(settings.eyesFollowCursor),
    timestamp: Date.now(),
  });
}

function syncCursorPolling() {
  stopCursorPolling();
  lastCursorPos = { x: null, y: null };

  const needPoll = (settings && settings.eyesFollowCursor) || process.platform === 'linux';

  if (needPoll) {
    if (isWaylandSession && settings && settings.eyesFollowCursor) {
      createWaylandSensorWindow();
    }
    pollCursorPosition();
    cursorPollTimer = setInterval(pollCursorPosition, CURSOR_POLL_INTERVAL_MS);
  } else {
    destroyWaylandSensorWindow();
  }
}

function stopCursorPolling() {
  if (cursorPollTimer) {
    clearInterval(cursorPollTimer);
    cursorPollTimer = null;
  }
}

function registerIpcHandlers() {
  ipcMain.handle('settings:get', () => {
    return settings;
  });

  ipcMain.handle('window:get-layout', () => {
    return mascotState;
  });

  ipcMain.handle('settings:update', (_event, patch) => {
    const prevStartup = settings.launchAtStartup;
    const prevSize = settings.size;
    settings = saveSettings(settings, patch);

    if (patch.size && patch.size !== prevSize) {
      applyMascotScreenPosition(mascotState.screenX, mascotState.screenY);
    }
    if (typeof patch.eyesFollowCursor === 'boolean') {
      syncCursorPolling();
    }
    if (typeof patch.launchAtStartup === 'boolean' && patch.launchAtStartup !== prevStartup) {
      applyLaunchAtStartup(settings.launchAtStartup);
    }
    return settings;
  });

  ipcMain.handle('power:get', () => {
    return readPowerStatus();
  });

  ipcMain.handle('audio:get', () => {
    return { isPlaying: readAudioPlayingStatus() };
  });

  ipcMain.handle('system:get-telemetry', () => {
    return readSystemTelemetry();
  });

  ipcMain.handle('app:get-awareness', () => {
    return readFocusedApp();
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    if (typeof text === 'string' && text.length > 0) {
      clipboard.writeText(text);
      return true;
    }
    return false;
  });

  ipcMain.handle('clipboard:read', () => {
    try {
      return clipboard.readText() || '';
    } catch (_e) {
      return '';
    }
  });

  ipcMain.on('window:set-shape', (_event, rects) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // On Linux, setShape() resets the X11 input region, overriding setIgnoreMouseEvents.
    // Skip it entirely on Linux to preserve click-through behavior.
    if (process.platform === 'linux') return;
    if (Array.isArray(rects)) {
      const cleanRects = rects.map((r) => ({
        x: Math.max(0, Math.floor(r.x)),
        y: Math.max(0, Math.floor(r.y)),
        width: Math.max(1, Math.ceil(r.width)),
        height: Math.max(1, Math.ceil(r.height)),
      }));
      mainWindow.setShape(cleanRects);
    }
  });

  ipcMain.on('window:set-ignore-mouse', (_event, ignore) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // On Linux, keep the window always able to receive mouse events
    if (process.platform === 'linux') return;
    const shouldIgnore = Boolean(ignore);
    if (shouldIgnore !== isIgnoringMouse) {
      isIgnoringMouse = shouldIgnore;
      mainWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
    }
  });

  ipcMain.on('window:set-focusable', (_event, focusable) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const shouldFocus = Boolean(focusable);
    // On Linux (X11/XWayland), calling mainWindow.setFocusable() dynamically after creation
    // corrupts X11 window hints and blocks all mouse clicks on the window.
    // Instead, keep focusable:true on the window and only focus/blur when an input is active.
    if (process.platform === 'linux') {
      if (shouldFocus) {
        mainWindow.focus();
      } else {
        mainWindow.blur();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
      }
      return;
    }
    mainWindow.setFocusable(shouldFocus);
    if (shouldFocus) {
      mainWindow.focus();
    } else {
      mainWindow.blur();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
  });

  // Begin OS-cursor-anchored drag (immune to X11 ConfigureNotify / e.screenX jitter)
  ipcMain.on('window:start-drag', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopGravityLoop();
    const pt = screen.getCursorScreenPoint();
    dragSession = {
      active: true,
      startCursorX: pt.x,
      startCursorY: pt.y,
      startMascotX: mascotState.screenX,
      startMascotY: mascotState.screenY,
    };
  });

  // Move mascot across 100% of screen width/height during drag using OS cursor coordinates
  ipcMain.on('window:move-by', (_event, { dx, dy }) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    stopGravityLoop();
    if (dragSession.active) {
      const pt = screen.getCursorScreenPoint();
      const totalDx = pt.x - dragSession.startCursorX;
      const totalDy = pt.y - dragSession.startCursorY;
      if (totalDx !== 0 || totalDy !== 0) {
        applyMascotScreenPosition(
          dragSession.startMascotX + totalDx,
          dragSession.startMascotY + totalDy
        );
        return;
      }
    }
    applyMascotScreenPosition(mascotState.screenX + dx, mascotState.screenY + dy);
  });

  // Step mascot horizontally during Screen-Edge Stroll Mode all the way to left/right screen edges
  ipcMain.handle('window:stroll-step', (_event, dx) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { bounced: false };
    const mascotSize = getMascotSizePx();
    const { workArea } = getDisplayAreaForPoint({
      x: mascotState.screenX,
      y: mascotState.screenY,
    });

    const minScreenX = workArea.x + 24;
    const maxScreenX = workArea.x + workArea.width - mascotSize - 24;

    let nextX = Math.round(mascotState.screenX + dx);
    let bounced = false;

    if (nextX <= minScreenX) {
      nextX = minScreenX;
      bounced = true;
    } else if (nextX >= maxScreenX) {
      nextX = maxScreenX;
      bounced = true;
    }

    const layout = applyMascotScreenPosition(nextX, mascotState.screenY);
    return { bounced, layout: { ...layout, peekEdge: null } };
  });

  // Handle drag release: check Peek-a-Boo Screen Edge Hiding OR Gravity Fall Physics
  ipcMain.handle('window:release-drag', () => {
    dragSession.active = false;
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { peekEdge: null, falling: false, settings, layout: mascotState };
    }
    stopGravityLoop();

    const mascotSize = getMascotSizePx();
    const { workArea } = getDisplayAreaForPoint({
      x: mascotState.screenX,
      y: mascotState.screenY,
    });

    const minScreenX = workArea.x;
    const maxScreenX = workArea.x + workArea.width - mascotSize;
    const groundScreenY = workArea.y + workArea.height - mascotSize - 6;

    // 1. Check if mascot was released near the left or right screen edge -> Snap & 90° Peek-a-Boo!
    if (mascotState.peekEdge === 'left' || mascotState.screenX <= minScreenX + 48) {
      const layout = applyMascotScreenPosition(minScreenX, mascotState.screenY);
      layout.peekEdge = 'left';
      layout.inWinX = 0;
      mascotState = layout;
      settings = saveSettings(settings, {
        windowPosition: { x: currentWinPos.x, y: currentWinPos.y },
        mascotScreenPos: { x: layout.screenX, y: layout.screenY },
      });
      return { peekEdge: 'left', falling: false, settings, layout };
    }

    if (mascotState.peekEdge === 'right' || mascotState.screenX >= maxScreenX - 48) {
      const layout = applyMascotScreenPosition(maxScreenX, mascotState.screenY);
      layout.peekEdge = 'right';
      layout.inWinX = WINDOW_WIDTH - mascotSize;
      mascotState = layout;
      settings = saveSettings(settings, {
        windowPosition: { x: currentWinPos.x, y: currentWinPos.y },
        mascotScreenPos: { x: layout.screenX, y: layout.screenY },
      });
      return { peekEdge: 'right', falling: false, settings, layout };
    }

    // 2. If Gravity Mode is enabled and released above the bottom edge, fall smoothly to ground
    if (settings.gravityMode && mascotState.screenY < groundScreenY - 8) {
      let currentY = mascotState.screenY;
      const fixedX = mascotState.screenX;
      let vy = 2.0;

      gravityTimer = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          stopGravityLoop();
          return;
        }
        vy = Math.min(34, vy + 1.85);
        currentY += vy;

        if (currentY >= groundScreenY) {
          currentY = groundScreenY;
          const landedLayout = applyMascotScreenPosition(fixedX, Math.round(currentY));
          stopGravityLoop();
          settings = saveSettings(settings, {
            windowPosition: { x: currentWinPos.x, y: currentWinPos.y },
            mascotScreenPos: { x: landedLayout.screenX, y: landedLayout.screenY },
          });
          mainWindow.webContents.send('window:landed', { settings, layout: landedLayout });
        } else {
          applyMascotScreenPosition(fixedX, Math.round(currentY));
        }
      }, 16);

      return { peekEdge: null, falling: true, settings, layout: mascotState };
    }

    settings = saveSettings(settings, {
      windowPosition: { x: currentWinPos.x, y: currentWinPos.y },
      mascotScreenPos: { x: mascotState.screenX, y: mascotState.screenY },
    });
    return { peekEdge: mascotState.peekEdge, falling: false, settings, layout: mascotState };
  });

  ipcMain.handle('window:save-position', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return settings;
    const winB = mainWindow.getBounds();
    settings = saveSettings(settings, {
      windowPosition: { x: winB.x, y: winB.y },
      mascotScreenPos: { x: mascotState.screenX, y: mascotState.screenY },
    });
    return settings;
  });

  ipcMain.on('timer:notify', (_event, { title, body }) => {
    if (Notification.isSupported()) {
      const notification = new Notification({
        title: title || 'Mascot Companion',
        body: body || 'Your timer is up!',
        silent: false,
      });
      notification.show();
    }
  });

  ipcMain.on('app:quit', () => {
    app.quit();
  });

  // Notify renderer when name-call shortcut is pressed
  ipcMain.on('voice:respond', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice:respond', {
        name: settings.mascotName || 'Otto',
        voiceEnabled: settings.voiceEnabled !== false,
      });
    }
  });

  // Voice activation: start Python speech recognition process
  ipcMain.handle('voice:activation:start', async (_event, { mascotName }) => {
    stopVoiceActivation();
    
    try {
      const scriptPath = path.join(__dirname, 'voice_activation.py');
      voiceActivationProcess = spawn('python3', [scriptPath, mascotName || 'Otto'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      voiceActivationProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed);
            console.log('[VOICE-ACT]', JSON.stringify(msg));
            
            if (msg.detected === true) {
              // Wake word detected! Send to renderer
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:activation:detected', {
                  name: msg.name || mascotName || 'Otto',
                  text: msg.text || '',
                  voiceEnabled: settings.voiceEnabled !== false,
                });
              }
            } else if (msg.status === 'listening') {
              // Script is now actively listening
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:activation:status', { status: 'listening' });
              }
            } else if (msg.status === 'error') {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:activation:status', { status: 'error', message: msg.message });
              }
            } else if (msg.status === 'heard') {
              // Log what was heard for debugging
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('voice:activation:status', { status: 'heard', text: msg.text });
              }
            }
          } catch (e) {
            console.warn('[VOICE-ACT] Failed to parse JSON:', trimmed);
          }
        }
      });
      
      voiceActivationProcess.stderr.on('data', (data) => {
        console.error('[VOICE-ACT] stderr:', data.toString().trim());
      });
      
      voiceActivationProcess.on('error', (err) => {
        console.error('[VOICE-ACT] Process error:', err.message);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voice:activation:status', { status: 'error', message: err.message });
        }
      });
      
      voiceActivationProcess.on('close', (code) => {
        console.log('[VOICE-ACT] Process exited with code:', code);
        voiceActivationProcess = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('voice:activation:status', { status: 'stopped' });
        }
      });
      
      console.log('[VOICE-ACT] Python process started');
      return { success: true };
    } catch (err) {
      console.error('[VOICE-ACT] Failed to start:', err.message);
      return { success: false, error: err.message };
    }
  });
  
  // Voice activation: stop Python speech recognition process
  ipcMain.handle('voice:activation:stop', async () => {
    stopVoiceActivation();
    return { success: true };
  });
  
  // Speak the exact response text with a Minion-pitched voice:
  // Fetches natural neural speech (Google Translate TTS, with slow=true so speeding it up 1.65x
  // gives high Minion pitch while keeping every spoken word crystal-clear and intelligible!)
  ipcMain.handle('voice:speak', async (_event, { text }) => {
    try {
      const cleanText = String(text || '')
        .replace(/[^\p{L}\p{N}\s,!?.']/gu, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) {
        return { success: false, error: 'Empty text' };
      }

      // Use ttsspeed=0.24 (slow articulation) so when WebAudio plays it at 1.62x-1.7x speed,
      // the pitch and vocal formants jump up into the authentic Minion register (+8.5 semitones)
      // while the actual speaking speed of the words stays natural and clear!
      const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=es&ttsspeed=0.24&q=${encodeURIComponent(
        cleanText
      )}`;

      const fetchTtsAudio = (url) =>
        new Promise((resolve, reject) => {
          const req = net.request({
            method: 'GET',
            url,
            headers: {
              'User-Agent':
                'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
          });
          const chunks = [];
          req.on('response', (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`HTTP ${res.statusCode}`));
              return;
            }
            res.on('data', (c) => chunks.push(Buffer.from(c)));
            res.on('end', () => {
              const buf = Buffer.concat(chunks);
              if (buf.length > 100) {
                resolve(buf.toString('base64'));
              } else {
                reject(new Error('Empty TTS buffer'));
              }
            });
            res.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        });

      const audioBase64 = await fetchTtsAudio(ttsUrl);
      return { success: true, audioBase64 };
    } catch (err) {
      console.warn('[VOICE] Neural TTS error:', err.message);
      return { success: false, error: err.message };
    }
  });
}

/* ==========================================================================
   Global Shortcut: Call mascot by name (Alt+O)
   ========================================================================== */

/**
 * Stops the voice activation Python process if running.
 */
function stopVoiceActivation() {
  if (voiceActivationProcess) {
    console.log('[VOICE-ACT] Stopping Python process...');
    try {
      voiceActivationProcess.kill('SIGTERM');
    } catch (e) {
      console.warn('[VOICE-ACT] Error killing process:', e.message);
    }
    voiceActivationProcess = null;
  }
}

function registerNameCallShortcut() {
  globalShortcut.unregisterAll();

  // Try multiple shortcut combinations until one succeeds
  const shortcutsToTry = [
    'CmdOrCtrl+Shift+O',
    'CmdOrCtrl+Alt+O',
    'F4',
    'Alt+O',
  ];

  const callback = () => {
    console.log('[VOICE] Global shortcut triggered!');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('voice:respond', {
        name: settings.mascotName || 'Otto',
        voiceEnabled: settings.voiceEnabled !== false,
      });
      console.log('[VOICE] Sent voice:respond IPC message to renderer');
    } else {
      console.error('[VOICE] mainWindow is null or destroyed!');
    }
  };

  for (const shortcut of shortcutsToTry) {
    const registered = globalShortcut.register(shortcut, callback);
    if (registered) {
      console.log('[VOICE] Shortcut registered:', shortcut);
      return shortcut;
    } else {
      console.log('[VOICE] Shortcut already in use, trying next:', shortcut);
    }
  }
  console.error('[VOICE] Failed to register any shortcut! All combinations are in use.');
  return null;
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    app.dock.hide();
  }

  settings = loadSettings();
  registerIpcHandlers();
  registeredShortcut = registerNameCallShortcut();

  if (powerMonitor) {
    powerMonitor.on('on-ac', () => broadcastSystemStatus(true));
    powerMonitor.on('on-battery', () => broadcastSystemStatus(true));
  }

  setTimeout(createMainWindow, process.platform === 'linux' ? 150 : 0);

  screen.on('display-removed', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const initPos = getInitialMascotScreenPos();
    applyMascotScreenPosition(initPos.x, initPos.y);
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopVoiceActivation();
});

app.on('window-all-closed', () => {
  app.quit();
});
