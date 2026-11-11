/**
 * Renderer Application Logic
 * ==========================
 * Coordinates full-screen cursor-tracking eyes, the gooey metaball double-chain menu,
 * 12 flat pastel shapes, reaction-driven color shifting, pure flash charging indicator,
 * low-battery tired state, system audio + procedural ambient Lo-Fi/Rain/Brown-Noise generator,
 * head-patting, treat feeding, gravity fall physics, screen-edge peek-a-boo, CPU/RAM sweat
 * & Wi-Fi offline indicators, circadian time-of-day props, XP/Streak leveling, wellness
 * reminders, and the drag-and-drop Clipboard Pocket.
 */

const SIZE_MAP = {
  small: { px: 96, label: 'Small', sliderIndex: 0 },
  medium: { px: 120, label: 'Medium', sliderIndex: 1 },
  large: { px: 148, label: 'Large', sliderIndex: 2 },
};
const INDEX_TO_SIZE = ['small', 'medium', 'large'];

// Exact pastel palettes from the reference design mapped to reactions
const REACTION_PALETTES = {
  happy: { body: '#A695F5', shade: '#8772E8' },     // Soft Lavender Purple
  wink: { body: '#79DF8E', shade: '#54C46B' },      // Mint Leaf Green
  sleepy: { body: '#86C5FF', shade: '#5AA8F0' },    // Sky Pastel Blue
  surprised: { body: '#FCA862', shade: '#E5893C' }, // Warm Apricot Orange
  dizzy: { body: '#F5CA7B', shade: '#DDA94E' },     // Sunny Butter Yellow
  angry: { body: '#FA969A', shade: '#E07176' },     // Soft Rose Pink
  sad: { body: '#FA9B78', shade: '#E27A54' },       // Coral Peach
};

const WELLNESS_PROMPTS = [
  '💧 Time for a sip of water!',
  '✨ Unclench your shoulders!',
  '👀 Look 20ft away for 20s!',
  '🧘 Roll & stretch your wrists!',
  '🌬️ Take a deep, slow breath!',
];

const MAX_EYE_OFFSET_X = 14.5;
const MAX_EYE_OFFSET_Y = 12.0;
const EYE_LERP_SPEED = 0.22;
const IDLE_SLEEP_TIMEOUT_MS = 120 * 1000;
const WELLNESS_INTERVAL_MS = 45 * 60 * 1000; // Every 45 minutes
const LOW_BATTERY_THRESHOLD = 20;
const DRAG_THRESHOLD_PX = 4;

const PANEL_TITLES = {
  timer: 'Focus, Audio & Wellness',
  shapes: '12 Shapes & Head Props',
  expression: 'Moods, Treats & Colors',
  task: 'Focus Goal & Pocket',
  customize: 'Colors, Physics & Setup',
};

// Application state
const state = {
  settings: null,
  isRingOpen: false,
  isPanelOpen: false,
  activePanel: 'timer',
  isSleepingFromIdle: false,
  isLowBatteryTired: false,
  isCharging: null,
  batteryLevel: null,
  systemAudioPlaying: false,
  ambientMode: 'off', // 'off' | 'lofi' | 'rain' | 'brown'
  isHighLoad: false,
  isOnline: true,
  peekEdge: null, // 'left' | 'right' | null
  greetedMorningDate: '',
  lastCursorMoveAt: Date.now(),
  tempExpressionTimer: null,
  blushTimer: null,
  treatTimer: null,

  // Head-pat detection
  headPat: {
    lastX: null,
    lastDir: 0,
    reversals: 0,
    firstReversalAt: 0,
    lastXpAt: 0,
  },

  // Full-screen eye rig animation state
  eyeRig: {
    cx: 0,
    cy: 0,
    tx: 0,
    ty: 0,
  },

  // Drag tracking
  drag: {
    active: false,
    moved: false,
    startScreenX: 0,
    startScreenY: 0,
    lastScreenX: 0,
    lastScreenY: 0,
  },

  // Stroll mode tracking
  stroll: {
    direction: -1,
    timerId: null,
  },

  // Timer / Pomodoro / Alarm state
  timer: {
    mode: 'pomodoro', // 'pomodoro' | 'countdown' | 'alarm'
    phase: 'focus',   // 'focus' | 'break'
    round: 1,
    status: 'idle',   // 'idle' | 'running' | 'paused' | 'alert'
    durationSec: 25 * 60,
    remainingSec: 25 * 60,
    endTimeMs: null,
    alarmTimeStr: '17:00',
    alarmLabel: '',
    intervalId: null,
  },
};

// DOM References
const dom = {
  root: document.documentElement,
  appStage: document.getElementById('app-stage'),
  mascotDock: document.getElementById('mascot-dock'),
  mascotWrapper: document.getElementById('mascot-wrapper'),
  mascotSvg: document.getElementById('mascot-svg'),
  eyesRig: document.getElementById('eyes-rig'),
  eyeDotLeft: document.getElementById('eye-dot-left'),
  eyeDotRight: document.getElementById('eye-dot-right'),
  sleepIndicator: document.getElementById('sleep-indicator'),
  chargingBadge: document.getElementById('charging-badge'),
  offlineBadge: document.getElementById('offline-badge'),
  wellnessBubble: document.getElementById('wellness-bubble'),
  wellnessBubbleText: document.getElementById('wellness-bubble-text'),
  floatingParticles: document.getElementById('floating-particles'),
  svgSweatDrop: document.getElementById('svg-sweat-drop'),
  svgBlush: document.getElementById('svg-blush'),
  propGlasses: document.getElementById('prop-glasses'),
  propCoffee: document.getElementById('prop-coffee'),
  propTreat: document.getElementById('prop-treat'),

  // Gooey Metaball Chain Menu & Floating Panel
  radialRing: document.getElementById('radial-ring'),
  ringButtons: document.querySelectorAll('.ring-btn'),
  ringQuickFocusBtn: document.getElementById('ring-quick-focus-btn'),
  ringSoundBtn: document.getElementById('ring-sound-btn'),
  ringStrollBtn: document.getElementById('ring-stroll-btn'),
  settingsQuitBtn: document.getElementById('settings-quit-btn'),

  popupMenu: document.getElementById('popup-menu'),
  panelTitle: document.getElementById('panel-title'),
  xpStreakBadge: document.getElementById('xp-streak-badge'),
  xpBarFill: document.getElementById('xp-bar-fill'),
  panelCloseBtn: document.getElementById('panel-close-btn'),
  tabPanels: {
    timer: document.getElementById('tab-timer'),
    shapes: document.getElementById('tab-shapes'),
    expression: document.getElementById('tab-expression'),
    task: document.getElementById('tab-task'),
    customize: document.getElementById('tab-customize'),
  },

  // Timer / Pomodoro / Alarm / Ambient Elements
  modePills: document.querySelectorAll('.mode-pill[data-timer-mode]'),
  pomodoroControls: document.getElementById('pomodoro-controls'),
  countdownControls: document.getElementById('countdown-controls'),
  alarmControls: document.getElementById('alarm-controls'),
  pomoFocusInput: document.getElementById('pomo-focus-input'),
  pomoBreakInput: document.getElementById('pomo-break-input'),
  pomoAutoCycleToggle: document.getElementById('pomo-autocycle-toggle'),
  alarmTimeInput: document.getElementById('alarm-time-input'),
  alarmLabelInput: document.getElementById('alarm-label-input'),
  ambientButtons: document.querySelectorAll('.ambient-btn[data-ambient]'),
  wellnessToggle: document.getElementById('wellness-toggle'),
  wellnessTestBtn: document.getElementById('wellness-test-btn'),
  soundChimeToggle: document.getElementById('sound-chime-toggle'),

  timerBubble: document.getElementById('timer-bubble'),
  bubblePhaseIcon: document.getElementById('bubble-phase-icon'),
  bubbleTimerText: document.getElementById('bubble-timer-text'),
  menuTimerReadout: document.getElementById('menu-timer-readout'),
  menuCycleSubtext: document.getElementById('menu-cycle-subtext'),
  menuTimerStatus: document.getElementById('menu-timer-status'),
  presetButtons: document.querySelectorAll('.chip-btn[data-minutes]'),
  customMinutesInput: document.getElementById('custom-minutes-input'),
  timerStartBtn: document.getElementById('timer-start-btn'),
  timerPauseBtn: document.getElementById('timer-pause-btn'),
  timerResumeBtn: document.getElementById('timer-resume-btn'),
  timerSkipBtn: document.getElementById('timer-skip-btn'),
  timerCancelBtn: document.getElementById('timer-cancel-btn'),

  // Customize & Shapes Elements
  shapeButtons: document.querySelectorAll('.shape-btn[data-shape]'),
  accessoryButtons: document.querySelectorAll('.acc-btn[data-accessory]'),
  circadianToggle: document.getElementById('circadian-toggle'),
  paletteSwatches: document.querySelectorAll('.palette-swatch'),
  reactionColorToggle: document.getElementById('reaction-color-toggle'),
  bodyColorPicker: document.getElementById('body-color-picker'),
  customShadeToggle: document.getElementById('custom-shade-toggle'),
  shadeColorPicker: document.getElementById('shade-color-picker'),
  sizeSlider: document.getElementById('size-slider'),
  sizeLabel: document.getElementById('size-label'),
  gravityToggle: document.getElementById('gravity-toggle'),
  eyesFollowToggle: document.getElementById('eyes-follow-toggle'),
  startupToggle: document.getElementById('startup-toggle'),

  // Expression & Treats Elements
  treatButtons: document.querySelectorAll('.treat-btn[data-treat]'),
  autoExprToggle: document.getElementById('auto-expr-toggle'),
  exprButtons: document.querySelectorAll('.expr-btn[data-expr]'),

  // Sticky Task & Clipboard Pocket Elements
  taskBubble: document.getElementById('task-bubble'),
  taskBubbleText: document.getElementById('task-bubble-text'),
  stickyTaskInput: document.getElementById('sticky-task-input'),
  taskCompleteBtn: document.getElementById('task-complete-btn'),
  taskClearBtn: document.getElementById('task-clear-btn'),
  pocketPasteBtn: document.getElementById('pocket-paste-btn'),
  pocketList: document.getElementById('pocket-list'),
};

/* ==========================================================================
   1. Synthesized WebAudio Chimes & Ambient Lo-Fi / Rain / Brown Noise Generator
   ========================================================================== */

let audioCtx = null;
let ambientNodes = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playChimeSound(type = 'alert', forcePlay = false) {
  if (
    !forcePlay &&
    state.settings &&
    state.settings.pomodoro &&
    !state.settings.pomodoro.soundEnabled
  ) {
    return;
  }
  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const noteSets = {
      alert: [587.33, 739.99, 880.0, 1174.66],
      celebrate: [523.25, 659.25, 783.99, 1046.5],
      munch: [440.0, 554.37, 659.25],
      pat: [659.25, 783.99],
    };
    const notes = noteSets[type] || noteSets.alert;

    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + idx * 0.1 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.1);
      osc.stop(ctx.currentTime + idx * 0.1 + 0.27);
    });
  } catch (_err) {
    // Ignore audio errors
  }
}

/**
 * Stops any running procedural ambient audio generator.
 */
function stopAmbientAudio() {
  if (!ambientNodes) return;
  try {
    if (ambientNodes.intervalId) clearInterval(ambientNodes.intervalId);
    if (ambientNodes.source) ambientNodes.source.stop();
    if (ambientNodes.gain) ambientNodes.gain.disconnect();
  } catch (_e) {
    // Ignore
  }
  ambientNodes = null;
}

/**
 * Starts built-in procedural WebAudio soundscape ('lofi' | 'rain' | 'brown' | 'off').
 */
function setAmbientAudioMode(mode) {
  stopAmbientAudio();
  state.ambientMode = mode || 'off';

  dom.ambientButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.ambient === state.ambientMode);
  });

  syncMusicHeadphones();

  if (state.ambientMode === 'off') {
    return;
  }

  try {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    if (state.ambientMode === 'rain' || state.ambientMode === 'brown') {
      // Generate 3-second looping noise buffer
      const bufferSize = ctx.sampleRate * 3;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);

      if (state.ambientMode === 'brown') {
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          data[i] = (lastOut + 0.02 * white) / 1.02;
          lastOut = data[i];
          data[i] *= 0.35;
        }
      } else {
        // Soft Rain pink-ish noise
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.963 * b1 + white * 0.2965164;
          b2 = 0.57 * b2 + white * 1.0526913;
          data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.04;
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = state.ambientMode === 'brown' ? 420 : 1350;

      const gain = ctx.createGain();
      gain.gain.value = 0.18;

      source.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      source.start();

      ambientNodes = { source, gain };
    } else if (state.ambientMode === 'lofi') {
      // Warm Lo-Fi Electric Piano Seventh Chords (Fmaj7 -> Em7 -> Dm7 -> Cmaj7)
      const chords = [
        [174.61, 220.0, 261.63, 329.63], // Fmaj7
        [164.81, 196.0, 246.94, 293.66], // Em7
        [146.83, 174.61, 220.0, 261.63], // Dm7
        [130.81, 164.81, 196.0, 246.94], // Cmaj7
      ];
      let chordIndex = 0;

      const playChord = () => {
        if (state.ambientMode !== 'lofi') return;
        const notes = chords[chordIndex % chords.length];
        chordIndex++;

        notes.forEach((freq) => {
          const osc = ctx.createOscillator();
          const filter = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, ctx.currentTime);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(800, ctx.currentTime);

          gain.gain.setValueAtTime(0.001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.032, ctx.currentTime + 0.35);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.7);

          osc.connect(filter);
          filter.connect(gain);
          gain.connect(ctx.destination);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 2.75);
        });
      };

      playChord();
      const intervalId = setInterval(playChord, 2800);
      ambientNodes = { intervalId };
    }
  } catch (_e) {
    // Ignore audio errors
  }
}

/* ==========================================================================
   2. Floating Particles, XP / Streak Leveling, Treats & Head-Patting
   ========================================================================== */

function spawnParticles(symbols = ['♥', '✨'], count = 3) {
  if (!dom.floatingParticles) return;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'particle-item';
    span.textContent = symbols[i % symbols.length];
    span.style.left = `${22 + Math.random() * 75}px`;
    span.style.top = `${10 + Math.random() * 25}px`;
    span.style.color = i % 2 === 0 ? '#F43F5E' : '#F59E0B';
    span.style.animationDelay = `${i * 0.09}s`;
    dom.floatingParticles.appendChild(span);
    setTimeout(() => span.remove(), 1200);
  }
}

function showBlushTemporarily(durationMs = 2400) {
  if (!dom.svgBlush) return;
  clearTimeout(state.blushTimer);
  dom.svgBlush.classList.remove('hidden');
  state.blushTimer = setTimeout(() => {
    dom.svgBlush.classList.add('hidden');
  }, durationMs);
}

/**
 * Awards XP, updates daily streak, and celebrates level-ups!
 */
async function awardXP(amount, extraStatsPatch = {}) {
  if (!state.settings) return;
  const stats = state.settings.stats || {
    xp: 0,
    level: 1,
    streak: 1,
    lastActiveDate: '',
    completedPomodoros: 0,
    completedGoals: 0,
    treatsFed: 0,
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  let nextStreak = stats.streak || 1;
  if (stats.lastActiveDate && stats.lastActiveDate !== todayStr) {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    nextStreak = stats.lastActiveDate === yesterday ? nextStreak + 1 : 1;
  }

  const prevLevel = stats.level || 1;
  const nextXp = (stats.xp || 0) + amount;
  const nextLevel = Math.floor(nextXp / 100) + 1;

  await updateSettings({
    stats: {
      ...stats,
      ...extraStatsPatch,
      xp: nextXp,
      level: nextLevel,
      streak: nextStreak,
      lastActiveDate: todayStr,
    },
  });

  if (nextLevel > prevLevel) {
    spawnParticles(['🎉', '⭐', '✨'], 5);
    playChimeSound('celebrate', true);
    triggerTemporaryExpression('wink', 3200, true);
  }
}

/**
 * Feeds the mascot a treat (Boba, Cookie, or Coffee) with munching animation & +10 XP.
 */
function feedMascotTreat(treatType = 'cookie') {
  if (state.isSleepingFromIdle) {
    state.isSleepingFromIdle = false;
  }

  clearTimeout(state.treatTimer);
  dom.propTreat.classList.remove('hidden');
  showBlushTemporarily(2600);

  dom.mascotWrapper.classList.remove('munching');
  void dom.mascotWrapper.offsetWidth;
  dom.mascotWrapper.classList.add('munching');

  spawnParticles(['♥', '✨', treatType === 'boba' ? '🧋' : treatType === 'coffee' ? '☕' : '🍪'], 4);
  playChimeSound('munch', true);
  triggerTemporaryExpression('wink', 2500, false);

  state.treatTimer = setTimeout(() => {
    dom.propTreat.classList.add('hidden');
    dom.mascotWrapper.classList.remove('munching');
  }, 1300);

  const curTreats = (state.settings && state.settings.stats && state.settings.stats.treatsFed) || 0;
  awardXP(10, { treatsFed: curTreats + 1 });
}

/**
 * Detects rapid cursor rubbing over the mascot's head for Head-Patting!
 */
function detectHeadPat(localX, localY) {
  const rect = dom.mascotWrapper.getBoundingClientRect();
  const isOverHead =
    localX >= rect.left &&
    localX <= rect.right &&
    localY >= rect.top &&
    localY <= rect.top + rect.height * 0.65;

  if (!isOverHead) {
    state.headPat.lastX = null;
    return;
  }

  if (state.headPat.lastX !== null) {
    const dx = localX - state.headPat.lastX;
    if (Math.abs(dx) >= 6) {
      const dir = Math.sign(dx);
      const now = Date.now();
      if (state.headPat.lastDir !== 0 && dir !== state.headPat.lastDir) {
        if (now - state.headPat.firstReversalAt > 1200) {
          state.headPat.reversals = 1;
          state.headPat.firstReversalAt = now;
        } else {
          state.headPat.reversals += 1;
        }

        if (state.headPat.reversals >= 3) {
          state.headPat.reversals = 0;
          showBlushTemporarily(2500);
          spawnParticles(['♥', '💕'], 3);
          triggerTemporaryExpression('wink', 2200, false);
          if (now - state.headPat.lastXpAt > 6000) {
            state.headPat.lastXpAt = now;
            playChimeSound('pat', false);
            awardXP(5);
          }
        }
      }
      state.headPat.lastDir = dir;
    }
  }
  state.headPat.lastX = localX;
}

/* ==========================================================================
   3. Color Utilities, Reaction Color Shifting, Circadian Props & Settings Sync
   ========================================================================== */

function deriveShadeColor(hex) {
  const clean = (hex || '#A695F5').replace('#', '');
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return '#8772E8';

  const r = Math.max(0, Math.round(((num >> 16) & 255) * 0.82));
  const g = Math.max(0, Math.round(((num >> 8) & 255) * 0.8));
  const b = Math.max(0, Math.round((num & 255) * 0.88));

  return (
    '#' +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

function applyColorForExpression(expr) {
  if (!state.settings) return;
  const { colors } = state.settings;
  const shiftEnabled = colors.reactionColorShift !== false;
  const reactionTheme = REACTION_PALETTES[expr];

  let bodyHex = colors.body || '#A695F5';
  let shadeHex = colors.customShade ? colors.shade : deriveShadeColor(bodyHex);

  if (shiftEnabled && reactionTheme) {
    bodyHex = reactionTheme.body;
    shadeHex = reactionTheme.shade;
  }

  dom.root.style.setProperty('--body', bodyHex);
  dom.root.style.setProperty('--shade', shadeHex);
  dom.root.style.setProperty('--eye-white', colors.eyeWhite || '#FFFDF5');
  dom.root.style.setProperty('--pupil', colors.pupil || '#2D2A3E');
}

function syncMusicHeadphones() {
  const isListening =
    state.systemAudioPlaying ||
    state.ambientMode !== 'off' ||
    (state.settings && state.settings.accessory === 'headphones');

  dom.mascotWrapper.classList.toggle('music-playing', isListening);
  dom.ringSoundBtn.classList.toggle('accent-red', isListening);
}

/**
 * Syncs Time-of-Day Circadian accessories (afternoon sunglasses / late-night cap).
 */
function syncCircadianMood() {
  if (!state.settings) return;
  const enabled = Boolean(state.settings.circadianMode);
  const manualAcc = state.settings.accessory || 'none';
  const hour = new Date().getHours();

  const showAfternoonShades =
    enabled && manualAcc === 'none' && hour >= 12 && hour < 17 && !state.isSleepingFromIdle;
  const showNightcap =
    enabled && manualAcc === 'none' && (hour >= 22 || hour < 6);

  dom.mascotWrapper.classList.toggle('circadian-sunglasses', showAfternoonShades);
  dom.mascotWrapper.classList.toggle('circadian-nightcap', showNightcap);
}

/**
 * Renders the Clipboard / Drag-and-Drop Pocket list inside Tab 4.
 */
function renderPocketList(items = []) {
  if (!dom.pocketList) return;
  dom.pocketList.innerHTML = '';

  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'pocket-empty';
    empty.textContent = 'Drop text/links onto mascot or click + Paste';
    dom.pocketList.appendChild(empty);
    return;
  }

  items.forEach((snippet, idx) => {
    const row = document.createElement('div');
    row.className = 'pocket-item';

    const textSpan = document.createElement('span');
    textSpan.className = 'pocket-item-text';
    textSpan.textContent = snippet;
    textSpan.title = 'Click to copy to clipboard';
    textSpan.addEventListener('click', async () => {
      await window.mascotAPI.writeClipboard(snippet);
      const original = textSpan.textContent;
      textSpan.textContent = '✓ Copied to clipboard!';
      setTimeout(() => {
        textSpan.textContent = original;
      }, 1100);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'pocket-del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Remove from pocket';
    delBtn.addEventListener('click', () => {
      const next = items.filter((_, i) => i !== idx);
      updateSettings({ pocketItems: next });
    });

    row.appendChild(textSpan);
    row.appendChild(delBtn);
    dom.pocketList.appendChild(row);
  });
}

/**
 * Adds a snippet to the mascot's 5-item pocket with a munch animation.
 */
async function addPocketSnippet(rawText) {
  const cleaned = (rawText || '').trim();
  if (!cleaned || !state.settings) return;

  const existing = Array.isArray(state.settings.pocketItems) ? state.settings.pocketItems : [];
  const next = [cleaned, ...existing.filter((item) => item !== cleaned)].slice(0, 5);

  dom.mascotWrapper.classList.remove('munching');
  void dom.mascotWrapper.offsetWidth;
  dom.mascotWrapper.classList.add('munching');
  spawnParticles(['📥', '✨'], 3);
  playChimeSound('munch', false);
  setTimeout(() => dom.mascotWrapper.classList.remove('munching'), 1100);

  await updateSettings({ pocketItems: next });
  awardXP(5);
}

/**
 * Applies current settings to CSS variables, SVG attributes, and UI controls.
 */
function applySettingsToUI(settings) {
  state.settings = settings;
  const {
    colors,
    shape,
    accessory,
    size,
    expression,
    autoExpressions,
    eyesFollowCursor,
    strollMode,
    gravityMode,
    circadianMode,
    wellnessReminders,
    ambientSound,
    launchAtStartup,
    pomodoro,
    stickyTask,
    stats,
    pocketItems,
  } = settings;

  const sizeInfo = SIZE_MAP[size] || SIZE_MAP.medium;
  dom.root.style.setProperty('--mascot-size', `${sizeInfo.px}px`);

  // Shape & Accessory attributes on mascot wrapper
  dom.mascotWrapper.setAttribute('data-shape', shape || 'ears');
  dom.mascotWrapper.setAttribute('data-accessory', accessory || 'none');

  dom.shapeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.shape === (shape || 'ears'));
  });
  dom.accessoryButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.accessory === (accessory || 'none'));
  });

  if (dom.circadianToggle) dom.circadianToggle.checked = circadianMode !== false;
  if (dom.gravityToggle) dom.gravityToggle.checked = gravityMode !== false;
  if (dom.wellnessToggle) dom.wellnessToggle.checked = wellnessReminders !== false;

  syncCircadianMood();
  syncMusicHeadphones();

  // Sync XP & Streak badge
  if (stats && dom.xpStreakBadge && dom.xpBarFill) {
    const lv = stats.level || 1;
    const streak = stats.streak || 1;
    const xpInLevel = (stats.xp || 0) % 100;
    dom.xpStreakBadge.textContent = `Lv.${lv} • 🔥${streak}`;
    dom.xpBarFill.style.width = `${xpInLevel}%`;
  }

  // Sync Pocket list
  renderPocketList(pocketItems || []);

  // Sync Ambient Sound if changed from settings
  if (ambientSound && ambientSound !== state.ambientMode) {
    setAmbientAudioMode(ambientSound);
  }

  // Sync customize form controls
  const effectiveShade = colors.customShade ? colors.shade : deriveShadeColor(colors.body);
  dom.reactionColorToggle.checked = colors.reactionColorShift !== false;
  dom.bodyColorPicker.value = colors.body;
  dom.customShadeToggle.checked = Boolean(colors.customShade);
  dom.shadeColorPicker.disabled = !colors.customShade;
  dom.shadeColorPicker.value = effectiveShade;
  dom.sizeSlider.value = String(sizeInfo.sliderIndex);
  dom.sizeLabel.textContent = sizeInfo.label;
  dom.eyesFollowToggle.checked = Boolean(eyesFollowCursor);
  dom.startupToggle.checked = Boolean(launchAtStartup);
  dom.autoExprToggle.checked = Boolean(autoExpressions);

  // Sync Pomodoro settings
  if (pomodoro) {
    dom.pomoFocusInput.value = String(pomodoro.focusMinutes || 25);
    dom.pomoBreakInput.value = String(pomodoro.breakMinutes || 5);
    dom.pomoAutoCycleToggle.checked = Boolean(pomodoro.autoCycle);
    dom.soundChimeToggle.checked = Boolean(pomodoro.soundEnabled);

    if (state.timer.status === 'idle' && state.timer.mode === 'pomodoro') {
      const mins =
        state.timer.phase === 'focus' ? pomodoro.focusMinutes || 25 : pomodoro.breakMinutes || 5;
      state.timer.durationSec = mins * 60;
      state.timer.remainingSec = state.timer.durationSec;
      renderTimerUI();
    }
  }

  // Sync Sticky Task
  const taskText = stickyTask && stickyTask.text ? stickyTask.text.trim() : '';
  dom.stickyTaskInput.value = taskText;
  dom.taskBubbleText.textContent = `📌 ${taskText}`;
  dom.taskBubble.classList.toggle('hidden', !taskText);

  // Sync Stroll Mode
  syncStrollMode(Boolean(strollMode));

  // Sync expression & reaction color
  if (state.isLowBatteryTired || state.isSleepingFromIdle) {
    setDisplayedExpression('sleepy');
  } else if (state.isHighLoad && !state.tempExpressionTimer) {
    setDisplayedExpression('angry');
  } else if (state.timer.status !== 'alert' && !state.tempExpressionTimer) {
    setDisplayedExpression(expression);
  } else {
    const activeExpr = dom.mascotWrapper.getAttribute('data-expression') || expression;
    applyColorForExpression(activeExpr);
  }
  syncExpressionButtons(expression);

  if (!eyesFollowCursor) {
    resetEyeTargets();
  }

  syncInteractiveWindowShape();
  setTimeout(syncInteractiveWindowShape, 230);
}

function setDisplayedExpression(expr) {
  dom.mascotWrapper.setAttribute('data-expression', expr);
  const showSleepZzz = expr === 'sleepy';
  dom.sleepIndicator.classList.toggle('hidden', !showSleepZzz);
  applyColorForExpression(expr);
}

function triggerTemporaryExpression(expr, durationMs = 2800, withHop = false) {
  if (state.isSleepingFromIdle || state.isLowBatteryTired || state.timer.status === 'alert') return;

  clearTimeout(state.tempExpressionTimer);
  setDisplayedExpression(expr);

  if (withHop) {
    dom.mascotWrapper.classList.remove('hopping');
    void dom.mascotWrapper.offsetWidth;
    dom.mascotWrapper.classList.add('hopping');
    setTimeout(() => dom.mascotWrapper.classList.remove('hopping'), 980);
  }

  state.tempExpressionTimer = setTimeout(() => {
    state.tempExpressionTimer = null;
    if (
      !state.isSleepingFromIdle &&
      !state.isLowBatteryTired &&
      state.timer.status !== 'alert' &&
      state.settings
    ) {
      setDisplayedExpression(state.isHighLoad ? 'angry' : state.settings.expression);
    }
  }, durationMs);
}

function syncExpressionButtons(selectedExpr) {
  dom.exprButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.expr === selectedExpr);
  });
}

async function updateSettings(patch) {
  const updated = await window.mascotAPI.updateSettings(patch);
  applySettingsToUI(updated);
}

/* ==========================================================================
   4. Power/Charging, Audio Playback & Laptop Telemetry (CPU Sweat + Offline)
   ========================================================================== */

function applyChargingState(isCharging, level = null) {
  const wasCharging = state.isCharging;
  state.isCharging = Boolean(isCharging);
  if (typeof level === 'number' && !Number.isNaN(level)) {
    state.batteryLevel = level;
  }

  // Show ONLY the flash bolt beside the mascot when charging
  dom.chargingBadge.classList.toggle('hidden', !state.isCharging);

  // Low battery (<= 20% and not charging) makes the mascot tired (sleepy)
  const isLowTired =
    !state.isCharging &&
    typeof state.batteryLevel === 'number' &&
    state.batteryLevel <= LOW_BATTERY_THRESHOLD;

  if (isLowTired !== state.isLowBatteryTired) {
    state.isLowBatteryTired = isLowTired;
    if (isLowTired) {
      setDisplayedExpression('sleepy');
    } else if (!state.isSleepingFromIdle && state.settings) {
      setDisplayedExpression(state.settings.expression);
    }
  }

  if (wasCharging === false && state.isCharging === true) {
    triggerTemporaryExpression('surprised', 2600, true);
  }
  syncInteractiveWindowShape();
}

function applyAudioPlayingState(isPlaying) {
  const next = Boolean(isPlaying);
  if (next !== state.systemAudioPlaying) {
    state.systemAudioPlaying = next;
    syncMusicHeadphones();
    if (next) {
      triggerTemporaryExpression('wink', 2200, true);
    }
  }
}

function applySystemTelemetry({ isHighLoad, isOnline }) {
  if (typeof isHighLoad === 'boolean' && isHighLoad !== state.isHighLoad) {
    state.isHighLoad = isHighLoad;
    if (dom.svgSweatDrop) {
      dom.svgSweatDrop.classList.toggle('hidden', !isHighLoad);
    }
    if (isHighLoad && !state.isSleepingFromIdle && !state.isLowBatteryTired) {
      setDisplayedExpression('angry');
    } else if (!isHighLoad && state.settings) {
      setDisplayedExpression(state.settings.expression);
    }
  }

  const effectiveOnline = Boolean(isOnline) && navigator.onLine !== false;
  if (effectiveOnline !== state.isOnline) {
    state.isOnline = effectiveOnline;
    if (dom.offlineBadge) {
      dom.offlineBadge.classList.toggle('hidden', effectiveOnline);
    }
    if (!effectiveOnline) {
      triggerTemporaryExpression('surprised', 3000, false);
    }
    syncInteractiveWindowShape();
  }
}

async function initPowerAndAudioMonitoring() {
  window.mascotAPI.onPowerStatus((status) => {
    if (status && typeof status.isCharging === 'boolean') {
      applyChargingState(status.isCharging, status.level);
    }
  });

  try {
    const initialPower = await window.mascotAPI.getPowerStatus();
    if (initialPower && typeof initialPower.isCharging === 'boolean') {
      applyChargingState(initialPower.isCharging, initialPower.level);
    }
  } catch (_e) {
    // Ignore
  }

  if (typeof navigator.getBattery === 'function') {
    try {
      const battery = await navigator.getBattery();
      const getPct = () => Math.round((battery.level || 0) * 100);
      applyChargingState(
        Boolean(battery.charging || state.isCharging),
        getPct() || state.batteryLevel
      );

      battery.addEventListener('chargingchange', () => {
        applyChargingState(battery.charging, getPct() || state.batteryLevel);
      });
      battery.addEventListener('levelchange', () => {
        applyChargingState(battery.charging, getPct());
      });
    } catch (_e) {
      // Ignore
    }
  }

  if (window.mascotAPI.onAudioStatus) {
    window.mascotAPI.onAudioStatus((status) => {
      if (status && typeof status.isPlaying === 'boolean') {
        applyAudioPlayingState(status.isPlaying);
      }
    });
  }

  if (window.mascotAPI.getAudioStatus) {
    try {
      const initialAudio = await window.mascotAPI.getAudioStatus();
      if (initialAudio && typeof initialAudio.isPlaying === 'boolean') {
        applyAudioPlayingState(initialAudio.isPlaying);
      }
    } catch (_e) {
      // Ignore
    }
  }

  // System Telemetry (CPU/RAM Sweat Drop & Wi-Fi Offline Indicator)
  if (window.mascotAPI.onSystemTelemetry) {
    window.mascotAPI.onSystemTelemetry((telemetry) => {
      if (telemetry) applySystemTelemetry(telemetry);
    });
  }
  if (window.mascotAPI.getSystemTelemetry) {
    try {
      const initTel = await window.mascotAPI.getSystemTelemetry();
      if (initTel) applySystemTelemetry(initTel);
    } catch (_e) {
      // Ignore
    }
  }

  window.addEventListener('online', () =>
    applySystemTelemetry({ isHighLoad: state.isHighLoad, isOnline: true })
  );
  window.addEventListener('offline', () =>
    applySystemTelemetry({ isHighLoad: state.isHighLoad, isOnline: false })
  );
}

/* ==========================================================================
   5. Click-Through Window Shape & Hit Testing
   ========================================================================== */

function syncInteractiveWindowShape() {
  if (state.drag.active) {
    window.mascotAPI.setWindowShape([
      { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    ]);
    return;
  }

  const elements = [
    { el: dom.mascotWrapper, pad: 28 },
    { el: dom.mascotSvg, pad: 28 },
    { el: dom.chargingBadge, pad: 12 },
    { el: dom.offlineBadge, pad: 10 },
    { el: dom.wellnessBubble, pad: 10 },
    { el: dom.timerBubble, pad: 10 },
    { el: dom.taskBubble, pad: 10 },
    { el: dom.popupMenu, pad: 24 },
    { el: dom.radialRing, pad: 28 },
  ];

  const rects = [];
  for (const { el, pad } of elements) {
    if (!el || el.classList.contains('hidden')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      rects.push({
        x: Math.max(0, r.left - pad),
        y: Math.max(0, r.top - pad),
        width: r.width + pad * 2,
        height: r.height + pad * 2,
      });
    }
  }

  if (rects.length > 0) {
    window.mascotAPI.setWindowShape(rects);
  }
}

function isPointOnInteractiveElement(localX, localY) {
  if (localX < 0 || localY < 0 || localX > window.innerWidth || localY > window.innerHeight) {
    return false;
  }
  const el = document.elementFromPoint(localX, localY);
  if (!el) return false;
  return Boolean(el.closest('.interactive'));
}

function updateClickThrough(localX, localY) {
  if (state.drag.active) {
    window.mascotAPI.setIgnoreMouseEvents(false);
    return;
  }
  const interactive = isPointOnInteractiveElement(localX, localY);
  window.mascotAPI.setIgnoreMouseEvents(!interactive);
}

/* ==========================================================================
   6. Full-Screen Cursor-Following Eyes & Smooth Lerp Loop
   ========================================================================== */

function updateEyesFromScreenOrLocal({
  winX,
  winY,
  localX,
  localY,
  displayX,
  displayY,
  displayWidth,
  displayHeight,
}) {
  if (
    !state.settings ||
    !state.settings.eyesFollowCursor ||
    state.isSleepingFromIdle ||
    state.isLowBatteryTired
  ) {
    return;
  }

  const wrapperRect = dom.mascotWrapper.getBoundingClientRect();
  const centerLocalX = wrapperRect.left + wrapperRect.width / 2;
  const centerLocalY = wrapperRect.top + wrapperRect.height / 2;

  const dx = localX - centerLocalX;
  const dy = localY - centerLocalY;

  const dispW = displayWidth || window.screen.width || 1920;
  const dispH = displayHeight || window.screen.height || 1080;
  const dispX = typeof displayX === 'number' ? displayX : 0;
  const dispY = typeof displayY === 'number' ? displayY : 0;

  const wX = typeof winX === 'number' ? winX : window.screenX || 0;
  const wY = typeof winY === 'number' ? winY : window.screenY || 0;
  const mascotScreenX = wX + centerLocalX;
  const mascotScreenY = wY + centerLocalY;

  const maxLeftDist = Math.max(260, mascotScreenX - dispX);
  const maxRightDist = Math.max(180, dispX + dispW - mascotScreenX);
  const maxUpDist = Math.max(260, mascotScreenY - dispY);
  const maxDownDist = Math.max(160, dispY + dispH - mascotScreenY);

  const rawX = dx < 0 ? dx / maxLeftDist : dx / maxRightDist;
  const rawY = dy < 0 ? dy / maxUpDist : dy / maxDownDist;

  const clampedX = Math.max(-1, Math.min(1, rawX));
  const clampedY = Math.max(-1, Math.min(1, rawY));

  const curvedX = Math.sign(clampedX) * Math.pow(Math.abs(clampedX), 0.62);
  const curvedY = Math.sign(clampedY) * Math.pow(Math.abs(clampedY), 0.62);

  state.eyeRig.tx = curvedX * MAX_EYE_OFFSET_X;
  state.eyeRig.ty = curvedY * MAX_EYE_OFFSET_Y;
}

function resetEyeTargets() {
  state.eyeRig.tx = 0;
  state.eyeRig.ty = 0;
}

function handleGlobalCursorMove(payload) {
  const { localX, localY, eyesFollow, timestamp } = payload;
  state.lastCursorMoveAt = timestamp || Date.now();

  // Morning greeting wave on first cursor movement between 5 AM and 11 AM
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  if (
    state.settings &&
    state.settings.circadianMode &&
    now.getHours() >= 5 &&
    now.getHours() < 11 &&
    state.greetedMorningDate !== todayStr
  ) {
    state.greetedMorningDate = todayStr;
    spawnParticles(['☀️', '✨', '♥'], 3);
    triggerTemporaryExpression('wink', 2800, true);
  }

  if (state.isSleepingFromIdle) {
    state.isSleepingFromIdle = false;
    if (!state.isLowBatteryTired && state.timer.status !== 'alert' && state.settings) {
      setDisplayedExpression(state.settings.expression);
    }
  }

  updateClickThrough(localX, localY);

  if (eyesFollow) {
    updateEyesFromScreenOrLocal(payload);
  }
}

function startEyeAnimationLoop() {
  function step() {
    const rig = state.eyeRig;
    rig.cx += (rig.tx - rig.cx) * EYE_LERP_SPEED;
    rig.cy += (rig.ty - rig.cy) * EYE_LERP_SPEED;

    dom.eyesRig.setAttribute(
      'transform',
      `translate(${rig.cx.toFixed(2)}, ${rig.cy.toFixed(2)})`
    );

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ==========================================================================
   7. Blinking, Idle Sleep, Wellness Reminders & Spontaneous Reactions
   ========================================================================== */

function scheduleNextBlink() {
  const delayMs = 2600 + Math.random() * 3400;
  setTimeout(() => {
    const currentExpr = dom.mascotWrapper.getAttribute('data-expression');
    const canBlink = !['sleepy', 'dizzy'].includes(currentExpr);

    if (canBlink) {
      dom.mascotWrapper.classList.add('blinking');
      setTimeout(() => {
        dom.mascotWrapper.classList.remove('blinking');
      }, 140);
    }
    scheduleNextBlink();
  }, delayMs);
}

function scheduleSpontaneousBehavior() {
  const delayMs = 12000 + Math.random() * 10000;
  setTimeout(() => {
    if (
      state.settings &&
      state.settings.autoExpressions &&
      !state.isSleepingFromIdle &&
      !state.isLowBatteryTired &&
      state.timer.status !== 'alert'
    ) {
      const reactions = ['wink', 'surprised', 'happy', 'angry', 'sad', 'glance'];
      const pick = reactions[Math.floor(Math.random() * reactions.length)];

      if (pick === 'glance') {
        const gx = (Math.random() > 0.5 ? 1 : -1) * 12;
        const gy = (Math.random() - 0.5) * 9;
        state.eyeRig.tx = gx;
        state.eyeRig.ty = gy;
        triggerTemporaryExpression('wink', 2400, false);
      } else {
        const shouldHop = pick === 'wink' || pick === 'surprised';
        triggerTemporaryExpression(pick, 3000, shouldHop);
      }
    }
    scheduleSpontaneousBehavior();
  }, delayMs);
}

function startIdleSleepAndWellnessMonitors() {
  setInterval(() => {
    const idleDuration = Date.now() - state.lastCursorMoveAt;
    if (
      !state.isSleepingFromIdle &&
      state.timer.status !== 'alert' &&
      idleDuration >= IDLE_SLEEP_TIMEOUT_MS
    ) {
      state.isSleepingFromIdle = true;
      resetEyeTargets();
      setDisplayedExpression('sleepy');
    }
    syncCircadianMood();
  }, 5000);

  // Hydration & Posture Micro-Reminders every 45 minutes
  setInterval(() => {
    if (state.settings && state.settings.wellnessReminders && !state.isSleepingFromIdle) {
      const prompt = WELLNESS_PROMPTS[Math.floor(Math.random() * WELLNESS_PROMPTS.length)];
      dom.wellnessBubbleText.textContent = prompt;
      dom.wellnessBubble.classList.remove('hidden');
      triggerTemporaryExpression('wink', 2600, true);
      syncInteractiveWindowShape();
    }
  }, WELLNESS_INTERVAL_MS);
}

/* ==========================================================================
   8. Screen-Edge Stroll Mode, Gravity Landing & Edge Peek-a-Boo
   ========================================================================== */

function syncStrollMode(enable) {
  dom.ringStrollBtn.classList.toggle('active', enable);
  dom.mascotWrapper.classList.toggle('strolling', enable);

  if (!enable) {
    if (state.stroll.timerId) {
      clearInterval(state.stroll.timerId);
      state.stroll.timerId = null;
    }
    return;
  }

  if (!state.stroll.timerId) {
    state.stroll.timerId = setInterval(async () => {
      if (
        state.drag.active ||
        state.isRingOpen ||
        state.isPanelOpen ||
        state.isSleepingFromIdle ||
        state.peekEdge
      ) {
        return;
      }
      const res = await window.mascotAPI.strollStep(state.stroll.direction * 3);
      if (res && res.layout) {
        applyMascotLayout(res.layout);
      }
      if (res && res.bounced) {
        state.stroll.direction *= -1;
        triggerTemporaryExpression('wink', 1800, false);
      }
    }, 50);
  }
}

function applyPeekEdgeState(peekEdge) {
  state.peekEdge = state.isRingOpen || state.isPanelOpen ? null : peekEdge || null;
  dom.mascotWrapper.classList.toggle('peek-left', state.peekEdge === 'left');
  dom.mascotWrapper.classList.toggle('peek-right', state.peekEdge === 'right');
  setTimeout(syncInteractiveWindowShape, 270);
}

function applyMascotLayout(layout) {
  if (!layout) return;
  if (typeof layout.inWinX === 'number' && typeof layout.inWinY === 'number') {
    dom.root.style.setProperty('--dock-x', `${Math.round(layout.inWinX)}px`);
    dom.root.style.setProperty('--dock-y', `${Math.round(layout.inWinY)}px`);
    if (dom.appStage) {
      dom.appStage.classList.toggle('dock-on-left', layout.inWinX < 210);
    }
  }
  applyPeekEdgeState(layout.peekEdge);
  syncInteractiveWindowShape();
}

function playLandingSquishBounce() {
  dom.mascotWrapper.classList.remove('bouncing');
  void dom.mascotWrapper.offsetWidth;
  dom.mascotWrapper.classList.add('bouncing');
  setTimeout(() => dom.mascotWrapper.classList.remove('bouncing'), 500);
  syncInteractiveWindowShape();
}

/* ==========================================================================
   9. Gooey Metaball Chain Menu, Detail Panel, Drag-to-Move & Drop Pocket
   ========================================================================== */

function toggleRingMenu(forceState) {
  const next = typeof forceState === 'boolean' ? forceState : !state.isRingOpen;
  state.isRingOpen = next;
  dom.radialRing.classList.toggle('hidden', !next);

  if (next && state.peekEdge) {
    applyPeekEdgeState(null);
  }
  if (!next) {
    closeDetailPanel();
  }
  syncInteractiveWindowShape();
  requestAnimationFrame(syncInteractiveWindowShape);
  setTimeout(syncInteractiveWindowShape, 260);
}

function openDetailPanel(panelKey) {
  if (state.isPanelOpen && state.activePanel === panelKey) {
    closeDetailPanel();
    return;
  }

  state.activePanel = panelKey;
  state.isPanelOpen = true;
  dom.panelTitle.textContent = PANEL_TITLES[panelKey] || 'Mascot Menu';
  dom.popupMenu.classList.remove('hidden');

  Object.entries(dom.tabPanels).forEach(([key, panel]) => {
    if (panel) {
      panel.classList.toggle('hidden', key !== panelKey);
    }
  });

  dom.ringButtons.forEach((btn) => {
    if (btn.dataset.ringPanel) {
      btn.classList.toggle('active', btn.dataset.ringPanel === panelKey);
    }
  });

  syncInteractiveWindowShape();
  requestAnimationFrame(syncInteractiveWindowShape);
  setTimeout(syncInteractiveWindowShape, 260);
}

function closeDetailPanel() {
  state.isPanelOpen = false;
  dom.popupMenu.classList.add('hidden');
  dom.ringButtons.forEach((btn) => {
    if (btn.dataset.ringPanel) {
      btn.classList.remove('active');
    }
  });
  window.mascotAPI.setFocusable(false);
  syncInteractiveWindowShape();
}

function setupMascotDragClickAndDropPocket() {
  if (window.mascotAPI.onMascotLayout) {
    window.mascotAPI.onMascotLayout((layout) => {
      applyMascotLayout(layout);
    });
  }

  if (window.mascotAPI.onWindowLanded) {
    window.mascotAPI.onWindowLanded((payload) => {
      if (payload && payload.settings) {
        state.settings = payload.settings;
      }
      if (payload && payload.layout) {
        applyMascotLayout(payload.layout);
      }
      playLandingSquishBounce();
    });
  }

  dom.mascotWrapper.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    if (state.timer.status === 'alert') {
      acknowledgeTimerAlert();
    }

    applyPeekEdgeState(null);
    state.drag.active = true;
    state.drag.moved = false;
    state.drag.startScreenX = e.screenX;
    state.drag.startScreenY = e.screenY;
    state.drag.lastScreenX = e.screenX;
    state.drag.lastScreenY = e.screenY;
    if (window.mascotAPI.startDrag) {
      window.mascotAPI.startDrag();
    }
    syncInteractiveWindowShape();
  });

  window.addEventListener('mousemove', (e) => {
    state.lastCursorMoveAt = Date.now();
    updateClickThrough(e.clientX, e.clientY);
    updateEyesFromScreenOrLocal({
      screenX: e.screenX,
      screenY: e.screenY,
      localX: e.clientX,
      localY: e.clientY,
    });

    if (!state.drag.active) {
      detectHeadPat(e.clientX, e.clientY);
      return;
    }

    const totalDx = e.screenX - state.drag.startScreenX;
    const totalDy = e.screenY - state.drag.startScreenY;

    if (!state.drag.moved && Math.hypot(totalDx, totalDy) > DRAG_THRESHOLD_PX) {
      state.drag.moved = true;
    }

    if (state.drag.moved) {
      const stepDx = e.screenX - state.drag.lastScreenX;
      const stepDy = e.screenY - state.drag.lastScreenY;
      if (stepDx !== 0 || stepDy !== 0) {
        window.mascotAPI.moveWindowBy(stepDx, stepDy);
        state.drag.lastScreenX = e.screenX;
        state.drag.lastScreenY = e.screenY;
      }
    }
  });

  window.addEventListener('mouseup', async () => {
    if (!state.drag.active) return;
    const wasMoved = state.drag.moved;
    state.drag.active = false;
    state.drag.moved = false;

    if (wasMoved) {
      if (window.mascotAPI.releaseDrag) {
        const res = await window.mascotAPI.releaseDrag();
        if (res) {
          if (res.layout) {
            applyMascotLayout(res.layout);
          }
          applyPeekEdgeState(res.peekEdge);
          if (!res.falling && !res.peekEdge) {
            playLandingSquishBounce();
          }
        }
      } else {
        playLandingSquishBounce();
        const updated = await window.mascotAPI.saveWindowPosition();
        state.settings = updated;
      }
      syncInteractiveWindowShape();
      requestAnimationFrame(syncInteractiveWindowShape);
    } else {
      toggleRingMenu();
    }
  });

  // Drag-and-Drop Text / URLs / Treats onto Mascot
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const treatType = e.dataTransfer && e.dataTransfer.getData('application/x-mascot-treat');
    if (treatType) {
      feedMascotTreat(treatType);
      return;
    }
    const droppedText =
      (e.dataTransfer &&
        (e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list'))) ||
      '';
    if (droppedText.trim()) {
      addPocketSnippet(droppedText);
    }
  });

  // Dismiss Wellness Reminder bubble (+10 XP!)
  if (dom.wellnessBubble) {
    dom.wellnessBubble.addEventListener('click', (e) => {
      e.stopPropagation();
      dom.wellnessBubble.classList.add('hidden');
      spawnParticles(['💧', '✨', '♥'], 3);
      playChimeSound('pat', false);
      awardXP(10);
      syncInteractiveWindowShape();
    });
  }

  dom.timerBubble.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.timer.status === 'alert') {
      acknowledgeTimerAlert();
    }
    toggleRingMenu(true);
    openDetailPanel('timer');
  });

  dom.taskBubble.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleRingMenu(true);
    openDetailPanel('task');
  });

  dom.ringButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panelKey = btn.dataset.ringPanel;
      const actionKey = btn.dataset.ringAction;

      if (panelKey) {
        openDetailPanel(panelKey);
        return;
      }

      if (actionKey === 'toggle-focus') {
        if (state.timer.status === 'running') {
          pauseTimer();
        } else if (state.timer.status === 'paused') {
          resumeTimer();
        } else {
          startTimer();
        }
      } else if (actionKey === 'toggle-music') {
        // Cycle built-in Ambient Audio ('off' -> 'lofi' -> 'rain' -> 'brown' -> 'off')
        const order = ['off', 'lofi', 'rain', 'brown'];
        const nextIdx = (order.indexOf(state.ambientMode) + 1) % order.length;
        const nextMode = order[nextIdx];
        setAmbientAudioMode(nextMode);
        updateSettings({ ambientSound: nextMode });
        if (nextMode !== 'off') {
          playChimeSound('celebrate', true);
          triggerTemporaryExpression('wink', 2600, true);
        }
      } else if (actionKey === 'toggle-stroll') {
        const nextStroll = !(state.settings && state.settings.strollMode);
        updateSettings({ strollMode: nextStroll });
      }
    });
  });

  dom.panelCloseBtn.addEventListener('click', () => {
    closeDetailPanel();
  });

  if (dom.settingsQuitBtn) {
    dom.settingsQuitBtn.addEventListener('click', () => {
      window.mascotAPI.quitApp();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.isPanelOpen) {
        closeDetailPanel();
      } else if (state.isRingOpen) {
        toggleRingMenu(false);
      }
    }
  });
}

/* ==========================================================================
   10. Pomodoro Focus / Breaks, Countdown Timer & Daily Alarm
   ========================================================================== */

function formatTime(totalSeconds) {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function syncPomodoroProps() {
  const isPomoActive =
    state.timer.mode === 'pomodoro' &&
    (state.timer.status === 'running' || state.timer.status === 'paused');

  const showGlasses = isPomoActive && state.timer.phase === 'focus';
  const showCoffee = isPomoActive && state.timer.phase === 'break';

  dom.propGlasses.classList.toggle('hidden', !showGlasses);
  dom.propCoffee.classList.toggle('hidden', !showCoffee);
}

function renderTimerUI() {
  const { mode, phase, round, status, remainingSec, alarmTimeStr } = state.timer;

  dom.modePills.forEach((pill) => {
    pill.classList.toggle('active', pill.dataset.timerMode === mode);
  });
  dom.pomodoroControls.classList.toggle('hidden', mode !== 'pomodoro');
  dom.countdownControls.classList.toggle('hidden', mode !== 'countdown');
  dom.alarmControls.classList.toggle('hidden', mode !== 'alarm');

  if (mode === 'alarm' && status === 'idle') {
    dom.menuTimerReadout.textContent = alarmTimeStr || '17:00';
    dom.menuCycleSubtext.textContent = 'Daily Alarm Target';
  } else {
    const formatted = formatTime(remainingSec);
    dom.menuTimerReadout.textContent = formatted;
    dom.bubbleTimerText.textContent = mode === 'alarm' ? `⏰ ${alarmTimeStr}` : formatted;

    if (mode === 'pomodoro') {
      const phaseLabel = phase === 'focus' ? '🎯 Focus' : '☕ Break';
      dom.menuCycleSubtext.textContent = `${phaseLabel} • Round ${round}/4`;
      dom.bubblePhaseIcon.textContent = phase === 'focus' ? '🎯' : '☕';
    } else if (mode === 'countdown') {
      dom.menuCycleSubtext.textContent = 'Countdown Timer';
      dom.bubblePhaseIcon.textContent = '⏳';
    } else {
      dom.menuCycleSubtext.textContent = `Alarm set for ${alarmTimeStr}`;
      dom.bubblePhaseIcon.textContent = '⏰';
    }
  }

  const statusLabels = {
    idle: 'Ready',
    running: mode === 'pomodoro' ? (phase === 'focus' ? 'Focusing' : 'On Break') : 'Running',
    paused: 'Paused',
    alert: 'Time Up!',
  };
  dom.menuTimerStatus.textContent = statusLabels[status] || 'Ready';

  dom.ringQuickFocusBtn.classList.toggle(
    'accent-red',
    status === 'running' || status === 'alert'
  );

  const showBubble = status === 'running' || status === 'paused' || status === 'alert';
  dom.timerBubble.classList.toggle('hidden', !showBubble);
  dom.timerBubble.classList.toggle('alert', status === 'alert');

  dom.timerStartBtn.classList.toggle('hidden', status === 'running' || status === 'paused');
  dom.timerPauseBtn.classList.toggle('hidden', status !== 'running');
  dom.timerResumeBtn.classList.toggle('hidden', status !== 'paused');
  dom.timerSkipBtn.classList.toggle(
    'hidden',
    mode !== 'pomodoro' || (status !== 'running' && status !== 'paused')
  );
  dom.timerCancelBtn.classList.toggle('hidden', status === 'idle');

  syncPomodoroProps();
  syncInteractiveWindowShape();
}

function computeAlarmRemainingSeconds(timeStr) {
  const [hh, mm] = (timeStr || '17:00').split(':').map((n) => parseInt(n, 10));
  const now = new Date();
  const target = new Date(now);
  target.setHours(Number.isNaN(hh) ? 17 : hh, Number.isNaN(mm) ? 0 : mm, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(1, Math.round((target.getTime() - now.getTime()) / 1000));
}

function setTimerDurationMinutes(minutes) {
  const mins = Math.max(1, Math.min(240, Math.round(Number(minutes) || 25)));
  state.timer.durationSec = mins * 60;
  if (state.timer.status === 'idle' || state.timer.status === 'alert') {
    state.timer.remainingSec = state.timer.durationSec;
    state.timer.status = 'idle';
    renderTimerUI();
  }
}

function startTimer() {
  acknowledgeTimerAlert();
  clearInterval(state.timer.intervalId);

  if (state.timer.mode === 'pomodoro') {
    const pomo = (state.settings && state.settings.pomodoro) || {};
    const mins =
      state.timer.phase === 'focus' ? pomo.focusMinutes || 25 : pomo.breakMinutes || 5;
    state.timer.durationSec = mins * 60;
    state.timer.remainingSec = state.timer.durationSec;
  } else if (state.timer.mode === 'countdown') {
    if (state.timer.remainingSec <= 0) {
      state.timer.remainingSec = state.timer.durationSec;
    }
  } else if (state.timer.mode === 'alarm') {
    state.timer.alarmTimeStr = dom.alarmTimeInput.value || '17:00';
    state.timer.alarmLabel = dom.alarmLabelInput.value.trim();
    state.timer.durationSec = computeAlarmRemainingSeconds(state.timer.alarmTimeStr);
    state.timer.remainingSec = state.timer.durationSec;
  }

  state.timer.status = 'running';
  state.timer.endTimeMs = Date.now() + state.timer.remainingSec * 1000;
  state.timer.intervalId = setInterval(tickTimer, 250);
  renderTimerUI();
}

function pauseTimer() {
  if (state.timer.status !== 'running') return;
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.remainingSec = Math.max(
    0,
    Math.ceil((state.timer.endTimeMs - Date.now()) / 1000)
  );
  state.timer.status = 'paused';
  renderTimerUI();
}

function resumeTimer() {
  if (state.timer.status !== 'paused') return;
  state.timer.status = 'running';
  state.timer.endTimeMs = Date.now() + state.timer.remainingSec * 1000;
  state.timer.intervalId = setInterval(tickTimer, 250);
  renderTimerUI();
}

function cancelTimer() {
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  acknowledgeTimerAlert();
  state.timer.status = 'idle';
  state.timer.phase = 'focus';
  state.timer.round = 1;

  if (state.timer.mode === 'pomodoro' && state.settings && state.settings.pomodoro) {
    state.timer.durationSec = (state.settings.pomodoro.focusMinutes || 25) * 60;
  }
  state.timer.remainingSec = state.timer.durationSec;
  renderTimerUI();
}

function skipPomodoroPhase() {
  if (state.timer.mode !== 'pomodoro') return;
  advancePomodoroPhase(true);
}

function tickTimer() {
  const remaining = Math.ceil((state.timer.endTimeMs - Date.now()) / 1000);
  if (remaining <= 0) {
    handleTimerFinished();
    return;
  }
  if (remaining !== state.timer.remainingSec) {
    state.timer.remainingSec = remaining;
    renderTimerUI();
  }
}

function advancePomodoroPhase(autoStart) {
  const pomo = (state.settings && state.settings.pomodoro) || {};

  if (state.timer.phase === 'focus') {
    state.timer.phase = 'break';
    const isLongBreak = state.timer.round % 4 === 0;
    const breakMins = isLongBreak ? pomo.longBreakMinutes || 15 : pomo.breakMinutes || 5;
    state.timer.durationSec = breakMins * 60;
    state.timer.remainingSec = state.timer.durationSec;
  } else {
    state.timer.phase = 'focus';
    state.timer.round = (state.timer.round % 4) + 1;
    const focusMins = pomo.focusMinutes || 25;
    state.timer.durationSec = focusMins * 60;
    state.timer.remainingSec = state.timer.durationSec;
  }

  if (autoStart) {
    state.timer.status = 'running';
    state.timer.endTimeMs = Date.now() + state.timer.remainingSec * 1000;
    clearInterval(state.timer.intervalId);
    state.timer.intervalId = setInterval(tickTimer, 250);
  } else {
    state.timer.status = 'idle';
  }
  renderTimerUI();
}

function handleTimerFinished() {
  clearInterval(state.timer.intervalId);
  state.timer.intervalId = null;
  state.timer.remainingSec = 0;

  playChimeSound('alert');

  dom.mascotWrapper.classList.remove('shaking');
  void dom.mascotWrapper.offsetWidth;
  dom.mascotWrapper.classList.add('shaking');

  if (state.timer.mode === 'pomodoro') {
    const finishedFocus = state.timer.phase === 'focus';
    if (finishedFocus) {
      const doneCount =
        ((state.settings &&
          state.settings.stats &&
          state.settings.stats.completedPomodoros) ||
          0) + 1;
      awardXP(40, { completedPomodoros: doneCount });
    }

    const title = finishedFocus ? 'Focus Round Complete! 🎉' : 'Break Over! 🎯';
    const body = finishedFocus
      ? 'Awesome focus! Time to grab a coffee and rest.'
      : 'Break finished! Ready for your next focus session?';
    window.mascotAPI.notifyTimerDone(title, body);

    const autoCycle = state.settings && state.settings.pomodoro && state.settings.pomodoro.autoCycle;
    if (autoCycle) {
      triggerTemporaryExpression(finishedFocus ? 'wink' : 'surprised', 3200, true);
      advancePomodoroPhase(true);
      return;
    }
  } else if (state.timer.mode === 'alarm') {
    const note = state.timer.alarmLabel || `It's ${state.timer.alarmTimeStr}!`;
    window.mascotAPI.notifyTimerDone('⏰ Mascot Alarm!', note);
  } else {
    const mins = Math.round(state.timer.durationSec / 60);
    window.mascotAPI.notifyTimerDone('⏳ Timer Complete!', `Your ${mins}-minute timer is up!`);
  }

  state.timer.status = 'alert';
  setDisplayedExpression('surprised');
  renderTimerUI();
}

function acknowledgeTimerAlert() {
  if (state.timer.status !== 'alert') return;
  dom.mascotWrapper.classList.remove('shaking');
  if (state.settings && !state.isSleepingFromIdle && !state.isLowBatteryTired) {
    setDisplayedExpression(state.settings.expression);
  }
}

function setupTimerControls() {
  dom.modePills.forEach((pill) => {
    pill.addEventListener('click', () => {
      if (state.timer.status === 'running' || state.timer.status === 'paused') {
        cancelTimer();
      }
      state.timer.mode = pill.dataset.timerMode;
      if (state.timer.mode === 'pomodoro' && state.settings && state.settings.pomodoro) {
        state.timer.phase = 'focus';
        state.timer.durationSec = (state.settings.pomodoro.focusMinutes || 25) * 60;
        state.timer.remainingSec = state.timer.durationSec;
      } else if (state.timer.mode === 'countdown') {
        const mins = parseInt(dom.customMinutesInput.value, 10) || 25;
        state.timer.durationSec = mins * 60;
        state.timer.remainingSec = state.timer.durationSec;
      }
      renderTimerUI();
    });
  });

  dom.pomoFocusInput.addEventListener('change', () => {
    const focusMinutes = Math.max(1, Math.min(180, parseInt(dom.pomoFocusInput.value, 10) || 25));
    updateSettings({ pomodoro: { focusMinutes } });
  });

  dom.pomoBreakInput.addEventListener('change', () => {
    const breakMinutes = Math.max(1, Math.min(60, parseInt(dom.pomoBreakInput.value, 10) || 5));
    updateSettings({ pomodoro: { breakMinutes } });
  });

  dom.pomoAutoCycleToggle.addEventListener('change', () => {
    updateSettings({ pomodoro: { autoCycle: dom.pomoAutoCycleToggle.checked } });
  });

  dom.soundChimeToggle.addEventListener('change', () => {
    updateSettings({ pomodoro: { soundEnabled: dom.soundChimeToggle.checked } });
  });

  if (dom.wellnessToggle) {
    dom.wellnessToggle.addEventListener('change', () => {
      updateSettings({ wellnessReminders: dom.wellnessToggle.checked });
    });
  }

  if (dom.wellnessTestBtn) {
    dom.wellnessTestBtn.addEventListener('click', () => {
      const prompt = WELLNESS_PROMPTS[Math.floor(Math.random() * WELLNESS_PROMPTS.length)];
      dom.wellnessBubbleText.textContent = prompt;
      dom.wellnessBubble.classList.remove('hidden');
      triggerTemporaryExpression('wink', 2400, true);
      syncInteractiveWindowShape();
    });
  }

  dom.ambientButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.ambient || 'off';
      setAmbientAudioMode(mode);
      updateSettings({ ambientSound: mode });
    });
  });

  dom.presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      dom.presetButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mins = parseInt(btn.dataset.minutes, 10);
      dom.customMinutesInput.value = String(mins);
      setTimerDurationMinutes(mins);
    });
  });

  dom.customMinutesInput.addEventListener('change', () => {
    dom.presetButtons.forEach((b) => b.classList.remove('active'));
    setTimerDurationMinutes(dom.customMinutesInput.value);
  });

  document.querySelectorAll('.focusable-input').forEach((input) => {
    input.addEventListener('focus', () => window.mascotAPI.setFocusable(true));
    input.addEventListener('blur', () => window.mascotAPI.setFocusable(false));
  });

  dom.timerStartBtn.addEventListener('click', startTimer);
  dom.timerPauseBtn.addEventListener('click', pauseTimer);
  dom.timerResumeBtn.addEventListener('click', resumeTimer);
  dom.timerSkipBtn.addEventListener('click', skipPomodoroPhase);
  dom.timerCancelBtn.addEventListener('click', cancelTimer);
}

/* ==========================================================================
   11. Customization, 12 Shapes, Accessories, Treats, Task & Pocket Controls
   ========================================================================== */

function setupCustomizationAndFeatures() {
  dom.shapeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      updateSettings({ shape: btn.dataset.shape });
      triggerTemporaryExpression('wink', 1600, true);
    });
  });

  dom.accessoryButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      updateSettings({ accessory: btn.dataset.accessory });
    });
  });

  if (dom.circadianToggle) {
    dom.circadianToggle.addEventListener('change', () => {
      updateSettings({ circadianMode: dom.circadianToggle.checked });
    });
  }

  dom.treatButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      feedMascotTreat(btn.dataset.treat || 'cookie');
    });
    btn.addEventListener('dragstart', (e) => {
      if (e.dataTransfer) {
        e.dataTransfer.setData('application/x-mascot-treat', btn.dataset.treat || 'cookie');
      }
    });
  });

  dom.paletteSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      const body = swatch.dataset.body;
      const shade = swatch.dataset.shade;
      updateSettings({
        colors: {
          body,
          shade,
          customShade: false,
          reactionColorShift: false,
        },
      });
    });
  });

  dom.reactionColorToggle.addEventListener('change', () => {
    updateSettings({
      colors: {
        reactionColorShift: dom.reactionColorToggle.checked,
      },
    });
  });

  dom.bodyColorPicker.addEventListener('input', () => {
    const body = dom.bodyColorPicker.value.toUpperCase();
    const shade = dom.customShadeToggle.checked
      ? dom.shadeColorPicker.value.toUpperCase()
      : deriveShadeColor(body);
    updateSettings({
      colors: { body, shade, reactionColorShift: false },
    });
  });

  dom.customShadeToggle.addEventListener('change', () => {
    const customShade = dom.customShadeToggle.checked;
    const body = dom.bodyColorPicker.value.toUpperCase();
    const shade = customShade
      ? dom.shadeColorPicker.value.toUpperCase()
      : deriveShadeColor(body);
    updateSettings({
      colors: { customShade, shade },
    });
  });

  dom.shadeColorPicker.addEventListener('input', () => {
    if (!dom.customShadeToggle.checked) return;
    updateSettings({
      colors: {
        shade: dom.shadeColorPicker.value.toUpperCase(),
        customShade: true,
        reactionColorShift: false,
      },
    });
  });

  dom.sizeSlider.addEventListener('input', () => {
    const index = parseInt(dom.sizeSlider.value, 10);
    const sizeKey = INDEX_TO_SIZE[index] || 'medium';
    updateSettings({ size: sizeKey });
  });

  if (dom.gravityToggle) {
    dom.gravityToggle.addEventListener('change', () => {
      updateSettings({ gravityMode: dom.gravityToggle.checked });
    });
  }

  dom.eyesFollowToggle.addEventListener('change', () => {
    updateSettings({ eyesFollowCursor: dom.eyesFollowToggle.checked });
  });

  dom.startupToggle.addEventListener('change', () => {
    updateSettings({ launchAtStartup: dom.startupToggle.checked });
  });

  dom.autoExprToggle.addEventListener('change', () => {
    updateSettings({ autoExpressions: dom.autoExprToggle.checked });
  });

  dom.exprButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const expr = btn.dataset.expr;
      acknowledgeTimerAlert();
      clearTimeout(state.tempExpressionTimer);
      state.tempExpressionTimer = null;
      state.isSleepingFromIdle = false;
      updateSettings({ expression: expr });
    });
  });

  // Sticky Focus Goal + Pocket Controls
  dom.stickyTaskInput.addEventListener('change', () => {
    updateSettings({
      stickyTask: { text: dom.stickyTaskInput.value.trim(), done: false },
    });
  });

  dom.taskCompleteBtn.addEventListener('click', () => {
    const hasGoal = dom.stickyTaskInput.value.trim().length > 0;
    updateSettings({ stickyTask: { text: '', done: true } });
    playChimeSound('celebrate', true);
    spawnParticles(['🎉', '⭐', '♥'], 4);
    triggerTemporaryExpression('wink', 2800, true);
    if (hasGoal) {
      const doneGoals =
        ((state.settings && state.settings.stats && state.settings.stats.completedGoals) || 0) + 1;
      awardXP(25, { completedGoals: doneGoals });
    }
  });

  dom.taskClearBtn.addEventListener('click', () => {
    updateSettings({ stickyTask: { text: '', done: false } });
  });

  if (dom.pocketPasteBtn) {
    dom.pocketPasteBtn.addEventListener('click', async () => {
      const clipText = await window.mascotAPI.readClipboard();
      if (clipText && clipText.trim()) {
        addPocketSnippet(clipText);
      }
    });
  }
}

/* ==========================================================================
   12. Bootstrap
   ========================================================================== */

async function init() {
  const initialSettings = await window.mascotAPI.getSettings();
  applySettingsToUI(initialSettings);

  if (window.mascotAPI.getMascotLayout) {
    const initialLayout = await window.mascotAPI.getMascotLayout();
    applyMascotLayout(initialLayout);
  }

  setupMascotDragClickAndDropPocket();
  setupTimerControls();
  setupCustomizationAndFeatures();
  renderTimerUI();

  window.mascotAPI.onCursorMove(handleGlobalCursorMove);
  await initPowerAndAudioMonitoring();

  startEyeAnimationLoop();
  scheduleNextBlink();
  scheduleSpontaneousBehavior();
  startIdleSleepAndWellnessMonitors();
  setTimeout(syncInteractiveWindowShape, 120);
}

init();
