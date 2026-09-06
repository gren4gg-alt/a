import { CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// Settings.
//
// One store, persisted to localStorage, wrapped because private-mode Safari
// throws on write. Everything reads from here rather than from constants
// scattered across modules, so a change lands everywhere at once.
// ---------------------------------------------------------------------------

const KEY = 'darkhouse.settings.v10';

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

/**
 * Default on-screen control layout, landscape.
 *
 * x and y are fractions of the viewport for the BUTTON CENTRE, so a layout
 * survives a rotation or a different phone; size is in CSS pixels before the
 * global scale. Laid out as a right-thumb arc with the one you press most in
 * the middle of it, the way a shooter does it, rather than a neat grid nobody
 * can reach the corners of.
 */
export const TOUCH_DEFAULTS = {
  interact:   { x: 0.870, y: 0.720, size: 84 },
  power:      { x: 0.745, y: 0.500, size: 64 },
  // RUN lives on the LEFT, just above and right of the walking stick, the way
  // every mobile shooter places it. It is a hold, and you hold it with the
  // same thumb that is already steering — putting it under the right thumb
  // meant letting go of aim to start sprinting.
  sprint:     { x: 0.300, y: 0.315, size: 68 },
  crouch:     { x: 0.955, y: 0.790, size: 62 },
  flashlight: { x: 0.720, y: 0.855, size: 58 },
  // Kept clear of the top-right corner: the timer and the door counter live
  // there and the button was landing on top of both.
  talk:       { x: 0.560, y: 0.115, size: 52 },
};

/**
 * Bumped whenever the default placement above changes.
 *
 * A saved layout is merged over the defaults, so anyone who has played before
 * keeps their old positions forever — including the ones we just decided were
 * wrong. This resets the placement once, and only the placement: binds, name,
 * audio and graphics are untouched. Someone who has deliberately dragged their
 * own buttons around loses that one arrangement, which is the trade.
 */
export const TOUCH_LAYOUT_VERSION = 2;

/** Order here is the order they appear in the controls screen. */
export const BINDABLE = [
  { id: 'forward',    label: 'Walk forward',     def: 'KeyW' },
  { id: 'back',       label: 'Walk back',        def: 'KeyS' },
  { id: 'left',       label: 'Step left',        def: 'KeyA' },
  { id: 'right',      label: 'Step right',       def: 'KeyD' },
  { id: 'sprint',     label: 'Run',              def: 'ShiftLeft' },
  { id: 'crouch',     label: 'Crouch',           def: 'KeyC' },
  { id: 'flashlight', label: 'Flashlight',       def: 'KeyF' },
  { id: 'interact',   label: 'Pick someone up',  def: 'KeyE' },
  { id: 'power',      label: 'Use your ability', def: 'KeyQ' },
  { id: 'talk',       label: 'Push to talk',     def: 'KeyV' },
  { id: 'cursor',     label: 'Free the mouse',   def: 'AltLeft' },
  { id: 'fullscreen', label: 'Fullscreen',       def: 'KeyG' },
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
  input: {
    sensitivity: onTouch ? 3.4 : 2.2,
    invertY: false,
    // A thumb drag covers a few hundred pixels; a mouse sweep covers thousands.
    // Sharing one number made one of them unusable, so touch has its own.
    // 5.0 turns roughly 90 degrees per half-screen swipe.
    touchSensitivity: 5.0,
    // Hold to crouch by default; a toggle suits long crawls through tunnels.
    crouchToggle: false,
  },
  binds: Object.fromEntries(BINDABLE.map((b) => [b.id, b.def])),
  touch: {
    layout: JSON.parse(JSON.stringify(TOUCH_DEFAULTS)),
    // 1, not TOUCH_LAYOUT_VERSION: a save from before this key existed leaves
    // the default in place, and the mismatch is exactly the signal we want.
    layoutVersion: 1,
    scale: 1.0,
    opacity: 0.45,
    stickSize: 132,
    lockLandscape: true,
  },
  name: '',
});

// Merging rather than replacing means a saved layout from an older build that
// is missing a button still boots with that button in its default place.
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
    if (this.data.touch.layoutVersion !== TOUCH_LAYOUT_VERSION) {
      this.data.touch.layout = JSON.parse(JSON.stringify(TOUCH_DEFAULTS));
      this.data.touch.layoutVersion = TOUCH_LAYOUT_VERSION;
      this.save();
    }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* memory only */ }
    for (const fn of this.listeners) fn(this.data);
  }

  onChange(fn) { this.listeners.push(fn); }

  reset() {
    this.data = DEFAULTS();
    this.data.touch.layoutVersion = TOUCH_LAYOUT_VERSION;
    this.save();
  }

  resetTouchLayout() {
    this.data.touch.layout = JSON.parse(JSON.stringify(TOUCH_DEFAULTS));
    this.data.touch.layoutVersion = TOUCH_LAYOUT_VERSION;
    this.data.touch.scale = 1.0;
    this.data.touch.opacity = 0.45;
    this.data.touch.stickSize = 132;
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
