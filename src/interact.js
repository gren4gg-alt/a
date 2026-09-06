import * as THREE from 'three';
import { createGlowMaterial, relightModel } from './material.js';
import { instance as modelInstance, has as hasModel } from './models.js';
import { CONFIG } from './level.js';
import { createBoard, applyStroke, createNoticeTexture, noticeLines } from './boards.js';

// ---------------------------------------------------------------------------
// Things you can walk up to and use.
//
// Three kinds, one lookup. Everything holds a world position, a facing, and a
// use radius; main.js asks what is nearest and shows a prompt for it. State
// that matters (who is in which closet, which relics are taken, what is in the
// door) lives on the host and arrives here through setters, so this file never
// decides anything — it only knows how to draw it.
// ---------------------------------------------------------------------------

export const USE_RANGE = 1.9;

export class Interactables {
  /**
   * @param propMats the run's PropMaterials, or null.
   *
   * Imported models MUST be run through this or they render black. There is
   * not one light in this scene — the house is lit by a baked vertex attribute
   * and a shader torch — so a GLB's own MeshStandardMaterial has nothing to
   * shade against and comes out a flat silhouette with the odd specular dot on
   * it. main.js relights everything in level.props; closets, terminals and
   * relics are built here instead and used to miss that step entirely.
   *
   * Optional so this class still works standalone (tools, tests). Passing null
   * gets you the old behaviour, black models included.
   */
  constructor(scene, level, difficulty = null, propMats = null) {
    this.scene = scene;
    this.level = level;
    this.propMats = propMats;
    // Only the notice uses it, and only to leave out warnings that are not
    // true of this house.
    this.difficulty = difficulty;
    this.closets = [];
    this.terminals = [];
    this.holders = [];
    this.time = 0;

    this.closetMat = createGlowMaterial(0x6b5a44, { additive: false, depthWrite: true, gain: 0.5 });
    this.peepMat = createGlowMaterial(0xffc07a, { additive: true, depthWrite: false, pulse: 0.4, gain: 1.6 });
    this.screenOn = createGlowMaterial(0x8fd6ff, { additive: true, depthWrite: false, pulse: 0.25, gain: 1.5 });
    this.screenOff = createGlowMaterial(0x2a3038, { additive: false, depthWrite: true, gain: 0.7 });
    this.relicMat = createGlowMaterial(0xffd27f, { additive: true, depthWrite: false, pulse: 0.4, gain: 1.8 });
    this.holderEmpty = createGlowMaterial(0x4a5a52, { additive: true, depthWrite: false, gain: 0.5 });

    this.boards = [];
    this._buildClosets();
    this._buildTerminals();
    this._buildHolders();
    this._buildBoards();
    this._buildNotice();
  }

  /**
   * Relight an imported model. See relightModel in material.js for why every
   * GLB has to go through this, and why the procedural fallbacks below do not.
   */
  _relight(model, slot) {
    return relightModel(this.propMats, model, slot);
  }

  // -- blackboards and the notice ------------------------------------------

  _buildBoards() {
    const frameGeo = new THREE.BoxGeometry(2.05, 1.42, 0.08);
    const faceGeo = new THREE.PlaneGeometry(1.9, 1.28);
    const frameMat = createGlowMaterial(0x3a2e22, { additive: false, depthWrite: true, gain: 0.5 });

    for (const b of this.level.boards ?? []) {
      const group = new THREE.Group();
      group.position.set(b.x, 1.55, b.z);
      // facing points local -Z into the room, but a PlaneGeometry's normal is
      // +Z, so a plane placed here looks at the wall and is culled away. Turn
      // the whole group instead of the plane: rotating the plane itself would
      // mirror the texture, and mirrored handwriting is worse than none.
      group.rotation.y = b.facing + Math.PI;

      group.add(new THREE.Mesh(frameGeo, frameMat));

      const board = createBoard();
      const face = new THREE.Mesh(faceGeo, new THREE.MeshBasicMaterial({ map: board.texture }));
      face.position.z = 0.05;
      group.add(face);

      this.scene.add(group);
      this.boards.push({ ...b, group, face, board });
    }
  }

  _buildNotice() {
    const n = this.level.notice;
    if (!n) return;
    const group = new THREE.Group();
    // Hung so the top edge stays at a constant height whatever the board
    // grows to; a notice that got taller downwards would end up in the
    // skirting board. Set after the size is known, further down.
    group.position.set(n.x, 1.6, n.z);
    group.rotation.y = n.facing + Math.PI;   // same half-turn as the boards
    // Cut the paper to the words rather than the words to the paper. The
    // notice sizes its own canvas, hands back the aspect, and the plane is
    // built from that — so a new rule, or one dropped because this house has
    // no traps, changes the shape of the thing on the wall and nothing else.
    const notice = createNoticeTexture(noticeLines(this.difficulty, this.level));

    // A fixed number of canvas pixels per metre, NOT a fixed plane size.
    //
    // Pinning the height and deriving the width from the aspect would keep the
    // board the same size and shrink the type every time a rule was added,
    // which is the failure this was supposed to end. At a constant scale the
    // lettering is always the same height on the wall and the paper grows to
    // hold it. Capped so a long notice cannot reach the ceiling; past the cap
    // it does start shrinking, because a board through the floor is worse.
    const PX_PER_METRE = 700;
    let W = notice.width / PX_PER_METRE;
    let H = notice.height / PX_PER_METRE;
    const MAX_H = 2.0, MAX_W = 2.6;
    const squeeze = Math.min(1, MAX_H / H, MAX_W / W);
    W *= squeeze; H *= squeeze;
    const geo = new THREE.PlaneGeometry(W, H);
    const mat = new THREE.MeshBasicMaterial({ map: notice.texture });
    const face = new THREE.Mesh(geo, mat);
    face.position.z = 0.02;
    group.add(face);

    // A thin board behind it, so it reads as pinned up rather than floating.
    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.12, H + 0.12, 0.05),
      createGlowMaterial(0x2a2018, { additive: false, depthWrite: true, gain: 0.5 }),
    );
    group.add(backing);
    // Centre it on the height a person reads at, but never let the bottom
    // edge dip below the skirting.
    group.position.y = Math.max(1.5, 0.55 + H / 2);

    this.scene.add(group);
    this.notice = group;
  }

  boardById(id) { return this.boards.find((b) => b.id === id); }

  applyBoardStroke(id, stroke) {
    const b = this.boardById(id);
    if (b) applyStroke(b.board, stroke);
  }

  // -- closets -------------------------------------------------------------

  _buildClosets() {
    const geo = new THREE.BoxGeometry(1.1, 2.15, 0.8);
    geo.translate(0, 2.15 / 2, 0);
    const peepGeo = new THREE.SphereGeometry(0.055, 8, 6);

    for (const c of this.level.closets) {
      const group = new THREE.Group();
      group.position.set(c.x, 0, c.z);
      group.rotation.y = c.facing;

      const model = this._relight(modelInstance('closet'), 'closet');
      group.add(model ?? new THREE.Mesh(geo, this.closetMat));

      // The peephole. Lit from inside when somebody is in there, which is the
      // only way to know a closet is taken before you open it.
      const peep = new THREE.Mesh(peepGeo, this.peepMat);
      peep.position.set(0, 1.45, -0.42);
      peep.visible = false;
      peep.frustumCulled = false;
      group.add(peep);

      this.scene.add(group);
      this.closets.push({ ...c, group, peep, occupant: null });
    }
  }

  setClosetOccupant(id, playerId) {
    const c = this.closets.find((k) => k.id === id);
    if (!c) return;
    c.occupant = playerId;
    c.peep.visible = !!playerId;
  }

  closetById(id) { return this.closets.find((c) => c.id === id); }

  /** Where the camera sits when you are inside, and which way it looks out. */
  hideSpot(id) {
    const c = this.closetById(id);
    if (!c) return null;
    return { x: c.x, z: c.z, facing: c.facing, id };
  }

  // -- terminals -----------------------------------------------------------

  _buildTerminals() {
    const body = new THREE.BoxGeometry(0.9, 1.3, 0.55);
    body.translate(0, 1.3 / 2, 0);
    const screen = new THREE.PlaneGeometry(0.62, 0.44);
    const relicGeo = new THREE.OctahedronGeometry(0.17, 0);

    for (const r of this.level.relics) {
      const group = new THREE.Group();
      group.position.set(r.x, 0, r.z);
      group.rotation.y = r.facing;

      const model = this._relight(modelInstance('terminal'), 'terminal');
      group.add(model ?? new THREE.Mesh(body, this.screenOff));

      const face = new THREE.Mesh(screen, this.screenOff);
      face.position.set(0, 1.0, -0.29);
      face.frustumCulled = false;
      group.add(face);

      const relic = this._relight(modelInstance('relic'), 'relic')
        ?? new THREE.Mesh(relicGeo, this.relicMat);
      relic.position.set(0, 1.42, 0);
      relic.visible = false;
      group.add(relic);

      this.scene.add(group);
      this.terminals.push({ ...r, group, face, relic, solved: false, taken: false, busy: false });
    }
  }

  /** Solved: the relic surfaces on top of the terminal, free to pick up. */
  setTerminalSolved(id) {
    const t = this.terminals.find((x) => x.id === id);
    if (!t) return;
    t.solved = true;
    t.relic.visible = true;
    t.face.material = this.screenOn;
  }

  setRelicTaken(id) {
    const t = this.terminals.find((x) => x.id === id);
    if (!t) return;
    t.taken = true;
    t.relic.visible = false;
  }

  setTerminalBusy(id, busy) {
    const t = this.terminals.find((x) => x.id === id);
    if (!t) return;
    t.busy = busy;
    if (!t.solved) t.face.material = busy ? this.screenOn : this.screenOff;
  }

  // -- the door ------------------------------------------------------------

  _buildHolders() {
    const ring = new THREE.TorusGeometry(0.17, 0.03, 6, 16);
    ring.rotateX(Math.PI / 2);
    const relicGeo = new THREE.OctahedronGeometry(0.15, 0);

    for (const h of this.level.holders) {
      const group = new THREE.Group();
      group.position.set(h.x, 1.1, h.z);

      const empty = new THREE.Mesh(ring, this.holderEmpty);
      empty.frustumCulled = false;
      group.add(empty);

      const filled = new THREE.Mesh(relicGeo, this.relicMat);
      filled.visible = false;
      filled.frustumCulled = false;
      group.add(filled);

      this.scene.add(group);
      this.holders.push({ ...h, group, empty, filled, relicId: null });
    }
  }

  setHolder(index, relicId) {
    const h = this.holders[index];
    if (!h) return;
    h.relicId = relicId;
    h.filled.visible = !!relicId;
    h.empty.visible = !relicId;
  }

  get filledHolders() { return this.holders.filter((h) => h.relicId).length; }
  get doorOpen() { return this.filledHolders >= this.holders.length; }
  get firstEmptyHolder() { return this.holders.findIndex((h) => !h.relicId); }

  // -- queries -------------------------------------------------------------

  /**
   * The nearest usable thing, or null. Carrying state is passed in because
   * what counts as usable depends on it: a full holder is scenery, an empty
   * one is only interesting if you have something to put in it.
   */
  nearest(pos, { carrying, canHide }) {
    let best = null, bestD = USE_RANGE * USE_RANGE;
    const test = (x, z, make) => {
      const dx = x - pos.x, dz = z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = make(); }
    };

    if (canHide) {
      for (const c of this.closets) {
        if (c.occupant) continue;
        test(c.x, c.z, () => ({ kind: 'closet', id: c.id, label: 'Hide in the closet' }));
      }
    }
    for (const t of this.terminals) {
      if (t.taken) continue;
      if (t.solved) {
        test(t.x, t.z, () => ({ kind: 'relic', id: t.id, label: `Take the ${t.name}` }));
      } else if (!carrying) {
        test(t.x, t.z, () => ({ kind: 'terminal', id: t.id, label: 'Use the screen' }));
      }
    }
    for (const b of this.boards) {
      test(b.x, b.z, () => ({ kind: 'board', id: b.id, label: 'Write on the board' }));
    }
    if (carrying) {
      const slot = this.firstEmptyHolder;
      if (slot >= 0) {
        const h = this.holders[slot];
        test(h.x, h.z, () => ({ kind: 'holder', id: slot, label: `Set the ${carrying.name} in the door` }));
      }
    }
    return best;
  }

  colliders() {
    const out = [];
    for (const c of this.closets) {
      const along = Math.abs(Math.cos(c.facing)) > 0.5;
      const hw = along ? 0.55 : 0.4, hd = along ? 0.4 : 0.55;
      out.push({ minX: c.x - hw, maxX: c.x + hw, minZ: c.z - hd, maxZ: c.z + hd, base: 0, top: 2.15 });
    }
    for (const t of this.terminals) {
      out.push({ minX: t.x - 0.45, maxX: t.x + 0.45, minZ: t.z - 0.35, maxZ: t.z + 0.35, base: 0, top: 1.3 });
    }
    return out;
  }

  update(dt, time) {
    this.time = time;
    this.peepMat.uniforms.uTime.value = time;
    this.screenOn.uniforms.uTime.value = time;
    this.relicMat.uniforms.uTime.value = time;
    for (const t of this.terminals) {
      if (t.relic.visible) {
        t.relic.rotation.y += dt * 1.6;
        t.relic.position.y = 1.42 + Math.sin(time * 2 + t.x) * 0.05;
      }
    }
    for (const h of this.holders) {
      if (h.filled.visible) h.filled.rotation.y += dt * 0.9;
    }
  }
}

export function hasCustomModels() {
  return ['closet', 'terminal', 'relic', 'door'].some(hasModel);
}

export { CONFIG };
