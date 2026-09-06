import * as THREE from 'three';
import { animationSource, animationStates } from './models.js';
import { ANIMATION_TUNING, ANIMATION_ONCE, ANIMATION_FALLBACK } from './assets.js';

// ---------------------------------------------------------------------------
// Animation.
//
// Narrow on purpose: this retargets Mixamo clips onto Mixamo characters and
// does not pretend to do anything else. That restriction is what makes it
// short, and it is the only workflow the game uses.
//
// The one thing that makes it possible: every Mixamo rig has the same bones
// with the same names. A clip downloaded on the Y-Bot is a list of rotations
// for mixamorig:LeftArm, mixamorig:Spine1 and so on, and those bones exist on
// every other Mixamo character too. So a clip is not tied to the body it was
// downloaded with, and one walk.glb animates the whole cast.
//
// Two things still have to be fixed up, which is what retarget() is for:
//
//   NAMES. Exporters mangle them differently — mixamorig:Hips becomes
//   mixamorigHips, or mixamorig_Hips, or picks up an Armature| prefix,
//   depending on which tool did the conversion. Matching on a normalised form
//   rather than the literal string means a clip converted with one tool still
//   binds to a character converted with another.
//
//   SCALE. The hip track carries the body's up-and-down motion in the source
//   character's units. Play a clip authored on a 1.6 unit tall rig against a
//   180 unit tall one and the character launches into the ceiling. Every
//   position track is scaled by the ratio of the two hip heights.
// ---------------------------------------------------------------------------

/**
 * A bone name reduced to something two exporters can agree on.
 *
 * mixamorig:LeftArm, mixamorig1:LeftArm, Armature|mixamorigLeftArm and
 * mixamorig_Left_Arm all come out as "leftarm".
 */
export function normaliseBone(name) {
  return String(name)
    .split(/[|/]/).pop()              // drop any Armature| or path prefix
    .toLowerCase()
    .replace(/mixamorig\d*/g, '')     // the rig prefix, numbered or not
    .replace(/[^a-z0-9]/g, '');       // colons, underscores, dots, spaces
}

/** Every bone in a subtree, keyed by normalised name. */
function boneIndex(root) {
  const map = new Map();
  root.traverse((o) => {
    if (!o.isBone && !o.isObject3D) return;
    const key = normaliseBone(o.name);
    if (key && !map.has(key)) map.set(key, o.name);
  });
  return map;
}

/**
 * Rebuild a clip so it drives THIS character's bones.
 *
 * Tracks whose bone has no counterpart are dropped rather than left to fail
 * silently at bind time — an unbound track is a warning per frame in the
 * console and no motion, which is a miserable thing to debug.
 *
 * Rotations are kept for every bone. Positions are kept ONLY for the hips:
 * every other bone's position is its rest offset, which belongs to the body
 * being animated and not to the clip. Copying those across is what makes a
 * retargeted character come out with the proportions of whoever the animation
 * was downloaded on.
 */
export function retarget(clip, targetRoot, source, rest) {
  const bones = boneIndex(targetRoot);
  const scale = (source.hipsY > 1e-6 && rest.hipsY > 1e-6)
    ? rest.hipsY / source.hipsY
    : 1;

  const tracks = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const rawNode = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);

    const key = normaliseBone(rawNode);
    const actual = bones.get(key);
    if (!actual) continue;

    if (property === 'quaternion') {
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${actual}.quaternion`, Array.from(track.times), Array.from(track.values),
      ));
      continue;
    }

    if (property !== 'position' || key !== 'hips') continue;

    // ANCHORED, not just scaled. This is the fix for characters standing in
    // the floor.
    //
    // A Mixamo hip track holds an absolute local position, so replaying it on
    // another rig plants the body at whatever height the SOURCE rig's hips sat
    // at. Two rigs a few centimetres apart put a character ankle-deep in the
    // boards; a rig exported at a different unit scale buries it completely.
    // And because it depends on which clip happens to be playing, it looks
    // intermittent — which is exactly how it was described.
    //
    // So only the MOTION is taken from the clip. Where that motion starts from
    // is this body's own rest pose, which is by definition the height at which
    // its feet are on the floor.
    const from = source.hipsLocal;
    const to = rest.hipsLocal;
    const values = Array.from(track.values);
    if (from && to) {
      for (let i = 0; i + 2 < values.length; i += 3) {
        values[i]     = to.x + (values[i]     - from.x) * scale;
        values[i + 1] = to.y + (values[i + 1] - from.y) * scale;
        values[i + 2] = to.z + (values[i + 2] - from.z) * scale;
      }
    } else {
      for (let i = 0; i < values.length; i++) values[i] *= scale;
    }
    tracks.push(new THREE.VectorKeyframeTrack(
      `${actual}.position`, Array.from(track.times), values,
    ));
  }

  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

/**
 * This body's rest measurements, taken once before any clip has moved it.
 *
 * Has to happen before the first action plays: read them afterwards and the
 * hips are wherever the animation currently has them, and every clip
 * retargeted from then on is anchored to a moving target.
 */
export function restPose(root) {
  let hips = null;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!hips && normaliseBone(o.name) === 'hips') hips = o;
  });
  return {
    hipsY: hips ? new THREE.Vector3().setFromMatrixPosition(hips.matrixWorld).y : 0,
    hipsLocal: hips ? hips.position.clone() : null,
  };
}

// ---------------------------------------------------------------------------

/** Playback rate so the feet keep up with the ground, per state. */
const CLIP_SPEED = {
  walk: 'walkSpeed',
  run: 'runSpeed',
  crouchWalk: 'crouchWalkSpeed',
};

/**
 * States that are the same gait at different speeds.
 *
 * Moving between any two of these keeps the stride phase instead of starting
 * the incoming clip at frame 0, so the body does not swap which foot is
 * forward halfway through a step.
 */
const GAIT = new Set(['walk', 'run', 'crouchWalk']);

/**
 * One character's animation. Owns a mixer, resolves states to clips lazily,
 * and cross-fades between them.
 *
 * Built to be harmless when there is nothing to play: with no animation files
 * on disk every method is a no-op and the caller falls back to whatever it did
 * before, which is how a half-populated assets/animations folder still runs.
 */
export class CharacterAnimator {
  /** @param root the character's model, already cloned for this instance */
  constructor(root) {
    this.root = root;
    // BEFORE the mixer exists, let alone plays anything. Every clip is
    // anchored to these numbers, and reading them off a body that is already
    // mid-animation anchors it to a moving target.
    this.rest = restPose(root);
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();     // state -> AnimationAction, or null if none
    this.clips = new Map();       // source state -> retargeted clip, or null
    this.state = null;
    // No skeleton, nothing to drive.
    this.usable = animationStates().length > 0 && !!findSkinned(root);
  }

  /**
   * Resolve a state to an action, following ANIMATION_FALLBACK.
   *
   * Retargeted clips are cached by the state they actually came FROM, not by
   * the state that was asked for, so run-falling-back-to-walk and walk itself
   * end up sharing one clip and therefore one action. Without that they would
   * be two actions playing identical motion and every transition between them
   * would be a pointless cross-fade.
   */
  _action(state) {
    if (this.actions.has(state)) return this.actions.get(state);

    let made = null;
    for (const candidate of [state, ...(ANIMATION_FALLBACK[state] ?? ['idle'])]) {
      let clip = this.clips.get(candidate);
      if (clip === undefined) {
        const src = animationSource(candidate);
        clip = src ? retarget(src.clip, this.root, src, this.rest) : null;
        // A clip with no tracks bound to nothing; remember that so we do not
        // pay to retarget it again for every state that falls back to it.
        if (clip && !clip.tracks.length) clip = null;
        this.clips.set(candidate, clip);
      }
      if (!clip) continue;

      made = this.mixer.clipAction(clip);
      if (ANIMATION_ONCE.includes(candidate)) {
        made.setLoop(THREE.LoopOnce, 1);
        made.clampWhenFinished = true;
      }
      break;
    }

    this.actions.set(state, made);
    return made;
  }

  /**
   * @param state one of the keys in ANIMATION_ASSETS
   * @param speed ground speed in m/s, used to keep the feet honest
   */
  play(state, speed = 0) {
    if (!this.usable) return;
    const next = this._action(state);

    if (state !== this.state) {
      const from = this.state;
      const previous = from ? this.actions.get(from) : null;
      this.state = state;
      // fadeOut/fadeIn rather than crossFadeTo. They do the same thing here
      // and do not care whether the outgoing action was still running, which
      // crossFadeTo does — and a one-shot that has already finished is exactly
      // that case.
      if (previous && previous !== next) previous.fadeOut(ANIMATION_TUNING.fade);
      if (next && previous !== next) {
        next.reset();
        // Walk and run are the same gait at two speeds. Starting the incoming
        // clip at the phase the outgoing one had reached keeps the same foot
        // forward; reset()ing to frame 0 is what makes the legs jump at the
        // moment somebody breaks into a sprint.
        if (previous && GAIT.has(state) && GAIT.has(from)) {
          const a = previous.getClip().duration || 1;
          const b = next.getClip().duration || 1;
          next.time = ((previous.time % a) / a) * b;
        }
        next.setEffectiveWeight(1).fadeIn(ANIMATION_TUNING.fade).play();
      }
    }

    // AFTER any reset() above, which sets the time scale back to 1. Setting it
    // first is the reason a run would play at walking pace for the first
    // moment after the blend.
    if (!next) return;
    const tuningKey = CLIP_SPEED[state];
    if (!tuningKey) { next.timeScale = 1; return; }
    const authored = ANIMATION_TUNING[tuningKey] || 1;
    const [lo, hi] = ANIMATION_TUNING.rateRange;
    next.timeScale = Math.min(hi, Math.max(lo, speed / authored));
  }

  update(dt) {
    if (this.usable && dt > 0) this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    this.clips.clear();
  }
}

/**
 * Which state a body in this condition should be in.
 *
 * Kept out of the animator so the same rules apply to a remote player, to the
 * preview in the character room, and to anything added later.
 */
export function stateFor({ speed = 0, crouching = false, downed = false, current = null } = {}) {
  if (downed) return 'downed';

  // HYSTERESIS. Pass the state the body is already in and the thresholds move
  // to make leaving it harder than entering it.
  //
  // Without this, a speed sitting on a threshold flips state every frame. Each
  // flip starts a fresh cross-fade, the flips arrive faster than the fade
  // finishes, and neither action ever reaches full weight or zero — so the
  // mixer holds a permanent blend of two clips. That is what a character
  // walking and running at the same time actually is.
  //
  // Callers that have no state to report may omit `current`; they simply get
  // the old sharp-threshold behaviour.
  const wasMoving = current === 'walk' || current === 'run' || current === 'crouchWalk';
  const wasRunning = current === 'run';

  const moving = speed > band(ANIMATION_TUNING.moveAbove, ANIMATION_TUNING.moveBand, wasMoving);
  if (crouching) return moving ? 'crouchWalk' : 'crouchIdle';
  if (!moving) return 'idle';
  return speed > band(ANIMATION_TUNING.runAbove, ANIMATION_TUNING.runBand, wasRunning) ? 'run' : 'walk';
}

/**
 * The threshold to compare against, widened or narrowed by the dead band
 * depending on whether we are already in the state it gates.
 *
 * The clamp is the whole point. A band wider than its own threshold puts the
 * exit at or below zero, and since ground speed is never negative, nothing can
 * ever satisfy it — a body that started walking would keep walking on the spot
 * forever, because idle had become unreachable. Capping the band at just under
 * the threshold means a wrong number in ANIMATION_TUNING degrades to weak
 * hysteresis instead of a stuck state.
 */
function band(threshold, width, inState) {
  const w = Math.min(Math.max(width ?? 0, 0), threshold * 0.9);
  return threshold + (inState ? -w : w);
}

function findSkinned(root) {
  let found = null;
  root.traverse((o) => { if (!found && o.isSkinnedMesh) found = o; });
  return found;
}
