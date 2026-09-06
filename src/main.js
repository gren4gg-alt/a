import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { CONFIG, RoomLookup } from './level.js';
import { DIFFICULTIES, difficultyById } from './difficulty.js';
import { generateLevel } from './generate.js';
import {
  buildWalls, buildColliders, buildOccluders,
  wallGeometry, floorGeometry, ceilingGeometry, propGeometry, propColliders,
} from './build.js';
import { createBaker } from './bake.js';
import { createHouseMaterial, createGlowMaterial, flickerSignal, PropMaterials } from './material.js';
import { Player, ColliderGrid, blocked } from './player.js';
import { Visibility } from './rooms.js';
import { Ghost } from './enemy.js';
import { loadSurfaceTextures } from './textures.js';
import { loadModels } from './models.js';
import { Interactables } from './interact.js';
import { instance as modelInstance, fitInfo, has as hasModel, isPooled, loadAnimations } from './models.js';
import { MODEL_TINT } from './assets.js';
import { startMinigame, GAME_NAMES } from './minigames.js';
import { ceilingColliders, roomVariant } from './build.js';
import { MenuScene } from './menuscene.js';
import { TouchControls, isTouchDevice, lockLandscape, unlockOrientation, isPortrait, TOUCH_LABELS } from './touch.js';
import { BoardEditor } from './boards.js';
import { showRewarded, initAds, adsEnabled, menuCooldownLeft, markMenuAdWatched,
         providerIsVerified, providerName } from './ads.js';
import { AD_CONFIG } from './adsconfig.js';
import { owns, buy, priceOf, firstOwned } from './shop.js';
import { Audio } from './audio.js';
import { Net, MSG, PROTOCOL, sessionId } from './net.js';
import { Voice } from './voice.js';
import { RemotePlayer, PLAYER_COLORS, reviveCandidate, REVIVE_SECONDS } from './remote.js';
import { settings, keyLabel } from './settings.js';
import { buildSettingsUI } from './ui.js';
import { CHARACTERS, characterById, Loadout, DEFAULT_CHARACTER, ABILITY_DURATION } from './characters.js';
import { CharacterRoom } from './charroom.js';

const $ = (id) => document.getElementById(id);

const SCREENS = ['menu', 'multiplayer', 'modes', 'select', 'shop', 'settings', 'about', 'loading', 'end', 'farewell'];
const screens = Object.fromEntries(SCREENS.map((s) => [s, $(s)]));

const el = {
  name: $('name'), joinCode: $('join-code'), menuError: $('menu-error'), bank: $('bank'),
  modeCards: $('mode-cards'), modeContinue: $('mode-continue'),
  code: $('code'), codeLine: $('code-line'), roster: $('roster'),
  selectBack: $('select-back'),
  readyBtn: $('ready-btn'), startBtn: $('start-btn'),
  charList: $('char-list'), charName: $('char-name'), charTag: $('char-tag'),
  charPassive: $('char-passive'), charAbility: $('char-ability'),
  charAbilityText: $('char-ability-text'), charKey: $('char-key'),
  selectHint: $('select-hint'), houseName: $('house-name'), changeHouse: $('change-house'),
  mic: $('mic'), micState: $('mic-state'), micHelp: $('mic-help'),
  bar: $('bar'), loadNote: $('load-note'), loadTitle: $('load-title'),
  hud: $('hud'), room: $('hud-room'), safeTag: $('safe-tag'), timer: $('hud-timer'), carry: $('hud-carry'),
  team: $('team'), stats: $('stats'), fps: $('hud-fps'), drawn: $('hud-drawn'),
  calls: $('hud-calls'), tris: $('hud-tris'), seed: $('seed'), net: $('hud-net'),
  power: $('power'), powerName: $('power-name'), powerKey: $('power-key'), powerFill: $('power-fill'),
  talk: $('talk-indicator'),
  prompt: $('prompt'), promptKeys: $('prompt-keys'), vignette: $('vignette'),
  ingameMenu: $('ingame-menu'),
  use: $('use'), useLabel: $('use-label'), useKey: $('use-key'),
  hiding: $('hiding'), hidingKey: $('hiding-key'), hidingVerb: $('hiding-verb'),
  ghostNear: $('ghost-near'), toast: $('toast'),
  door: $('door-status'), doorCount: $('door-count'),
  tv: $('tv'), tvBody: $('tv-body'),
  board: $('board'), boardBody: $('board-body'), boardRoom: $('board-room'),
  rosterHud: $('roster-hud'),
  shopList: $('shop-list'), shopBank: $('shop-bank'), shopNote: $('shop-note'),
  shopName: $('shop-name'), shopTag: $('shop-tag'),
  adEarn: $('ad-earn'), adEarnNote: $('ad-earn-note'),
  adModal: $('ad-modal'), adModalText: $('ad-modal-text'),
  adRevive: $('ad-revive'), adReviveNote: $('ad-revive-note'),
  vote: $('vote'), voteList: $('vote-list'), voteTimer: $('vote-timer'),
  giveUp: $('give-up'),
  touchEdit: $('touch-edit'), teWhich: $('te-which'), rotate: $('rotate'),
  touchFirst: $('touch-first'), teDone: $('te-done'),
  voteWatch: $('vote-watch'), voteQuit: $('vote-quit'),
  carrying: $('carrying'), carryingName: $('carrying-name'),
  downed: $('downed'), downedTimer: $('downed-timer'), downedNote: $('downed-note'),
  revive: $('revive'), reviveBar: $('revive-bar'), reviveName: $('revive-name'), reviveKey: $('revive-key'),
  endTitle: $('end-title'), endBody: $('end-body'), endRows: $('end-rows'),
  endTotal: $('end-total'), again: $('again'), menuBtn: $('menu-btn'),
  farewellBank: $('farewell-bank'),
};

let currentScreen = 'menu';
function show(name) {
  currentScreen = name;
  for (const s of SCREENS) screens[s].classList.toggle('hidden', s !== name);
  const inGame = name === null;
  el.hud.classList.toggle('hidden', !inGame);
  el.timer.classList.toggle('hidden', !inGame);
  el.power.classList.toggle('hidden', !inGame);
  el.rosterHud.classList.toggle('hidden', !inGame);
  // These three were only ever toggled by gameplay, so they sat on top of the
  // main menu: the click-to-look prompt, the door counter and the carry line.
  el.door.classList.toggle('hidden', !inGame);
  syncPrompt();
  $('touch').classList.toggle('hidden', !TOUCH || !inGame);
  if (TOUCH && !inGame) el.rotate.classList.add('hidden');
  if (!inGame) el.carrying.classList.add('hidden');
  if (!inGame) el.ghostNear.classList.add('hidden');
  $('fullscreen').classList.toggle('hidden', !inGame);
  el.ingameMenu.classList.toggle('hidden', !inGame);
  // The reticle has no JS owner of its own and used to sit in the dead centre
  // of every menu screen. One class, so the stylesheet can decide.
  document.body.classList.toggle('in-run', inGame);
}

/**
 * Whether the click-to-look prompt belongs on screen.
 *
 * It used to be toggled from two places with two different conditions, neither
 * of which knew about the other overlays. Release the mouse while you are on
 * the floor and you got the prompt drawn straight over the knocked-out panel:
 * two headings, two sets of body text and the ad button underneath both of
 * them. One function, asked at every point the answer can change.
 *
 * Nothing to capture on a touch device, so it never shows there at all.
 */
function syncPrompt() {
  const inGame = currentScreen === null;
  const locked = !!document.pointerLockElement;
  // Any overlay that owns the middle of the screen and has something to press.
  const occupied = !el.downed.classList.contains('hidden')
                || !el.vote.classList.contains('hidden')
                || !el.tv.classList.contains('hidden')
                || !el.board.classList.contains('hidden');
  el.prompt.classList.toggle('hidden', TOUCH || !inGame || locked || occupied);
}

// Screens that sit over the diorama rather than blacking it out.
const DIORAMA = new Set(['menu', 'multiplayer', 'modes', 'select', 'shop']);

let menuScene = null;
let charRoom = null;
let menuLast = 0;

// Screens that show the character room instead of the corridor diorama.
const CHAR_SCREENS = new Set(['select', 'shop']);

function menuTick(now) {
  requestAnimationFrame(menuTick);
  const dt = Math.min((now - menuLast) / 1000, 0.1);
  menuLast = now;
  if (crashed) return;

  if (CHAR_SCREENS.has(currentScreen) && charRoom) {
    // Each screen reserves its own column for the figure, so hand the room the
    // one that belongs to whichever screen is up rather than assuming a layout.
    const slotEl = currentScreen === 'shop' ? $('shop-preview-wrap') : $('preview-wrap');
    charRoom.resize(window.innerWidth, window.innerHeight, slotEl);
    charRoom.update(dt);
    renderer.render(charRoom.scene, charRoom.camera);
    return;
  }
  // touchReturnScreen means the editor has temporarily dropped us to
  // currentScreen === null purely to expose the buttons. There is no house to
  // look at from the menu, so keep the diorama up behind them.
  const editingOverMenu = touchReturnScreen !== null && !run;
  if (!menuScene || !(DIORAMA.has(currentScreen) || editingOverMenu)) return;
  menuScene.update(dt);
  menuScene.resize(window.innerWidth, window.innerHeight);
  renderer.render(menuScene.scene, menuScene.camera);
}

function ensureCharRoom() {
  if (!charRoom) {
    charRoom = new CharacterRoom();
    charRoom.bindDrag($('select'));
    charRoom.bindDrag($('shop'));
  }
  charRoom.resize(window.innerWidth, window.innerHeight);
  return charRoom;
}

async function ensureMenuScene() {
  if (menuScene) return;
  const surfaces = await ensureSurfaces();
  if (menuScene) return;
  menuScene = new MenuScene(surfaces, renderer.capabilities.getMaxAnisotropy());
  menuScene.resize(window.innerWidth, window.innerHeight);
  // Models and clips arrive with the textures. Somebody who reached the shop
  // before that finished is looking at a built-in silhouette standing still;
  // rebuild it now that there is something better to show.
  if (CHAR_SCREENS.has(currentScreen) && charRoom?.character) {
    charRoom.show(charRoom.character);
  }
}

/**
 * Run an ad behind a modal so the player knows something is happening and
 * cannot walk off mid-view. Always resolves; 'unavailable' is a normal
 * outcome (ad blockers are common) and has to be shown, not swallowed.
 */
async function playAd(name, label) {
  el.adModal.classList.remove('hidden');
  el.adModalText.textContent = label;
  const result = await showRewarded(name, (left) => {
    el.adModalText.textContent = `${label} \u2014 ${left}s`;
  });
  if (result === 'unavailable') {
    el.adModalText.textContent = providerName() === 'off'
      ? 'Ads are switched off in this build.'
      : 'No ad available. An ad blocker or no fill \u2014 nothing was charged.';
    await new Promise((r) => setTimeout(r, 1800));
  }
  el.adModal.classList.add('hidden');
  return result;
}

const Bank = {
  read() {
    try { return parseInt(localStorage.getItem('darkhouse.bank') ?? '0', 10) || 0; }
    catch { return this._mem ?? 0; }
  },
  write(v) {
    this._mem = v;
    try { localStorage.setItem('darkhouse.bank', String(v)); } catch { /* memory only */ }
  },
};

// ---------------------------------------------------------------------------
// Renderer. Antialiasing cannot be toggled on a live WebGL context, so a change
// swaps in a fresh canvas. Only ever done from a menu, never mid-run.
// ---------------------------------------------------------------------------

export const BUILD = '1.0.0';

// ---------------------------------------------------------------------------
// Failure handling.
//
// A WebGL game that throws leaves a black screen and no explanation, and the
// player has no console open. Everything below exists so that a crash, a lost
// GPU context or a backgrounded tab produces something a person can act on.
// ---------------------------------------------------------------------------

let crashed = false;

function reportCrash(what, err) {
  if (crashed) return;
  crashed = true;
  console.error(`[${what}]`, err);
  // Stop telling the room we are fine. The transport answers pings by itself,
  // so without this the host waits on a tab that will never move again. Guarded
  // because this runs above session's declaration: a crash during module
  // evaluation would otherwise die in the crash handler.
  try { if (session?.net) session.net.responsive = false; } catch { /* not up yet */ }
  try { cancelAnimationFrame(rafId); } catch { /* not running */ }
  try { document.exitPointerLock?.(); } catch { /* not locked */ }
  const box = document.getElementById('crash');
  const detail = document.getElementById('crash-detail');
  if (!box) return;
  detail.textContent = `${what}: ${err?.message ?? err ?? 'unknown'}`;
  box.classList.remove('hidden');
}

window.addEventListener('error', (e) => reportCrash('Error', e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => reportCrash('Failed', e.reason));

const TOUCH = isTouchDevice();
let touchControls = null;

let canvas = $('view');
let renderer = null;
let rendererAA = null;
const camera = new THREE.PerspectiveCamera(74, 1, 0.05, 60);
const audio = new Audio();
const voice = new Voice(audio);

function makeRenderer() {
  rendererAA = settings.quality.aa;
  const r = new THREE.WebGLRenderer({
    canvas, antialias: rendererAA, powerPreference: 'high-performance', stencil: false,
  });
  r.setClearColor(CONFIG.fogColor, 1);

  // Losing the GPU context is routine on mobile: another app takes it, or the
  // driver resets. Without preventDefault the browser never restores it, and
  // the page is dead with no error thrown anywhere.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(rafId);
    if (session?.net) session.net.responsive = false;
    document.getElementById('ctxlost')?.classList.remove('hidden');
  }, false);
  canvas.addEventListener('webglcontextrestored', () => {
    if (session?.net) session.net.responsive = true;
    document.getElementById('ctxlost')?.classList.add('hidden');
    // Every GPU-side object died with the context, so the house has to be
    // rebuilt. Returning to the lobby is honest; silently continuing is not.
    disposeRun();
    menuScene?.dispose();
    menuScene = null;
    ensureMenuScene();
    isNet() ? renderSelect() : buildMenu();
  }, false);

  return r;
}

function applyGraphics() {
  settings.applyToConfig();
  if (renderer && rendererAA !== settings.quality.aa && !run) {
    const next = canvas.cloneNode(false);
    canvas.parentNode.replaceChild(next, canvas);
    canvas = next;
    renderer.dispose();
    renderer = makeRenderer();
  }
  if (!renderer) renderer = makeRenderer();
  // Phones report devicePixelRatio 3 or 4. Honouring that renders nine to
  // sixteen times the pixels of the CSS size for no visible gain and a lot of
  // heat, so the ceiling is tighter on touch regardless of the preset.
  const cap = TOUCH ? Math.min(settings.quality.pixelRatio, 1.0) : settings.quality.pixelRatio;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.fov = settings.data.graphics.fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.far = CONFIG.drawDistance + 14;
  camera.updateProjectionMatrix();
}

function applyAudio() {
  audio.setVolumes(settings.data.volume);
  voice.setPushToTalk(settings.data.voice.pushToTalk);
  voice.setInputGain(settings.data.voice.inputGain ?? 1);
}

window.addEventListener('resize', () => {
  renderer?.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  charRoom?.resize(window.innerWidth, window.innerHeight);
  menuScene?.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

const session = {
  mode: 'solo',
  net: null,
  localId: 'solo',
  name: 'Someone',
  roster: [],
  difficultyId: DIFFICULTIES[0].id,
  character: DEFAULT_CHARACTER,
  ready: false,
};

/** Set the moment the host commits to a house. No joins after that. */
let roomLocked = false;

const isNet = () => session.mode !== 'solo';
const isHost = () => session.mode !== 'client';
const rosterIndex = (id) => session.roster.findIndex((p) => p.id === id);
const meInRoster = () => session.roster.find((p) => p.id === session.localId);

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

let run = null;
let rafId = 0;

function disposeRun() {
  if (!run) return;
  // Leaving mid-edit — from the menu button, a disconnect, a crash — would
  // otherwise strand the editor panel on top of the main menu.
  if (!el.touchEdit.classList.contains('hidden')) closeTouchEditor();
  touchControls?.detach();
  if (TOUCH) { unlockOrientation(); el.rotate.classList.add('hidden'); }
  closeBoard();
  cancelAnimationFrame(rafId);
  run.player.releaseInput();
  for (const r of run.remotes.values()) r.dispose(run.scene);
  run.scene.traverse((o) => {
    if (!o.isMesh && !o.isLineSegments) return;
    // Clones of a cached model share their geometry with the cache. Disposing
    // it here freed the parsed GLB for every future run, so the second house
    // came up with the furniture missing or garbled. The materials on those
    // clones are ours and go with run.propMats below.
    if (isPooled(o)) return;
    o.geometry?.dispose();
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
    else o.material?.dispose();
  });
  run.propMats?.dispose();
  run = null;
}

let surfacesPromise = null;
function ensureSurfaces() {
  if (!surfacesPromise) {
    surfacesPromise = Promise.all([
      loadSurfaceTextures(renderer.capabilities.getMaxAnisotropy()),
      // Models are optional; every slot falls back to a primitive, so a
      // failure here is not worth blocking the house on.
      loadModels().catch(() => ({ loaded: [], missing: [] })),
      // Same again for the clips: nothing here is required, and a character
      // with no animation stands still exactly as it did before.
      loadAnimations().catch(() => ({ loaded: [], missing: [] })),
    ]).then(([surfaces]) => surfaces);
  }
  return surfacesPromise;
}

async function startRun(difficulty, seed) {
  disposeRun();
  audio.resume();
  applyAudio();
  applyGraphics();

  el.loadTitle.textContent = difficulty.label;
  el.loadNote.textContent = 'Finding the walls';
  el.bar.style.width = '0%';
  show('loading');

  // Supplied images if assets/textures holds any, generated tiles otherwise.
  // Resolved once and cached, so only the first house ever waits.
  const surfaces = await ensureSurfaces();

  el.loadNote.textContent = 'Laying out the rooms';
  const level = generateLevel(difficulty, seed);
  const scene = new THREE.Scene();
  const material = createHouseMaterial(surfaces, renderer.capabilities.getMaxAnisotropy());
  renderer.setClearColor(CONFIG.fogColor, 1);
  camera.far = CONFIG.drawDistance + 14;
  camera.updateProjectionMatrix();

  const wallBoxes = buildWalls(level);
  const occluders = buildOccluders(wallBoxes);

  const chunkMap = new Map();
  const CS = CONFIG.wallChunkSize;
  const wallItems = [];
  for (const b of wallBoxes) {
    const owner = nearestRoom(level, b.cx, b.cz);
    const geo = wallGeometry(b, roomVariant(owner.id));
    wallItems.push({ geometry: geo, albedo: owner.wall });
    const key = `${Math.floor(b.cx / CS)},${Math.floor(b.cz / CS)}`;
    if (!chunkMap.has(key)) chunkMap.set(key, []);
    chunkMap.get(key).push(geo);
  }

  const roomItems = new Map();
  for (const r of level.rooms) {
    roomItems.set(r.id, [
      { geometry: floorGeometry(r), albedo: r.floor },
      { geometry: ceilingGeometry(r), albedo: r.ceil },
    ]);
  }
  // A prop with a supplied model cannot take the vertex bake — its mesh is not
  // tessellated for it — so only the box fallbacks are merged into the room's
  // baked geometry. Modelled pieces are added separately after the bake.
  for (const p of level.props) {
    if (hasModel(p.kind)) continue;
    roomItems.get(p.room)?.push({ geometry: propGeometry(p), albedo: p.color });
  }

  el.loadNote.textContent = 'Lighting the rooms';
  const baker = createBaker([...wallItems, ...[...roomItems.values()].flat()], level.lights, occluders);
  const t0 = performance.now();

  (function bakeStep() {
    if (baker.step(14)) {
      el.bar.style.width = '100%';
      finishBuild(difficulty, level, scene, material, wallBoxes, chunkMap, roomItems,
                  performance.now() - t0, baker.total);
      return;
    }
    el.bar.style.width = `${(baker.progress * 100).toFixed(1)}%`;
    requestAnimationFrame(bakeStep);
  })();
}

/**
 * Where player `index` of `count` starts.
 *
 * The old version added a flat 3.2 m to the room centre with no bounds check
 * and no collision pass. The entrance can be small, so that pushed people
 * straight through a wall and into whatever was on the other side — which is
 * exactly what "the client joined but I was somewhere outside" looked like.
 *
 * Now the ring is sized from the room itself, the result is collision-tested,
 * and it walks inward before it ever gives up. Everyone lands in the entrance.
 */
function spawnSlot(level, index, count, grid) {
  const cx = level.spawn.x, cz = level.spawn.z;
  const maxR = Math.max(0, Math.min(level.spawn.radius ?? 2.0, 2.6));
  if (count <= 1 || maxR < 0.5) return { x: cx, z: cz };

  const angle = (index / count) * Math.PI * 2;
  // Try the ring, then progressively closer in, then dead centre.
  for (const r of [maxR, maxR * 0.7, maxR * 0.45, 0]) {
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    if (!blocked(x, z, CONFIG.playerRadius, CONFIG.standClearance, grid)) return { x, z };
  }
  return { x: cx, z: cz };
}

function nearestRoom(level, x, z) {
  let best = level.rooms[0], bestD = Infinity;
  for (const r of level.rooms) {
    const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < bestD) { bestD = d; best = r; }
  }
  return best;
}

function finishBuild(difficulty, level, scene, material, wallBoxes, chunkMap, roomItems, bakeMs, verts) {
  const wallChunks = [];
  for (const [key, geos] of chunkMap) {
    const [i, j] = key.split(',').map(Number);
    const mesh = new THREE.Mesh(mergeGeometries(geos), material);
    scene.add(mesh);
    wallChunks.push({ mesh, cx: (i + 0.5) * CONFIG.wallChunkSize, cz: (j + 0.5) * CONFIG.wallChunkSize });
  }

  // A Group per room rather than a Mesh, so modelled furniture rides the same
  // portal culling as the baked geometry. Visibility only ever touches the
  // top-level object, so nothing else needed changing.
  const roomMeshes = new Map();
  for (const [roomId, items] of roomItems) {
    const group = new THREE.Group();
    if (items.length) {
      group.add(new THREE.Mesh(mergeGeometries(items.map((i) => i.geometry)), material));
    }
    scene.add(group);
    roomMeshes.set(roomId, group);
  }

  // Match every prop's footprint to the model that will actually stand there.
  //
  // THIS HAS TO HAPPEN FIRST. It used to run after the loop below, which read
  // p.fitScale to size the mesh — and p.fitScale did not exist yet. Every
  // model was therefore drawn at its default height from MODEL_ASSETS while
  // the collider was rebuilt from the fitted size, so nothing agreed with its
  // own hitbox: crates in a stack intersected each other, and a chair the
  // generator had reserved a wide footprint for was drawn small inside it.
  //
  // Supplied models come at all sorts of proportions, so the fit is per axis
  // (see fitInfo) and the collider below is rebuilt from what it returns. The
  // box you walk into is the box you can see.
  for (const pr of level.props) {
    if (!hasModel(pr.kind)) continue;
    const f = fitInfo(pr.kind, pr.w, pr.h, pr.d);
    if (!f) continue;
    pr.w = f.w; pr.h = f.h; pr.d = f.d; pr.fitScale = f.scale;
  }

  // Everything imported gets relit. A GLB brings a MeshStandardMaterial with
  // it, and there is not one light in this scene — the house is lit by a baked
  // vertex attribute and a shader torch — so an untouched import renders as a
  // black silhouette. See PropMaterials in material.js.
  const propMats = new PropMaterials(material);

  let modelled = 0;
  for (const p of level.props) {
    if (!hasModel(p.kind)) continue;
    const obj = modelInstance(p.kind);
    if (!obj) continue;
    if (p.fitScale) obj.scale.set(p.fitScale.x, p.fitScale.y, p.fitScale.z);
    // p.y is the BASE of the prop, and fit() already sat the model's feet on
    // its own origin, so these two agree without an offset.
    obj.position.set(p.x, p.y ?? 0, p.z);
    obj.rotation.y = p.facing;
    propMats.apply(obj, { tint: MODEL_TINT[p.kind] ?? null, slot: p.kind });
    roomMeshes.get(p.room)?.add(obj);
    modelled++;
  }

  // propMats, not just scene/level: closets, terminals and relics are imported
  // models too, and they need the same relighting the loop above does. Without
  // it they keep their GLB's MeshStandardMaterial and render black.
  const interact = new Interactables(scene, level, difficulty, propMats);
  const grid = new ColliderGrid([
    ...buildColliders(wallBoxes),
    ...propColliders(level.props),
    // Low ceilings need colliders or you can crouch into a tunnel and stand up
    // inside it — the mesh alone stops nothing.
    ...ceilingColliders(level.rooms),
    ...interact.colliders(),
  ]);
  const lookup = new RoomLookup(level);

  const lootMat = createGlowMaterial(0xffd27f, { additive: true, depthWrite: false, pulse: 0.35, gain: 1.4 });
  const beadMat = createGlowMaterial(0xffd27f, { additive: true, depthWrite: false, pulse: 0.5, gain: 1.7 });
  const lootGeo = new THREE.OctahedronGeometry(0.22, 0);
  const beadGeo = new THREE.SphereGeometry(0.08, 8, 6);
  const lootItems = level.loot.map((l) => {
    const mesh = new THREE.Mesh(lootGeo, lootMat);
    mesh.position.set(l.x, 0.85, l.z);
    scene.add(mesh);
    const bead = new THREE.Mesh(beadGeo, beadMat);
    bead.position.set(l.x, 1.7, l.z);
    bead.renderOrder = 3;
    bead.frustumCulled = false;
    bead.visible = false;
    scene.add(bead);
    return { ...l, mesh, bead, taken: false, owner: null };
  });

  const exitRoom = level.rooms.find((r) => r.id === level.exitId);
  const exitMat = createGlowMaterial(0x9fffc8, { additive: true, depthWrite: false, pulse: 0.5, gain: 1.2 });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 2.9, 12, 1, true), exitMat);
  pillar.position.set((exitRoom.x0 + exitRoom.x1) / 2, 1.45, (exitRoom.z0 + exitRoom.z1) / 2);
  scene.add(pillar);

  const exitBead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
    createGlowMaterial(0x9fffc8, { additive: true, depthWrite: false, gain: 2.0 }));
  exitBead.position.set(pillar.position.x, 3.4, pillar.position.z);
  exitBead.frustumCulled = false;
  exitBead.renderOrder = 3;
  exitBead.visible = false;
  scene.add(exitBead);

  // Snares the ghost leaves behind on the harder houses. Faint on purpose:
  // visible if you are watching the floor, invisible if you are running.
  const trapMat = createGlowMaterial(0xc4321f, { additive: true, depthWrite: false, pulse: 0.7, gain: 0.55 });
  const trapGeo = new THREE.TorusGeometry(0.5, 0.045, 6, 18);
  trapGeo.rotateX(Math.PI / 2);
  const trapGroup = new THREE.Group();
  scene.add(trapGroup);

  const flare = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 0),
    createGlowMaterial(0xff8a30, { additive: true, depthWrite: false, pulse: 0.6, gain: 2.2 }));
  flare.frustumCulled = false;
  flare.visible = false;
  scene.add(flare);

  // The Lookout's mark. One marker per run, moved onto whichever ghost is
  // currently pinned — there is only ever one mark at a time, and building it
  // up front means the ability costs nothing to fire.
  //
  // depthTest off, so it is genuinely visible through walls. That is the whole
  // ability: not "you can see it", but "everyone can see where it is going
  // even though it is two rooms away".
  const markMat = createGlowMaterial(0x8fd6ff, {
    additive: true, depthTest: false, depthWrite: false, pulse: 0.55, gain: 2.0,
  });
  const mark = new THREE.Mesh(new THREE.OctahedronGeometry(0.20, 0), markMat);
  mark.frustumCulled = false;
  mark.renderOrder = 4;
  mark.visible = false;
  scene.add(mark);

  // -- local player and loadout -------------------------------------------

  const myIndex = Math.max(0, rosterIndex(session.localId));
  const loadout = new Loadout(characterById(session.character));

  const player = new Player(camera, level.spawn);
  player.id = session.localId;
  player.isLocal = true;
  player.dead = false;
  player.name = session.name;
  player.speedScale = loadout.stats.sprintScale;
  player.loudness = loadout.stats.loudnessScale;
  player.knifeDodge = loadout.stats.knifeDodge;
  player.bindInput(canvas);
  player.onFlashToggle = () => {
    material.uniforms.uFlashOn.value = material.uniforms.uFlashOn.value > 0.5 ? 0 : 1;
  };
  player.onDebugToggle = () => el.stats.classList.toggle('on');
  player.onPower = () => firePower();
  player.onInteract = () => useNearest();
  if (TOUCH) {
    touchControls = touchControls ?? new TouchControls($('touch'));
    touchControls.applyLayout();
    touchControls.attach(player);
    // Landscape needs fullscreen first on every browser that supports it at
    // all, and iOS supports neither. checkRotate() covers the failure.
    lockLandscape().finally(checkRotate);
  }
  player.onLockChange = () => syncPrompt();

  material.uniforms.uFlashRange.value *= loadout.stats.flashlightRange;

  if (isNet()) {
    const spot = spawnSlot(level, myIndex, session.roster.length, grid);
    player.pos.x = spot.x;
    player.pos.z = spot.z;
  }

  const remotes = new Map();
  const loadouts = new Map([[session.localId, loadout]]);
  for (const p of session.roster) {
    if (p.id === session.localId) continue;
    const r = new RemotePlayer(scene, p.id, p.name, rosterIndex(p.id), !isHost(), p.char);
    // Same reason as the furniture: a teammate wearing a supplied model was a
    // person-shaped hole in the dark. The capsule fallback is already self-lit,
    // so only the modelled ones need this.
    if (r.usesModel) propMats.apply(r.mesh, { slot: `player_${p.char ?? DEFAULT_CHARACTER}` });
    const lo = new Loadout(characterById(p.char ?? DEFAULT_CHARACTER));
    r.loudness = lo.stats.loudnessScale;
    r.knifeDodge = lo.stats.knifeDodge;
    remotes.set(p.id, r);
    loadouts.set(p.id, lo);
  }

  // Three of them. Spawned far apart and biased to stay that way, so the maze
  // has no safe quarter rather than one busy corridor.
  const spawns = level.ghostSpawns?.length ? level.ghostSpawns : [level.ghostSpawn];
  const count = level.ghostCount ?? spawns.length;
  const ghosts = spawns.slice(0, count).map((spawn, index) => {
    const g = new Ghost(scene, level, difficulty.ghost, lookup, {
      index, spawn, count, tint: GHOST_TINTS[index % GHOST_TINTS.length],
      // Without this a supplied ghost.glb or knife.glb renders black, exactly
      // as the closets did before they were given the same thing.
      propMats,
    });
    g.onThrow = (d, knife) => {
      audio.knifeThrow(d);
      if (isHost() && isNet()) {
        session.net.broadcast(MSG.KNIFE, {
          gi: index, x: r2(knife.x), z: r2(knife.z), dx: r3(knife.dx), dz: r3(knife.dz),
        }, true);
      }
    };
    g.onHit = (playerId) => hostKnockDown(playerId);
    g.onDodge = (playerId) => { if (playerId === session.localId) audio.knifeThrow(2); };
    g.onTrap = (x, z) => {
      addTrap(x, z);
      if (isHost() && isNet()) session.net.broadcast(MSG.TRAP, { n: 'add', x: r2(x), z: r2(z) }, true);
    };
    return g;
  });

  const vis = new Visibility(level, roomMeshes, wallChunks);
  vis.update(player.pos.x, player.pos.z);

  run = {
    difficulty, level, scene, material, propMats, player, remotes, ghosts, vis, grid,
    loadout, loadouts, interact, lootItems, lootMat, beadMat, exitMat, exitRoom, pillar,
    carrying: null, minigame: null, busyTerminals: new Map(), useTarget: null,
    sheltered: null,
    boardOpen: null, boardEditor: null, adRevives: 0, vote: null,
    stateSeq: 0, snapSeq: 0, lastSnapSeq: -1,
    exitBead, flare, flareUntil: 0, senseUntil: 0,
    // The Lookout's mark: which ghost, and until when. Shared by everyone.
    mark, markMat, markIndex: -1, markUntil: 0,
    trapMat, trapGeo, trapGroup, traps: [],
    carried: [], elapsed: 0, over: false, begun: !isNet(),
    downTimers: new Map(), reviveProgress: 0, reviveTarget: null,
    time: 0, sendAcc: 0, snapAcc: 0,
    stats: { bakeMs, verts },
  };

  el.loadNote.textContent =
    `${verts.toLocaleString()} vertices lit in ${bakeMs.toFixed(0)} ms · ` +
    `${level.stats.plots} rooms, ${level.stats.corridors} passages` +
    (modelled ? ` · ${modelled} pieces of furniture` : '');
  el.room.textContent = 'Entrance';
  el.carry.textContent = 'nothing';
  el.seed.textContent = `seed ${level.seed}`;
  el.powerName.textContent = loadout.char.ability;
  el.powerKey.textContent = actionLabel('power');
  el.reviveKey.textContent = actionLabel('interact');
  el.useKey.textContent = actionLabel('interact');
  el.hidingKey.textContent = actionLabel('interact');
  // A key is pressed and a button is tapped, and the sentence has to read
  // right either way.
  el.hidingVerb.textContent = TOUCH ? 'Tap ' : '';
  el.doorCount.textContent = `0/${level.holders.length}`;
  el.promptKeys.innerHTML = promptText();

  if (isNet() && !isHost()) {
    session.net.toHost(MSG.LOADED, {}, true);
    el.loadNote.textContent += ' · waiting for the others';
  }
  if (isNet() && isHost()) hostMarkLoaded(session.localId);

  setTimeout(() => {
    show(null);
    lastFrame = performance.now();
    rafId = requestAnimationFrame(frame);
    // After show(null), so the touch buttons are already on screen to drag.
    maybeFirstRunLayout();
  }, isNet() ? 200 : 450);
}

/**
 * What to call an action in the HUD, for the device actually in their hands.
 *
 * On a keyboard this is the bind, which is what it always was. On a phone it
 * is the caption printed on the on-screen button, because "E to pick someone
 * up" on a device with no E is worse than no prompt at all — it reads like the
 * game has not noticed what it is running on.
 */
function actionLabel(id) {
  if (TOUCH) return TOUCH_LABELS[id] ?? '';
  return keyLabel(settings.data.binds[id]);
}

function promptText() {
  const b = settings.data.binds;
  const k = (id) => `<b>${keyLabel(b[id])}</b>`;
  return `${k('forward')}${k('left')}${k('back')}${k('right')} move · ${k('sprint')} run · ${k('crouch')} crouch<br>` +
    `${k('flashlight')} torch · ${k('power')} ability · ${k('interact')} pick someone up<br>` +
    `${k('talk')} talk · ${k('cursor')} free the mouse · ${k('fullscreen')} fullscreen<br>` +
    `${k('stats')} stats · <b>Esc</b> also releases the mouse<br>` +
    `<span style="opacity:0.7">Crawl holes are too low for it to follow you through.</span>`;
}

// Enough hues that adjacent ghosts rarely match; with one per ten rooms there
// can be nearly twenty of them.
const GHOST_TINTS = [
  0x7fd6ff, 0xffa46b, 0xbf9dff, 0x86e0b4, 0xff9db8,
  0xffe08a, 0x9db8ff, 0xd9a0ff, 0x8ad8d0, 0xffb0a0,
];

function addTrap(x, z) {
  if (!run) return;
  const mesh = new THREE.Mesh(run.trapGeo, run.trapMat);
  mesh.position.set(x, 0.05, z);
  mesh.frustumCulled = false;
  run.trapGroup.add(mesh);
  run.traps.push({ x, z, armed: true, mesh });
  // Old snares decay so a long run does not end up wall-to-wall with them.
  if (run.traps.length > 30) {
    const dead = run.traps.shift();
    run.trapGroup.remove(dead.mesh);
  }
}

/** Nearest ghost, for the torch stutter and the tension bed. */
/**
 * Floorboards, from whatever is nearest.
 *
 * Only the three closest are audible: with up to twenty-eight of them a
 * distance check alone would produce a constant wall of creaking. Each keeps
 * its own step timer driven by how fast it is actually moving, so a hunting
 * ghost audibly speeds up.
 */
// Ghost footsteps used to live here: a creak per step for the three nearest,
// scaled by distance. Removed. The proximity drone already tells you something
// is close and does it continuously, so the creaks were a second cue saying
// the same thing louder — and because they fired per step they turned every
// patrol walking past a wall into a burst of noise you learned to tune out.
// One cue that always means the same thing beats two that overlap.
//
// GHOST_EARSHOT went with them; the drone has always used its own 22 m range.

function nearestGhostDistance() {
  let best = Infinity;
  for (const g of run.ghosts) best = Math.min(best, g.distanceToPlayer);
  return best;
}
const anyHunting = () => run.ghosts.some((g) => g.state === 'hunt');

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

const allPlayers = () => [run.player, ...run.remotes.values()];
const livePlayers = () => allPlayers().filter((p) => !p.dead);

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

function firePower() {
  if (!run || run.over || !run.begun) return;
  const lo = run.loadout;
  const id = lo.char.id;
  if (run.player.dead) return;
  // The Nurse's ability only exists while you are on the floor; everyone
  // else's only exists while you are not.
  if (id === 'nurse' ? !run.player.downed : run.player.downed) return;

  // The Lookout has to have something to point at, and finding out costs a
  // five minute cooldown — so it is checked BEFORE lo.fire() spends it. An
  // ability that can be wasted on empty air by a mistimed button is not a
  // five minute ability, it is a five minute punishment.
  let extra = null;
  if (id === 'lookout') {
    const target = ghostInSight();
    if (target < 0) {
      el.powerName.textContent = 'Nothing in sight';
      setTimeout(() => { if (run && !run.over) el.powerName.textContent = lo.char.ability; }, 1200);
      return;
    }
    extra = { g: target };
  }

  if (!lo.fire()) return;

  applyPower(id, run.player.pos.x, run.player.pos.z, session.localId, extra);
  if (isNet()) {
    const payload = {
      c: id, x: r2(run.player.pos.x), z: r2(run.player.pos.z),
      i: rosterIndex(session.localId), ...(extra ?? {}),
    };
    if (isHost()) session.net.broadcast(MSG.POWER, payload, true);
    else session.net.toHost(MSG.POWER, payload, true);
  }
}

/**
 * Which ghost the Lookout is looking at, or -1.
 *
 * "The nearest one you can see" is taken literally: in front of the camera,
 * inside marking range, and not around a corner. The room-visibility set the
 * renderer already maintains answers the last part for free — if the room it
 * is standing in is not being drawn, you are not looking at it, whatever the
 * angle says.
 */
function ghostInSight() {
  const p = run.player.pos;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  let best = -1, bestD = MARK_RANGE;
  run.ghosts.forEach((g, i) => {
    const dx = g.pos.x - p.x, dz = g.pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > bestD || d < 1e-3) return;
    // Roughly within the front half of the view. Generous on purpose: you are
    // being chased, and pixel-accurate aim is not the skill being tested.
    if ((dx / d) * dir.x + (dz / d) * dir.z < 0.55) return;
    if (!g.mesh.visible) return;
    best = i; bestD = d;
  });
  return best;
}

/** How far the Lookout can reach to pin something. */
const MARK_RANGE = 30;

/** Runs on every machine for anything visible; host-only bits are guarded. */
function applyPower(charId, x, z, ownerId, extra = null) {
  const mine = ownerId === session.localId;

  switch (charId) {
    case 'lookout': {
      // Everyone runs this, not just the owner — the point of the mark is that
      // the rest of the house can see it too.
      const gi = extra?.g ?? -1;
      if (gi < 0 || gi >= run.ghosts.length) break;
      run.markIndex = gi;
      run.markUntil = run.time + ABILITY_DURATION.lookout;
      audio.pickup(80);
      break;
    }
    case 'lamplighter': {
      run.flare.position.set(x, 1.1, z);
      run.flare.visible = true;
      run.flareUntil = run.time + ABILITY_DURATION.lamplighter;
      run.material.uniforms.uFlarePos.value.set(x, 1.1, z);
      run.material.uniforms.uFlareOn.value = 1;
      // A flare pulls every one of them. Bright, loud, and a genuine gamble.
      if (isHost()) for (const g of run.ghosts) g.lure(x, z);
      audio.pickup(40);
      break;
    }
    case 'runner':
      if (mine) run.player.speedScale = run.loadout.stats.sprintScale * 1.42;
      break;
    case 'quiet': {
      const target = allPlayers().find((p) => p.id === ownerId);
      if (target) target.undetectableUntil = run.time + ABILITY_DURATION.quiet;
      break;
    }
    case 'scavenger':
      if (mine) run.senseUntil = run.time + ABILITY_DURATION.scavenger;
      break;
    case 'terminator': {
      // Everything nearby, not just whatever was chasing the owner: the point
      // is to break a room open for the whole group.
      if (isHost()) {
        for (const g of run.ghosts) {
          if (Math.hypot(g.pos.x - x, g.pos.z - z) < 12.0) {
            g.shove(ABILITY_DURATION.terminator, x, z);
          }
        }
      }
      audio.hit();
      break;
    }
    case 'warden': {
      if (isHost()) {
        // Shoves whichever is within reach, not all of them.
        for (const g of run.ghosts) {
          if (Math.hypot(g.pos.x - x, g.pos.z - z) < 4.0) {
            g.shove(ABILITY_DURATION.warden, x, z);
          }
        }
      }
      audio.hit();
      break;
    }
    case 'nurse':
      if (isHost()) hostRevive(ownerId);
      break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Using things
// ---------------------------------------------------------------------------

function useNearest() {
  if (!run || run.over || !run.begun || run.minigame) return;
  const p = run.player;
  if (p.dead) return;

  // Already inside a closet: the same key gets you back out.
  if (p.hiding) { requestHide(p.hiding.id, false); return; }
  if (p.downed) return;

  // Reviving owns the key whenever a body is in reach; it is the more urgent
  // of the two and holding for it must not be interrupted by a closet behind.
  if (reviveCandidate(p.pos, [...run.remotes.values()])) return;

  const target = run.useTarget;
  if (!target) return;

  switch (target.kind) {
    case 'closet': requestHide(target.id, true); break;
    case 'terminal': openTerminal(target.id); break;
    case 'relic': requestRelic('taken', target.id); break;
    case 'holder': requestRelic('placed', run.carrying.id); break;
    case 'board': openBoard(target.id); break;
    default: break;
  }
}

// -- closets ---------------------------------------------------------------

function requestHide(closetId, entering) {
  if (isHost()) { hostSetHide(closetId, entering ? session.localId : null); return; }
  session.net.toHost(MSG.HIDE, { c: closetId, on: entering }, true);
}

function hostSetHide(closetId, playerId) {
  const c = run.interact.closetById(closetId);
  if (!c) return;
  if (playerId) {
    if (c.occupant) return;                       // one at a time, first come
    // Leave whatever else they were in.
    for (const other of run.interact.closets) {
      if (other.occupant === playerId) applyHide(other.id, null);
    }
  } else if (c.occupant !== playerId && c.occupant !== null) {
    // only the occupant may leave
  }
  applyHide(closetId, playerId);
  // Shutting a door in its face works. It gives up and goes elsewhere, rather
  // than waiting outside for the one exit you have.
  if (playerId) {
    const c = run.interact.closetById(closetId);
    if (c) scatterGhosts(c.x, c.z, 9);
  }
  if (isNet()) {
    session.net.broadcast(MSG.HIDE, {
      c: closetId, i: playerId ? rosterIndex(playerId) : null,
    }, true);
  }
}

/**
 * Somewhere clear to stand when you come out.
 *
 * Stepping out used to leave you on the closet's own position, which is inside
 * its collider and usually a hand's width from a wall. The push-out then had to
 * resolve a deep overlap against two surfaces at once and could eject you
 * through the wall or wedge you. Pick a spot that is actually free instead.
 */
function closetExitSpot(closetId) {
  const c = run.interact.closetById(closetId);
  if (!c) return null;
  const fx = -Math.sin(c.facing), fz = -Math.cos(c.facing);
  const sx = -fz, sz = fx;                     // sideways, if straight out is blocked
  const tries = [
    [1.30, 0], [1.70, 0], [1.30, 0.7], [1.30, -0.7],
    [2.10, 0], [1.70, 1.0], [1.70, -1.0],
  ];
  for (const [ahead, side] of tries) {
    const x = c.x + fx * ahead + sx * side;
    const z = c.z + fz * ahead + sz * side;
    if (!blocked(x, z, CONFIG.playerRadius, CONFIG.standClearance, run.grid)) return { x, z };
  }
  // Nothing clear: still better to be in front of it than inside it.
  return { x: c.x + fx * 1.3, z: c.z + fz * 1.3 };
}

function applyHide(closetId, playerId) {
  const wasMine = run.player.hiding?.id === closetId;
  run.interact.setClosetOccupant(closetId, playerId);
  const target = playerId ? allPlayers().find((pl) => pl.id === playerId) : null;
  for (const pl of allPlayers()) {
    if (pl.hidingClosetId === closetId && pl !== target) pl.hidingClosetId = null;
  }
  if (target) target.hidingClosetId = closetId;

  if (!playerId || playerId === session.localId) {
    const mine = run.interact.closets.find((c) => c.occupant === session.localId);
    const nowHiding = mine ? run.interact.hideSpot(mine.id) : null;
    if (!nowHiding && wasMine) {
      const spot = closetExitSpot(closetId);
      if (spot) { run.player.pos.x = spot.x; run.player.pos.z = spot.z; }
      run.player.crouching = false;
      run.player.vel.set(0, 0, 0);
    }
    run.player.hiding = nowHiding;
    el.hiding.classList.toggle('hidden', !run.player.hiding);
  }
}

// -- blackboards -----------------------------------------------------------

function openBoard(id) {
  const b = run.interact.boardById(id);
  if (!b) return;
  document.exitPointerLock?.();
  el.board.classList.remove('hidden');
  el.boardRoom.textContent = run.vis.roomName;
  run.boardOpen = id;
  run.boardEditor = new BoardEditor(el.boardBody, b.board, (stroke) => {
    if (!isNet()) return;
    const msg = { b: id, s: stroke };
    isHost() ? session.net.broadcast(MSG.BOARD, msg, true)
             : session.net.toHost(MSG.BOARD, msg, true);
  });
}

function closeBoard() {
  if (!run?.boardOpen) return;
  run.boardOpen = null;
  run.boardEditor = null;
  el.boardBody.innerHTML = '';
  el.board.classList.add('hidden');
  relockPointer();   // same reason as the terminal
}

// -- terminals -------------------------------------------------------------

function openTerminal(id) {
  const t = run.interact.terminals.find((x) => x.id === id);
  if (!t || t.solved || t.busy) return;

  document.exitPointerLock?.();
  el.tv.classList.remove('hidden');
  run.minigame = {
    id,
    controller: startMinigame(t.game, el.tvBody, {
      title: t.name,
      onWin: () => { requestRelic('solved', id); closeTerminal(); },
      onQuit: () => closeTerminal(),
    }),
  };
  setTerminalBusy(id, true);
}

function closeTerminal() {
  if (!run?.minigame) return;
  const { id, controller } = run.minigame;
  controller.destroy();
  run.minigame = null;
  el.tv.classList.add('hidden');
  setTerminalBusy(id, false);
  // Opening the terminal let the mouse go so it could click the puzzle.
  // Closing it has to take the mouse back, or you finish a screen and land in
  // the room looking at the click-to-look overlay as though you had paused.
  relockPointer();
}

/**
 * Ask for the pointer back, if there is anything to point at.
 *
 * Browsers only grant this inside a user gesture, which is why every caller is
 * on the tail of a click. A refusal is fine and expected — the click-anywhere
 * handler further down is the fallback — so the rejection is swallowed rather
 * than reported.
 */
function relockPointer() {
  if (TOUCH || !run || run.over) return;
  if (currentScreen !== null || document.pointerLockElement) return;
  if (run.minigame || run.boardOpen || run.player.downed) return;
  const r = canvas.requestPointerLock();
  if (r && typeof r.catch === 'function') r.catch(() => {});
}

function setTerminalBusy(id, on) {
  run.interact.setTerminalBusy(id, on);
  const t = run.interact.terminals.find((x) => x.id === id);
  if (on && t) run.busyTerminals.set(id, { x: t.x, z: t.z, next: 0 });
  else run.busyTerminals.delete(id);
  if (isNet()) {
    const payload = { n: 'busy', id, on };
    isHost() ? session.net.broadcast(MSG.RELIC, payload, true)
             : session.net.toHost(MSG.RELIC, payload, true);
  }
}

function requestRelic(kind, id) {
  if (isHost()) { hostRelic(kind, id, session.localId); return; }
  session.net.toHost(MSG.RELIC, { n: kind, id }, true);
}

function hostRelic(kind, id, playerId) {
  const t = run.interact.terminals.find((x) => x.id === id);
  const send = (payload) => { if (isNet()) session.net.broadcast(MSG.RELIC, payload, true); };

  if (kind === 'solved') {
    if (!t || t.solved) return;
    applyRelic('solved', id);
    send({ n: 'solved', id });
  } else if (kind === 'taken') {
    if (!t || !t.solved || t.taken) return;
    applyRelic('taken', id, playerId);
    send({ n: 'taken', id, i: rosterIndex(playerId) });
  } else if (kind === 'placed') {
    const slot = run.interact.firstEmptyHolder;
    if (slot < 0) return;
    applyRelic('placed', id, playerId, slot);
    send({ n: 'placed', id, i: rosterIndex(playerId), slot });
  }
}

function applyRelic(kind, id, playerId, slot) {
  const t = run.interact.terminals.find((x) => x.id === id);
  if (kind === 'solved') {
    run.interact.setTerminalSolved(id);
    audio.pickup(120);
  } else if (kind === 'taken') {
    run.interact.setRelicTaken(id);
    if (playerId === session.localId && t) {
      run.carrying = { id, name: t.name };
      el.carrying.classList.remove('hidden');
      el.carryingName.textContent = t.name;
      audio.pickup(90);
    }
  } else if (kind === 'placed') {
    run.interact.setHolder(slot, id);
    el.doorCount.textContent = `${run.interact.filledHolders}/${run.interact.holders.length}`;
    el.door.classList.toggle('open', run.interact.doorOpen);
    if (playerId === session.localId) {
      run.carrying = null;
      el.carrying.classList.add('hidden');
    }
    audio.pickup(200);
  }
}

// ---------------------------------------------------------------------------
// Host authority
// ---------------------------------------------------------------------------

function hostKnockDown(playerId) {
  if (!run || run.over || !isHost()) return;
  const target = allPlayers().find((p) => p.id === playerId);
  if (!target || target.downed || target.dead) return;
  // Just revived. Without this the ghost standing over the body knocks them
  // straight back down and the ad bought nothing.
  if ((target.invulnUntil ?? 0) > run.time) return;

  const lo = run.loadouts.get(playerId);
  if (lo?.absorbHit()) {
    // The Warden ate it. Tell them so, and nobody else needs to know.
    if (playerId === session.localId) audio.hit();
    else if (isNet()) session.net.send(playerId, MSG.DOWN, { i: rosterIndex(playerId), brace: true }, true);
    return;
  }

  target.downed = true;
  const seconds = CONFIG.bleedOutSeconds * (lo?.stats.bleedScale ?? 1);
  run.downTimers.set(playerId, seconds);

  // Whatever put them down loses interest and leaves. Otherwise it stands over
  // the body and nobody can get close enough to help, which turns one mistake
  // into the end of the run.
  scatterGhosts(target.pos.x, target.pos.z, 14);
  if (isNet()) {
    session.net.broadcast(MSG.DOWN, {
      i: rosterIndex(playerId), dead: false, t: Math.round(seconds),
    }, true);
  }
  if (playerId === session.localId) applyDownLocal();
}

/** Every ghost within reach forgets this spot for a while. Host only. */
function scatterGhosts(x, z, seconds) {
  if (!isHost() || !run) return;
  for (const g of run.ghosts) {
    if (Math.hypot(g.pos.x - x, g.pos.z - z) < 30) g.retreat(x, z, seconds, run.time);
  }
}

function hostKill(playerId) {
  const target = allPlayers().find((p) => p.id === playerId);
  if (!target) return;
  target.dead = true;
  target.downed = false;
  run.downTimers.delete(playerId);
  if (isNet()) session.net.broadcast(MSG.DOWN, { i: rosterIndex(playerId), dead: true }, true);
  if (playerId === session.localId) applyDeadLocal();
}

function hostRevive(playerId, immunity = 0) {
  const target = allPlayers().find((p) => p.id === playerId);
  if (!target || !target.downed || target.dead) return;
  target.downed = false;
  target.invulnUntil = run.time + immunity;
  run.downTimers.delete(playerId);
  if (isNet()) session.net.broadcast(MSG.REVIVE, { i: rosterIndex(playerId) }, true);
  if (playerId === session.localId) applyReviveLocal();
}

function applyDownLocal() {
  run.player.downed = true;
  // Being knocked out has to interrupt whatever screen you were sitting at.
  // Without this the puzzle stays open and you keep solving it from the floor,
  // which is exactly what happened on the Brass key terminal.
  if (run.minigame) { run.minigame.controller.abort?.(); closeTerminal(); }
  if (run.boardOpen) closeBoard();
  audio.hit();
  el.downed.classList.remove('hidden');
  syncPrompt();
  el.downedTimer.textContent = String(Math.ceil(
    run.downTimers.get(session.localId) ?? CONFIG.bleedOutSeconds,
  ));
  // Solo only: in multiplayer, conceding alone should not end anyone else's
  // run, and the group vote covers the case where it genuinely is over.
  el.giveUp.classList.toggle('hidden', isNet());
  refreshAdRevive();
  const canSelfRevive = run.loadout.char.id === 'nurse' && run.loadout.ready;
  el.downedNote.textContent = canSelfRevive
    ? `You can still get yourself up. ${actionLabel('power')}.`
    : isNet() ? 'Someone has to come and pick you up.'
              : 'No one is coming for you. Alone, this is how it ends.';
}

function applyDeadLocal() {
  run.player.dead = true;
  run.player.downed = true;
  if (run.minigame) { run.minigame.controller.abort?.(); closeTerminal(); }
  if (run.boardOpen) closeBoard();
  el.downedTimer.textContent = '0';
  el.downedNote.textContent = 'You bled out. Watch the rest of it.';
}

function applyReviveLocal() {
  run.player.downed = false;
  el.downed.classList.add('hidden');
  syncPrompt();
}

// ---------------------------------------------------------------------------
// Ads: buying your way back up
// ---------------------------------------------------------------------------

function refreshAdRevive() {
  const left = AD_CONFIG.selfRevivesPerRun - (run?.adRevives ?? 0);
  const usable = adsEnabled() && left > 0 && run?.player.downed && !run.player.dead;
  el.adRevive.classList.toggle('hidden', !usable);
  el.adReviveNote.textContent = usable
    ? `${left} of ${AD_CONFIG.selfRevivesPerRun} left this run`
    : '';
}

// Solo only. In multiplayer, walking away is what the group vote is for, and
// one person conceding should not take the run away from everyone else.
el.giveUp.addEventListener('click', () => {
  if (!run || isNet()) return;
  endRun(false);
});

el.adRevive.addEventListener('click', async () => {
  if (!run || !run.player.downed || run.player.dead) return;
  if ((run.adRevives ?? 0) >= AD_CONFIG.selfRevivesPerRun) return;
  el.adRevive.disabled = true;
  const result = await playAd('self-revive', 'Getting you back up');
  el.adRevive.disabled = false;
  if (result !== 'viewed') return;
  run.adRevives = (run.adRevives ?? 0) + 1;
  if (isHost()) hostRevive(session.localId, AD_CONFIG.immunitySeconds);
  else session.net.toHost(MSG.REVIVE, { i: rosterIndex(session.localId), ad: true }, true);
  refreshAdRevive();
});

// ---------------------------------------------------------------------------
// Last stand: everyone is down
// ---------------------------------------------------------------------------

function hostOpenVote() {
  if (run.vote) return;
  run.vote = { agreed: new Set(), until: run.time + AD_CONFIG.voteSeconds };
  if (isNet()) session.net.broadcast(MSG.VOTE, { n: 'open', t: AD_CONFIG.voteSeconds }, true);
  openVoteUI();
}

function openVoteUI() {
  if (!adsEnabled()) { if (isHost()) hostCloseVote(false); return; }
  // The group decision replaces the individual one; two overlays offering
  // different ways out of the same moment is just confusing.
  el.downed.classList.add('hidden');
  el.vote.classList.remove('hidden');
  el.voteWatch.disabled = false;
  renderVote();
}

function renderVote() {
  el.voteList.innerHTML = '';
  const agreed = run.vote?.agreed ?? new Set();
  for (const pl of allPlayers()) {
    const row = document.createElement('div');
    row.className = 'vote-row' + (agreed.has(pl.id) ? ' yes' : '');
    const n = document.createElement('span');
    n.textContent = (pl.name ?? '?') + (pl.isLocal ? ' (you)' : '');
    const t = document.createElement('b');
    t.textContent = agreed.has(pl.id) ? 'watched' : 'waiting';
    row.append(n, t);
    el.voteList.appendChild(row);
  }
}

function hostRecordVote(playerId) {
  if (!run.vote) return;
  run.vote.agreed.add(playerId);
  if (isNet()) {
    session.net.broadcast(MSG.VOTE, {
      n: 'tally', ids: [...run.vote.agreed].map(rosterIndex),
    }, true);
  }
  renderVote();
  // Everyone, or nobody. One person paying for five is not a group decision.
  if (allPlayers().every((pl) => run.vote.agreed.has(pl.id))) hostCloseVote(true);
}

function hostCloseVote(revive) {
  if (!run.vote) return;
  run.vote = null;
  if (isNet()) session.net.broadcast(MSG.VOTE, { n: revive ? 'go' : 'end' }, true);
  revive ? applyGroupRevive() : endRun(false);
}

function applyGroupRevive() {
  el.vote.classList.add('hidden');
  el.giveUp.classList.add('hidden');
  for (const pl of allPlayers()) {
    pl.dead = false;
    pl.downed = false;
    pl.invulnUntil = run.time + AD_CONFIG.immunitySeconds;
    run.downTimers.delete(pl.id);
  }
  run.player.dead = false;
  run.player.downed = false;
  el.downed.classList.add('hidden');
  audio.escape();
}

el.voteWatch.addEventListener('click', async () => {
  el.voteWatch.disabled = true;
  const result = await playAd('group-revive', 'Bringing everyone back');
  if (result !== 'viewed') { el.voteWatch.disabled = false; return; }
  if (isHost()) hostRecordVote(session.localId);
  else session.net.toHost(MSG.VOTE, { n: 'yes' }, true);
});

el.voteQuit.addEventListener('click', () => {
  el.vote.classList.add('hidden');
  // One refusal ends it for everyone, which is the point of it being a vote.
  if (isHost()) hostCloseVote(false);
  else session.net.toHost(MSG.VOTE, { n: 'no' }, true);
});

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function endRun(escaped, remoteElapsed) {
  if (!run || run.over) return;
  run.over = true;
  for (const g of run.ghosts) g.clearKnives();
  run.mark.visible = false;
  el.ghostNear.classList.add('hidden');
  audio.silence();
  escaped ? audio.escape() : audio.caught();
  document.exitPointerLock?.();
  el.downed.classList.add('hidden');
  el.revive.classList.add('hidden');
  el.giveUp.classList.add('hidden');
  voice.setTalking(false);

  if (isHost() && isNet()) {
    session.net.broadcast(MSG.END, { escaped, elapsed: Math.round(run.elapsed) }, true);
  }

  const elapsed = remoteElapsed ?? run.elapsed;
  const d = run.difficulty;
  const rows = [];
  let total = 0;
  const gotOut = escaped && !run.player.dead;

  if (gotOut) {
    total += d.payoutBase;
    rows.push([`Escaped · ${d.label}`, d.payoutBase]);
    const lootValue = run.carried.reduce((s, l) => s + l.value, 0);
    const scaled = Math.round(lootValue * d.payoutMultiplier);
    if (run.carried.length) {
      rows.push([`${run.carried.length} item${run.carried.length > 1 ? 's' : ''} recovered · ×${d.payoutMultiplier}`, scaled]);
      total += scaled;
    }
    const par = run.level.parSeconds ?? d.parSeconds;
    const spare = Math.max(0, par - elapsed);
    const speed = Math.round(spare * 0.7 * d.payoutMultiplier);
    if (speed > 0) { rows.push([`${formatTime(spare)} under par`, speed]); total += speed; }
  } else if (escaped) {
    rows.push(['The others got out. You did not.', 0]);
  } else {
    rows.push(['Lights out. Everything stays in the house.', 0]);
  }

  el.endTitle.textContent = gotOut ? 'Out' : 'Taken';
  el.endBody.textContent = `${formatTime(elapsed)} inside.` +
    (run.carried.length && !gotOut ? ` ${run.carried.length} item${run.carried.length === 1 ? '' : 's'} lost with you.` : '');

  el.endRows.innerHTML = '';
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'row';
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('span'); b.textContent = `${value > 0 ? '+' : ''}${value}`;
    row.append(a, b);
    el.endRows.appendChild(row);
  }
  el.endTotal.textContent = String(total);
  Bank.write(Bank.read() + total);
  el.again.classList.toggle('hidden', isNet() && !isHost());
  show('end');
}

const formatTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

const STEP = 1 / 60;
const SEND_HZ = 20;
const SNAP_HZ = 15;
let accumulator = 0;
let lastFrame = 0;
let fpsAccum = 0, fpsFrames = 0;

const flashDir = new THREE.Vector3(0, 0, -1);
const targetDir = new THREE.Vector3();

function frame(now) {
  rafId = requestAnimationFrame(frame);
  if (!run || crashed) return;
  try {
    step(now);
  } catch (err) {
    reportCrash('Frame', err);
  }
}

function step(now) {

  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  run.time += dt;

  // Four classList reads a frame, and in exchange the click-to-look prompt can
  // never again be left showing on top of an overlay that opened without
  // remembering to tell it. Every overlay in the game opens from somewhere
  // different; this is the one place that sees all of them.
  syncPrompt();

  if (!run.over && run.begun) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps < 5) {
      // A terminal takes both hands. Without this the movement keys still
      // reach the window listener and you walk off while the puzzle is open.
      // A terminal takes both hands, and so does a piece of chalk. Without
      // this the movement keys still reach the window listener and you walk
      // off while the panel is open.
      if (!run.minigame && !run.boardOpen) run.player.update(STEP, run.grid, run.time);
      if (isHost()) for (const g of run.ghosts) g.update(STEP, allPlayers(), run.grid, run.time);
      accumulator -= STEP;
      steps++;
    }
    if (!run.player.downed) run.elapsed += dt;
  }

  // Ghost meshes bypass frustum culling so their shader wobble is never
  // clipped mid-vertex. With one per seven rooms that is up to 28 additive,
  // depth-writing-off draws every frame, most of them behind walls in fog.
  // A distance test costs nothing and removes nearly all of them.
  const far2 = CONFIG.drawDistance * CONFIG.drawDistance;
  for (const g of run.ghosts) {
    const dx = g.pos.x - camera.position.x, dz = g.pos.z - camera.position.z;
    g.mesh.visible = dx * dx + dz * dz < far2;
  }

  for (const r of run.remotes.values()) r.update(now, dt);
  if (!isHost()) for (const g of run.ghosts) g.updateVisualsOnly(dt, run.grid, run.time);
  if (!run.over && run.begun) simulate(dt);
  if (isNet()) network(dt);

  camera.getWorldDirection(targetDir);
  flashDir.lerp(targetDir, 1 - Math.exp(-14 * dt)).normalize();
  run.material.uniforms.uFlashPos.value.copy(camera.position);
  run.material.uniforms.uFlashDir.value.copy(flashDir);
  // Failing bulbs. Baked into their own channels, modulated live here.
  const u = run.material.uniforms;
  u.uFlickerA.value = flickerSignal(run.time, 0.0);
  u.uFlickerB.value = flickerSignal(run.time, 2.7);

  // The torch stutters when the ghost is close. It is atmosphere, but it is
  // also the only warning you get when it is behind you.
  const near = Math.max(0, 1 - nearestGhostDistance() / 12);
  u.uFlashFlicker.value = near > 0.05
    ? 1 - near * 0.55 * (0.5 + 0.5 * Math.sin(run.time * 33 + Math.sin(run.time * 7) * 3))
    : 1;

  run.lootMat.uniforms.uTime.value = run.time;
  run.beadMat.uniforms.uTime.value = run.time;
  run.exitMat.uniforms.uTime.value = run.time;
  run.trapMat.uniforms.uTime.value = run.time;

  if (run.vis.update(run.player.pos.x, run.player.pos.z)) el.room.textContent = run.vis.roomName;

  // Say so, plainly. A safe room nobody realises is safe is not a mechanic.
  const sr = run.level.safeRoom;
  const sheltered = !!sr && run.player.pos.x > sr.x0 && run.player.pos.x < sr.x1
    && run.player.pos.z > sr.z0 && run.player.pos.z < sr.z1;
  if (sheltered !== run.sheltered) {
    run.sheltered = sheltered;
    el.room.classList.toggle('safe', sheltered);
    el.safeTag.classList.toggle('hidden', !sheltered);
  }
  renderer.render(run.scene, camera);

  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 0.4) {
    el.fps.textContent = Math.round(fpsFrames / fpsAccum);
    el.drawn.textContent = run.vis.drawn;
    el.calls.textContent = renderer.info.render.calls;
    el.tris.textContent = renderer.info.render.triangles.toLocaleString();
    el.timer.textContent = formatTime(run.elapsed);
    el.net.textContent = isNet() ? `${session.mode} · ${run.remotes.size + 1} in` : 'solo';
    fpsAccum = 0; fpsFrames = 0;
    updateTeamPanel();
  }
}

function simulate(dt) {
  const p = run.player;
  const lo = run.loadout;
  lo.tick(dt);

  // Ability upkeep.
  if (!lo.isActive && lo.char.id === 'runner') p.speedScale = lo.stats.sprintScale;
  if (run.flare.visible && run.time > run.flareUntil) {
    run.flare.visible = false;
    run.material.uniforms.uFlareOn.value = 0;
  }
  for (const pl of allPlayers()) {
    // A closet hides you from every sense it has. That is the whole point of
    // one, and it has to apply to remote players on the host too, not just to
    // whoever is looking at their own screen.
    pl.undetectable = pl.undetectableUntil > run.time || !!pl.hidingClosetId;
  }

  el.powerFill.style.width = lo.char.cooldown
    ? `${100 * (1 - lo.cooldown / lo.char.cooldown)}%`
    : (lo.ready ? '100%' : '0%');
  el.power.classList.toggle('ready', lo.ready);
  el.power.classList.toggle('active', lo.isActive);

  // Push to talk.
  if (voice.enabled) {
    const talking = settings.data.voice.pushToTalk ? p.held('talk') : true;
    if (talking !== voice.talking) voice.setTalking(talking);
    el.talk.classList.toggle('hidden', !(talking && !voice.muted));
  }

  if (isHost() && run.vote) {
    el.voteTimer.textContent = Math.ceil(Math.max(0, run.vote.until - run.time));
    if (run.time > run.vote.until) hostCloseVote(false);
    return;      // nothing else moves while the house waits on the answer
  }

  if (isHost()) {
    for (const [id, t] of run.downTimers) {
      const left = t - dt;
      if (left <= 0) hostKill(id);
      else run.downTimers.set(id, left);
    }
    for (const g of run.ghosts) {
      const touched = g.checkContact(allPlayers());
      if (touched) { hostKnockDown(touched); break; }
    }
    hostCheckTraps();
    hostCheckLastStand();
    checkEscape();
  }

  if (p.downed && !p.dead) {
    // Only the host decides when somebody actually bleeds out, but it is the
    // host that was counting down, so a downed client sat looking at a frozen
    // number. Clients tick their own copy purely for the display; the host's
    // DOWN message resets it whenever the two drift.
    if (!isHost() && !run.vote) {
      const left = run.downTimers.get(p.id);
      if (left !== undefined) run.downTimers.set(p.id, Math.max(0, left - dt));
    }
    const left = run.downTimers.get(p.id);
    if (left !== undefined) el.downedTimer.textContent = Math.ceil(Math.max(0, left));
  }

  // -- hiding, and what is in reach ---------------------------------------

  if (p.hiding || p.downed || p.dead || run.minigame || run.boardOpen) {
    el.use.classList.add('hidden');
    run.useTarget = null;
  } else {
    run.useTarget = run.interact.nearest(p.pos, { carrying: run.carrying, canHide: true });
    const busy = !!reviveCandidate(p.pos, [...run.remotes.values()]);
    const showUse = run.useTarget && !busy;
    el.use.classList.toggle('hidden', !showUse);
    if (showUse) el.useLabel.textContent = run.useTarget.label;
  }

  run.interact.update(dt, run.time);

  // A screen that is on is telling the house where you are. Every few seconds
  // it calls again, so a long puzzle is a long invitation.
  if (isHost()) {
    for (const [, t] of run.busyTerminals) {
      t.next -= dt;
      if (t.next <= 0) {
        t.next = 3.0;
        for (const g of run.ghosts) {
          if (Math.hypot(g.pos.x - t.x, g.pos.z - t.z) < 45) g.lure(t.x, t.z);
        }
      }
    }
  }

  // The noise, heard locally. Driven separately from the lure above because a
  // client running a terminal must hear its own racket even though the host is
  // the one moving the ghosts.
  if (run.minigame) {
    run.noiseTimer = (run.noiseTimer ?? 0) - dt;
    if (run.noiseTimer <= 0) { run.noiseTimer = 1.5; audio.terminalNoise(); }
  } else {
    run.noiseTimer = 0;
  }

  // Your microphone, as the ghosts hear it.
  if (voice.enabled) {
    p.voiceLevel = voice.sampleLevel();
  } else {
    p.voiceLevel = 0;
  }

  // -- reviving ------------------------------------------------------------

  if (!p.downed && !p.dead) {
    const cand = reviveCandidate(p.pos, [...run.remotes.values()]);
    if (cand) {
      const needed = REVIVE_SECONDS * lo.stats.reviveScale;
      el.revive.classList.remove('hidden');
      el.reviveName.textContent = cand.name;
      if (p.held('interact')) {
        if (run.reviveTarget !== cand.id) { run.reviveTarget = cand.id; run.reviveProgress = 0; }
        run.reviveProgress += dt;
        if (run.reviveProgress >= needed) {
          run.reviveProgress = 0;
          if (isHost()) hostRevive(cand.id);
          else session.net.toHost(MSG.REVIVE, { i: rosterIndex(cand.id) }, true);
        }
      } else {
        run.reviveProgress = Math.max(0, run.reviveProgress - dt * 2);
      }
      el.reviveBar.style.width = `${(run.reviveProgress / needed) * 100}%`;
    } else {
      el.revive.classList.add('hidden');
      run.reviveProgress = 0;
      run.reviveTarget = null;
    }
  } else {
    el.revive.classList.add('hidden');
  }

  // -- loot ----------------------------------------------------------------

  const senseAll = run.time < run.senseUntil;
  const senseRadius = lo.stats.lootSense;
  run.exitBead.visible = senseAll;

  for (const l of run.lootItems) {
    if (l.taken) { l.bead.visible = false; continue; }
    const dx = l.x - p.pos.x, dz = l.z - p.pos.z;
    const d2 = dx * dx + dz * dz;

    if (!p.downed && !p.dead && d2 < 1.4 * 1.4) {
      if (isHost()) { hostGrantLoot(l.uid, session.localId); continue; }
      if (!l.claimedAt || run.time - l.claimedAt > 2) {
        l.claimedAt = run.time;
        session.net.toHost(MSG.PICKUP, { uid: l.uid }, true);
      }
    }
    l.bead.visible = senseAll || (senseRadius > 0 && d2 < senseRadius * senseRadius);
    l.mesh.rotation.y += dt * 1.4;
    l.mesh.position.y = 0.85 + Math.sin(run.time * 2 + l.x) * 0.07;
  }

  if (!p.downed && !p.dead) {
    // The player makes no footstep sound at all. Every creak you hear in here
    // is something else walking, which is the entire point of the cue.
  }
  run.pillar.rotation.y += dt * 0.4;

  // -- the Lookout ---------------------------------------------------------

  // The mark rides whichever ghost was pinned until its forty seconds are up.
  // Driven from the ghost's live position rather than a snapshot, which is the
  // whole value of it: a marker that showed where the thing WAS would be worse
  // than nothing.
  const marked = run.markIndex >= 0 && run.time < run.markUntil
    ? run.ghosts[run.markIndex] : null;
  run.mark.visible = !!marked;
  if (marked) {
    run.mark.position.set(marked.pos.x, 2.55 + Math.sin(run.time * 2.4) * 0.09, marked.pos.z);
    run.mark.rotation.y += dt * 1.8;
    run.markMat.uniforms.uTime.value = run.time;
  } else if (run.markIndex >= 0) {
    run.markIndex = -1;
  }

  const d = nearestGhostDistance();

  // The Lookout's passive. Deliberately directionless: it tells you one of
  // them is inside twenty metres and nothing else, which turns a corridor into
  // a decision instead of answering it for you. Everyone else has ghostSense 0
  // and never sees this.
  if (lo.stats.ghostSense > 0) {
    const near = d < lo.stats.ghostSense && !p.dead;
    el.ghostNear.classList.toggle('hidden', !near);
    if (near) el.ghostNear.classList.toggle('close', d < lo.stats.ghostSense * 0.5);
  }

  const proximity = Math.max(0, 1 - d / 22);
  const hunting = anyHunting();
  audio.setTension(proximity, hunting);
  el.vignette.style.opacity = String(Math.min(0.85, hunting ? proximity * 1.3 : proximity * 0.35));
}

/**
 * A snare does not knock you down. It pins you for a few seconds and makes
 * enough noise to bring the ghost — which is worse, because now you are the
 * one standing still.
 */
function hostCheckTraps() {
  for (let i = 0; i < run.traps.length; i++) {
    const t = run.traps[i];
    if (!t.armed) continue;
    for (const pl of allPlayers()) {
      if (pl.downed || pl.dead) continue;
      const dx = pl.pos.x - t.x, dz = pl.pos.z - t.z;
      if (dx * dx + dz * dz > 0.85 * 0.85) continue;
      applyTrapHit(i, pl.id);
      if (isNet()) {
        session.net.broadcast(MSG.TRAP, { n: 'hit', i, p: rosterIndex(pl.id) }, true);
      }
      return;
    }
  }
}

function applyTrapHit(index, playerId) {
  const t = run.traps[index];
  if (!t || !t.armed) return;
  t.armed = false;
  t.mesh.visible = false;
  // Every ghost hears it, not just the one that left it. That is the point:
  // a snare is loud, and there are three of them now.
  if (isHost()) for (const g of run.ghosts) g.lure(t.x, t.z);
  if (playerId === session.localId) {
    run.player.snaredUntil = run.time + 2.6;
    audio.hit();
  }
}

function hostGrantLoot(uid, ownerId) {
  const l = run.lootItems.find((x) => x.uid === uid);
  if (!l || l.owner) return;
  l.owner = ownerId;
  l.taken = true;
  l.mesh.visible = false;
  l.bead.visible = false;
  if (isNet()) session.net.broadcast(MSG.PICKUP, { uid, i: rosterIndex(ownerId) }, true);
  if (ownerId === session.localId) claimLoot(l);
}

function claimLoot(l) {
  run.carried.push(l);
  audio.pickup(l.value);
  const worth = run.carried.reduce((s, i) => s + i.value, 0);
  el.carry.textContent = `${run.carried.length} · ${worth}`;
}

/**
 * Everyone on the floor is already the end of the run — nobody left standing
 * can pick anybody up — so the choice is offered then, rather than after
 * watching four separate timers run out one at a time.
 *
 * Only when ads are available. With them switched off there is nothing to
 * offer, so the bleed-out timers simply run and the run ends on its own.
 */
function hostCheckLastStand() {
  if (run.vote || run.over) return;
  const live = livePlayers();
  const allGone = !live.length;
  const allDown = live.length > 0 && live.every((pl) => pl.downed);
  if (!allGone && !allDown) return;

  // Solo keeps its own panel. Three ad revives and a give-up button are already
  // on screen, and a unanimous vote with one voter is just the same choice in
  // worse words. When the timer genuinely runs out, that is the end.
  if (!isNet()) { if (allGone) endRun(false); return; }

  // Nothing to offer without ads, so the bleed-out timers simply run.
  if (!adsEnabled()) { if (allGone) endRun(false); return; }

  hostOpenVote();
}

function checkEscape() {
  if (run.over) return;
  const live = livePlayers();
  // Ending the run is hostCheckLastStand's job; this only decides escapes.
  if (!live.length) return;
  if (live.some((pl) => pl.downed)) return;
  // The door does not open on arrival. It opens when its four holders are full.
  if (!run.interact.doorOpen) return;
  const r = run.exitRoom;
  const inside = live.filter((pl) =>
    pl.pos.x > r.x0 && pl.pos.x < r.x1 && pl.pos.z > r.z0 && pl.pos.z < r.z1);
  run.atExit = `${inside.length}/${live.length}`;
  if (inside.length === live.length) endRun(true);
}

function updateTeamPanel() {
  // Top left, always visible, so you can see at a glance who is still standing
  // without waiting for someone to say so on voice.
  el.rosterHud.innerHTML = '';
  for (const pl of allPlayers()) {
    const state = pl.dead ? 'gone' : pl.downed ? 'down' : 'up';
    const row = document.createElement('div');
    row.className = `rh ${state}`;
    const dot = document.createElement('i');
    dot.style.background = `#${(pl.color ?? 0xcfc4b4).toString(16).padStart(6, '0')}`;
    const name = document.createElement('span');
    name.textContent = (pl.name ?? '?') + (pl.isLocal ? ' (you)' : '');
    const tag = document.createElement('b');
    tag.textContent = pl.dead ? 'gone' : pl.downed ? 'down' : '';
    row.append(dot, name, tag);
    el.rosterHud.appendChild(row);
  }

  el.team.textContent = '';
  if (run.atExit) {
    const span = document.createElement('span');
    span.className = 'tp exit';
    span.textContent = `${run.atExit} at the way out`;
    el.team.appendChild(span);
  }
}

// ---------------------------------------------------------------------------
// Networking per frame
// ---------------------------------------------------------------------------

function network(dt) {
  const net = session.net;
  if (!net) return;

  run.sendAcc += dt;
  if (!isHost() && run.sendAcc >= 1 / SEND_HZ) {
    run.sendAcc = 0;
    const p = run.player;
    // Unreliable means unordered. Without a sequence number an older packet
    // arriving after a newer one is treated as the latest word and snaps
    // everyone backwards.
    net.toHost(MSG.STATE, {
      q: ++run.stateSeq,
      x: r2(p.pos.x), z: r2(p.pos.z), y: r2(p.yaw),
      f: (p.downed ? 1 : 0) | (p.dead ? 2 : 0) | (p.crouching ? 4 : 0),
      v: Math.round((p.voiceLevel ?? 0) * 100),
    }, false);
  }

  run.snapAcc += dt;
  if (isHost() && run.snapAcc >= 1 / SNAP_HZ) {
    run.snapAcc = 0;
    const players = allPlayers().map((pl) => [
      rosterIndex(pl.id), r2(pl.pos.x), r2(pl.pos.z), r2(pl.yaw),
      (pl.downed ? 1 : 0) | (pl.dead ? 2 : 0) | (pl.crouching ? 4 : 0),
    ]);
    net.broadcast(MSG.SNAP, {
      q: ++run.snapSeq,
      p: players,
      g: run.ghosts.map((gh) => [
        r2(gh.pos.x), r2(gh.pos.z), r2(gh.mesh.rotation.y), r2(gh.rage), gh.state,
      ]),
      e: Math.round(run.elapsed),
      a: run.atExit ?? null,
    }, false);
  }

  if (voice.enabled) {
    voice.setListener(camera);
    for (const r of run.remotes.values()) {
      voice.setPosition(r.id, r.pos.x, 1.4, r.pos.z);
      voice.setVolume(r.id, r.downed ? 0.55 : 1.0);
    }
  }
}

// ---------------------------------------------------------------------------
// Message wiring
// ---------------------------------------------------------------------------

/**
 * Same browser, new peer id.
 *
 * A refresh, a second Join click, or leaving the lobby and coming back all hand
 * out a fresh PeerJS id while the old connection is still live — which is how
 * one person ended up in the roster twice. The browser's session id is the
 * thing that identifies a person, so match on that and replace.
 *
 * Called from both the 'joined' path and the HELLO path, because either can be
 * the first sight of a player: they arrive on separate channels and neither
 * wins reliably.
 */
function hostDropStaleSession(net, sid, keepId) {
  if (!sid) return;
  const stale = session.roster.filter((p) => p.sid === sid && p.id !== keepId);
  for (const p of stale) {
    // Never the host's own seat. Hosting in one tab and joining from another
    // shares a session id, and those are two genuine people in the room.
    if (p.id === session.localId) continue;
    net.kick(p.id, 'Reconnected from another tab.');
    session.roster = session.roster.filter((r) => r.id !== p.id);
    if (run) {
      const r = run.remotes.get(p.id);
      if (r) { r.dispose(run.scene); run.remotes.delete(p.id); }
    }
  }
}

function wireNet(net) {
  /**
   * Sender-role guards.
   *
   * PeerJS ids are visible in the lobby, so "who sent this" has to be checked
   * on every message rather than assumed from the message type. Two rules:
   * a client accepts nothing that did not come from the host, and a host
   * ignores anything only it is supposed to send. Without the first, a client
   * that rewrote its own roster from a forged LOBBY would be trivial.
   */
  const fromHost = (fn) => (d, from) => {
    if (isHost() || !net.isFromHost(from)) return;
    fn(d, from);
  };
  const fromClient = (fn) => (d, from) => {
    if (!isHost() || from === net.id) return;
    fn(d, from);
  };
  // Both directions carry these; each branches on isHost() internally, but a
  // client must still only ever hear them from the host.
  const authed = (fn) => (d, from) => {
    if (!isHost() && !net.isFromHost(from)) return;
    fn(d, from);
  };

  // Every refusal happens here, before the connection is wired up, so a
  // rejected peer never enters the roster or receives a snapshot.
  net.gate = (conn) => {
    if (!isHost()) return null;
    const meta = conn.metadata ?? {};
    if (meta.protocol !== PROTOCOL) {
      return 'That is a different version of the game. Refresh the page and try again.';
    }
    if (roomLocked) return 'They have already gone in. Wait for this run to finish.';
    if (session.roster.length >= 6) return 'That house already has six people in it.';
    if (session.roster.some((p) => p.id === conn.peer)) return 'You are already in this room.';
    return null;
  };

  net.on('joined', ({ id, name, sid }) => {
    if (!isHost()) return;
    hostDropStaleSession(net, sid, id);

    // Checked again: the gate ran when the connection opened, and the roster
    // can have filled between then and now.
    // kick(), not send(DENY): send leaves them connected, and a connected peer
    // is in net.conns, and broadcast() iterates net.conns. Somebody turned
    // away for arriving sixth was still fed every snapshot of the run.
    if (roomLocked || session.roster.length >= 6) { net.kick(id, 'The room closed.'); return; }

    // This fires only once both channels are open, so HELLO has often created
    // the entry already. Fill in the session id rather than skipping past it:
    // an entry without one can never be matched as a reconnect later, which is
    // exactly how the same person ended up listed twice.
    const existing = session.roster.find((p) => p.id === id);
    if (existing) existing.sid ??= sid;
    else session.roster.push({ id, sid, name: cleanName(name), ready: false, char: DEFAULT_CHARACTER });

    broadcastLobby();
    voice.callAll(net.peer, voicePeerIds());
  });

  net.on('timeout', ({ id }) => {
    if (!isHost()) return;
    session.roster = session.roster.filter((p) => p.id !== id);
    broadcastLobby();
    hostRecheckLoaded();
  });

  net.on(MSG.DENY, fromHost((d) => {
    voice.shutdown();
    session.net?.destroy();
    session.net = null;
    session.mode = 'solo';
    session.roster = [];
    roomLocked = false;
    disposeRun();
    show('multiplayer');
    showMenuError(d?.kicked
      ? (d.why ?? 'The host removed you from the room.')
      : (d?.why ?? 'The host would not let you in.'));
  }));

  net.on('left', ({ id }) => {
    // forget, not drop: drop() closes the call but leaves the retry backoff in
    // place, so somebody who left and rejoined started halfway up the ladder.
    voice.forget(id);
    if (isHost()) {
      session.roster = session.roster.filter((p) => p.id !== id);
      broadcastLobby();
      // The person everyone was waiting on may be the person who just left.
      // Without this the house stays frozen until the load watchdog fires,
      // which is the better part of a minute of nobody being able to move.
      hostRecheckLoaded();
    }
    if (run) {
      const r = run.remotes.get(id);
      if (r) { r.dispose(run.scene); run.remotes.delete(id); }
      run.downTimers.delete(id);
    }
    if (currentScreen === 'select') renderSelect();
  });

  net.on(MSG.HELLO, fromClient(({ name, sid }, from) => {
    if (!isHost()) return;
    if (roomLocked) return;
    // HELLO rides the reliable channel, which routinely opens before the
    // unreliable one — so this, not 'joined', is frequently the first sight of
    // a player, and it has to do the same replacement.
    hostDropStaleSession(net, sid, from);
    const entry = session.roster.find((p) => p.id === from);
    if (entry) {
      entry.name = cleanName(name);
      if (sid) entry.sid = sid;
    } else if (session.roster.length < 6) {
      session.roster.push({ id: from, sid, name: cleanName(name), ready: false, char: DEFAULT_CHARACTER });
    }
    broadcastLobby();
  }));

  net.on(MSG.LOBBY, fromHost(({ roster, difficultyId }) => {
    session.roster = roster;
    session.difficultyId = difficultyId;
    const me = meInRoster();
    if (me) { session.character = me.char ?? session.character; session.ready = !!me.ready; }
    if (currentScreen === 'select' || currentScreen === 'multiplayer') renderSelect();
    voice.callAll(net.peer, voicePeerIds());
  }));

  net.on(MSG.CHAR, fromClient(({ char, ready }, from) => {
    if (!isHost()) return;
    const entry = session.roster.find((p) => p.id === from);
    if (!entry) return;
    if (char) entry.char = char;
    if (ready !== undefined) entry.ready = ready;
    broadcastLobby();
  }));

  net.on(MSG.START, fromHost(({ difficultyId, seed }) => {
    if (isHost()) return;
    // START is re-sent to stragglers, so ignore it if this house is already up.
    if (run && run.level.seed === seed) return;
    startRun(difficultyById(difficultyId), seed);
  }));

  net.on(MSG.LOADED, fromClient((_, from) => hostMarkLoaded(from)));
  net.on(MSG.BEGIN, fromHost(() => { if (run) run.begun = true; }));

  net.on(MSG.STATE, fromClient((d, from) => {
    if (!isHost() || !run) return;
    const rp = run.remotes.get(from);
    if (!rp) return;
    if (d.q !== undefined) {
      if (d.q <= (rp.lastStateSeq ?? -1)) return;    // arrived out of order
      rp.lastStateSeq = d.q;
    }
    rp.push(d.x, d.z, d.y, !!(d.f & 1), !!(d.f & 2), performance.now(), !!(d.f & 4));
    // Applied directly rather than buffered: the ghost reacts to how loud you
    // are now, and an eighth of a second of smoothing would only blur it.
    rp.voiceLevel = (d.v ?? 0) / 100;
  }));

  net.on(MSG.SNAP, fromHost((d) => {
    if (isHost() || !run) return;
    if (d.q !== undefined) {
      if (d.q <= run.lastSnapSeq) return;            // arrived out of order
      run.lastSnapSeq = d.q;
    }
    const now = performance.now();
    for (const [idx, x, z, yaw, f] of d.p) {
      const entry = session.roster[idx];
      if (!entry || entry.id === session.localId) continue;
      run.remotes.get(entry.id)?.push(x, z, yaw, !!(f & 1), !!(f & 2), now, !!(f & 4));
    }
    for (let i = 0; i < d.g.length && i < run.ghosts.length; i++) {
      const gs = d.g[i];
      run.ghosts[i].applySnapshot(gs[0], gs[1], gs[2], gs[3], gs[4]);
    }
    run.elapsed = d.e;
    run.atExit = d.a;
  }));

  net.on(MSG.KNIFE, fromHost((d) => {
    if (isHost() || !run) return;
    (run.ghosts[d.gi ?? 0] ?? run.ghosts[0])?.addKnife(d.x, d.z, d.dx, d.dz);
  }));

  net.on(MSG.HIDE, authed((d, from) => {
    if (!run) return;
    if (isHost()) { hostSetHide(d.c, d.on ? from : null); return; }
    applyHide(d.c, d.i === null || d.i === undefined ? null : session.roster[d.i]?.id ?? null);
  }));

  net.on(MSG.RELIC, authed((d, from) => {
    if (!run) return;
    if (d.n === 'busy') {
      run.interact.setTerminalBusy(d.id, d.on);
      if (isHost()) {
        const t = run.interact.terminals.find((x) => x.id === d.id);
        if (d.on && t) run.busyTerminals.set(d.id, { x: t.x, z: t.z, next: 0 });
        else run.busyTerminals.delete(d.id);
        session.net.broadcast(MSG.RELIC, d, true, from);
      }
      return;
    }
    if (isHost()) { hostRelic(d.n, d.id, from); return; }
    applyRelic(d.n, d.id, session.roster[d.i]?.id, d.slot);
  }));

  net.on(MSG.VOTE, authed((d, from) => {
    if (!run) return;
    if (isHost()) {
      if (d.n === 'yes') hostRecordVote(from);
      else if (d.n === 'no') hostCloseVote(false);
      return;
    }
    if (d.n === 'open') { run.vote = { agreed: new Set(), until: run.time + d.t }; openVoteUI(); }
    else if (d.n === 'tally') {
      if (!run.vote) return;
      run.vote.agreed = new Set(d.ids.map((i) => session.roster[i]?.id).filter(Boolean));
      renderVote();
    } else if (d.n === 'go') { run.vote = null; applyGroupRevive(); }
    else if (d.n === 'end') { run.vote = null; el.vote.classList.add('hidden'); }
  }));

  net.on(MSG.BOARD, authed((d, from) => {
    if (!run) return;
    run.interact.applyBoardStroke(d.b, d.s);
    // The host relays so a client's chalk reaches everyone, not only the host.
    if (isHost()) session.net.broadcast(MSG.BOARD, d, true, from);
    if (run.boardOpen === d.b) run.boardEditor?.refresh();
  }));

  net.on(MSG.TRAP, fromHost((d) => {
    if (isHost() || !run) return;
    if (d.n === 'add') { addTrap(d.x, d.z); return; }
    applyTrapHit(d.i, session.roster[d.p]?.id);
  }));

  net.on(MSG.POWER, authed((d, from) => {
    if (!run) return;
    const ownerId = session.roster[d.i]?.id ?? from;
    if (ownerId === session.localId) return;   // already applied locally
    applyPower(d.c, d.x, d.z, ownerId, d.g !== undefined ? { g: d.g } : null);
    if (isHost()) session.net.broadcast(MSG.POWER, d, true, from);
  }));

  net.on(MSG.PICKUP, authed((d, from) => {
    if (!run) return;
    if (isHost()) { hostGrantLoot(d.uid, from); return; }
    const l = run.lootItems.find((x) => x.uid === d.uid);
    if (!l) return;
    l.taken = true;
    l.mesh.visible = false;
    l.bead.visible = false;
    if (session.roster[d.i]?.id === session.localId) claimLoot(l);
  }));

  net.on(MSG.DOWN, fromHost((d) => {
    if (isHost() || !run) return;
    if (d.brace) { audio.hit(); return; }
    const id = session.roster[d.i]?.id;
    if (!id) return;
    const target = allPlayers().find((p) => p.id === id);
    if (target) { target.downed = !d.dead; target.dead = d.dead; }
    if (id === session.localId) d.dead ? applyDeadLocal() : applyDownLocal();
    if (!d.dead) run.downTimers.set(id, d.t ?? CONFIG.bleedOutSeconds);
  }));

  net.on(MSG.REVIVE, authed((d, from) => {
    if (!run) return;
    const id = session.roster[d.i]?.id;
    if (!id) return;
    if (isHost()) {
      const reviver = allPlayers().find((p) => p.id === from);
      const target = allPlayers().find((p) => p.id === id);
      if (!reviver || !target || !target.downed) return;
      // An ad revive is bought by the downed player themselves, so it has no
      // reviver to stand next to.
      if (d.ad) { hostRevive(id, AD_CONFIG.immunitySeconds); return; }
      if (Math.hypot(reviver.pos.x - target.pos.x, reviver.pos.z - target.pos.z) > 3.5) return;
      hostRevive(id);
      return;
    }
    const target = allPlayers().find((p) => p.id === id);
    if (target) target.downed = false;
    run.downTimers.delete(id);
    if (id === session.localId) applyReviveLocal();
  }));

  net.on(MSG.END, fromHost((d) => {
    if (d.full) { showMenuError('That house already has six people in it.'); return; }
    if (!isHost()) endRun(d.escaped, d.elapsed);
  }));

  net.on('deadroom', () => {
    // The channel opened but the host never replied: their tab is gone and the
    // signalling server has not noticed yet. Without this the player sits on a
    // connected-but-silent screen indefinitely.
    roomClosed('That room is not answering. The host has probably closed it.');
  });

  // The host's tab closed, or their connection died. Two very different
  // situations depending on whether the house had been entered yet.
  net.on('hostlost', () => {
    if (isHost() || !isNet()) return;   // already handled, or never applied
    if (run && !run.over) continueAlone();
    else roomClosed('The host closed the room.');
  });

  net.on('call', (call) => voice.accept(call));

  // Keep trying, on a timer, for anybody in the room we still cannot hear.
  //
  // Every previous attempt to connect a voice pair happened on a roster
  // change, and none of the things that break a pair change the roster: the
  // other side switching their microphone on later, ICE failing once, a peer
  // connection dropping mid-run. This is the loop that makes voice eventually
  // work instead of working or not depending on join order.
  clearInterval(voiceRetry);
  voiceRetry = setInterval(() => {
    if (!session.net?.peer || !voice.enabled) return;
    voice.reconcile(session.net.peer, voicePeerIds());
  }, 4000);
  net.on('error', (err) => showMenuError(err?.message ?? 'Connection lost.'));
}

/**
 * The host has gone and there is still a house to get out of.
 *
 * The alternative was to end everyone's run because one person closed a tab,
 * which is a miserable way to lose twenty minutes. The star topology means
 * there is no room left to be in — every other player was reachable only
 * through the host — but the house itself is entirely reproducible locally:
 * the level was generated from a shared seed and already exists in memory, and
 * the ghost logic is the same code on every machine, just gated behind
 * isHost(). Dropping to solo hands that gate the key.
 *
 * The ghosts carry on from wherever the last snapshot left them rather than
 * resetting, so the moment of handover is not a moment of safety.
 */
function continueAlone() {
  const wasClient = session.mode === 'client';
  clearInterval(voiceRetry);
  voiceRetry = null;
  voice.shutdown();
  try { session.net?.destroy(); } catch { /* already down */ }
  session.net = null;
  session.mode = 'solo';
  roomLocked = false;

  // Everyone else was only ever reachable through the host, so they are gone
  // whether or not their own tab is still open.
  if (run) {
    for (const r of run.remotes.values()) r.dispose(run.scene);
    run.remotes.clear();
    run.downTimers?.clear();
    run.vote = null;
    el.vote.classList.add('hidden');
    // isHost() is now true, so the simulation this client has been watching
    // becomes the simulation it runs. It must not also still be paused waiting
    // for a BEGIN that will never arrive.
    run.begun = true;
  }

  // rosterIndex() is used for colours and for the escape check; a roster with
  // nobody in it makes both of those quietly wrong.
  const me = session.roster.find((p) => p.id === session.localId);
  session.roster = [{
    id: session.localId,
    name: me?.name ?? session.name,
    char: me?.char ?? session.character,
    ready: true, loaded: true,
  }];

  if (wasClient) toast('Everyone else is gone. Finish it on your own.');
}

/**
 * A line across the middle of the screen that fades on its own.
 *
 * For things the player has to be told mid-run and cannot act on — the host
 * leaving being the one that prompted it. Deliberately not a dialog: stopping
 * a horror game to make somebody click OK is worse than the news.
 */
let toastTimer = null;
function toast(message, seconds = 5) {
  el.toast.textContent = message;
  el.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.toast.classList.add('hidden'), seconds * 1000);
}

/**
 * The host left before anybody went in. Nothing to salvage: back to the menu
 * with the reason, rather than a lobby that will never start.
 */
function roomClosed(why) {
  clearInterval(voiceRetry);
  voiceRetry = null;
  voice.shutdown();
  try { session.net?.destroy(); } catch { /* already down */ }
  session.net = null;
  session.mode = 'solo';
  session.roster = [];
  session.ready = false;
  roomLocked = false;
  disposeRun();
  show('multiplayer');
  showMenuError(why);
}

let loadWatch = null;
let voiceRetry = null;

function hostMarkLoaded(id) {
  const entry = session.roster.find((p) => p.id === id);
  if (entry) entry.loaded = true;
  hostRecheckLoaded();
}

/**
 * Has everyone still here finished baking?
 *
 * Split out because the answer changes when somebody LEAVES as well as when
 * somebody reports in, and only the second case used to ask.
 */
function hostRecheckLoaded() {
  if (!isHost() || !loadWatch) return;
  if (!session.roster.length) return;
  if (session.roster.every((p) => p.loaded)) hostBegin();
}

function hostBegin() {
  clearTimeout(loadWatch);
  loadWatch = null;
  session.net?.broadcast(MSG.BEGIN, {}, true);
  if (run) run.begun = true;
  for (const p of session.roster) p.loaded = false;
}

/**
 * Nobody waits forever for a straggler.
 *
 * A client whose tab was throttled, whose bake stalled, or that crashed during
 * load simply never sends LOADED, and the old code left everybody frozen on the
 * loading screen with no way out. START is re-sent once in case it was missed
 * while the client was still setting up its handlers, and after that the run
 * begins without them.
 */
function hostWatchLoading(difficultyId, seed) {
  clearTimeout(loadWatch);
  const resend = setTimeout(() => {
    for (const p of session.roster) {
      if (!p.loaded && p.id !== session.localId) {
        session.net?.send(p.id, MSG.START, { difficultyId, seed }, true);
      }
    }
  }, 6000);
  loadWatch = setTimeout(() => {
    clearTimeout(resend);
    const stuck = session.roster.filter((p) => !p.loaded && p.id !== session.localId);
    for (const p of stuck) {
      session.net?.kick(p.id, 'You did not finish loading in time.');
      session.roster = session.roster.filter((r) => r.id !== p.id);
    }
    if (stuck.length) broadcastLobby();
    hostBegin();
  }, 35000);
}

function broadcastLobby() {
  session.net?.broadcast(MSG.LOBBY, {
    roster: session.roster.map((p) => ({
      // Deliberately not sid. It is a persistent browser identifier, it is only
      // ever the host's business, and nothing on a client reads it.
      id: p.id, name: p.name, ready: p.ready, char: p.char,
    })),
    difficultyId: session.difficultyId,
  }, true);
  if (currentScreen === 'select') renderSelect();
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/** Names arrive over the wire, so they are neither trusted nor unbounded. */
function cleanName(raw) {
  const clean = String(raw ?? '')
    // Control characters, then the invisible ones: zero-width joiners and
    // bidirectional overrides let a name render as somebody else's, or as
    // nothing at all. Everything reaches the DOM through textContent, so this
    // is about impersonation and legibility rather than script injection.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return clean || 'Someone';
}

function showMenuError(msg) {
  el.menuError.textContent = msg;
  el.menuError.classList.remove('hidden');
}

function difficultyCard(d, selected) {
  const card = document.createElement('button');
  card.className = 'card' + (selected ? ' selected' : '');
  const n = document.createElement('span'); n.className = 'card-name'; n.textContent = d.label;
  const b = document.createElement('span'); b.className = 'card-blurb'; b.textContent = d.blurb;
  const m = document.createElement('span'); m.className = 'card-meta';
  m.textContent = `${d.grid[0] * d.grid[1]} rooms · ${d.lootCount} things worth taking · pays ×${d.payoutMultiplier}`;
  card.append(n, b, m);
  return card;
}

function renderModes() {
  el.modeCards.innerHTML = '';
  for (const d of DIFFICULTIES) {
    const card = difficultyCard(d, d.id === session.difficultyId);
    card.addEventListener('click', () => {
      session.difficultyId = d.id;
      renderModes();
      if (isNet() && isHost()) broadcastLobby();
    });
    el.modeCards.appendChild(card);
  }
  show('modes');
}

function renderSelect() {
  const chosen = characterById(session.character);
  ensureCharRoom().show(chosen);

  el.charName.textContent = chosen.name;
  el.charTag.textContent = chosen.tag;
  el.charPassive.textContent = chosen.passive;
  el.charAbility.textContent = chosen.ability;
  el.charAbilityText.textContent = chosen.abilityText;
  el.charKey.textContent = actionLabel('power') +
    (chosen.cooldown ? ` · ${chosen.cooldown}s cooldown` : ' · once per run');

  el.charList.innerHTML = '';
  for (const c of CHARACTERS) {
    const b = document.createElement('button');
    const locked = !owns(c.id);
    b.className = 'char-chip' + (c.id === session.character ? ' selected' : '') + (locked ? ' locked' : '');
    b.style.setProperty('--chip', `#${c.color.toString(16).padStart(6, '0')}`);
    const dot = document.createElement('i');
    const label = document.createElement('span');
    label.textContent = c.name.replace(/^The /, '') + (locked ? ' \u2014 locked' : '');
    b.append(dot, label);

    // Who else is on this character right now.
    const takers = session.roster.filter((p) => p.char === c.id && p.id !== session.localId);
    if (takers.length) {
      const who = document.createElement('em');
      who.textContent = takers.map((t) => t.name).join(', ');
      b.appendChild(who);
    }
    b.addEventListener('click', () => pickCharacter(c.id));
    el.charList.appendChild(b);
  }

  el.houseName.textContent = difficultyById(session.difficultyId).label;
  el.changeHouse.classList.toggle('hidden', isNet() && !isHost());

  el.roster.innerHTML = '';
  const list = isNet() ? session.roster : [{ id: 'solo', name: session.name, char: session.character, ready: true }];
  list.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'player-row' + (p.ready ? ' is-ready' : '');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = `#${PLAYER_COLORS[i % PLAYER_COLORS.length].toString(16).padStart(6, '0')}`;
    const nm = document.createElement('span');
    nm.textContent = p.name + (p.id === session.localId ? ' (you)' : '');
    const ch = document.createElement('em');
    ch.textContent = characterById(p.char ?? DEFAULT_CHARACTER).name.replace(/^The /, '');
    const st = document.createElement('b');
    st.textContent = p.ready ? 'ready' : '…';
    row.append(dot, nm, ch, st);

    // kickPlayer() has existed since the room did and nothing ever called it,
    // which is why the host could not remove anybody. Only the host sees this,
    // and never against themselves.
    if (isNet() && isHost() && p.id !== session.localId) {
      const kick = document.createElement('button');
      kick.className = 'kick';
      kick.type = 'button';
      kick.title = `Remove ${p.name}`;
      kick.setAttribute('aria-label', `Remove ${p.name}`);
      kick.textContent = '\u00d7';
      kick.addEventListener('click', (e) => {
        e.stopPropagation();
        // One tap arms it, the second does it. A misplaced click throwing
        // somebody out of a room they queued for is not recoverable.
        if (kick.dataset.armed !== '1') {
          kick.dataset.armed = '1';
          kick.textContent = 'remove?';
          kick.classList.add('armed');
          setTimeout(() => {
            if (!kick.isConnected) return;
            kick.dataset.armed = '0';
            kick.textContent = '\u00d7';
            kick.classList.remove('armed');
          }, 2600);
          return;
        }
        kickPlayer(p.id, p.name);
      });
      row.appendChild(kick);
    }

    el.roster.appendChild(row);
  });

  el.codeLine.classList.toggle('hidden', !isNet());
  el.code.textContent = session.net?.code ?? '—';
  // In a room this abandons it; solo it is just a step back to the houses.
  el.selectBack.textContent = isNet() ? 'Leave' : 'Back';
  el.readyBtn.classList.toggle('hidden', !isNet());
  el.readyBtn.textContent = session.ready ? 'Not ready' : 'Ready';
  el.startBtn.classList.toggle('hidden', isNet() && !isHost());

  const allReady = !isNet() || session.roster.every((p) => p.ready);
  el.startBtn.disabled = isNet() && !allReady;
  el.selectHint.textContent = !isNet()
    ? 'Pick someone and go in. Drag the figure to look at them.'
    : isHost() ? (allReady ? 'Everyone is ready.' : 'Waiting for everyone to say ready.')
               : 'The host decides when you go in.';

  show('select');
}

/**
 * Everyone we should be trying to hear.
 *
 * NOT net.conns. On a client that map holds exactly one entry, the host — so
 * anything driving voice off it only ever reaches the host and never the other
 * four players. The roster is the only list that means the same thing on every
 * machine.
 */
function voicePeerIds() {
  if (!session.net) return [];
  const ids = session.roster.map((p) => p.id).filter((id) => id && id !== session.localId);
  // Before the first LOBBY lands the host has connections but no roster yet.
  return ids.length ? ids : [...session.net.conns.keys()].filter((id) => id !== session.localId);
}

function kickPlayer(id, name) {
  if (!isHost() || !session.net) return;
  session.net.kick(id, 'The host removed you from the room.');
  session.roster = session.roster.filter((p) => p.id !== id);
  voice.forget(id);
  if (run) {
    const r = run.remotes.get(id);
    if (r) { r.dispose(run.scene); run.remotes.delete(id); }
    run.downTimers.delete(id);
  }
  el.selectHint.textContent = `${name} was removed.`;
  broadcastLobby();
}

function pickCharacter(id) {
  if (!owns(id)) {
    el.selectHint.textContent = `${characterById(id).name} is locked \u2014 ${priceOf(id).toLocaleString()} shards in the shop.`;
    return;
  }
  session.character = id;
  if (isNet()) {
    const me = meInRoster();
    if (me) me.char = id;
    if (isHost()) broadcastLobby();
    else session.net.toHost(MSG.CHAR, { char: id }, true);
  }
  renderSelect();
}

// The room is shared and cheap to keep; only stop drawing it.
function closePreview() {}

let shopSelected = null;

function renderShop() {
  el.shopBank.textContent = Bank.read().toLocaleString();
  shopSelected = shopSelected ?? session.character;

  // The same room the character screen uses. Nobody should have to spend
  // 2,200 shards on a silhouette they have only seen as a coloured dot.
  const shown = characterById(shopSelected);
  ensureCharRoom().show(shown);
  el.shopName.textContent = shown.name;
  el.shopTag.textContent = shown.tag;

  el.shopList.innerHTML = '';
  for (const c of CHARACTERS) {
    const owned = owns(c.id);
    const price = priceOf(c.id);
    // A div, not a button. Clicking the description should never spend
    // anything — buying is its own explicit control.
    const card = document.createElement('div');
    card.className = 'card shop-card' + (owned ? ' owned' : '')
      + (c.id === shopSelected ? ' shown' : '');
    // Clicking the card previews. Buying is the button, and only the button.
    card.addEventListener('click', () => { shopSelected = c.id; renderShop(); });
    card.style.setProperty('--chip', `#${c.color.toString(16).padStart(6, '0')}`);

    const text = document.createElement('div');
    text.className = 'shop-text';
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = c.name;
    const blurb = document.createElement('span');
    blurb.className = 'card-blurb';
    blurb.textContent = `${c.passive} ${c.ability}: ${c.abilityText}`;
    text.append(name, blurb);

    const side = document.createElement('div');
    side.className = 'shop-side';
    const meta = document.createElement('span');
    meta.className = 'card-meta';
    meta.textContent = owned
      ? (price === 0 ? 'free forever' : 'owned')
      : `${price.toLocaleString()} shards`;
    side.appendChild(meta);

    if (!owned) {
      const buyBtn = document.createElement('button');
      const affordable = Bank.read() >= price;
      buyBtn.className = 'btn shop-buy' + (affordable ? ' primary' : '');
      buyBtn.textContent = affordable ? 'Buy' : 'Too few shards';
      buyBtn.disabled = !affordable;
      buyBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const result = buy(c.id, Bank);
        el.shopNote.textContent = result === 'bought'
          ? `${c.name} is yours.`
          : `You need ${(price - Bank.read()).toLocaleString()} more.`;
        // Both, not just the equip: buying The Warden from its own button while
        // previewing The Nurse used to leave you owning and wearing one while
        // still looking at the other.
        if (result === 'bought') { session.character = c.id; shopSelected = c.id; }
        renderShop();
        el.bank.textContent = Bank.read().toLocaleString();
      });
      side.appendChild(buyBtn);
    }

    card.append(text, side);
    el.shopList.appendChild(card);
  }
}

function refreshAdEarn() {
  if (!adsEnabled()) { el.adEarn.classList.add('hidden'); return; }
  el.adEarn.classList.remove('hidden');
  const left = menuCooldownLeft();
  el.adEarn.disabled = left > 0;
  el.adEarnNote.textContent = left > 0
    ? `${left}s`
    : `+${AD_CONFIG.menuReward}`;
}

el.adEarn.addEventListener('click', async () => {
  if (menuCooldownLeft() > 0) return;
  el.adEarn.disabled = true;
  const result = await playAd('menu-earn', 'Earning shards');
  if (result === 'viewed') {
    markMenuAdWatched();
    Bank.write(Bank.read() + AD_CONFIG.menuReward);
    el.bank.textContent = Bank.read().toLocaleString();
    if (currentScreen === 'shop') renderShop();
  }
  refreshAdEarn();
});

$('open-shop').addEventListener('click', () => { renderShop(); show('shop'); });
$('shop-back').addEventListener('click', () => buildMenu());

setInterval(() => {
  if (currentScreen === 'menu' || currentScreen === 'shop') refreshAdEarn();
}, 1000);

function buildMenu() {
  disposeRun();
  closePreview();
  el.bank.textContent = Bank.read().toLocaleString();
  el.menuError.classList.add('hidden');
  refreshAdEarn();
  show('menu');
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

const settingsUI = buildSettingsUI({
  isTouch: TOUCH,
  onChange: () => { applyGraphics(); applyAudio(); if (run) el.promptKeys.innerHTML = promptText(); },
  onTest: (key) => { audio.resume(); if (key === 'sfx' || key === 'master') audio.pickup(60); },
  // The store has already been reset by the time this fires; the live buttons
  // have not, and they are sitting behind the settings screen waiting.
  onTouchReset: () => touchControls?.applyLayout(),
});

$('go-solo').addEventListener('click', () => {
  // Solo has nobody to show a name to, so it is never asked for.
  session.name = settings.data.name || 'You';
  session.mode = 'solo';
  session.localId = 'solo';
  session.roster = [{ id: 'solo', name: session.name, ready: true, char: session.character }];
  audio.resume();
  renderModes();
});

$('go-multiplayer').addEventListener('click', () => {
  el.name.value = settings.data.name;
  el.menuError.classList.add('hidden');
  show('multiplayer');
  setTimeout(() => el.name.focus(), 40);
});

function takeName(fallback) {
  const v = el.name.value.trim();
  session.name = v || fallback;
  settings.data.name = session.name;
  settings.save();
  return session.name;
}

$('open-controls').addEventListener('click', () => { settingsUI.openTab('controls'); show('settings'); });
$('open-audio').addEventListener('click', () => { settingsUI.openTab('audio'); show('settings'); });
$('open-graphics').addEventListener('click', () => { settingsUI.openTab('graphics'); show('settings'); });
$('open-about').addEventListener('click', () => show('about'));
$('settings-back').addEventListener('click', () => {
  // The world keeps running behind the settings screen, which is the only
  // correct behaviour in multiplayer — a pause everyone else does not share
  // would just be a way to get killed while reading a slider.
  if (run && !run.over) { show(null); return; }
  buildMenu();
});
$('ingame-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  settingsUI.openTab('controls');
  show('settings');
});
// The same door, but always on screen. The prompt one only exists on desktop
// and only while the mouse is free, so on a phone — no Escape key, no prompt —
// settings were unreachable from the moment a run started, which also meant
// the on-screen controls could not be moved without quitting to the menu.
el.ingameMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!run || run.over) return;
  settingsUI.openTab(TOUCH ? 'controls' : 'graphics');
  show('settings');
});
$('about-back').addEventListener('click', () => buildMenu());
$('mp-back').addEventListener('click', () => { dropNet(); buildMenu(); });
$('modes-back').addEventListener('click', () => (isNet() ? renderSelect() : buildMenu()));

$('exit').addEventListener('click', () => {
  // A page cannot close itself unless a script opened it, so this is honest
  // about what it can do rather than silently failing.
  voice.shutdown();
  session.net?.destroy();
  disposeRun();
  el.farewellBank.textContent = Bank.read().toLocaleString();
  show('farewell');
  setTimeout(() => { try { window.close(); } catch { /* not permitted */ } }, 120);
});
$('farewell-back').addEventListener('click', () => buildMenu());

// The lobby had no way out at all: no Back button, and Escape did not cover
// this screen. The only exits were starting the run or reloading the page —
// and reloading is exactly the new-peer-id-same-session-id case that used to
// put somebody in the roster twice.
$('select-back').addEventListener('click', () => {
  if (isNet()) { dropNet(); buildMenu(); return; }
  renderModes();
});

el.modeContinue.addEventListener('click', () => {
  if (isNet() && isHost()) broadcastLobby();
  renderSelect();
});

/**
 * Let go of the room.
 *
 * Exactly one Net may be live at a time. A second Peer is a second peer id, and
 * to the host that is a second player — so leaving a lobby, or opening a new
 * connection, has to close the old one rather than merely stop referring to it.
 * The heartbeat interval in particular kept a dead connection warm, which is
 * why the host never timed the old entry out.
 */
function dropNet() {
  clearInterval(voiceRetry);
  voiceRetry = null;
  voice.shutdown();
  try { session.net?.destroy(); } catch { /* already down */ }
  session.net = null;
  session.mode = 'solo';
  session.roster = [];
  session.ready = false;
  roomLocked = false;
}

/**
 * Opening a room can take twelve seconds. Without this an impatient second
 * click builds a second Peer with the same session id, and both arrive.
 */
let netBusy = false;
function setNetBusy(busy) {
  netBusy = busy;
  $('host-btn').disabled = busy;
  $('join-btn').disabled = busy;
}

$('host-btn').addEventListener('click', async () => {
  if (netBusy) return;
  setNetBusy(true);
  takeName('Host');
  audio.resume();
  dropNet();
  const net = new Net();
  wireNet(net);
  try {
    await net.hostGame(session.name);
    session.net = net;
    session.mode = 'host';
    session.localId = net.id;
    session.roster = [{ id: net.id, sid: sessionId(), name: session.name, ready: false, char: session.character }];
    net.startHeartbeat();
    await requestMic();
    renderModes();
  } catch {
    // A rejected promise does not close the Peer, and a Peer left running will
    // still open and announce itself later.
    try { net.destroy(); } catch { /* never opened */ }
    show('multiplayer');
    showMenuError('Could not open a room. The signalling server may be busy.');
  } finally {
    setNetBusy(false);
  }
});

$('join-btn').addEventListener('click', async () => {
  if (netBusy) return;
  const code = el.joinCode.value.trim().toUpperCase();
  if (code.length < 4) { showMenuError('That code looks too short.'); return; }
  setNetBusy(true);
  takeName('Guest');
  audio.resume();
  dropNet();
  const net = new Net();
  wireNet(net);
  try {
    await net.joinGame(code, session.name);
    session.net = net;
    session.mode = 'client';
    session.localId = net.id;
    net.startHeartbeat();
    await requestMic();
    renderSelect();
  } catch (err) {
    // The twelve second timeout rejects the promise but leaves the Peer alive:
    // it would open at thirteen seconds and greet the host, by which point the
    // player has already pressed Join again and the host sees both.
    try { net.destroy(); } catch { /* never opened */ }
    showMenuError(err?.message ?? 'Could not reach that house.');
  } finally {
    setNetBusy(false);
  }
});

el.readyBtn.addEventListener('click', () => {
  session.ready = !session.ready;
  const me = meInRoster();
  if (me) me.ready = session.ready;
  if (isHost()) broadcastLobby(); else session.net.toHost(MSG.CHAR, { ready: session.ready }, true);
  renderSelect();
});

el.startBtn.addEventListener('click', () => {
  if (isNet() && !isHost()) return;         // only the host may commit
  closePreview();
  roomLocked = true;
  const seed = (Math.random() * 1e9) | 0;
  if (isNet()) {
    for (const p of session.roster) p.loaded = false;
    session.net.broadcast(MSG.START, { difficultyId: session.difficultyId, seed }, true);
    hostWatchLoading(session.difficultyId, seed);
  }
  startRun(difficultyById(session.difficultyId), seed);
});

el.changeHouse.addEventListener('click', () => { closePreview(); renderModes(); });

async function requestMic() {
  const ok = await voice.enable();
  updateMicUI();
  return ok;
}

function updateMicUI() {
  const state = !voice.enabled
    ? (voice.denied ? 'denied' : 'off')
    : voice.muted ? 'muted' : 'live';
  const { failed } = voice.linkReport;
  el.micState.textContent = failed && voice.enabled
    ? `${state} · ${failed} unreachable`
    : state;
  el.mic.classList.toggle('off', state !== 'live');
  el.micHelp.classList.toggle('hidden', state !== 'denied');
}

el.mic.addEventListener('click', async () => {
  if (!voice.enabled) {
    const ok = await requestMic();
    if (ok && session.net) voice.callAll(session.net.peer, voicePeerIds());
    return;
  }
  voice.setMuted(!voice.muted);
  updateMicUI();
});
voice.onStatus = () => updateMicUI();

el.again.addEventListener('click', () => {
  const seed = (Math.random() * 1e9) | 0;
  if (isNet() && isHost()) {
    roomLocked = true;
    for (const p of session.roster) p.loaded = false;
    session.net.broadcast(MSG.START, { difficultyId: session.difficultyId, seed }, true);
    hostWatchLoading(session.difficultyId, seed);
    startRun(difficultyById(session.difficultyId), seed);
  } else if (!isNet()) {
    startRun(run.difficulty, seed);
  }
});

el.menuBtn.addEventListener('click', () => {
  if (isNet()) {
    // Back in the lobby: the room takes people again.
    if (isHost()) roomLocked = false;
    disposeRun();
    renderSelect();
    return;
  }
  buildMenu();
});

/** Nag only while actually playing, and only when the lock did not take. */
function checkRotate() {
  const playing = TOUCH && run && !run.over && currentScreen === null;
  el.rotate.classList.toggle('hidden', !(playing && isPortrait()));
}
if (TOUCH) {
  window.addEventListener('orientationchange', () => setTimeout(checkRotate, 250));
  window.addEventListener('resize', () => setTimeout(checkRotate, 120));
}

// ---------------------------------------------------------------------------
// Moving the on-screen controls
// ---------------------------------------------------------------------------

// True while the editor is standing in for a screen rather than sitting on top
// of one, i.e. the walkthrough the first house on a phone opens with.
let touchFirstRun = false;
// Which screen to put back when the editor closes, or null if we were already
// looking at the world.
let touchReturnScreen = null;

function openTouchEditor({ firstRun = false } = {}) {
  if (!TOUCH) return;
  touchFirstRun = firstRun;

  // Get out of the way of the thing being edited.
  //
  // The on-screen buttons live at z-index 14 and every settings screen is at
  // 30, so opening this from Settings put the panel in front of buttons that
  // were themselves behind an opaque screen — you could see the sliders and
  // nothing to point them at. Drop to the world (or the menu backdrop), and
  // put the screen back on the way out.
  touchReturnScreen = currentScreen;
  if (currentScreen !== null) show(null);
  touchControls = touchControls ?? new TouchControls($('touch'));
  touchControls.applyLayout();
  touchControls.setEditMode(true);
  touchControls.onSelect = (id) => {
    el.teWhich.textContent = `Resizing ${id}`;
    $('te-size').value = String(settings.data.touch.layout[id].size);
    $('te-size-value').textContent = `${$('te-size').value}px`;
  };
  $('touch').classList.remove('hidden');
  el.touchEdit.classList.remove('hidden');
  // Clear anything a previous drag left behind, so the panel always opens
  // somewhere sensible rather than wherever it was last shoved.
  el.touchEdit.style.left = '';
  el.touchEdit.style.top = '';
  el.touchEdit.style.bottom = '';
  el.touchEdit.style.transform = '';
  el.touchEdit.classList.toggle('first-run', firstRun);
  el.touchFirst.classList.toggle('hidden', !firstRun);
  el.teDone.textContent = firstRun ? 'Save and play' : 'Done';
  el.teWhich.textContent = firstRun ? 'Drag a button to move it' : 'Nothing selected';
  // These live at z-index 32, under a #touch-first that passes taps straight
  // through on purpose. Leaving them there means a thumb reaching for a
  // control it is about to move opens fullscreen instead.
  el.ingameMenu.classList.add('hidden');
  $('fullscreen').classList.add('hidden');

  // Nothing should be hunting them while they arrange their thumbs. Solo can
  // simply stop; multiplayer cannot, because a pause nobody else shares is
  // just a way to get killed reading a slider, so there the house keeps going
  // and the walkthrough is something they can dismiss in two taps.
  if (firstRun && run && !run.over && !isNet()) {
    run.frozenForLayout = true;
    run.begun = false;
  }
}

function closeTouchEditor() {
  touchControls?.setEditMode(false);
  el.touchEdit.classList.add('hidden');
  el.touchEdit.classList.remove('first-run');
  el.touchFirst.classList.add('hidden');
  el.teDone.textContent = 'Done';
  // Back to wherever we came from. show() re-toggles the touch layer, the HUD
  // and the corner buttons for us, so this has to come before we read them.
  if (touchReturnScreen !== null) show(touchReturnScreen);
  touchReturnScreen = null;

  $('touch').classList.toggle('hidden', !(TOUCH && currentScreen === null));
  const playing = currentScreen === null && run && !run.over;
  el.ingameMenu.classList.toggle('hidden', !playing);
  $('fullscreen').classList.toggle('hidden', !playing);

  if (touchFirstRun) {
    // Asked once, whether or not they moved anything. Somebody happy with the
    // defaults has still made a choice.
    settings.data.touch.layoutChosen = true;
    touchFirstRun = false;
  }
  if (run && run.frozenForLayout) {
    run.frozenForLayout = false;
    run.begun = true;
    // The clock has been stopped for however long they spent in here. Without
    // this the next frame integrates the whole of it in one step.
    lastFrame = performance.now();
  }
  settings.save();
}

/**
 * The first house on a phone opens with the buttons in your hands.
 *
 * Every mobile game does this and for the same reason: a layout that suits one
 * pair of thumbs suits nobody else's, and the only moment a player can judge
 * it is with the real buttons over the real room. Asked once, then never
 * again — the flag lives in settings, so it survives a reload.
 */
function maybeFirstRunLayout() {
  if (!TOUCH || settings.data.touch.layoutChosen) return;
  openTouchEditor({ firstRun: true });
}

function syncTouchSliders() {
  const t = settings.data.touch;
  $('te-opacity').value = String(Math.round(t.opacity * 100));
  $('te-opacity-value').textContent = `${$('te-opacity').value}%`;
  $('te-landscape').checked = !!t.lockLandscape;
  const sel = touchControls?.selected;
  $('te-size').value = String(sel ? t.layout[sel].size : 70);
  $('te-size-value').textContent = sel ? `${$('te-size').value}px` : '—';
}

$('te-size').addEventListener('input', (e) => {
  const sel = touchControls?.selected;
  if (!sel) { el.teWhich.textContent = 'Tap a button first'; return; }
  settings.data.touch.layout[sel].size = Number(e.target.value);
  $('te-size-value').textContent = `${e.target.value}px`;
  touchControls.applyLayout();
});
$('te-opacity').addEventListener('input', (e) => {
  settings.data.touch.opacity = Number(e.target.value) / 100;
  $('te-opacity-value').textContent = `${e.target.value}%`;
  touchControls?.applyLayout();
});
$('te-landscape').addEventListener('change', (e) => {
  settings.data.touch.lockLandscape = e.target.checked;
  settings.save();
});
$('te-done').addEventListener('click', closeTouchEditor);
$('te-reset').addEventListener('click', () => {
  settings.resetTouchLayout();
  touchControls?.applyLayout();
  syncTouchSliders();
});

// ---------------------------------------------------------------------------
// Dragging the editor panel itself.
//
// It covers the buttons it is there to arrange — unavoidable on a phone-sized
// screen — so the answer is to let it be shoved out of the way rather than to
// guess a corner that is always free. Pointer events, so a mouse and a thumb
// take the same path, and clamped to the viewport so it can never be parked
// somewhere it cannot be dragged back from.
// ---------------------------------------------------------------------------

(() => {
  const panel = el.touchEdit;
  const grip = $('te-grip');
  let drag = null;

  grip.addEventListener('pointerdown', (e) => {
    const r = panel.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
    grip.setPointerCapture?.(e.pointerId);
    grip.classList.add('dragging');
    // The first-run variant is centred with a transform. Once it is being
    // dragged it is positioned outright, or the transform fights every move.
    panel.classList.remove('first-run');
    panel.style.transform = 'none';
    panel.style.left = `${r.left}px`;
    panel.style.top = `${r.top}px`;
    panel.style.bottom = 'auto';
    e.preventDefault();
  });

  grip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = panel.getBoundingClientRect();
    // Keep the grip itself reachable: at least a strip of the panel stays on
    // screen on every side.
    const maxX = window.innerWidth - 44;
    const maxY = window.innerHeight - 30;
    panel.style.left = `${Math.min(maxX, Math.max(44 - r.width, e.clientX - drag.dx))}px`;
    panel.style.top = `${Math.min(maxY, Math.max(0, e.clientY - drag.dy))}px`;
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    grip.classList.remove('dragging');
  };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);
})();

$('open-touch-edit').addEventListener('click', openTouchEditor);
$('open-touch-edit').classList.toggle('hidden', !TOUCH);

// Fullscreen. Requires a user gesture, so it is a button and a key press
// rather than a setting that could be applied on load.
function toggleFullscreen() {
  const doc = document;
  if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
    const root = doc.documentElement;
    (root.requestFullscreen ?? root.webkitRequestFullscreen)?.call(root)?.catch?.(() => {});
  } else {
    (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc)?.catch?.(() => {});
  }
}
for (const id of ['fullscreen', 'fullscreen-menu', 'fullscreen-settings']) {
  $(id)?.addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
}

/**
 * Let the mouse go, or take it back.
 *
 * Escape always releases the pointer — that is the browser's own behaviour and
 * cannot be reassigned — but it only goes one way, so getting back in meant
 * clicking. This is the same toggle in both directions.
 */
function toggleCursor() {
  if (document.pointerLockElement) { document.exitPointerLock?.(); return; }
  // Only take it back if there is actually a game to look at.
  if (!run || run.over || currentScreen !== null) return;
  if (run.minigame || run.boardOpen) return;
  const r = canvas.requestPointerLock();
  if (r && typeof r.catch === 'function') r.catch(() => {});
}

/**
 * Fullscreen and cursor release, handled globally.
 *
 * These used to hang off the Player, which meant they only existed while a run
 * was up and only if that object had been wired correctly. They are window
 * concerns, not player concerns, so they live here and work everywhere.
 */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const action = settings.actionFor(e.code);
  if (action !== 'fullscreen' && action !== 'cursor') return;
  e.preventDefault();
  if (action === 'fullscreen') toggleFullscreen();
  else toggleCursor();
});

// One Escape handler for every overlay. Pointer lock consumes its own Escape
// before this ever sees it, so releasing the mouse and closing a panel never
// happen on the same press.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (run?.minigame) { closeTerminal(); return; }
  if (run?.boardOpen) { closeBoard(); return; }
  if (currentScreen === 'settings' || currentScreen === 'about') {
    e.preventDefault();
    (run && !run.over) ? show(null) : buildMenu();
    return;
  }
  if (currentScreen === 'select') {
    e.preventDefault();
    if (isNet()) { dropNet(); buildMenu(); } else renderModes();
    return;
  }
  if (currentScreen === 'multiplayer' || currentScreen === 'modes') {
    e.preventDefault();
    if (currentScreen === 'modes' && isNet()) { renderSelect(); return; }
    dropNet();
    buildMenu();
  }
});

// Clicking away from an open terminal walks away from it.
$('tv').addEventListener('mousedown', (e) => {
  if (e.target === $('tv')) closeTerminal();
});
$('board').addEventListener('mousedown', (e) => {
  if (e.target === $('board')) closeBoard();
});

// Any interaction at all is a chance to un-stick audio the browser refused to
// start on its own. Cheap, idempotent, and it covers the case where somebody
// joined before this tab had ever been clicked — which used to lose that
// player's voice permanently.
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, () => {
    audio.resume();
    if (voice.enabled) voice.resumeBlocked();
  }, { passive: true });
}

document.addEventListener('click', (ev) => {
  if (TOUCH) return;                       // nothing to lock; the stick handles it
  if (!run || run.over || document.pointerLockElement) return;
  if (run.minigame || run.boardOpen) return;
  if (ev.target.closest('button, input, label, a')) return;
  if (currentScreen !== null) return;
  const r = canvas.requestPointerLock();
  if (r && typeof r.catch === 'function') r.catch(() => {});
});

if (!owns(session.character)) session.character = firstOwned();
initAds();
// A backgrounded tab still has to simulate in multiplayer — the host cannot
// pause for everyone else — but it should not be making noise or holding the
// cursor. Solo genuinely stops.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    audio.silence();
    try { document.exitPointerLock?.(); } catch { /* not locked */ }
  } else {
    lastFrame = performance.now();     // do not integrate the whole absence
  }
});

// Leave cleanly: a peer that vanishes without closing sits in someone else's
// roster until the heartbeat times it out.
window.addEventListener('pagehide', () => {
  try { voice.shutdown(); } catch { /* already down */ }
  try { session.net?.destroy(); } catch { /* already gone */ }
  if (TOUCH) unlockOrientation();
});

const buildTag = document.getElementById('build');
if (buildTag) buildTag.textContent = `v${BUILD}`;

applyGraphics();
applyAudio();
buildMenu();
requestAnimationFrame(menuTick);
// The diorama shares the texture load with the first house, so this warms
// both. It appears a moment after the menu rather than holding it up.
ensureMenuScene();
