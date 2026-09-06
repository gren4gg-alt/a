// Shared tuning and helpers. The house itself is procedural now — see
// generate.js — but everything downstream still speaks this shape:
//
//   rooms: [{ id, name, x0, z0, x1, z1, floor, wall, ceil, isCorridor? }]
//   doors: [{ a, b, axis:'x'|'z', coord, center, width }]
//
// axis 'z' -> a wall plane at constant Z, running along X
// axis 'x' -> a wall plane at constant X, running along Z

export const CONFIG = {
  wallThickness: 0.20,
  roomHeight: 3.0,
  doorHeight: 2.1,

  // Crawl tunnels. The opening is lower than a standing player is tall, and
  // collision enforces that literally rather than by rule — which is also what
  // keeps the ghost out, since it cannot crouch.
  tunnelHeight: 1.35,
  tunnelDoorHeight: 1.25,

  playerRadius: 0.35,
  eyeHeight: 1.62,
  // Seconds on the floor before you bleed out. Generous on purpose: with one
  // ghost per seven rooms, a teammate often has most of a house to cross.
  bleedOutSeconds: 55,
  crouchEyeHeight: 0.75,
  hideEyeHeight: 1.35,      // at the peephole, not on the closet floor
  standClearance: 1.8,      // a collider shorter than this only blocks standing
  // Sprint is the escape verb: every ghost (2.0 to 3.2 m/s, see difficulty.js)
  // is faster than a walking player, so once you are seen, walking is not an
  // option. It also puts the walk inside the range the walk clip was authored
  // at, which is what stopped the legs blending two gaits at once.
  //
  // Do NOT lower sprintSpeed below 4.2 without also lowering the loudness
  // threshold in enemy.js, which gates "loud" on speed > 4.2. Sprinting under
  // that number stops alerting the ghost entirely.
  walkSpeed: 2.2,
  sprintSpeed: 5.0,
  crouchSpeed: 1.45,
  accel: 12.0,

  // Set by the generator: tessellation scales down as the maze grows so the
  // bake stays under a couple of seconds.
  bakeStep: 0.34,
  bakeStepScale: 1.0,   // set from the graphics quality preset
  ambient: 0.018,
  shadowLeak: 0.10,

  // How many world metres one texture tile covers. Lower = finer detail.
  // Metres of world covered by one texture tile, per surface. Overridable in
  // src/assets.js when you supply your own images.
  textureMetres: { wall: 2.2, floor: 2.4, ceiling: 2.6 },

  fogColor: 0x05070a,
  fogDensity: 0.09,

  cullCellSize: 4.0,
  // Beyond this the fog is opaque, so there is nothing left to see. Culling
  // here is what keeps a 400-room maze costing what a six-room house did.
  drawDistance: 34.0,
  wallChunkSize: 26.0,
};

export function roomsById(level) {
  const m = new Map();
  for (const r of level.rooms) m.set(r.id, r);
  return m;
}

export function adjacency(level) {
  const m = new Map();
  for (const r of level.rooms) m.set(r.id, new Set([r.id]));
  for (const d of level.doors) {
    m.get(d.a)?.add(d.b);
    m.get(d.b)?.add(d.a);
  }
  return m;
}

/**
 * Which room contains this point? Backed by a coarse bucket grid — a linear
 * scan over ~190 rectangles every frame is wasteful once the maze is large.
 */
export class RoomLookup {
  constructor(level, cell = 16) {
    this.cell = cell;
    this.rooms = level.rooms;
    this.map = new Map();
    level.rooms.forEach((r, i) => {
      const i0 = Math.floor(r.x0 / cell), i1 = Math.floor(r.x1 / cell);
      const j0 = Math.floor(r.z0 / cell), j1 = Math.floor(r.z1 / cell);
      for (let a = i0; a <= i1; a++) {
        for (let b = j0; b <= j1; b++) {
          const k = `${a},${b}`;
          if (!this.map.has(k)) this.map.set(k, []);
          this.map.get(k).push(i);
        }
      }
    });
  }

  at(x, z) {
    const list = this.map.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
    if (!list) return null;
    for (const i of list) {
      const r = this.rooms[i];
      if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r;
    }
    return null;
  }
}
