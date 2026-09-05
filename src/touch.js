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

const STICK_RADIUS = 58;      // px from centre to full deflection
const DEAD_ZONE = 0.14;

/** action, label, and whether holding it means anything. */
const BUTTONS = [
  { id: 'interact',   label: 'USE',   cls: 'big' },
  { id: 'power',      label: 'ABILITY' },
  { id: 'crouch',     label: 'CROUCH', hold: true },
  { id: 'sprint',     label: 'RUN',    hold: true },
  { id: 'flashlight', label: 'TORCH' },
  { id: 'talk',       label: 'TALK',   hold: true },
];

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

    const pad = document.createElement('div');
    pad.className = 'tc-buttons';
    this.buttons = [];
    for (const b of BUTTONS) {
      const el = document.createElement('button');
      el.className = `tc-btn ${b.cls ?? ''}`;
      el.textContent = b.label;
      el.dataset.action = b.id;
      pad.appendChild(el);
      this.buttons.push({ ...b, el, pointerId: null });
    }
    this.root.appendChild(pad);

    this._bind();
  }

  _bind() {
    // Look. Anything that starts on the look zone and is not a button.
    this.lookZone.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
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
      if (this.stickId !== null) return;
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
        b.pointerId = e.pointerId;
        b.el.classList.add('on');
        b.el.setPointerCapture?.(e.pointerId);
        this._press(b.id);
      });
      const up = (e) => {
        if (b.pointerId !== e.pointerId) return;
        b.pointerId = null;
        b.el.classList.remove('on');
        this.player?.touchActions.delete(b.id);
      };
      b.el.addEventListener('pointerup', up);
      b.el.addEventListener('pointercancel', up);
    }
  }

  _stick(dx, dy) {
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_RADIUS);
    const nx = dist > 0 ? (dx / dist) * clamped : 0;
    const ny = dist > 0 ? (dy / dist) * clamped : 0;
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
