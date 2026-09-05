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
function fit(object, targetHeight) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 1e-4 && targetHeight) {
    const k = targetHeight / size.y;
    object.scale.multiplyScalar(k);
    box.setFromObject(object);
  }
  const centre = new THREE.Vector3();
  box.getCenter(centre);
  // Centre on X/Z, sit on the floor on Y.
  object.position.x -= centre.x;
  object.position.z -= centre.z;
  object.position.y -= box.min.y;
  return object;
}

const cache = new Map();

/**
 * @returns {THREE.Object3D|null} a fresh clone, or null if the slot has no
 *   model and the caller should build its primitive instead.
 */
export function instance(slot) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const copy = entry.scene.clone(true);
  copy.animations = entry.animations;
  return copy;
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
  const copy = entry.scene.clone(true);
  const box = new THREE.Box3().setFromObject(copy);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 1e-4 && height) copy.scale.multiplyScalar(height / size.y);
  return copy;
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
      fit(scene, spec.height);
      scene.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      cache.set(slot, { scene, animations: gltf.animations ?? [] });
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
