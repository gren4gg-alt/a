import * as THREE from 'three';
import { CONFIG } from './level.js';
import { SURFACE } from './textures.js';

// ---------------------------------------------------------------------------
// Interval maths
//
// Every room contributes four wall edges. Two adjacent rooms contribute the
// same edge twice, and partially overlapping edges (the foyer's north wall vs
// the corridor's south wall) would produce coplanar boxes and z-fighting.
// So: collect every edge onto its plane, union the intervals, then subtract
// the door openings. One clean set of segments falls out.
// ---------------------------------------------------------------------------

function unionIntervals(list) {
  if (!list.length) return [];
  const sorted = list.slice().sort((p, q) => p[0] - q[0]);
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1];
    const nxt = sorted[i];
    if (nxt[0] <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], nxt[1]);
    else out.push(nxt.slice());
  }
  return out;
}

function subtractIntervals(spans, holes) {
  let out = spans.map((s) => s.slice());
  for (const h of holes) {
    const next = [];
    for (const s of out) {
      if (h[1] <= s[0] + 1e-6 || h[0] >= s[1] - 1e-6) { next.push(s); continue; }
      if (h[0] > s[0] + 1e-6) next.push([s[0], h[0]]);
      if (h[1] < s[1] - 1e-6) next.push([h[1], s[1]]);
    }
    out = next;
  }
  return out.filter((s) => s[1] - s[0] > 1e-4);
}

// ---------------------------------------------------------------------------

/**
 * Turn the level into wall boxes (full height + door lintels).
 * Returns { boxes: [{cx,cy,cz,sx,sy,sz,solid}] }
 */
export function buildWalls(level) {
  const t = CONFIG.wallThickness;
  const H = CONFIG.roomHeight;

  const planes = new Map(); // "axis|coord" -> { axis, coord, spans: [], holes: [] }
  const key = (axis, coord) => `${axis}|${coord.toFixed(3)}`;

  const addSpan = (axis, coord, a, b) => {
    const k = key(axis, coord);
    if (!planes.has(k)) planes.set(k, { axis, coord, spans: [], holes: [] });
    planes.get(k).spans.push([Math.min(a, b), Math.max(a, b)]);
  };

  for (const r of level.rooms) {
    addSpan('z', r.z0, r.x0, r.x1);
    addSpan('z', r.z1, r.x0, r.x1);
    addSpan('x', r.x0, r.z0, r.z1);
    addSpan('x', r.x1, r.z0, r.z1);
  }

  for (const d of level.doors) {
    const k = key(d.axis, d.coord);
    if (!planes.has(k)) {
      console.warn(`Door on ${d.axis}=${d.coord} has no wall to punch through.`);
      continue;
    }
    planes.get(k).holes.push({
      span: [d.center - d.width / 2, d.center + d.width / 2],
      height: d.height ?? CONFIG.doorHeight,
    });
  }

  const boxes = [];

  for (const p of planes.values()) {
    const merged = unionIntervals(p.spans);
    const solidSpans = subtractIntervals(merged, p.holes.map((h) => h.span));

    // Full-height wall segments.
    for (const [a, b] of solidSpans) {
      boxes.push(makeBox(p.axis, p.coord, a, b, 0, H, t));
    }
    // Lintels: the strip above each opening. A hole only produces a lintel
    // where a wall actually existed, hence the intersection against merged.
    //
    // These are solid colliders like any other, and their base height is what
    // makes crawl tunnels work: a 1.35 m opening leaves a lintel starting at
    // 1.35 m, which a standing body and a two-metre ghost both walk into and a
    // crouching one passes under. No rule, just geometry.
    for (const h of p.holes) {
      for (const m of merged) {
        const a = Math.max(h.span[0], m[0]);
        const b = Math.min(h.span[1], m[1]);
        if (b - a > 1e-4) boxes.push(makeBox(p.axis, p.coord, a, b, h.height, H - h.height, t));
      }
    }
  }

  return boxes;
}

function makeBox(axis, coord, a, b, y0, height, thickness) {
  const len = b - a;
  const mid = (a + b) / 2;
  if (axis === 'z') {
    return { cx: mid, cy: y0 + height / 2, cz: coord,
             sx: len, sy: height, sz: thickness, base: y0, top: y0 + height };
  }
  return { cx: coord, cy: y0 + height / 2, cz: mid,
           sx: thickness, sy: height, sz: len, base: y0, top: y0 + height };
}

/**
 * Colliders are 2D boxes plus the height band they occupy. Callers pass how
 * tall they currently are, and anything whose base is above that is ignored —
 * which is how a crouching player fits through a hole that stops the ghost.
 */
export function buildColliders(wallBoxes) {
  return wallBoxes.map((b) => ({
    minX: b.cx - b.sx / 2, maxX: b.cx + b.sx / 2,
    minZ: b.cz - b.sz / 2, maxZ: b.cz + b.sz / 2,
    base: b.base, top: b.top,
  }));
}

/** Shrunk 3D boxes used as shadow occluders during the bake. */
export function buildOccluders(wallBoxes) {
  const e = 0.04;
  return wallBoxes.map((b) => ({
    minX: b.cx - b.sx / 2 + e, maxX: b.cx + b.sx / 2 - e,
    minY: b.cy - b.sy / 2 + e, maxY: b.cy + b.sy / 2 - e,
    minZ: b.cz - b.sz / 2 + e, maxZ: b.cz + b.sz / 2 - e,
  }));
}

// ---------------------------------------------------------------------------
// Geometry emitters. Each returns { geometry, albedo } in world space,
// tessellated finely enough for vertex lighting to read as smooth.
// ---------------------------------------------------------------------------

const seg = (size) => Math.max(1, Math.round(size / CONFIG.bakeStep));

/**
 * A per-room shift of the texture projection: two offsets and a quarter turn.
 *
 * Without it every room in the house shows the same plank in the same place,
 * because the shader projects world coordinates straight onto the tile. Nudging
 * the projection per room means the grain never lines up across a doorway and
 * the floorboards in one room can run the other way to the next, off one shared
 * texture. Derived from the room id so it survives regeneration from a seed.
 */
export function roomVariant(roomId) {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const c = ((h >>> 10) % 1000) / 1000;
  const rot = ((h >>> 20) & 1);
  // Which of the three packed patterns this surface uses. Rooms differ by
  // material now, not only by where the grain starts.
  const set = (h >>> 22) % 3;
  return [a, c, rot, set];
}

export function wallGeometry(b, variant = [0, 0, 0, 0]) {
  const g = new THREE.BoxGeometry(
    b.sx, b.sy, b.sz, seg(b.sx), seg(b.sy), seg(b.sz),
  );
  g.translate(b.cx, b.cy, b.cz);
  // UVs are not needed: the shader projects world coordinates onto whichever
  // axis the face points down. All geometry here is axis-aligned, so that
  // projection is exact and there are no seams to hide.
  g.deleteAttribute('uv');
  g.userData.surface = SURFACE.WALL;
  g.userData.variant = variant;
  return g;
}

export function floorGeometry(room) {
  const w = room.x1 - room.x0;
  const d = room.z1 - room.z0;
  const g = new THREE.PlaneGeometry(w, d, seg(w), seg(d));
  g.rotateX(-Math.PI / 2);
  g.translate((room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2);
  g.deleteAttribute('uv');
  g.userData.surface = SURFACE.FLOOR;
  g.userData.variant = roomVariant(room.id);
  return g;
}

export function ceilingGeometry(room) {
  const w = room.x1 - room.x0;
  const d = room.z1 - room.z0;
  const g = new THREE.PlaneGeometry(w, d, seg(w), seg(d));
  g.rotateX(Math.PI / 2);
  // Crawl tunnels carry their own, much lower ceiling.
  g.translate((room.x0 + room.x1) / 2, room.ceilHeight ?? CONFIG.roomHeight, (room.z0 + room.z1) / 2);
  g.deleteAttribute('uv');
  g.userData.surface = SURFACE.CEILING;
  g.userData.variant = roomVariant(`${room.id}~c`);
  return g;
}

export function propGeometry(p) {
  const g = new THREE.BoxGeometry(
    p.w, p.h, p.d, seg(p.w), seg(p.h), seg(p.d),
  );
  g.translate(p.x, (p.y ?? 0) + p.h / 2, p.z);
  g.deleteAttribute('uv');
  g.userData.surface = SURFACE.FLOOR;   // furniture reads as timber
  g.userData.variant = roomVariant(`${p.room}~${p.x.toFixed(2)}`);
  return g;
}

/**
 * Rooms with a lowered ceiling get a collider slab filling the space above it.
 *
 * Without this you could crouch through a tunnel mouth and then stand up
 * inside, because the low ceiling was only ever a mesh — nothing in the
 * collision world knew it was there. The lintels at either end blocked you,
 * the middle did not, and your head went through the geometry.
 */
export function ceilingColliders(rooms) {
  const out = [];
  for (const r of rooms) {
    const h = r.ceilHeight ?? CONFIG.roomHeight;
    if (h >= CONFIG.roomHeight - 1e-3) continue;
    out.push({
      minX: r.x0, maxX: r.x1, minZ: r.z0, maxZ: r.z1,
      base: h, top: CONFIG.roomHeight, ceiling: true,
    });
  }
  return out;
}

export function propColliders(props) {
  // Rugs and hung paintings are scenery, not obstacles.
  return props.filter((p) => !p.noCollide).map((p) => ({
    minX: p.x - p.w / 2, maxX: p.x + p.w / 2,
    minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2,
    base: p.y ?? 0, top: (p.y ?? 0) + p.h,
  }));
}
