import * as THREE from 'three';
import { CONFIG } from './level.js';
import { settings } from './settings.js';

// ---------------------------------------------------------------------------
// Collider grid.
//
// Overkill for the ~90 boxes the house currently produces, but it stops being
// overkill the moment GLB props start adding colliders, and it's twenty lines.
// ---------------------------------------------------------------------------

export class ColliderGrid {
  constructor(boxes, cell = CONFIG.cullCellSize) {
    this.cell = cell;
    this.boxes = boxes;
    this.map = new Map();
    boxes.forEach((b, i) => {
      const x0 = Math.floor(b.minX / cell), x1 = Math.floor(b.maxX / cell);
      const z0 = Math.floor(b.minZ / cell), z1 = Math.floor(b.maxZ / cell);
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const k = `${x},${z}`;
          if (!this.map.has(k)) this.map.set(k, []);
          this.map.get(k).push(i);
        }
      }
    });
    this._scratch = new Set();
    this._segScratch = new Set();
  }

  /** Every collider whose cell overlaps the segment's bounding box. */
  nearSegment(x0, z0, x1, z1) {
    const c = this.cell;
    const i0 = Math.floor(Math.min(x0, x1) / c), i1 = Math.floor(Math.max(x0, x1) / c);
    const j0 = Math.floor(Math.min(z0, z1) / c), j1 = Math.floor(Math.max(z0, z1) / c);
    const set = this._segScratch;
    set.clear();
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.map.get(`${i},${j}`);
        if (list) for (const idx of list) set.add(idx);
      }
    }
    return set;
  }

  near(x, z) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const set = this._scratch;
    set.clear();
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = this.map.get(`${cx + i},${cz + j}`);
        if (list) for (const idx of list) set.add(idx);
      }
    }
    return set;
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Would a body of this height overlap anything here? Used for headroom. */
export function blocked(px, pz, r, height, grid) {
  const r2 = r * r;
  for (const idx of grid.near(px, pz)) {
    const b = grid.boxes[idx];
    if (b.base >= height) continue;
    const cx = px < b.minX ? b.minX : (px > b.maxX ? b.maxX : px);
    const cz = pz < b.minZ ? b.minZ : (pz > b.maxZ ? b.maxZ : pz);
    const dx = px - cx, dz = pz - cz;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------

export class Player {
  constructor(camera, spawn) {
    this.camera = camera;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.yaw = spawn.yaw ?? 0;
    this.pitch = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;

    this.downed = false;
    this.crouching = false;
    this.crouchLatched = false;
    this.hiding = null;        // the closet you are inside, if any
    this.snaredUntil = 0;
    this.keys = new Set();
    // Touch writes into these; everything downstream reads them through
    // held() and update(), so no ability or binding needs to know.
    this.touchActions = new Set();
    this.touchMove = { x: 0, z: 0 };
    this.speedScale = 1;
    this.locked = false;

    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  /** Is the key bound to this action currently held? */
  held(action) {
    if (this.touchActions.has(action)) return true;
    const code = settings.data.binds[action];
    return !!code && this.keys.has(code);
  }

  /**
   * What happens the moment an action is pressed, as opposed to held.
   * Shared by the keyboard and the on-screen buttons so both behave the same.
   */
  pressAction(action) {
    if (!action) return;
    if (action === 'stats') this.onDebugToggle?.();
    if (action === 'flashlight') this.onFlashToggle?.();
    if (action === 'power') this.onPower?.();
    // Interact fires on press; holding the same key revives a downed teammate
    // instead, and useNearest() defers when a body is in reach.
    if (action === 'interact') this.onInteract?.();
    if (action === 'crouch' && settings.data.input.crouchToggle) {
      this.crouchLatched = !this.crouchLatched;
    }
  }

  /** Look, in the same units as a mouse delta. Used by the touch look zone. */
  applyLook(dx, dy) {
    const sens = settings.data.input.sensitivity * 0.001;
    const invert = settings.data.input.invertY ? -1 : 1;
    this.yaw -= dx * sens;
    this.pitch -= dy * sens * invert;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  bindInput(domElement) {
    // Keys are tracked by their physical code and resolved through the binding
    // table at read time, so rebinding takes effect immediately and does not
    // need the listeners rebuilt.
    const press = (code, down) => {
      if (down) {
        this.pressAction(settings.actionFor(code));
        this.keys.add(code);
      } else {
        this.keys.delete(code);
      }
    };

    this._onKeyDown = (e) => {
      if (e.repeat) return;
      // Only swallow the browser default once we actually own the pointer,
      // or F2 and friends stop working on the settings screens.
      if (this.locked && e.code !== 'Escape') e.preventDefault();
      press(e.code, true);
    };
    this._onKeyUp = (e) => press(e.code, false);
    this._onMouseDown = (e) => { if (this.locked) press(`Mouse${e.button}`, true); };
    this._onMouseUp = (e) => press(`Mouse${e.button}`, false);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('blur', () => this.keys.clear());

    this._onLockChange = () => {
      this.locked = document.pointerLockElement === domElement;
      this.onLockChange?.(this.locked);
      if (!this.locked) this.keys.clear();
    };
    document.addEventListener('pointerlockchange', this._onLockChange);

    this._onMouseMove = (e) => {
      if (!this.locked) return;
      const sens = settings.data.input.sensitivity * 0.001;
      const invert = settings.data.input.invertY ? -1 : 1;
      this.yaw -= e.movementX * sens;
      this.pitch -= e.movementY * sens * invert;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    };
    document.addEventListener('mousemove', this._onMouseMove);
  }

  releaseInput() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('mousemove', this._onMouseMove);
    this.keys.clear();
  }

  /** How tall the collision system should treat this body as being. */
  get bodyHeight() {
    return this.crouching ? 1.05 : CONFIG.standClearance;
  }

  update(dt, grid, now = 0) {
    if (this.hiding) {
      // Inside a closet: no movement, no collision, eye at the peephole.
      this.vel.set(0, 0, 0);
      this.pos.x = this.hiding.x;
      this.pos.z = this.hiding.z;
      this.camera.position.set(this.hiding.x, CONFIG.hideEyeHeight, this.hiding.z);
      const limit = Math.PI * 0.42;
      const rel = shortestAngle(this.hiding.facing, this.yaw);
      this.yaw = this.hiding.facing + Math.max(-limit, Math.min(limit, rel));
      this.camera.rotation.set(this.pitch * 0.6, this.yaw, 0, 'YXZ');
      return;
    }

    if (this.downed) {
      // Knocked out: you keep your view, and that is the whole punishment.
      // You watch it walk away and you cannot do anything about it.
      this.vel.set(0, 0, 0);
      this.camera.position.set(this.pos.x, 0.42, this.pos.z);
      this.camera.rotation.set(this.pitch * 0.5 - 0.12, this.yaw, 0.22, 'YXZ');
      return;
    }

    // Crouch. You may always go down; standing up requires the headroom, which
    // is checked against the same colliders rather than against a flag, so you
    // simply cannot stand inside a crawl tunnel.
    const wantsCrouch = settings.data.input.crouchToggle
      ? this.crouchLatched
      : this.held('crouch');
    if (wantsCrouch) this.crouching = true;
    else if (this.crouching && !blocked(this.pos.x, this.pos.z, CONFIG.playerRadius, CONFIG.standClearance, grid)) {
      this.crouching = false;
    }

    const snared = now < this.snaredUntil;
    const sprint = this.held('sprint') && !this.crouching;
    const scale = this.speedScale ?? 1;
    const base = this.crouching ? CONFIG.crouchSpeed
               : sprint ? CONFIG.sprintSpeed : CONFIG.walkSpeed;
    const speed = snared ? 0 : base * scale;

    let ix = 0, iz = 0;
    if (this.held('forward')) iz -= 1;
    if (this.held('back')) iz += 1;
    if (this.held('left')) ix -= 1;
    if (this.held('right')) ix += 1;

    const len = Math.hypot(ix, iz);
    if (len > 0) { ix /= len; iz /= len; }

    // A stick beats the keys when it is actually deflected, and it stays
    // analogue: easing it over gives you a slow, quiet walk, which matters
    // when the thing hunting you goes by noise.
    const tm = Math.hypot(this.touchMove.x, this.touchMove.z);
    if (tm > 0) { ix = this.touchMove.x; iz = this.touchMove.z; }

    // With rotation order YXZ the camera looks down its local -Z, so:
    //   forward = (-sin(yaw), 0, -cos(yaw))
    //   right   = ( cos(yaw), 0, -sin(yaw))
    // and iz is -1 for W, so displacement = right*ix + forward*(-iz).
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = ix * cos + iz * sin;
    const wishZ = -ix * sin + iz * cos;

    const k = 1 - Math.exp(-CONFIG.accel * dt);
    this.vel.x += (wishX * speed - this.vel.x) * k;
    this.vel.z += (wishZ * speed - this.vel.z) * k;

    let px = this.pos.x + this.vel.x * dt;
    let pz = this.pos.z + this.vel.z * dt;

    [px, pz] = this._resolve(px, pz, grid, this.bodyHeight);

    // Kill velocity into whatever we hit, so we slide instead of sticking.
    const actualX = px - this.pos.x;
    const actualZ = pz - this.pos.z;
    if (dt > 0) {
      this.vel.x = actualX / dt;
      this.vel.z = actualZ / dt;
    }
    this.pos.x = px;
    this.pos.z = pz;

    // Head bob, scaled by how fast we're actually moving.
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    const t = Math.min(hSpeed / CONFIG.walkSpeed, 1.4);
    this.bobPhase += dt * hSpeed * 2.2;
    this.bobAmount += (t * 0.035 - this.bobAmount) * (1 - Math.exp(-8 * dt));

    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * this.bobAmount * 0.6;

    // Ease the eye between standing and crawling instead of snapping it.
    const targetEye = this.crouching ? CONFIG.crouchEyeHeight : CONFIG.eyeHeight;
    this.eye = this.eye ?? targetEye;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-11 * dt));

    this.camera.position.set(
      this.pos.x + bobX * Math.cos(this.yaw),
      this.eye + bobY,
      this.pos.z - bobX * Math.sin(this.yaw),
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  _resolve(px, pz, grid, height) {
    const r = CONFIG.playerRadius;
    const r2 = r * r;

    for (let iter = 0; iter < 4; iter++) {
      let hit = false;
      const near = grid.near(px, pz);

      for (const idx of near) {
        const b = grid.boxes[idx];
        // A lintel whose underside is above your head is not in your way.
        if (b.base >= height) continue;
        const cx = px < b.minX ? b.minX : (px > b.maxX ? b.maxX : px);
        const cz = pz < b.minZ ? b.minZ : (pz > b.maxZ ? b.maxZ : pz);
        const dx = px - cx, dz = pz - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r2) continue;

        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = r - d;
          px += (dx / d) * push;
          pz += (dz / d) * push;
        } else {
          // Centre is inside the box — eject along the shallowest face.
          const toL = px - b.minX, toR = b.maxX - px;
          const toB = pz - b.minZ, toT = b.maxZ - pz;
          const m = Math.min(toL, toR, toB, toT);
          if (m === toL) px = b.minX - r;
          else if (m === toR) px = b.maxX + r;
          else if (m === toB) pz = b.minZ - r;
          else pz = b.maxZ + r;
        }
        hit = true;
      }
      if (!hit) break;
    }
    return [px, pz];
  }
}
