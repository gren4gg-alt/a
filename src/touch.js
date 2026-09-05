// ---------------------------------------------------------------------------
// Touch controls.
//
// A left stick for walking, the right half of the screen for looking, and a
// column of buttons. Pointer events throughout with explicit pointerId
// tracking, because the whole point is that the stick and the look drag and a
// button press all happen at once — a touch handler that assumes one finger
// falls apart the first time somebody sprints round a corner.
//
// Nothing here reaches into the game. It writes an analogue vector and a set of
// held actions onto the player, which reads them exactly as it reads the
// keyboard, so every ability, bind and cooldown works untouched.
// ---------------------------------------------------------------------------

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(pointer: coarse)')?.matches
    || (navigator.maxTouchPoints ?? 0) > 0;
}

import { settings } from './settings.js';

const DEAD_ZONE = 0.14;

/** action, label, and whether holding it means anything. */
const BUTTONS = [
  { id: 'interact',   label: 'USE',     cls: 'primary' },
  { id: 'power',      label: 'ABILITY' },
  { id: 'crouch',     label: 'CROUCH',  hold: true },
  { id: 'sprint',     label: 'RUN',     hold: true },
  { id: 'flashlight', label: 'TORCH' },
  { id: 'talk',       label: 'TALK',    hold: true },
];

// ---------------------------------------------------------------------------
// Orientation.
//
// Every browser that can lock orientation requires fullscreen first, and iOS
// Safari cannot lock at all. So: try, and fall back to telling the player to
// turn the phone rather than pretending it worked.
// ---------------------------------------------------------------------------

export async function lockLandscape() {
  if (!settings.data.touch.lockLandscape) return false;
  try {
    const root = document.documentElement;
    if (!document.fullscreenElement) {
      await (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root);
    }
    await screen.orientation?.lock?.('landscape');
    return true;
  } catch {
    return false;   // iOS, or the user refused fullscreen
  }
}

export function unlockOrientation() {
  try { screen.orientation?.unlock?.(); } catch { /* not supported */ }
  try {
    if (document.fullscreenElement) {
      (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
    }
  } catch { /* already out */ }
}

export const isPortrait = () => window.innerHeight > window.innerWidth;

export class TouchControls {
  constructor(root) {
    this.root = root;
    this.player = null;
    this.lookId = null;
    this.stickId = null;
    this.lastLook = { x: 0, y: 0 };
    this.sensitivity = 0.26;
    this._build();
  }

  _build() {
    this.root.innerHTML = '';

    this.lookZone = document.createElement('div');
    this.lookZone.className = 'tc-look';
    this.root.appendChild(this.lookZone);

    this.stickZone = document.createElement('div');
    this.stickZone.className = 'tc-stickzone';
    this.base = document.createElement('div');
    this.base.className = 'tc-base';
    this.knob = document.createElement('div');
    this.knob.className = 'tc-knob';
    this.base.appendChild(this.knob);
    this.stickZone.appendChild(this.base);
    this.root.appendChild(this.stickZone);

    this.buttons = [];
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tc-btn ${b.cls ?? ''}`;
      el.textContent = b.label;
      el.dataset.action = b.id;
      this.root.appendChild(el);
      this.buttons.push({ ...b, el, pointerId: null });
    }

    this.editing = false;
    this.selected = null;
    this.onSelect = null;
    this._bind();
    this.applyLayout();
  }

  _bind() {
    // Look. Anything that starts on the look zone and is not a button.
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.editing || this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lastLook = { x: e.clientX, y: e.clientY };
      this.lookZone.setPointerCapture(e.pointerId);
    });
    this.lookZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId || !this.player) return;
      this.player.applyLook(
        (e.clientX - this.lastLook.x) * this.sensitivity,
        (e.clientY - this.lastLook.y) * this.sensitivity,
      );
      this.lastLook = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    this.lookZone.addEventListener('pointerup', endLook);
    this.lookZone.addEventListener('pointercancel', endLook);

    // Stick. The base re-centres under the finger wherever it lands, so you
    // never have to find a fixed circle you cannot see.
    this.stickZone.addEventListener('pointerdown', (e) => {
      if (this.editing || this.stickId !== null) return;
      this.stickId = e.pointerId;
      this.origin = { x: e.clientX, y: e.clientY };
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.stickZone.setPointerCapture(e.pointerId);
      this._stick(0, 0);
    });
    this.stickZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      this._stick(e.clientX - this.origin.x, e.clientY - this.origin.y);
    });
    const endStick = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.base.classList.remove('on');
      this.knob.style.transform = 'translate(-50%, -50%)';
      if (this.player) this.player.touchMove = { x: 0, z: 0 };
    };
    this.stickZone.addEventListener('pointerup', endStick);
    this.stickZone.addEventListener('pointercancel', endStick);

    // Buttons. Tracked by pointerId so a finger sliding off still releases.
    for (const b of this.buttons) {
      b.el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.editing) { this._startDrag(b, e); return; }
        b.pointerId = e.pointerId;
        b.el.classList.add('on');
        b.el.setPointerCapture?.(e.pointerId);
        this._press(b.id);
      });
      b.el.addEventListener('pointermove', (e) => this._moveDrag(e));
      const up = (e) => {
        if (this.editing) { this._endDrag(); return; }
        if (b.pointerId !== e.pointerId) return;
        b.pointerId = null;
        b.el.classList.remove('on');
        this.player?.touchActions.delete(b.id);
      };
      b.el.addEventListener('pointerup', up);
      b.el.addEventListener('pointercancel', up);
    }
  }

  /** Re-read the saved layout and put everything where it belongs. */
  applyLayout() {
    const t = settings.data.touch;
    const scale = t.scale ?? 1;
    this.root.style.setProperty('--tc-opacity', String(t.opacity ?? 0.45));
    const stick = (t.stickSize ?? 132) * scale;
    this.base.style.width = `${stick}px`;
    this.base.style.height = `${stick}px`;
    this.base.style.margin = `${-stick / 2}px 0 0 ${-stick / 2}px`;
    this.knob.style.width = `${stick * 0.41}px`;
    this.knob.style.height = `${stick * 0.41}px`;
    this.stickRadius = stick * 0.44;

    for (const b of this.buttons) {
      const l = t.layout[b.id] ?? { x: 0.9, y: 0.5, size: 70 };
      const size = l.size * scale;
      b.el.style.width = `${size}px`;
      b.el.style.height = `${size}px`;
      b.el.style.left = `${l.x * 100}%`;
      b.el.style.top = `${l.y * 100}%`;
      b.el.style.marginLeft = `${-size / 2}px`;
      b.el.style.marginTop = `${-size / 2}px`;
      b.el.style.fontSize = `${Math.max(9, size * 0.135)}px`;
    }
  }

  setEditMode(on) {
    this.editing = on;
    this.root.classList.toggle('editing', on);
    if (!on) { this.selected = null; this._markSelection(); }
  }

  _markSelection() {
    for (const b of this.buttons) b.el.classList.toggle('picked', b.id === this.selected);
  }

  /** Viewport size, never zero: a divide by it must not produce NaN. */
  _view() {
    return {
      w: Math.max(1, window.innerWidth || 1),
      h: Math.max(1, window.innerHeight || 1),
    };
  }

  _startDrag(b, e) {
    const l = settings.data.touch.layout[b.id];
    const { w, h } = this._view();
    this.drag = {
      b,
      pointerId: e.pointerId,
      dx: e.clientX - l.x * w,
      dy: e.clientY - l.y * h,
      moved: false,
    };
    b.el.setPointerCapture?.(e.pointerId);
  }

  _moveDrag(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const l = settings.data.touch.layout[this.drag.b.id];
    // Keep the whole button on screen whatever they drag it towards.
    const { w, h } = this._view();
    const half = (l.size * (settings.data.touch.scale ?? 1)) / 2;
    const mx = Math.min(0.45, half / w);
    const my = Math.min(0.45, half / h);
    const nx = (e.clientX - this.drag.dx) / w;
    const ny = (e.clientY - this.drag.dy) / h;
    // Guard the assignment: a NaN here writes a null into saved settings and
    // the button never appears again, on any future run.
    if (Number.isFinite(nx)) l.x = Math.min(1 - mx, Math.max(mx, nx));
    if (Number.isFinite(ny)) l.y = Math.min(1 - my, Math.max(my, ny));
    this.drag.moved = true;
    this.applyLayout();
  }

  _endDrag() {
    if (!this.drag) return;
    if (!this.drag.moved) {
      this.selected = this.drag.b.id;
      this._markSelection();
      this.onSelect?.(this.drag.b.id);
    } else {
      settings.save();
    }
    this.drag = null;
  }

  _stick(dx, dy) {
    const STICK_RADIUS = this.stickRadius ?? 58;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
    void STICK_RADIUS;
    this.knob.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

    let mag = clamped / STICK_RADIUS;
    if (mag < DEAD_ZONE) mag = 0;
    else mag = (mag - DEAD_ZONE) / (1 - DEAD_ZONE);

    if (!this.player) return;
    const ang = Math.atan2(dy, dx);
    // Screen up is forward, which is -Z in the player's input space.
    this.player.touchMove = {
      x: Math.cos(ang) * mag,
      z: Math.sin(ang) * mag,
    };
  }

  _press(action) {
    if (!this.player) return;
    this.player.touchActions.add(action);
    // Momentary actions fire on press, exactly as a key does. Held ones only
    // need to be in the set; the player polls for those.
    if (action === 'flashlight') this.player.onFlashToggle?.();
    if (action === 'power') this.player.onPower?.();
    if (action === 'interact') this.player.onInteract?.();
  }

  attach(player) {
    this.player = player;
    player.touchMove = { x: 0, z: 0 };
    player.touchActions = new Set();
    this.root.classList.remove('hidden');
  }

  detach() {
    if (this.player) {
      this.player.touchMove = { x: 0, z: 0 };
      this.player.touchActions?.clear();
    }
    this.player = null;
    this.lookId = null;
    this.stickId = null;
    this.root.classList.add('hidden');
  }

  /** Keep the button captions in step with rebinding, for the labels' sake. */
  setVisible(on) {
    this.root.classList.toggle('hidden', !on);
  }
}
