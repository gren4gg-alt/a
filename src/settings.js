import { CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// Settings.
//
// One store, persisted to localStorage, wrapped because private-mode Safari
// throws on write. Everything reads from here rather than from constants
// scattered across modules, so a change lands everywhere at once.
// ---------------------------------------------------------------------------

const KEY = 'darkhouse.settings.v6';

export const QUALITY = {
  potato: {
    label: 'Potato',
    note: 'For laptops that get warm thinking about it.',
    pixelRatio: 0.7, drawDistance: 20, bakeScale: 1.55, aa: false,
  },
  low: {
    label: 'Low',
    note: 'Shorter sight lines, coarser light.',
    pixelRatio: 1.0, drawDistance: 26, bakeScale: 1.28, aa: false,
  },
  balanced: {
    label: 'Balanced',
    note: 'What the game was tuned against.',
    pixelRatio: 1.25, drawDistance: 34, bakeScale: 1.0, aa: true,
  },
  high: {
    label: 'High',
    note: 'Finer baked light. Longer load, same frame rate.',
    pixelRatio: 1.5, drawDistance: 42, bakeScale: 0.85, aa: true,
  },
};

/** Order here is the order they appear in the controls screen. */
export const BINDABLE = [
  { id: 'forward',    label: 'Walk forward',     def: 'KeyW' },
  { id: 'back',       label: 'Walk back',        def: 'KeyS' },
  { id: 'left',       label: 'Step left',        def: 'KeyA' },
  { id: 'right',      label: 'Step right',       def: 'KeyD' },
  { id: 'sprint',     label: 'Run',              def: 'ShiftLeft' },
  { id: 'crouch',     label: 'Crouch',           def: 'ControlLeft' },
  { id: 'flashlight', label: 'Flashlight',       def: 'KeyF' },
  { id: 'interact',   label: 'Pick someone up',  def: 'KeyE' },
  { id: 'power',      label: 'Use your ability', def: 'KeyQ' },
  { id: 'talk',       label: 'Push to talk',     def: 'KeyV' },
  { id: 'stats',      label: 'Show frame stats', def: 'F2' },
];

// Coarse pointer means a phone or tablet, where Balanced is not a sensible
// first impression. Only a DEFAULT: anything saved wins over it.
const onTouch = typeof window !== 'undefined'
  && (window.matchMedia?.('(pointer: coarse)')?.matches
      || (navigator?.maxTouchPoints ?? 0) > 0);

const DEFAULTS = () => ({
  volume: { master: 0.8, sfx: 0.9, ambience: 0.8, voice: 1.0 },
  voice: { pushToTalk: true, inputGain: 1.0 },
  graphics: { quality: onTouch ? 'potato' : 'balanced', fov: onTouch ? 78 : 74 },
  input: { sensitivity: onTouch ? 3.4 : 2.2, invertY: false },
  binds: Object.fromEntries(BINDABLE.map((b) => [b.id, b.def])),
  name: '',
});

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], patch[k]);
    } else if (patch[k] !== undefined) {
      base[k] = patch[k];
    }
  }
  return base;
}

class SettingsStore {
  constructor() {
    this.data = DEFAULTS();
    this.listeners = [];
    try {
      const raw = localStorage.getItem(KEY);
      // Merge rather than replace, so a saved file from an older build that is
      // missing a key still boots with a sane value for it.
      if (raw) deepMerge(this.data, JSON.parse(raw));
    } catch { /* defaults */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* memory only */ }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn) { this.listeners.push(fn); }

  reset() {
    this.data = DEFAULTS();
    this.save();
  }

  get quality() { return QUALITY[this.data.graphics.quality] ?? QUALITY.balanced; }

  /** Push graphics settings into the shared CONFIG the world builder reads. */
  applyToConfig() {
    const q = this.quality;
    CONFIG.drawDistance = q.drawDistance;
    CONFIG.bakeStepScale = q.bakeScale;
  }

  /** Which action, if any, is this key code bound to? */
  actionFor(code) {
    for (const [id, bound] of Object.entries(this.data.binds)) {
      if (bound === code) return id;
    }
    return null;
  }

  /** Rebinding is exclusive: taking a key frees it from whatever had it. */
  bind(actionId, code) {
    for (const [id, bound] of Object.entries(this.data.binds)) {
      if (id !== actionId && bound === code) this.data.binds[id] = null;
    }
    this.data.binds[actionId] = code;
    this.save();
  }
}

export const settings = new SettingsStore();

// ---------------------------------------------------------------------------

const NAMED_KEYS = {
  Space: 'Space', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Tab: 'Tab', CapsLock: 'Caps Lock', Backquote: '`', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';',
  Quote: "'", Comma: ',', Period: '.', Slash: '/', Enter: 'Enter',
  Mouse0: 'Left click', Mouse1: 'Middle click', Mouse2: 'Right click',
  Mouse3: 'Mouse 4', Mouse4: 'Mouse 5',
};

export function keyLabel(code) {
  if (!code) return 'unbound';
  if (NAMED_KEYS[code]) return NAMED_KEYS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}
