import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import {
  MODEL_ASSETS, USE_ASSET_MODELS, STRIP_MODEL_OBJECTS, PROP_SIZE,
  ANIMATION_ASSETS, USE_ASSET_ANIMATIONS,
} from './assets.js';

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

/**
 * Drop labels and other junk objects before anything measures the model.
 *
 * Order matters: this runs before fit(), because a floating "Text" plane is
 * part of the bounding box, and fitting a cube-plus-label to 0.65 m makes the
 * cube itself noticeably shorter than 0.65 m.
 */
function stripJunk(scene) {
  if (!STRIP_MODEL_OBJECTS) return 0;
  const doomed = [];
  scene.traverse((o) => {
    if (o !== scene && o.name && STRIP_MODEL_OBJECTS.test(o.name)) doomed.push(o);
  });
  for (const o of doomed) o.parent?.remove(o);
  return doomed.length;
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
/**
 * Bounds of a model, correct for rigged ones too.
 *
 * A SkinnedMesh is not where its geometry says it is. The vertices in the
 * buffer are in bind space and the skeleton is what puts them somewhere, so
 * measuring the raw geometry gives a box in the wrong place and often the
 * wrong size. three knows how to do this properly — SkinnedMesh has its own
 * computeBoundingBox that walks every vertex through applyBoneTransform — but
 * it needs the bone world matrices to be current, and straight out of the
 * loader they are not. Without the two lines below, a Mixamo character
 * measures against a box that has nothing to do with the body, which is why
 * one came out standing several metres to the side of where it was put and
 * swung around the room instead of turning on the spot.
 */
function measure(object) {
  object.updateMatrixWorld(true);
  object.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton?.update?.();
    o.boundingBox = null;      // cached; must be dropped or the second pass is stale
  });
  return new THREE.Box3().setFromObject(object);
}

function fit(object, targetHeight) {
  const box = measure(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.y > 1e-4 && targetHeight) {
    object.scale.multiplyScalar(targetHeight / size.y);
    box.copy(measure(object));
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
 * Mark a clone as belonging to the shared cache.
 *
 * Object3D.clone() copies the transform tree but SHARES geometry and materials
 * with the original. A scene teardown that walks every mesh and calls
 * geometry.dispose() therefore frees the parsed GLB itself, and the next run
 * clones something that no longer has buffers on the GPU — which is why the
 * furniture came back wrong on the second house and not the first. Anything
 * carrying this flag is skipped by that teardown.
 */
function pool(copy) {
  copy.userData.pooled = true;
  return copy;
}

/** Is this object, or anything above it, a clone of a cached model? */
export function isPooled(object) {
  for (let o = object; o; o = o.parent) {
    if (o.userData?.pooled) return true;
  }
  return false;
}

/**
 * @returns {THREE.Object3D|null} a fresh clone, or null if the slot has no
 *   model and the caller should build its primitive instead.
 */
/**
 * Clone a cached model.
 *
 * Object3D.clone() is wrong for anything rigged, and wrong in a way that looks
 * like the model simply failed to load. It copies the SkinnedMesh but leaves
 * the copy's skeleton POINTING AT THE ORIGINAL'S BONES — so every clone
 * deforms to whatever pose that first skeleton happens to be in, wherever it
 * happens to be. In practice: the character room builds one, its bones live in
 * the character room's scene, and every teammate cloned afterwards has their
 * vertices dragged off to that skeleton's coordinates. They are not invisible,
 * they are somewhere else, which is why all you could see was the marker bead
 * that had been positioned honestly.
 *
 * SkeletonUtils.clone rebuilds the bone hierarchy and rebinds to it. It costs
 * more than a plain clone, so it is only used where it is needed.
 */
function copyOf(entry) {
  return entry.skinned ? cloneSkinned(entry.root) : entry.root.clone(true);
}

export function instance(slot) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const copy = copyOf(entry);
  copy.animations = entry.animations;
  return pool(copy);
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
  const copy = copyOf(entry);
  if (entry.size.y > 1e-4 && height) copy.scale.setScalar(height / entry.size.y);
  return pool(copy);
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
 * How far a single axis may stretch away from the uniform scale.
 *
 * 1.0 would be strictly uniform — correct proportions, and a cube-shaped
 * placeholder standing in for a two-metre bed stays a small cube with a small
 * collider. Higher lets a model fill the footprint the generator reserved, at
 * the cost of squashing it. A third either way is not visible on furniture and
 * is enough to close the gap on anything roughly box-shaped. Turn it down to
 * 1.0 once every slot has a real model in it.
 */
export const MAX_STRETCH = 1.35;

/**
 * What a model would become if asked to fit a box, without building it.
 *
 * The collider is generated before the meshes are, so the generator needs the
 * achieved size in advance — otherwise a squat model keeps the tall footprint
 * the generator invented and you collide with air above it.
 *
 * HEIGHT LEADS, and then the other two axes are allowed to move towards the
 * reserved footprint. Fitting uniformly to the tightest of three axes sounds
 * safe and makes everything tiny: a chair modelled in a 1x1x1 box asked for
 * 0.55 wide and 0.95 tall takes the 0.55 and ends up knee-high. Height is the
 * axis a person reads, so that sets the base scale; width and depth then
 * stretch towards what the generator actually reserved, capped at
 * MAX_STRETCH so nothing comes out visibly deformed.
 *
 * The caller rebuilds the collider from w/h/d, so whatever comes out of here,
 * the box you walk into is the box you can see.
 */
export function fitInfo(slot, w, h, d) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const s = entry.size;
  if (s.x < 1e-4 || s.y < 1e-4 || s.z < 1e-4) return null;

  const base = h / s.y;
  const lo = base / MAX_STRETCH, hi = base * MAX_STRETCH;
  let kx = Math.min(hi, Math.max(lo, w / s.x));
  let ky = base;
  let kz = Math.min(hi, Math.max(lo, d / s.z));

  // Your dial (assets.js). Applied last and to all three axes together, so it
  // never changes the shape — only how big the thing is. The caller rebuilds
  // the collider from what comes out, so this cannot desync the hitbox.
  const nudge = PROP_SIZE?.[slot] ?? 1;
  if (nudge > 0 && nudge !== 1) { kx *= nudge; ky *= nudge; kz *= nudge; }

  return {
    // Per axis. Callers do obj.scale.set(scale.x, scale.y, scale.z).
    scale: { x: kx, y: ky, z: kz },
    // The uniform equivalent, for anything that still wants one number.
    k: ky,
    w: s.x * kx, h: s.y * ky, d: s.z * kz,
  };
}

export function instanceInBox(slot, w, h, d) {
  const entry = cache.get(slot);
  if (!entry) return null;
  const s = entry.size;
  if (s.x < 1e-4 || s.y < 1e-4 || s.z < 1e-4) return null;
  const k = Math.min(w / s.x, h / s.y, d / s.z);
  const copy = copyOf(entry);
  copy.scale.setScalar(k);
  return { object: pool(copy), w: s.x * k, h: s.y * k, d: s.z * k };
}

export function animationsFor(slot) { return cache.get(slot)?.animations ?? []; }

// ---------------------------------------------------------------------------
// Animation clips.
//
// Loaded from their own files rather than out of the character models, so one
// walk.glb animates the whole cast. See the note in assets.js: every Mixamo
// rig shares its bone names, which is what makes that work.
//
// Only the raw clip is stored here plus the hip height of the body it was
// downloaded on. Fitting it to a particular character is animation.js's job
// and happens per instance, because the answer differs per character.
// ---------------------------------------------------------------------------

const clips = new Map();

/** @returns {{clip: THREE.AnimationClip, hipsY: number}|null} */
export function animationSource(state) {
  return clips.get(state) ?? null;
}

export function animationStates() {
  return [...clips.keys()];
}

/**
 * Rest height of the hips in a loaded animation file, which is the yardstick
 * the retargeter scales hip motion against.
 *
 * Duplicated from animation.js rather than imported, to keep models.js free of
 * a dependency on it — this file is loaded by things that never animate.
 */
function sourceHipsHeight(scene) {
  let bone = null;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (bone) return;
    const n = String(o.name).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (n.replace(/mixamorig\d*/g, '') === 'hips') bone = o;
  });
  if (!bone) return 0;
  return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).y;
}

/** Resolves once every configured animation has either loaded or failed. */
export async function loadAnimations() {
  if (!USE_ASSET_ANIMATIONS) return { loaded: [], missing: Object.keys(ANIMATION_ASSETS) };
  const entries = Object.entries(ANIMATION_ASSETS).filter(([, url]) => url);
  const loaded = [], missing = [];

  await Promise.all(entries.map(async ([state, url]) => {
    try {
      const gltf = await loadOne(url);
      // A Mixamo export carries exactly one clip, usually called
      // "mixamo.com". Anything with several is somebody's own combined file,
      // and the first is still the reasonable guess.
      const clip = gltf.animations?.[0];
      if (!clip) throw new Error('no clip');
      const scene = gltf.scene ?? gltf.scenes?.[0];
      clips.set(state, {
        clip,
        hipsY: scene ? sourceHipsHeight(scene) : 0,
      });
      loaded.push(state);
    } catch {
      missing.push(state);
    }
  }));

  return { loaded, missing };
}

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
      const stripped = stripJunk(scene);
      if (stripped) {
        console.info(`[models] ${slot}: dropped ${stripped} label object(s) from ${spec.url}`);
      }
      let skinned = false;
      scene.traverse((o) => {
        if (o.isMesh) o.frustumCulled = false;
        // A rigged mesh must never be culled by its own bounds either: those
        // bounds are the bind pose, and an animated arm reaching outside them
        // makes the whole body vanish at the edge of the screen.
        if (o.isSkinnedMesh) { o.frustumCulled = false; skinned = true; }
      });
      const fitted = fit(scene, spec.height);
      cache.set(slot, {
        root: fitted.root, size: fitted.size, skinned,
        animations: gltf.animations ?? [],
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
