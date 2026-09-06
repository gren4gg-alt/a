import * as THREE from 'three';
import { createGlowMaterial } from './material.js';
import { characterModel } from './models.js';
import { CharacterAnimator, stateFor } from './animation.js';

// ---------------------------------------------------------------------------
// Remote players.
//
// Snapshots arrive at 15 Hz over an unreliable channel, so they are late,
// jittery and occasionally missing. Rendering them the instant they land looks
// like a slideshow. Instead every sample goes into a buffer stamped with local
// arrival time, and we render 120 ms in the past — comfortably more than one
// snapshot interval, so there is almost always a sample on each side to
// interpolate between. The cost is that everyone else is an eighth of a second
// behind where they really are, which nobody notices in a co-op walking game.
//
// Buffering against local arrival time rather than the host's clock means no
// clock synchronisation is needed at all.
// ---------------------------------------------------------------------------

const INTERP_DELAY = 120;   // ms
const BUFFER_KEEP = 1200;   // ms of history

export const PLAYER_COLORS = [
  0xffb066, 0x7fd6ff, 0x9fffc8, 0xff8fa8, 0xd0a8ff, 0xffe58f,
];

export class RemotePlayer {
  /**
   * @param trustFlags whether downed/dead in the stream are authoritative.
   * True on clients, who are simply told the truth. FALSE on the host, which
   * decides those itself — otherwise a player's own state packet, still in
   * flight from before they were hit, would un-down them for a round trip and
   * the escape check could briefly count a body on the floor as standing.
   */
  constructor(scene, id, name, colorIndex, trustFlags = true, characterId = null) {
    this.id = id;
    this.name = name;
    this.trustFlags = trustFlags;
    this.color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.downed = false;
    this.dead = false;
    this.crouching = false;
    this.voiceLevel = 0;
    this.hidingClosetId = null;
    this.buffer = [];

    // Their character's model where one exists. The glowing capsule is the
    // fallback, and it is also what keeps a teammate findable in the dark, so
    // the bead above them stays either way.
    const model = characterId ? characterModel(characterId) : null;
    this.material = createGlowMaterial(this.color, { additive: true, depthWrite: false, gain: 0.9 });
    this.usesModel = !!model;
    this.mesh = model ?? new THREE.Mesh(
      (() => { const g = new THREE.CapsuleGeometry(0.32, 1.0, 4, 12); g.translate(0, 0.94, 0); return g; })(),
      this.material,
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);

    // Only a real model can be animated. The capsule fallback keeps the squash
    // and the tip-over below, which is why those are still here.
    this.animator = this.usesModel ? new CharacterAnimator(model) : null;
    if (!this.animator?.usable) this.animator = null;

    // A small marker that stays visible through walls, so you can find each
    // other in a maze without shouting coordinates.
    const beadGeo = new THREE.SphereGeometry(0.09, 8, 6);
    this.bead = new THREE.Mesh(beadGeo, createGlowMaterial(this.color, { additive: true, depthWrite: false, gain: 1.5 }));
    this.bead.frustumCulled = false;
    this.bead.renderOrder = 3;
    scene.add(this.bead);
  }

  /** A sample straight off the wire. */
  push(x, z, yaw, downed, dead, now, crouching = false) {
    this.buffer.push({ t: now, x, z, yaw, downed, dead, crouching });
    const cutoff = now - BUFFER_KEEP;
    while (this.buffer.length > 2 && this.buffer[0].t < cutoff) this.buffer.shift();
  }

  /**
   * @param dt seconds since the last frame, for the animation mixer. Zero is
   *   safe and simply leaves the pose where it is.
   */
  update(now, dt = 0) {
    const target = now - INTERP_DELAY;
    const buf = this.buffer;
    if (!buf.length) return;

    let a = buf[0], b = buf[buf.length - 1];
    if (target <= a.t) { b = a; }
    else if (target >= b.t) { a = b; }
    else {
      for (let i = 0; i < buf.length - 1; i++) {
        if (buf[i].t <= target && buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break; }
      }
    }

    const span = b.t - a.t;
    const k = span > 0 ? (target - a.t) / span : 1;

    const prevX = this.pos.x, prevZ = this.pos.z;
    this.pos.x = a.x + (b.x - a.x) * k;
    this.pos.z = a.z + (b.z - a.z) * k;
    this.yaw = a.yaw + shortestAngle(a.yaw, b.yaw) * k;
    if (this.trustFlags) {
      this.downed = b.downed;
      this.dead = b.dead;
    }

    // Derived velocity: the ghost's hearing check needs it on the host, and it
    // is cheaper to infer than to put another field in every snapshot.
    this.vel.set((this.pos.x - prevX) / dt, 0, (this.pos.z - prevZ) / dt);

    this.crouching = b.crouching;
    // Someone in a closet is inside it, not standing in front of it.
    const stowed = !!this.hidingClosetId;
    this.mesh.visible = !this.dead && !stowed;
    this.bead.visible = !this.dead && !stowed;

    if (this.animator) {
      // The speed comes from the interpolated position, which is the same
      // number the ghost's hearing uses — so what you see somebody doing is
      // what the house thinks they are doing.
      const speed = Math.hypot(this.vel.x, this.vel.z);
      this.animator.play(stateFor({
        speed, crouching: this.crouching, downed: this.downed,
      }), speed);
      this.animator.update(dt);
      // The clip is doing the crouching and the falling over, so the old
      // stand-ins must not fight it.
      this.mesh.scale.set(1, 1, 1);
      this.mesh.position.set(this.pos.x, 0, this.pos.z);
      this.mesh.rotation.set(0, this.yaw, 0);
    } else {
      // Squash rather than swap geometry: at the distance you ever see another
      // player in here, the silhouette is all the information that survives.
      const squash = this.crouching ? 0.52 : 1;
      this.mesh.scale.set(1, squash, 1);
      this.mesh.position.set(this.pos.x, this.downed ? -0.55 : 0, this.pos.z);
      this.mesh.rotation.set(this.downed ? Math.PI / 2.3 : 0, this.yaw, 0);
    }
    this.bead.position.set(this.pos.x, this.downed ? 0.35 : (this.crouching ? 1.15 : 2.05), this.pos.z);
    if (!this.usesModel) this.material.uniforms.uGain.value = this.downed ? 0.35 : 0.9;
  }

  dispose(scene) {
    this.animator?.dispose();
    scene.remove(this.mesh);
    scene.remove(this.bead);
    this.mesh.geometry?.dispose();
    this.material.dispose();
    this.bead.geometry.dispose();
    this.bead.material.dispose();
  }
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------

// Long enough that reaching someone across a room is the hard part, not the
// holding. Paired with a much longer bleed-out so the attempt is worth making.
export const REVIVE_SECONDS = 5.0;
export const REVIVE_RANGE = 2.2;

/**
 * Who, if anyone, is the local player close enough to pick up? Returns the
 * nearest downed teammate in range.
 */
export function reviveCandidate(localPos, players) {
  let best = null, bestD = REVIVE_RANGE * REVIVE_RANGE;
  for (const p of players) {
    if (!p.downed || p.dead || p.isLocal) continue;
    const dx = p.pos.x - localPos.x, dz = p.pos.z - localPos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = p; }
  }
  return best;
}
