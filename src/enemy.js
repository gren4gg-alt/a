import * as THREE from 'three';
import { findPath } from './generate.js';
import { CONFIG } from './level.js';
import { createGhostMaterial, createGlowMaterial } from './material.js';
import { instance as modelInstance, has as hasModel } from './models.js';

// ---------------------------------------------------------------------------
// The ghost.
//
// It paths on the nav graph the generator hands out, which means no navmesh
// baking and no grid flood fill: nodes are rooms and corridors, edges are
// doorways, and A* over ~160 nodes finishes in well under a millisecond.
//
// It cannot see through walls. Detection is a 2D segment test against the same
// colliders the player uses, so if you break line of sight you genuinely break
// it, and there is no cheating fallback that makes it magically know where you
// went. What it does instead is remember: it walks to where it last saw or
// heard you, then goes back to wandering.
// ---------------------------------------------------------------------------

const STATE = { WANDER: 'wander', INVESTIGATE: 'investigate', HUNT: 'hunt' };

// Taller than a crawl tunnel's opening, which is the entire reason tunnels
// work. No rule excludes it from them; it simply does not fit.
//
// DERIVED from the normal door height rather than written as a constant. A
// hardcoded 2.2 against 2.1 m doors meant the ghost was blocked by every
// doorway in the house and never left the room it spawned in — and because it
// still tracked and stood still, nothing looked obviously broken. Deriving it
// makes that class of mistake impossible when either number is retuned.
export const GHOST_HEIGHT = CONFIG.doorHeight - 0.15;

export class Ghost {
  /**
   * @param options.index which ghost this is, used for tint and for staggering
   *   their trap timers so three of them do not all drop one on the same frame.
   * @param options.spawn where it starts; defaults to the level's single spawn.
   * @param options.count how many ghosts exist, so shared budgets can be split.
   */
  constructor(scene, level, params, lookup, options = {}) {
    this.level = level;
    this.nav = level.nav;
    this.lookup = lookup;
    this.p = params;
    this.index = options.index ?? 0;

    const spawn = options.spawn ?? level.ghostSpawn;
    this.pos = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.vel = new THREE.Vector3();
    this.nodeId = spawn.node;

    // Where it considers its own. Wandering is biased towards here, which is
    // what stops three ghosts converging into one and leaving the rest of the
    // house empty.
    this.home = { x: spawn.x, z: spawn.z };
    this.state = STATE.WANDER;
    this.path = [];
    this.repathIn = 0;
    this.cooldown = params.cooldown;
    this.alert = 0;
    this.lastSeen = null;
    this.rage = 0;
    this.target = null;
    this.stun = 0;
    this.avoid = null;
    this.avoidUntil = 0;
    // Padded outward: standing in the doorway with an arm through it would
    // technically be outside the rectangle and would still reach someone.
    this.safe = level.safeRoom
      ? { x0: level.safeRoom.x0 - 0.7, z0: level.safeRoom.z0 - 0.7,
          x1: level.safeRoom.x1 + 0.7, z1: level.safeRoom.z1 + 0.7 }
      : null;

    this.knives = [];
    // Traps themselves are owned by the game, not by the ghost that left them:
    // with several hunters, a per-ghost list makes every trap need a compound
    // id over the wire for no benefit. The ghost only decides when to drop one.
    const count = options.count ?? 1;
    this.trapInterval = (level.trapInterval ?? 0) * count;
    this.trapTimer = this.trapInterval * (0.4 + 0.5 * (this.index / Math.max(1, count)));
    this.onTrap = null;
    this.onThrow = null;
    this.onHit = null;

    // --- meshes ---
    // A supplied ghost.glb if there is one, keeping its own materials; the
    // rim-lit capsule otherwise. This was previously hardcoded to the capsule,
    // so a supplied model showed up in the menu and nowhere else.
    this.material = createGhostMaterial();
    if (options.tint !== undefined) {
      this.material.uniforms.uCalm.value = new THREE.Color().setHex(options.tint, THREE.SRGBColorSpace);
    }
    const custom = modelInstance('ghost');
    if (custom) {
      this.mesh = custom;
      this.usesModel = true;
    } else {
      const body = new THREE.CapsuleGeometry(0.42, 1.5, 6, 14);
      body.translate(0, 1.25, 0);
      this.mesh = new THREE.Mesh(body, this.material);
    }
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);

    this.knifeMaterial = createGlowMaterial(0xffd9a0, { additive: true, depthWrite: false, gain: 1.6 });
    this.knifeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.5);
    this.knifeModel = hasModel('knife');
    this.knifePool = new THREE.Group();
    scene.add(this.knifePool);
  }

  get distanceToPlayer() { return this._dist ?? Infinity; }

  /**
   * @param {Array} players every live player; the ghost picks its own target.
   * Only the host ever calls this — clients receive the result in a snapshot.
   */
  update(dt, players, grid, time) {
    // Shoved. It keeps looking at you the whole time, which is worse.
    if (this.stun > 0) {
      this.stun -= dt;
      // Still integrate: a shove is meant to put distance between you and it,
      // and freezing the position outright would make the ability a pure timer.
      let sx = this.pos.x + this.vel.x * dt;
      let sz = this.pos.z + this.vel.z * dt;
      [sx, sz] = resolveCircle(sx, sz, 0.4, grid, GHOST_HEIGHT);
      this.pos.x = sx;
      this.pos.z = sz;
      this.vel.multiplyScalar(Math.exp(-4.5 * dt));
      this._paint(time);
      this.mesh.position.set(this.pos.x, Math.sin(time * 9) * 0.12, this.pos.z);
      this._updateKnives(dt, players, grid);
      this._dist = this._nearest(players);
      return;
    }

    // Backing off. Standing over a body, or over the closet someone just shut
    // themselves into, turns a setback into a dead end: nobody can reach the
    // downed player and nobody can come out. It loses interest and wanders.
    this._avoiding = time < this.avoidUntil;
    if (this._avoiding) {
      if (this.state !== STATE.WANDER) {
        this.state = STATE.WANDER;
        this.alert = 0;
        this.lastSeen = null;
        this.path = [];
        this.repathIn = 0;
      }
    }

    // -- senses ------------------------------------------------------------
    //
    // Pick a target rather than tracking a fixed one: sight wins over sound,
    // and closer wins over farther. Practically this means the ghost peels off
    // toward whoever breaks cover, which is what makes splitting up a real
    // decision instead of a free win.

    let target = null, dist = Infinity, seen = false, heard = false;

    for (const pl of players) {
      // undetectable is the Quiet One's ability: not invisible to the renderer,
      // simply absent from every sense the ghost has.
      if (pl.downed || pl.dead || pl.undetectable) continue;
      if (time < this.avoidUntil) continue;      // deliberately not looking
      // Stood in the entrance: not seen, not heard, not a target. The room is
      // a place to regroup, and that is worth nothing if it can still watch
      // you from the doorway and be waiting when you step out.
      if (this.inSafe(pl.pos.x, pl.pos.z)) continue;
      const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      // The early-out has to allow for the loudest anyone can possibly be, or
      // it rejects them before the check that would have heard them. Sprinting
      // tops out at 1.7x; a raised voice reaches 2.4x.
      const maxLoud = this.p.hearsVoice ? 2.4 : 1.7;
      if (d > this.p.sight && d > this.p.hearing * maxLoud) continue;

      const clear = d < this.p.sight &&
        !segmentBlocked(this.pos.x, this.pos.z, pl.pos.x, pl.pos.z, grid);
      const speed = Math.hypot(pl.vel.x, pl.vel.z);
      let loud = (speed > 4.2 ? 1.7 : speed > 0.6 ? 1.0 : 0.3) * (pl.loudness ?? 1);
      // Your voice. Standing perfectly still and shouting is louder than
      // sprinting in silence, which is the trade the harder houses impose.
      if (this.p.hearsVoice) loud = Math.max(loud, (pl.voiceLevel ?? 0) * 2.4);
      const audible = d < this.p.hearing * loud;

      if (!clear && !audible) continue;
      // A seen player always outranks a merely heard one, whatever the range.
      const better = (clear && !seen) || ((clear === seen) && d < dist);
      if (better) { target = pl; dist = d; seen = clear; heard = audible; }
    }

    this.target = target?.id ?? null;
    this._dist = target ? dist : this._nearest(players);

    const px = target ? target.pos.x : (this.lastSeen?.x ?? this.pos.x);
    const pz = target ? target.pos.z : (this.lastSeen?.z ?? this.pos.z);

    if (seen) {
      this.lastSeen = { x: px, z: pz };
      this.alert = 5.5;
      if (this.state !== STATE.HUNT) { this.state = STATE.HUNT; this.repathIn = 0; }
    } else if (heard && target && this.state !== STATE.HUNT) {
      this.lastSeen = { x: px, z: pz };
      this.state = STATE.INVESTIGATE;
      this.repathIn = Math.min(this.repathIn, 0.2);
    }

    this.alert = Math.max(0, this.alert - dt);
    if (this.state === STATE.HUNT && this.alert <= 0) {
      this.state = this.lastSeen ? STATE.INVESTIGATE : STATE.WANDER;
      this.repathIn = 0;
      this._driftHome();
    }

    const targetRage = this.state === STATE.HUNT ? 1 : this.state === STATE.INVESTIGATE ? 0.4 : 0;
    this.rage += (targetRage - this.rage) * (1 - Math.exp(-3 * dt));

    // -- pathing -----------------------------------------------------------

    this.repathIn -= dt;
    const here = this.lookup.at(this.pos.x, this.pos.z);
    if (here) this.nodeId = here.id;

    if (this.repathIn <= 0 || this.path.length === 0) {
      this.repathIn = this.state === STATE.HUNT ? 0.55 : 1.6;
      let goalId = null;

      if (this.state === STATE.HUNT || this.state === STATE.INVESTIGATE) {
        const target = this.state === STATE.HUNT ? { x: px, z: pz } : this.lastSeen;
        const room = target ? this.lookup.at(target.x, target.z) : null;
        goalId = room?.id ?? null;
        if (goalId === this.nodeId) {
          this.path = [{ x: target.x, z: target.z }];
          goalId = null;
          if (this.state === STATE.INVESTIGATE && dist > this.p.sight) {
            // Arrived, found nothing. Give up on the next repath.
            this.lastSeen = null;
          }
        }
      }
      if (!goalId && this.state === STATE.WANDER) {
        goalId = this._randomNode();
      }
      if (goalId) {
        const path = findPath(this.nav, this.nodeId, goalId, false, false);
        if (path.length) this.path = path;
      }
      if (this.state === STATE.INVESTIGATE && !this.lastSeen) this.state = STATE.WANDER;
    }

    // -- movement ----------------------------------------------------------

    if (this.path.length) {
      const wp = this.path[0];
      const wx = wp.x - this.pos.x, wz = wp.z - this.pos.z;
      const wd = Math.hypot(wx, wz);
      if (wd < 0.7) {
        this.path.shift();
      } else {
        const sp = this.p.speed * (this.state === STATE.HUNT ? 1.0 : 0.72);
        const ax = (wx / wd) * sp, az = (wz / wd) * sp;
        const k = 1 - Math.exp(-7 * dt);
        this.vel.x += (ax - this.vel.x) * k;
        this.vel.z += (az - this.vel.z) * k;
      }
    } else {
      this.vel.multiplyScalar(Math.exp(-4 * dt));
    }

    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    [nx, nz] = resolveCircle(nx, nz, 0.4, grid, GHOST_HEIGHT);
    // The nav graph already refuses to route through the entrance, but local
    // steering towards a waypoint can still drift across the threshold. This
    // is the backstop that makes "it cannot come in" true rather than likely.
    if (this.inSafe(nx, nz)) {
      this.vel.set(0, 0, 0);
      this.path = [];
      this.repathIn = 0;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }

    // Face where it is going; face you when it is hunting.
    // Face the target when hunting, otherwise face travel direction. px/pz
    // fall back to the last known position when nothing is currently sensed.
    const faceX = this.state === STATE.HUNT ? px - this.pos.x : this.vel.x;
    const faceZ = this.state === STATE.HUNT ? pz - this.pos.z : this.vel.z;
    if (Math.hypot(faceX, faceZ) > 0.05) {
      this.mesh.rotation.y = Math.atan2(faceX, faceZ);
    }
    this.mesh.position.set(this.pos.x, Math.sin(time * 1.4) * 0.05, this.pos.z);
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uRage.value = this.rage;

    // -- traps ---------------------------------------------------------------
    //
    // Only the harder houses. It leaves them behind while it is searching, not
    // while it is chasing, so they accumulate along the routes it patrols and
    // the danger is where it has already been.
    if (this.trapInterval > 0 && this.state !== STATE.HUNT) {
      this.trapTimer -= dt;
      if (this.trapTimer <= 0) {
        this.trapTimer = this.trapInterval;
        this.onTrap?.(this.pos.x, this.pos.z);
      }
    }

    // -- knives ------------------------------------------------------------

    this.cooldown -= dt;
    if (this.state === STATE.HUNT && seen && target && this.cooldown <= 0 &&
        dist > 3.0 && dist < this.p.throwRange) {
      this._throw(target, dist);
    }
    this._updateKnives(dt, players, grid);
  }

  _randomNode() {
    // Never pick a crawlspace: it cannot get there, and a goal it cannot reach
    // would leave it grinding against a lintel until the next repath.
    if (!this._walkable) {
      this._walkable = [];
      for (const [id, node] of this.nav.nodes) {
        if (!node.isTunnel && !node.isSafe) this._walkable.push(id);
      }
    }
    const pool = this._walkable;
    if (!pool.length) return null;

    // While backing off, head for whichever of the samples is furthest from
    // the place it is avoiding — otherwise "wander" leaves it circling the
    // body it was told to leave alone.
    if (this.avoid && this._avoiding) {
      let far = null, farD = -1;
      for (let k = 0; k < 6; k++) {
        const id = pool[(Math.random() * pool.length) | 0];
        const n = this.nav.nodes.get(id);
        const d = Math.hypot(n.x - this.avoid.x, n.z - this.avoid.z);
        if (d > farD) { farD = d; far = id; }
      }
      if (far) return far;
    }

    // Sample a handful and take whichever is nearest home. Uniform picks would
    // send each ghost across the whole maze and they would all end up mixed
    // together in the middle; this keeps them loosely to their own quarter
    // while still letting them drift.
    let best = null, bestD = Infinity;
    for (let k = 0; k < 5; k++) {
      const id = pool[(Math.random() * pool.length) | 0];
      const n = this.nav.nodes.get(id);
      const d = Math.hypot(n.x - this.home.x, n.z - this.home.z);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  /** Chasing someone across the house legitimately moves its territory. */
  _driftHome() {
    this.home.x += (this.pos.x - this.home.x) * 0.25;
    this.home.z += (this.pos.z - this.home.z) * 0.25;
  }

  _throw(player, dist) {
    this.cooldown = this.p.cooldown;

    // Lead the shot, but only partly — a perfect intercept is unfair and a
    // static aim is trivial to sidestep. Somewhere in between is the game.
    const flight = dist / this.p.knifeSpeed;
    const tx = player.pos.x + player.vel.x * flight * 0.65;
    const tz = player.pos.z + player.vel.z * flight * 0.65;

    const ax = tx - this.pos.x, az = tz - this.pos.z;
    const ad = Math.hypot(ax, az) || 1;

    const mesh = this._knifeMesh();
    mesh.frustumCulled = false;
    this.knifePool.add(mesh);

    const knife = {
      x: this.pos.x, z: this.pos.z, y: 1.3,
      dx: ax / ad, dz: az / ad,
      life: 3.0, mesh,
    };
    this.knives.push(knife);
    this.onThrow?.(dist, knife);
  }

  _updateKnives(dt, players, grid) {
    const speed = this.p.knifeSpeed;
    for (let i = this.knives.length - 1; i >= 0; i--) {
      const k = this.knives[i];
      const nx = k.x + k.dx * speed * dt;
      const nz = k.z + k.dz * speed * dt;

      let dead = false;
      if (segmentBlocked(k.x, k.z, nx, nz, grid)) dead = true;

      if (!dead) {
        // A knife hits whoever it reaches first, not only its intended target.
        for (const pl of players) {
          if (pl.downed || pl.dead) continue;
          const hx = pl.pos.x - nx, hz = pl.pos.z - nz;
          if (hx * hx + hz * hz < 0.42 * 0.42) {
            // Rolled here, on the host, where the knife lives. A client
            // holding its own dodge chance could simply never be hit.
            if (Math.random() < (pl.knifeDodge ?? 0)) {
              this.onDodge?.(pl.id, nx, nz);
            } else {
              this.onHit?.(pl.id, 'knife');
            }
            dead = true;
            break;
          }
        }
      }

      k.x = nx; k.z = nz;
      k.life -= dt;
      if (k.life <= 0) dead = true;

      if (dead) {
        this.knifePool.remove(k.mesh);
        this.knives.splice(i, 1);
        continue;
      }
      k.mesh.position.set(k.x, k.y, k.z);
      k.mesh.rotation.y = Math.atan2(k.dx, k.dz);
    }
  }

  /** Body contact, so it can't simply pin someone against a wall forever. */
  checkContact(players) {
    for (const pl of players) {
      if (pl.downed || pl.dead) continue;
      const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      if (dx * dx + dz * dz < 0.95 * 0.95) return pl.id;
    }
    return null;
  }

  /** Is this point inside the sanctuary the ghost is barred from? */
  inSafe(x, z) {
    const s = this.safe;
    return !!s && x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1;
  }

  _nearest(players) {
    let best = Infinity;
    for (const pl of players) {
      if (pl.dead) continue;
      const d = Math.hypot(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      if (d < best) best = d;
    }
    return best;
  }

  /** Clients do not simulate the ghost; they are told where it is. */
  applySnapshot(x, z, yaw, rage, state) {
    this.pos.x = x;
    this.pos.z = z;
    this.mesh.rotation.y = yaw;
    this.rage = rage;
    this.state = state;
  }

  /**
   * Clients do not decide hits, but they must still see the knife fly. The host
   * announces the spawn on the reliable channel and every client replays the
   * same straight line locally — far less traffic than streaming projectile
   * positions in every snapshot.
   */
  /** Only the built-in capsule has shader uniforms; a model brings its own. */
  _paint(time) {
    if (this.usesModel) return;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uRage.value = this.rage;
  }

  _knifeMesh() {
    return this.knifeModel
      ? modelInstance('knife')
      : new THREE.Mesh(this.knifeGeo, this.knifeMaterial);
  }

  addKnife(x, z, dx, dz) {
    const mesh = this._knifeMesh();
    mesh.frustumCulled = false;
    this.knifePool.add(mesh);
    this.knives.push({ x, z, y: 1.3, dx, dz, life: 3.0, mesh });
  }

  /** Client-side per-frame work: move knives, animate, no authority. */
  updateVisualsOnly(dt, grid, time) {
    this._updateKnives(dt, [], grid);
    this._paint(time);
    this.mesh.position.set(this.pos.x, Math.sin(time * 1.4) * 0.05, this.pos.z);
  }

  /**
   * Lose interest in a place and walk away from it for a while.
   * @param seconds how long it stays disinterested
   * @param now the simulation clock, since the ghost has no other reference
   */
  retreat(x, z, seconds, now) {
    if (this.inSafe(x, z)) return;
    this.avoid = { x, z };
    this.avoidUntil = Math.max(this.avoidUntil, now + seconds);
    this.state = STATE.WANDER;
    this.alert = 0;
    this.lastSeen = null;
    this.path = [];
    this.repathIn = 0;
  }

  /** Warden's shove. Also drops whatever it was chasing. */
  shove(seconds, fromX, fromZ) {
    this.stun = Math.max(this.stun, seconds);
    this.alert = 0;
    this.path = [];
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.set((dx / d) * 5.0, 0, (dz / d) * 5.0);
  }

  /** Something loud and bright over there. Go and look at it. */
  lure(x, z) {
    if (this.inSafe(x, z)) return;      // nothing in there concerns it
    this.lastSeen = { x, z };
    this.alert = 0;
    this.state = STATE.INVESTIGATE;
    this.repathIn = 0;
    this.path = [];
  }

  clearKnives() {
    for (const k of this.knives) this.knifePool.remove(k.mesh);
    this.knives.length = 0;
  }
}

// ---------------------------------------------------------------------------

/** 2D segment vs the collider boxes. This is the line-of-sight test. */
export function segmentBlocked(x0, z0, x1, z1, grid) {
  const dx = x1 - x0, dz = z1 - z0;
  const invX = 1 / (dx || 1e-9);
  const invZ = 1 / (dz || 1e-9);

  for (const idx of grid.nearSegment(x0, z0, x1, z1)) {
    const b = grid.boxes[idx];
    // Ceiling slabs exist to stop you standing up, not to stop sight. Treating
    // them as opaque would blind the ghost across every tunnel footprint.
    if (b.ceiling) continue;

    let t0 = (b.minX - x0) * invX, t1 = (b.maxX - x0) * invX;
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
    let u0 = (b.minZ - z0) * invZ, u1 = (b.maxZ - z0) * invZ;
    if (u0 > u1) { const s = u0; u0 = u1; u1 = s; }

    const tmin = Math.max(t0, u0);
    const tmax = Math.min(t1, u1);
    if (tmin <= tmax && tmax > 0 && tmin < 1) return true;
  }
  return false;
}

/** Same push-out the player uses, reused so the ghost never clips a wall. */
export function resolveCircle(px, pz, r, grid, height = GHOST_HEIGHT) {
  const r2 = r * r;
  for (let iter = 0; iter < 3; iter++) {
    let hit = false;
    for (const idx of grid.near(px, pz)) {
      const b = grid.boxes[idx];
      if (b.base >= height) continue;
      const cx = px < b.minX ? b.minX : (px > b.maxX ? b.maxX : px);
      const cz = pz < b.minZ ? b.minZ : (pz > b.maxZ ? b.maxZ : pz);
      const dx = px - cx, dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        px += (dx / d) * (r - d);
        pz += (dz / d) * (r - d);
      } else {
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

export { STATE };
