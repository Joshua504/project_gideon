const { contextBridge, ipcRenderer } = require('electron');

/**
 * Exposes a minimal, strict API to the renderer process via contextBridge.
 */
contextBridge.exposeInMainWorld('mascotAPI', {
  // Settings persistence
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),

  // Global cursor tracking subscription
  onCursorMove: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('cursor:move', listener);
    return () => ipcRenderer.removeListener('cursor:move', listener);
  },

  // Battery / charging status
  getPowerStatus: () => ipcRenderer.invoke('power:get'),
  onPowerStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('power:status', listener);
    return () => ipcRenderer.removeListener('power:status', listener);
  },

  // System audio / music playback detection
  getAudioStatus: () => ipcRenderer.invoke('audio:get'),
  onAudioStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('audio:status', listener);
    return () => ipcRenderer.removeListener('audio:status', listener);
  },

  // System telemetry (CPU / RAM sweat indicator & Wi-Fi offline indicator)
  getSystemTelemetry: () => ipcRenderer.invoke('system:get-telemetry'),
  onSystemTelemetry: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('system:telemetry', listener);
    return () => ipcRenderer.removeListener('system:telemetry', listener);
  },

  // App Usage Awareness (detects focused app category)
  getAppAwareness: () => ipcRenderer.invoke('app:get-awareness'),
  onAppAwareness: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('app:awareness', listener);
    return () => ipcRenderer.removeListener('app:awareness', listener);
  },

  // Clipboard helpers for Pocket feature
  writeClipboard: (text) => ipcRenderer.invoke('clipboard:write', text),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),

  // Window interaction, shape, layout, gravity & positioning
  getMascotLayout: () => ipcRenderer.invoke('window:get-layout'),
  onMascotLayout: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('window:mascot-layout', listener);
    return () => ipcRenderer.removeListener('window:mascot-layout', listener);
  },
  setWindowShape: (rects) => ipcRenderer.send('window:set-shape', rects),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('window:set-ignore-mouse', ignore),
  setFocusable: (focusable) => ipcRenderer.send('window:set-focusable', focusable),
  startDrag: () => ipcRenderer.send('window:start-drag'),
  moveWindowBy: (dx, dy) => ipcRenderer.send('window:move-by', { dx, dy }),
  strollStep: (dx) => ipcRenderer.invoke('window:stroll-step', dx),
  releaseDrag: () => ipcRenderer.invoke('window:release-drag'),
  onWindowLanded: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('window:landed', listener);
    return () => ipcRenderer.removeListener('window:landed', listener);
  },
  saveWindowPosition: () => ipcRenderer.invoke('window:save-position'),

  // System notifications & lifecycle
  notifyTimerDone: (title, body) => ipcRenderer.send('timer:notify', { title, body }),
  quitApp: () => ipcRenderer.send('app:quit'),

  // Voice / Name-call response (triggered by global shortcut Alt+O)
  onVoiceRespond: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:respond', listener);
    return () => ipcRenderer.removeListener('voice:respond', listener);
  },

  // Speak text using system TTS (main process handles it)
  speakText: (text, pitch, rate) => ipcRenderer.invoke('voice:speak', { text, pitch, rate }),

  // Notify renderer of the registered shortcut key
  onVoiceShortcutRegistered: (callback) => {
    const listener = (_event, shortcut) => callback(shortcut);
    ipcRenderer.on('voice:shortcut-registered', listener);
    return () => ipcRenderer.removeListener('voice:shortcut-registered', listener);
  },

  // Voice Activation (Python SpeechRecognition)
  startVoiceActivation: (mascotName) => ipcRenderer.invoke('voice:activation:start', { mascotName }),
  stopVoiceActivation: () => ipcRenderer.invoke('voice:activation:stop'),
  onVoiceActivationDetected: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:activation:detected', listener);
    return () => ipcRenderer.removeListener('voice:activation:detected', listener);
  },
  onVoiceActivationStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('voice:activation:status', listener);
    return () => ipcRenderer.removeListener('voice:activation:status', listener);
  },
});
