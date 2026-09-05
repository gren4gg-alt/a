import * as THREE from 'three';
import { CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// Static light bake.
//
// Runs once at load. For every vertex we accumulate N·L × attenuation from each
// light in range, fire a shadow ray at the wall boxes, and write the result to
// a vertex attribute. After this there are no lights in the scene at all: no
// shadow maps, no per-frame lighting cost, real hard shadows.
//
// The naive version is O(vertices × lights × occluders), which is fine for one
// house and hopeless for a maze — 110k vertices against 95 lights and 600 boxes
// is over six billion slab tests. Two spatial grids fix it:
//
//   * lights are inserted into every cell they can reach, so a vertex finds its
//     candidates with a single bucket lookup;
//   * occluders are bucketed too, and a shadow ray only tests the boxes in the
//     cells its own bounding box touches.
//
// Together those cut it to roughly vertices × 3 × 20. The bake is also stepped
// across frames against a time budget, so the tab shows a progress bar instead
// of locking up.
//
// FLICKERING LIGHTS. Baked light cannot flicker — that is the trade. So lights
// marked flicker:1 or flicker:2 are kept out of aLit entirely and accumulated
// into aFlickA / aFlickB instead. The shader adds those back scaled by a live
// uniform, which means a failing bulb costs one multiply per fragment and still
// casts a real baked shadow. Two channels rather than one so a corridor of dying
// lamps does not blink in unison like a stage cue.
// ---------------------------------------------------------------------------

const CELL = 8;

class Buckets {
  constructor() { this.map = new Map(); }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  insert(i, j, value) {
    const k = this.key(i, j);
    let list = this.map.get(k);
    if (!list) { list = []; this.map.set(k, list); }
    list.push(value);
  }
  get(i, j) { return this.map.get(this.key(i, j)); }
}

function buildLightGrid(lights) {
  const grid = new Buckets();
  lights.forEach((l, idx) => {
    const i0 = Math.floor((l.x - l.range) / CELL), i1 = Math.floor((l.x + l.range) / CELL);
    const j0 = Math.floor((l.z - l.range) / CELL), j1 = Math.floor((l.z + l.range) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid.insert(i, j, idx);
  });
  return grid;
}

function buildOccluderGrid(boxes) {
  const grid = new Buckets();
  boxes.forEach((b, idx) => {
    const i0 = Math.floor(b.minX / CELL), i1 = Math.floor(b.maxX / CELL);
    const j0 = Math.floor(b.minZ / CELL), j1 = Math.floor(b.maxZ / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid.insert(i, j, idx);
  });
  return grid;
}

/** Slab test against one box. */
function hitsBox(b, ox, oy, oz, invX, invY, invZ, maxT) {
  let t0 = (b.minX - ox) * invX;
  let t1 = (b.maxX - ox) * invX;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  let tmin = t0, tmax = t1;

  t0 = (b.minY - oy) * invY;
  t1 = (b.maxY - oy) * invY;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  if (t0 > tmin) tmin = t0;
  if (t1 < tmax) tmax = t1;
  if (tmin > tmax) return false;

  t0 = (b.minZ - oz) * invZ;
  t1 = (b.maxZ - oz) * invZ;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  if (t0 > tmin) tmin = t0;
  if (t1 < tmax) tmax = t1;
  if (tmin > tmax) return false;

  return tmin < maxT && tmax > 0;
}

// ---------------------------------------------------------------------------

/**
 * @param {Array<{geometry: THREE.BufferGeometry, albedo: number}>} items
 * @param {Array} lights raw level lights
 * @param {Array} occluders shrunk boxes from buildOccluders()
 */
export function createBaker(items, lights, occluders) {
  // THREE.ColorManagement is on by default, so setHex(..., SRGBColorSpace)
  // already lands us in linear working space. Do not convert a second time.
  const L = lights.map((l) => {
    const c = new THREE.Color().setHex(l.color, THREE.SRGBColorSpace);
    return { x: l.x, y: l.y, z: l.z, r: c.r, g: c.g, b: c.b,
             intensity: l.intensity, range: l.range, range2: l.range * l.range,
             flicker: l.flicker | 0 };
  });

  const lightGrid = buildLightGrid(L);
  const occGrid = buildOccluderGrid(occluders);
  const stamp = new Int32Array(occluders.length);
  let stampId = 0;

  const total = items.reduce((s, i) => s + i.geometry.attributes.position.count, 0);
  let itemIndex = 0;
  let vertexIndex = 0;
  let done = 0;

  // Per-item scratch, set up lazily as we reach each item.
  let cur = null;

  function beginItem() {
    const item = items[itemIndex];
    const g = item.geometry;
    const n = g.attributes.position.count;
    cur = {
      g,
      pos: g.attributes.position,
      nrm: g.attributes.normal,
      n,
      lit: new Float32Array(n * 3),
      alb: new Float32Array(n * 3),
      // Flickering lights are kept out of lit and accumulated here instead.
      flA: new Float32Array(n * 3),
      flB: new Float32Array(n * 3),
      surf: new Float32Array(n),
      vari: new Float32Array(n * 4),
      surfaceId: g.userData.surface ?? 0,
      variant: g.userData.variant ?? [0, 0, 0, 0],
      base: new THREE.Color().setHex(item.albedo, THREE.SRGBColorSpace),
    };
  }

  function endItem() {
    cur.g.setAttribute('aLit', new THREE.BufferAttribute(cur.lit, 3));
    cur.g.setAttribute('aAlbedo', new THREE.BufferAttribute(cur.alb, 3));
    cur.g.setAttribute('aFlickA', new THREE.BufferAttribute(cur.flA, 3));
    cur.g.setAttribute('aFlickB', new THREE.BufferAttribute(cur.flB, 3));
    cur.g.setAttribute('aSurf', new THREE.BufferAttribute(cur.surf, 1));
    cur.g.setAttribute('aVariant', new THREE.BufferAttribute(cur.vari, 4));
    cur = null;
  }

  function occluded(ox, oy, oz, dx, dy, dz, maxT) {
    const invX = 1 / (dx || 1e-9);
    const invY = 1 / (dy || 1e-9);
    const invZ = 1 / (dz || 1e-9);

    const ex = ox + dx * maxT, ez = oz + dz * maxT;
    const i0 = Math.floor(Math.min(ox, ex) / CELL), i1 = Math.floor(Math.max(ox, ex) / CELL);
    const j0 = Math.floor(Math.min(oz, ez) / CELL), j1 = Math.floor(Math.max(oz, ez) / CELL);

    stampId++;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = occGrid.get(i, j);
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          if (stamp[idx] === stampId) continue;
          stamp[idx] = stampId;
          if (hitsBox(occluders[idx], ox, oy, oz, invX, invY, invZ, maxT)) return true;
        }
      }
    }
    return false;
  }

  const amb = CONFIG.ambient;
  const leak = CONFIG.shadowLeak;

  return {
    total,
    get progress() { return total ? done / total : 1; },

    /** Bake for at most budgetMs, then yield. Returns true when finished. */
    step(budgetMs = 14) {
      const deadline = performance.now() + budgetMs;

      while (itemIndex < items.length) {
        if (!cur) { beginItem(); vertexIndex = 0; }

        const { pos, nrm, n, lit, alb, flA, flB, surf, vari, surfaceId, variant, base } = cur;

        while (vertexIndex < n) {
          const i = vertexIndex++;
          done++;

          const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
          const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);

          let sr = amb, sg = amb, sb = amb;
      let ar = 0, ag = 0, ab = 0;
      let br = 0, bg = 0, bb = 0;

          const candidates = lightGrid.get(Math.floor(px / CELL), Math.floor(pz / CELL));
          if (candidates) {
            for (let c = 0; c < candidates.length; c++) {
              const l = L[candidates[c]];
              const dx = l.x - px, dy = l.y - py, dz = l.z - pz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > l.range2) continue;

              const d = Math.sqrt(d2);
              const ux = dx / d, uy = dy / d, uz = dz / d;

              const ndl = nx * ux + ny * uy + nz * uz;
              if (ndl <= 0.001) continue;

              let att = 1 - d / l.range;
              att *= att;

              // Nudge the origin off the surface so the face it sits on does
              // not shadow itself.
              const ox = px + nx * 0.06, oy = py + ny * 0.06, oz = pz + nz * 0.06;
              const shadow = occluded(ox, oy, oz, ux, uy, uz, d - 0.12) ? leak : 1.0;

              const k = ndl * att * l.intensity * shadow;
              if (l.flicker === 1) {
                ar += l.r * k; ag += l.g * k; ab += l.b * k;
              } else if (l.flicker === 2) {
                br += l.r * k; bg += l.g * k; bb += l.b * k;
              } else {
                sr += l.r * k; sg += l.g * k; sb += l.b * k;
              }
            }
          }

          const o = i * 3;
          lit[o]     = base.r * sr;
          lit[o + 1] = base.g * sg;
          lit[o + 2] = base.b * sb;
          flA[o]     = base.r * ar;
          flA[o + 1] = base.g * ag;
          flA[o + 2] = base.b * ab;
          flB[o]     = base.r * br;
          flB[o + 1] = base.g * bg;
          flB[o + 2] = base.b * bb;
          alb[o]     = base.r;
          alb[o + 1] = base.g;
          alb[o + 2] = base.b;
          surf[i]    = surfaceId;
          const v4 = i * 4;
          vari[v4]     = variant[0];
          vari[v4 + 1] = variant[1];
          vari[v4 + 2] = variant[2];
          vari[v4 + 3] = variant[3] ?? 0;

          if ((i & 255) === 0 && performance.now() > deadline) return false;
        }

        endItem();
        itemIndex++;
      }
      return true;
    },
  };
}
