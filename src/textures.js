import * as THREE from 'three';
import { CONFIG } from './level.js';
import { TEXTURE_ASSETS, USE_ASSET_TEXTURES } from './assets.js';

// ---------------------------------------------------------------------------
// Surfaces.
//
// THREE VARIANTS PER SURFACE TYPE, PACKED INTO ONE TEXTURE.
//
// Rooms needed to look like different rooms, not the same room with the grain
// shifted. Nine separate textures would mean nine samplers and nine fetches per
// fragment; a 2x2 atlas would need textureGrad to keep its mip levels honest,
// which means GLSL3 and a far larger change.
//
// Instead every pattern is generated GREYSCALE and three are packed into the R,
// G and B channels of one tile. The shader samples once per surface type and
// dots the result with a one-hot weight, so choosing a variant costs a dot
// product and the fetch count is unchanged at three.
//
// Colour therefore comes entirely from the per-room albedo. Texture supplies
// pattern; albedo supplies whether it is wood, damp or stone. That split is
// also what lets a supplied colour image still work — see uPacked.
//
// Everything is periodic: integer noise scales, periods that divide 512, and
// wrapped line drawing.
// ---------------------------------------------------------------------------

const SIZE = 512;
const N = SIZE * SIZE;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseGrid(cells, rand) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return { cells, g };
}

function sampleNoise(n, x, y) {
  const { cells, g } = n;
  const fx = (x / SIZE) * cells;
  const fy = (y / SIZE) * cells;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const i0 = ((x0 % cells) + cells) % cells;
  const j0 = ((y0 % cells) + cells) % cells;
  const i1 = (i0 + 1) % cells, j1 = (j0 + 1) % cells;
  const a = g[j0 * cells + i0], b = g[j0 * cells + i1];
  const c = g[j1 * cells + i0], d = g[j1 * cells + i1];
  const top = a + (b - a) * sx;
  return top + ((c + (d - c) * sx) - top) * sy;
}

// EVERY scale applied to a noise coordinate must be a whole number. sampleNoise
// wraps at SIZE, so a coordinate multiplied by 0.45 advances only 0.45 of a
// period across the tile and the pattern stops meeting itself at the edge.
function fbm(layers, x, y) {
  let sum = 0, amp = 0.5, total = 0;
  for (const n of layers) { sum += sampleNoise(n, x, y) * amp; total += amp; amp *= 0.5; }
  return sum / total;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const buf = () => new Float32Array(N);
const wrap = (v) => ((v % SIZE) + SIZE) % SIZE;

/** Darken along a line, wrapped both ways so cracks continue across tiles. */
function scratch(b, x0, y0, x1, y1, width, strength) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) + 1;
  const r = Math.max(1, Math.round(width));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const fall = 1 - Math.hypot(ox, oy) / (r + 0.5);
        if (fall <= 0) continue;
        b[wrap(Math.round(py + oy)) * SIZE + wrap(Math.round(px + ox))] -= strength * fall;
      }
    }
  }
}

function cracks(b, rand, count, strength) {
  for (let c = 0; c < count; c++) {
    let x = rand() * SIZE, y = rand() * SIZE;
    let angle = rand() * Math.PI * 2;
    const steps = 16 + ((rand() * 26) | 0);
    for (let s = 0; s < steps; s++) {
      angle += (rand() - 0.5) * 0.9;
      const nx = x + Math.cos(angle) * 9;
      const ny = y + Math.sin(angle) * 9;
      scratch(b, x, y, nx, ny, 0.7 + rand() * 1.0, strength);
      x = nx; y = ny;
    }
  }
}

/**
 * Per-plank tones that wrap.
 *
 * Drawing them independently means the first and last plank can differ by more
 * than any neighbouring pair, and since those two meet when the tile repeats,
 * that shows as a hard line every 512 pixels. Built from two sine harmonics
 * instead, the sequence is periodic by construction, so the wrap step is no
 * larger than any other.
 */
function periodicTones(count, amp, rand) {
  const p1 = rand() * Math.PI * 2, p2 = rand() * Math.PI * 2;
  const w = 0.6 + rand() * 0.4;
  const out = [];
  for (let k = 0; k < count; k++) {
    const t = (k / count) * Math.PI * 2;
    out.push(amp * (Math.sin(t + p1) * w + Math.sin(t * 2 + p2) * (1 - w)));
  }
  return out;
}

/** Force a channel to a known mean, so all three variants sit at one exposure. */
function normaliseBuf(b, target) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum += b[i];
  const mean = sum / N;
  if (mean < 1e-4) return;
  const k = target / mean;
  for (let i = 0; i < N; i++) b[i] = clamp01(b[i] * k);
}

// --------------------------- wall variants ---------------------------------

/** Vertical panelling, with the grain pulled around each knot. */
function wallPanelling(rand) {
  const b = buf();
  const PLANK = 64;
  const grain = [noiseGrid(8, rand), noiseGrid(31, rand), noiseGrid(83, rand)];
  const varnish = [noiseGrid(3, rand), noiseGrid(9, rand)];
  const grit = noiseGrid(128, rand);
  const tone = periodicTones(SIZE / PLANK, 0.26, rand);
  const knots = [];
  for (let k = 0; k < 5; k++) knots.push({ x: rand() * SIZE, y: rand() * SIZE, r: 9 + rand() * 15 });

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const plank = Math.floor(x / PLANK);
      const inPlank = x % PLANK;
      let gx = x, gy = y, ring = 0;
      for (const kn of knots) {
        let dx = x - kn.x; if (dx > SIZE / 2) dx -= SIZE; if (dx < -SIZE / 2) dx += SIZE;
        let dy = y - kn.y; if (dy > SIZE / 2) dy -= SIZE; if (dy < -SIZE / 2) dy += SIZE;
        const dist = Math.hypot(dx, dy);
        if (dist > kn.r * 4) continue;
        const pull = Math.exp(-dist / (kn.r * 1.7));
        gx += dx * pull * 1.5;
        gy += dy * pull * 0.5;
        if (dist < kn.r) ring = Math.max(ring, (0.5 + 0.5 * Math.cos((dist / kn.r) * Math.PI * 5)) * (1 - dist / kn.r));
      }
      let v = 0.46 + tone[plank] + (fbm(grain, gx * 4, gy) - 0.5) * 0.42;
      const edge = Math.min(inPlank, PLANK - 1 - inPlank);
      if (edge < 2) v -= (1 - edge / 2) * 0.32;
      v -= ring * 0.34;
      v -= clamp01((fbm(varnish, x, y * 2) - 0.48) * 2.6) * 0.20;
      v += (sampleNoise(grit, x, y) - 0.5) * 0.06;
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 4, 0.16);
  return b;
}

/** Damp plaster that has been coming off the wall for years. */
function wallPlaster(rand) {
  const b = buf();
  const mottle = [noiseGrid(4, rand), noiseGrid(13, rand), noiseGrid(47, rand)];
  const damp = [noiseGrid(2, rand), noiseGrid(6, rand)];
  const loss = [noiseGrid(3, rand), noiseGrid(11, rand)];
  const grit = noiseGrid(160, rand);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0.56 + (fbm(mottle, x, y) - 0.5) * 0.30;
      v -= clamp01((fbm(damp, x * 2, y) - 0.44) * 2.8) * 0.34;
      const gone = clamp01((fbm(loss, x, y) - 0.56) * 4.0);
      if (gone > 0) {
        v -= gone * 0.26;
        v += (sampleNoise(grit, x * 2, y * 2) - 0.5) * gone * 0.22;
      }
      v += (sampleNoise(grit, x, y) - 0.5) * 0.05;
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 22, 0.26);
  return b;
}

/** Coursed stone, laid the way a cellar wall is. */
function wallStone(rand) {
  const b = buf();
  const COURSE = 64, BRICK = 128;
  const rough = [noiseGrid(6, rand), noiseGrid(37, rand), noiseGrid(110, rand)];
  const soot = [noiseGrid(3, rand), noiseGrid(10, rand)];

  const tone = new Map();
  for (let cy = 0; cy < SIZE / COURSE; cy++) {
    for (let cx = 0; cx < SIZE / BRICK; cx++) tone.set(`${cx},${cy}`, (rand() - 0.5) * 0.24);
  }

  for (let y = 0; y < SIZE; y++) {
    const course = Math.floor(y / COURSE);
    const inCourse = y % COURSE;
    const offset = (course % 2) * (BRICK / 2);
    for (let x = 0; x < SIZE; x++) {
      const sx = (x + offset) % SIZE;
      const block = Math.floor(sx / BRICK);
      const inBlock = sx % BRICK;
      let v = 0.52 + tone.get(`${block},${course}`) + (fbm(rough, x * 2, y * 2) - 0.5) * 0.26;

      const mv = Math.min(inCourse, COURSE - 1 - inCourse);
      const mh = Math.min(inBlock, BRICK - 1 - inBlock);
      const mortar = Math.max(mv < 4 ? 1 - mv / 4 : 0, mh < 4 ? 1 - mh / 4 : 0);
      v = v * (1 - mortar) + (0.40 + (fbm(rough, x, y) - 0.5) * 0.18) * mortar;
      if (mortar > 0.6) v -= 0.10;

      v -= clamp01((fbm(soot, x, y) - 0.50) * 2.4) * 0.22;
      b[y * SIZE + x] = v;
    }
  }
  return b;
}

// --------------------------- floor variants --------------------------------

function floorPlanks(rand) {
  const b = buf();
  const PLANK = 64;
  const grain = [noiseGrid(6, rand), noiseGrid(23, rand), noiseGrid(97, rand)];
  const rot = [noiseGrid(3, rand), noiseGrid(8, rand)];
  const tone = periodicTones(SIZE / PLANK, 0.22, rand);

  for (let y = 0; y < SIZE; y++) {
    const plank = Math.floor(y / PLANK);
    const inPlank = y % PLANK;
    for (let x = 0; x < SIZE; x++) {
      let v = 0.46 + tone[plank] + (fbm(grain, x, y * 4) - 0.5) * 0.44;
      const edge = Math.min(inPlank, PLANK - 1 - inPlank);
      if (edge < 2) v -= (1 - edge / 2) * 0.30;
      v -= clamp01((fbm(rot, x, y) - 0.52) * 3.4) * 0.30;
      b[y * SIZE + x] = v;
    }
  }
  return b;
}

/** Square tile, chipped, with grout gone dark. */
function floorTile(rand) {
  const b = buf();
  const TILE = 64;
  const wear = [noiseGrid(5, rand), noiseGrid(19, rand), noiseGrid(64, rand)];
  const filth = [noiseGrid(3, rand), noiseGrid(9, rand)];
  const tone = new Map();
  for (let ty = 0; ty < SIZE / TILE; ty++) {
    for (let tx = 0; tx < SIZE / TILE; tx++) tone.set(`${tx},${ty}`, (rand() - 0.5) * 0.20);
  }

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      const ix = x % TILE, iy = y % TILE;
      let v = 0.60 + tone.get(`${tx},${ty}`) + (fbm(wear, x, y) - 0.5) * 0.16;
      const g = Math.min(ix, TILE - 1 - ix, iy, TILE - 1 - iy);
      if (g < 3) v = v * (g / 3) + 0.26 * (1 - g / 3);
      else if (g < 6) v += (1 - (g - 3) / 3) * 0.05;
      v -= clamp01((fbm(filth, x, y) - 0.50) * 2.6) * 0.26;
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 10, 0.20);
  return b;
}

/** Wide rough boards, more dirt than finish. */
function floorBoards(rand) {
  const b = buf();
  const PLANK = 128;
  const grain = [noiseGrid(4, rand), noiseGrid(17, rand), noiseGrid(70, rand)];
  const dirt = [noiseGrid(2, rand), noiseGrid(7, rand), noiseGrid(21, rand)];
  const tone = periodicTones(SIZE / PLANK, 0.26, rand);

  for (let y = 0; y < SIZE; y++) {
    const plank = Math.floor(y / PLANK);
    const inPlank = y % PLANK;
    for (let x = 0; x < SIZE; x++) {
      let v = 0.44 + tone[plank] + (fbm(grain, x, y * 2) - 0.5) * 0.34;
      const edge = Math.min(inPlank, PLANK - 1 - inPlank);
      if (edge < 3) v -= (1 - edge / 3) * 0.34;
      v -= clamp01((fbm(dirt, x, y) - 0.40) * 1.8) * 0.30;
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 6, 0.14);
  return b;
}

// -------------------------- ceiling variants -------------------------------

function ceilBeams(rand) {
  const b = buf();
  const BOARD = 64, BEAM = 128, BEAM_W = 26;
  const grain = [noiseGrid(7, rand), noiseGrid(29, rand), noiseGrid(97, rand)];
  const soot = [noiseGrid(4, rand), noiseGrid(11, rand)];
  const tone = periodicTones(SIZE / BOARD, 0.20, rand);

  for (let y = 0; y < SIZE; y++) {
    const board = Math.floor(y / BOARD);
    const inBoard = y % BOARD;
    for (let x = 0; x < SIZE; x++) {
      let v = 0.42 + tone[board] + (fbm(grain, x, y * 4) - 0.5) * 0.30;
      const edge = Math.min(inBoard, BOARD - 1 - inBoard);
      if (edge < 2) v -= (1 - edge / 2) * 0.26;
      // Offset half a period so a beam edge never lands on the tile seam.
      const inBeam = (x + BEAM / 2) % BEAM;
      if (inBeam < BEAM_W) {
        v -= 0.14;
        if (inBeam < 3) v += 0.16;
        if (inBeam > BEAM_W - 4) v -= 0.10;
      }
      v -= clamp01((fbm(soot, x, y) - 0.44) * 2.2) * 0.22;
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 6, 0.18);
  return b;
}

/** Plaster with tidemarks where the water stopped, more than once. */
function ceilPlaster(rand) {
  const b = buf();
  const mottle = [noiseGrid(5, rand), noiseGrid(13, rand), noiseGrid(61, rand)];
  const wobble = noiseGrid(11, rand);
  const stains = [];
  for (let k = 0; k < 3; k++) stains.push({ x: rand() * SIZE, y: rand() * SIZE, r: 60 + rand() * 90 });

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let v = 0.56 + (fbm(mottle, x, y) - 0.5) * 0.26;
      for (const s of stains) {
        let dx = Math.abs(x - s.x); if (dx > SIZE / 2) dx = SIZE - dx;
        let dy = Math.abs(y - s.y); if (dy > SIZE / 2) dy = SIZE - dy;
        const dist = Math.hypot(dx, dy) * (0.85 + sampleNoise(wobble, x, y) * 0.3);
        if (dist > s.r) continue;
        const t = dist / s.r;
        const ring = 0.5 + 0.5 * Math.cos(t * Math.PI * 7);
        v -= (1 - t) * (0.35 + ring * 0.35) * 0.40;
      }
      b[y * SIZE + x] = v;
    }
  }
  cracks(b, rand, 18, 0.24);
  return b;
}

/** Narrow lath, sagging, with the dark between the slats. */
function ceilLath(rand) {
  const b = buf();
  const SLAT = 32;
  const grain = [noiseGrid(9, rand), noiseGrid(41, rand)];
  const sag = [noiseGrid(2, rand), noiseGrid(5, rand)];
  const tone = periodicTones(SIZE / SLAT, 0.24, rand);

  for (let y = 0; y < SIZE; y++) {
    const slat = Math.floor(y / SLAT);
    const inSlat = y % SLAT;
    for (let x = 0; x < SIZE; x++) {
      let v = 0.46 + tone[slat] + (fbm(grain, x, y * 6) - 0.5) * 0.22;
      const edge = Math.min(inSlat, SLAT - 1 - inSlat);
      if (edge < 3) v -= (1 - edge / 3) * 0.46;
      v -= clamp01((fbm(sag, x, y) - 0.42) * 1.6) * 0.24;
      b[y * SIZE + x] = v;
    }
  }
  return b;
}

// ---------------------------------------------------------------------------

function packRGB(v0, v1, v2, target) {
  normaliseBuf(v0, target);
  normaliseBuf(v1, target);
  normaliseBuf(v2, target);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const d = img.data;
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    d[o] = v0[i] * 255;
    d[o + 1] = v1[i] * 255;
    d[o + 2] = v2[i] * 255;
    d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, aniso, packed) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // A packed tile holds three greyscale masks, not a colour image. Tagging it
  // sRGB would gamma-curve the masks and the three variants would stop matching.
  t.colorSpace = packed ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

export const VARIANT_NAMES = {
  wall: ['panelling', 'damp plaster', 'coursed stone'],
  floor: ['warped planks', 'cracked tile', 'rough boards'],
  ceiling: ['boards and beams', 'stained plaster', 'sagging lath'],
};
export const VARIANTS_PER_SURFACE = 3;

let cachedProcedural = null;

export function createHauntedTextures(anisotropy = 4) {
  if (cachedProcedural) return cachedProcedural;
  const rand = rng(0x8ADF00D);
  cachedProcedural = {
    wall: toTexture(packRGB(wallPanelling(rand), wallPlaster(rand), wallStone(rand), 0.50), anisotropy, true),
    floor: toTexture(packRGB(floorPlanks(rand), floorTile(rand), floorBoards(rand), 0.48), anisotropy, true),
    ceiling: toTexture(packRGB(ceilBeams(rand), ceilPlaster(rand), ceilLath(rand), 0.46), anisotropy, true),
    packed: { wall: 1, floor: 1, ceiling: 1 },
  };
  return cachedProcedural;
}

// ---------------------------------------------------------------------------
// Supplied images, with the generated tiles as the fallback.
// ---------------------------------------------------------------------------

function loadImage(url, anisotropy) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = anisotropy;
        t.generateMipmaps = true;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        resolve(t);
      },
      undefined,
      () => reject(new Error(`no texture at ${url}`)),
    );
  });
}

/**
 * The shader doubles whatever it samples, so a tile that is not mid-toned
 * shifts the brightness of the whole house away from what the light bake
 * computed. We cannot fix someone's image for them, but we can say so.
 */
function warnIfMistoned(name, texture) {
  try {
    const img = texture.image;
    if (!img?.width) return;
    const c = document.createElement('canvas');
    const n = 64;
    c.width = c.height = n;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    }
    const mean = sum / (n * n) / 255;
    if (mean < 0.32 || mean > 0.68) {
      console.warn(
        `[textures] ${name} averages ${mean.toFixed(2)} brightness. ` +
        'Around 0.5 keeps the baked lighting accurate; this will make the ' +
        `house look ${mean < 0.5 ? 'darker' : 'brighter'} than intended.`,
      );
    }
  } catch { /* cross-origin image, cannot inspect; not worth failing over */ }
}

let cachedSurfaces = null;

/**
 * Resolves to the three surface textures plus the per-surface tiling scale.
 * Never rejects: a missing or broken file falls back to the generated tile for
 * that surface alone, so you can replace them one at a time.
 */
export async function loadSurfaceTextures(anisotropy = 4) {
  if (cachedSurfaces) return cachedSurfaces;
  const procedural = createHauntedTextures(anisotropy);
  const out = {
    ...procedural,
    packed: { ...procedural.packed },
    sources: {},
    metres: { ...CONFIG.textureMetres },
  };

  if (USE_ASSET_TEXTURES) {
    await Promise.all(Object.entries(TEXTURE_ASSETS).map(async ([key, spec]) => {
      if (!spec?.url) return;
      try {
        const t = await loadImage(spec.url, anisotropy);
        out[key] = t;
        // A supplied image is one picture, not three packed masks, so it
        // replaces all three variants for that surface.
        out.packed[key] = 0;
        out.sources[key] = spec.url;
        if (spec.metresPerTile) out.metres[key] = spec.metresPerTile;
        warnIfMistoned(key, t);
      } catch {
        out.sources[key] = 'generated';
      }
    }));
  } else {
    for (const k of ['wall', 'floor', 'ceiling']) out.sources[k] = 'generated';
  }

  cachedSurfaces = out;
  return out;
}

export const SURFACE = { WALL: 0, FLOOR: 1, CEILING: 2 };
