import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MODEL_ASSETS, USE_ASSET_MODELS } from './assets.js';

// ---------------------------------------------------------------------------
// Models.
//
// Everything here is optional. Each slot falls back to the primitive shape the
// game already used, so an empty assets/models folder runs exactly as before
// and you can replace one model at a time.
//
// Loaded once and cloned per instance. Nineteen ghosts sharing one parsed GLB
// is the difference between a fine load and a bad one.
// ---------------------------------------------------------------------------

let loader = null;

function getLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  // Draco-compressed GLBs are typically a fifth the size. The decoder is
  // fetched from a CDN only if a model actually needs it.
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://unpkg.com/three@0.169.0/examples/jsm/libs/draco/');
  loader.setDRACOLoader(draco);
  return loader;
}

function loadOne(url) {
  return new Promise((resolve, reject) => {
    getLoader().load(url, (gltf) => resolve(gltf), undefined, reject);
  });
}

/**
 * Scale and centre a loaded model so it stands on the floor at a known height,
 * whatever units it was exported in. Blender metres, Maya centimetres and
 * whatever your marketplace model uses all end up the same size.
 */
/**
 * Scale a model to a known height, centre it on X/Z and sit it on the floor,
 * then WRAP IT IN A GROUP.
 *
 * The wrapper is the whole point. The offsets have to live on something, and if
 * they live on the model's own transform then the first caller to write
 * `obj.position.set(x, y, z)` silently throws them away — which is exactly why
 * a supplied ghost.glb appeared buried in the floor. With a wrapper, callers
 * position the wrapper and the fit underneath is untouchable.
 *
 * @returns {{root: THREE.Group, size: THREE.Vector3}} size is post-fit, in metres
 */
function fit(object, targetHeight) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 1e-4 && targetHeight) {
    object.scale.multiplyScalar(targetHeight / size.y);
    box.setFromObject(object);
    box.getSize(size);
  }
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= box.min.y;

  const root = new THREE.Group();
  root.add(object);
  return { root, size: size.clone() };
}

const cache = new Map();

/**
 * @returns {THREE.Object3D|null} a fresh clone, or null if the slot has no
 *   model and the caller should build its primitive instead.
 */
export function instance(slot) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const copy = entry.root.clone(true);
  copy.animations = entry.animations;
  return copy;
}

/** Post-fit dimensions in metres, or null if the slot has no model. */
export function sizeOf(slot) {
  return cache.get(slot)?.size ?? null;
}

/**
 * The best model for a character: their own if you supplied one, the generic
 * player otherwise, and null if neither exists so the caller draws its
 * primitive.
 */
export function characterModel(characterId) {
  return instance(`player_${characterId}`) ?? instance('player');
}

export function hasCharacterModel(characterId) {
  return has(`player_${characterId}`) || has('player');
}

export function has(slot) { return cache.has(slot); }

/**
 * A clone scaled to a specific height rather than the slot's default.
 *
 * The generator gives every piece of furniture its own dimensions so the
 * collider matches what you see; the model has to follow that, not the other
 * way round. Uniform scale, so a chair never comes out stretched.
 */
export function instanceScaled(slot, height) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const copy = entry.root.clone(true);
  if (entry.size.y > 1e-4 && height) copy.scale.setScalar(height / entry.size.y);
  return copy;
}

/**
 * A clone scaled to sit INSIDE a given box, uniformly.
 *
 * Supplied models come at wildly different proportions — a chair that is twice
 * as wide as it is tall will burst out of its footprint if you only match its
 * height, and the collider stops agreeing with what you can see. Fitting to the
 * tightest of the three axes keeps the model inside the space the generator
 * reserved for it. Returns the achieved size so the caller can shrink the
 * collider to match rather than guessing.
 */
/**
 * What a model would become if asked to fit a box, without building it.
 *
 * The collider is generated before the meshes are, so the generator needs the
 * achieved size in advance — otherwise a squat model keeps the tall footprint
 * the generator invented and you collide with air above it.
 */
export function fitInfo(slot, w, h, d) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const s = entry.size;
  if (s.x < 1e-4 || s.y < 1e-4 || s.z < 1e-4) return null;

  // HEIGHT LEADS. Fitting to the tightest of three axes sounds safe and makes
  // everything tiny: a chair modelled in a 1x1x1 box asked for 0.55 wide and
  // 0.95 tall takes the 0.55 and ends up knee-high. Height is the axis a person
  // reads, so match that, and let the footprint be whatever the model actually
  // is — the collider is rebuilt from the result, so it still agrees with what
  // you can see.
  let k = h / s.y;

  // The one thing worth refusing is a piece so wide it swallows the room. Cap
  // the footprint at a generous multiple of what the generator reserved.
  const maxFoot = Math.max(w, d) * 2.4;
  const foot = Math.max(s.x, s.z) * k;
  if (foot > maxFoot) k *= maxFoot / foot;

  return { k, w: s.x * k, h: s.y * k, d: s.z * k };
}

export function instanceInBox(slot, w, h, d) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const s = entry.size;
  if (s.x < 1e-4 || s.y < 1e-4 || s.z < 1e-4) return null;
  const k = Math.min(w / s.x, h / s.y, d / s.z);
  const copy = entry.root.clone(true);
  copy.scale.setScalar(k);
  return { object: copy, w: s.x * k, h: s.y * k, d: s.z * k };
}

export function animationsFor(slot) { return cache.get(slot)?.animations ?? []; }

/** Resolves once every configured model has either loaded or failed. */
export async function loadModels(onProgress) {
  if (!USE_ASSET_MODELS) return { loaded: [], missing: Object.keys(MODEL_ASSETS) };
  const slots = Object.entries(MODEL_ASSETS).filter(([, spec]) => spec?.url);
  const loaded = [], missing = [];
  let done = 0;

  await Promise.all(slots.map(async ([slot, spec]) => {
    try {
      const gltf = await loadOne(spec.url);
      const scene = gltf.scene ?? gltf.scenes?.[0];
      if (!scene) throw new Error('empty gltf');
      scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      const fitted = fit(scene, spec.height);
      cache.set(slot, {
        root: fitted.root, size: fitted.size, animations: gltf.animations ?? [],
      });
      loaded.push(slot);
    } catch {
      missing.push(slot);
    } finally {
      onProgress?.(++done, slots.length);
    }
  }));

  for (const [slot] of Object.entries(MODEL_ASSETS)) {
    if (!cache.has(slot) && !missing.includes(slot)) missing.push(slot);
  }
  return { loaded, missing };
}
