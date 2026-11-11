/**
 * Settings Schema & Persistence Module
 * ====================================
 * Persists user preferences to `<userData>/settings.json`.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VALID_SHAPES = new Set([
  'ears',
  'clover',
  'splat',
  'snowman',
  'jelly',
  'pillow',
  'kite',
  'topknot',
  'ufo',
  'hourglass',
  'sub',
  'cookie',
]);

const DEFAULT_SETTINGS = Object.freeze({
  version: 6,
  windowPosition: null,
  mascotScreenPos: null,
  colors: {
    body: '#A695F5',
    shade: '#8772E8',
    eyeWhite: '#FFFDF5',
    pupil: '#2D2A3E',
    customShade: false,
    reactionColorShift: true,
  },
  shape: 'ears',
  accessory: 'none',
  size: 'medium',
  expression: 'happy',
  autoExpressions: true,
  eyesFollowCursor: true,
  strollMode: false,
  gravityMode: true,
  circadianMode: true,
  wellnessReminders: true,
  ambientSound: 'off',
  launchAtStartup: false,
  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
    autoCycle: true,
    soundEnabled: true,
  },
  stickyTask: {
    text: '',
    done: false,
  },
  stats: {
    xp: 0,
    level: 1,
    streak: 1,
    lastActiveDate: '',
    completedPomodoros: 0,
    completedGoals: 0,
    treatsFed: 0,
  },
  pocketItems: [],
});

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function mergeWithDefaults(partial = {}) {
  const mergedShape = VALID_SHAPES.has(partial.shape) ? partial.shape : DEFAULT_SETTINGS.shape;
  const mergedPocket = Array.isArray(partial.pocketItems)
    ? partial.pocketItems.filter((item) => typeof item === 'string').slice(0, 5)
    : DEFAULT_SETTINGS.pocketItems;
  const isMigratingFromPreV6 = !partial.version || partial.version < 6;

  return {
    ...DEFAULT_SETTINGS,
    ...partial,
    version: DEFAULT_SETTINGS.version,
    circadianMode: isMigratingFromPreV6 ? true : Boolean(partial.circadianMode),
    shape: mergedShape,
    pocketItems: mergedPocket,
    windowPosition:
      partial.windowPosition &&
      typeof partial.windowPosition.x === 'number' &&
      typeof partial.windowPosition.y === 'number'
        ? { x: Math.round(partial.windowPosition.x), y: Math.round(partial.windowPosition.y) }
        : null,
    mascotScreenPos:
      partial.mascotScreenPos &&
      typeof partial.mascotScreenPos.x === 'number' &&
      typeof partial.mascotScreenPos.y === 'number'
        ? { x: Math.round(partial.mascotScreenPos.x), y: Math.round(partial.mascotScreenPos.y) }
        : null,
    colors: {
      ...DEFAULT_SETTINGS.colors,
      ...(partial.colors || {}),
    },
    pomodoro: {
      ...DEFAULT_SETTINGS.pomodoro,
      ...(partial.pomodoro || {}),
    },
    stickyTask: {
      ...DEFAULT_SETTINGS.stickyTask,
      ...(partial.stickyTask || {}),
    },
    stats: {
      ...DEFAULT_SETTINGS.stats,
      ...(partial.stats || {}),
    },
  };
}

function loadSettings() {
  const filePath = getSettingsPath();
  try {
    if (!fs.existsSync(filePath)) {
      return mergeWithDefaults();
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch (err) {
    console.warn('[settings] Failed to read settings, using defaults:', err.message);
    return mergeWithDefaults();
  }
}

function saveSettings(currentSettings, patch = {}) {
  const next = mergeWithDefaults({
    ...currentSettings,
    ...patch,
    colors: {
      ...(currentSettings ? currentSettings.colors : {}),
      ...(patch.colors || {}),
    },
    pomodoro: {
      ...(currentSettings ? currentSettings.pomodoro : {}),
      ...(patch.pomodoro || {}),
    },
    stickyTask: {
      ...(currentSettings ? currentSettings.stickyTask : {}),
      ...(patch.stickyTask || {}),
    },
    stats: {
      ...(currentSettings ? currentSettings.stats : {}),
      ...(patch.stats || {}),
    },
  });

  const filePath = getSettingsPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf-8');
  } catch (err) {
    console.error('[settings] Failed to write settings:', err.message);
  }
  return next;
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettingsPath,
  loadSettings,
  saveSettings,
};
