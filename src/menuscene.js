import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createHouseMaterial, createGlowMaterial, createGhostMaterial, flickerSignal } from './material.js';
import { instance as modelInstance } from './models.js';
import { createBaker } from './bake.js';
import { SURFACE } from './textures.js';
import { CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// The menu diorama.
//
// A short dead-end corridor with a lit doorway at the far end and something on
// a plinth in the middle. It is built out of the same boxes, baked with the
// same light bake, and drawn with the same shader as the house itself, so the
// menu is not a picture of the game — it is a small room in it. That also
// means it costs nothing new: one bake of about 12k vertices and four draw
// calls.
//
// It has its own camera, drifting slowly on two out-of-phase sines so the
// motion never visibly repeats.
// ---------------------------------------------------------------------------

// Narrower and lower than it was, and longer. A tight corridor with something
// standing a long way down it is worse than a wide room with an exhibit in it.
const W = 5.0;        // corridor width
const L = 19.0;       // corridor length, running towards -Z
const H = 3.0;
const T = 0.3;        // wall thickness
const DOOR_W = 1.9;
const DOOR_H = 2.7;

function box(cx, cy, cz, sx, sy, sz, surface, step) {
  const seg = (v) => Math.max(1, Math.round(v / step));
  const g = new THREE.BoxGeometry(sx, sy, sz, seg(sx), seg(sy), seg(sz));
  g.translate(cx, cy, cz);
  g.deleteAttribute('uv');
  g.userData.surface = surface;
  return g;
}

export class MenuScene {
  constructor(surfaces, anisotropy) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 60);
    this.time = 0;
    this.ready = false;

    this.material = createHouseMaterial(surfaces, anisotropy);
    // No torch in the menu: the doorway is the whole light source and a beam
    // following the camera would flatten it.
    this.material.uniforms.uFlashOn.value = 0;
    this.material.uniforms.uFogDensity.value = 0.055;

    this._build(surfaces);
  }

  _build() {
    const step = 0.26;
    const back = -L / 2;
    const front = L / 2;
    const items = [];
    const add = (geo, albedo) => items.push({ geometry: geo, albedo });

    // Floor and ceiling.
    add(box(0, -T / 2, 0, W, T, L, SURFACE.FLOOR, step), 0x3a332c);
    add(box(0, H + T / 2, 0, W, T, L, SURFACE.CEILING, step), 0x241f1b);

    // Side walls.
    add(box(-W / 2 - T / 2, H / 2, 0, T, H, L, SURFACE.WALL, step), 0x4a423a);
    add(box(W / 2 + T / 2, H / 2, 0, T, H, L, SURFACE.WALL, step), 0x4a423a);

    // Far wall, split around the doorway.
    const side = (W - DOOR_W) / 2;
    add(box(-(DOOR_W / 2 + side / 2), H / 2, back, side, H, T, SURFACE.WALL, step), 0x4a423a);
    add(box(+(DOOR_W / 2 + side / 2), H / 2, back, side, H, T, SURFACE.WALL, step), 0x4a423a);
    add(box(0, DOOR_H + (H - DOOR_H) / 2, back, DOOR_W, H - DOOR_H, T, SURFACE.WALL, step), 0x4a423a);

    // A wall behind the camera, so the fog has something to end on.
    add(box(0, H / 2, front, W, H, T, SURFACE.WALL, step), 0x4a423a);

    // A doorframe standing proud of the far wall, so the light has an edge.
    const jamb = 0.22;
    add(box(-(DOOR_W / 2 + jamb / 2), DOOR_H / 2, back + 0.25, jamb, DOOR_H, 0.3, SURFACE.WALL, step), 0x2a2015);
    add(box(+(DOOR_W / 2 + jamb / 2), DOOR_H / 2, back + 0.25, jamb, DOOR_H, 0.3, SURFACE.WALL, step), 0x2a2015);
    add(box(0, DOOR_H + jamb / 2, back + 0.25, DOOR_W + jamb * 2, jamb, 0.3, SURFACE.WALL, step), 0x2a2015);

    // Bake. One strong source spilling through the doorway, plus a low ember
    // behind the camera so the near walls are not pure black.
    // More of them than the house uses, and deliberately so: this is a shop
    // window, not a room you have to be frightened in. The doorway still
    // dominates, but the side walls now read as brick instead of black.
    // The doorway carries almost all of it. Everything nearer the camera is a
    // dying lamp, so the walls read as timber without ever being comfortable —
    // and the figure standing in front of the doorway comes out as a hole in
    // the light rather than a lit-up exhibit.
    const lights = [
      { x: 0, y: 1.6, z: back - 1.1, color: 0xfff2d8, intensity: 11.0, range: 26, flicker: 0 },
      { x: -W / 2 + 0.45, y: 2.4, z: back + 6.0, color: 0xff7a2a, intensity: 1.9, range: 7.5, flicker: 1 },
      { x: W / 2 - 0.45, y: 2.4, z: back + 11.0, color: 0xff8c3a, intensity: 1.6, range: 7.0, flicker: 2 },
      { x: 0, y: 2.5, z: front - 2.6, color: 0xff6a20, intensity: 1.2, range: 7.0, flicker: 1 },
    ];
    const occluders = [
      { minX: -W / 2 - T, maxX: -W / 2, minY: 0, maxY: H, minZ: back, maxZ: front },
      { minX: W / 2, maxX: W / 2 + T, minY: 0, maxY: H, minZ: back, maxZ: front },
      // The doorframe, so the spill through the opening has hard edges.
      { minX: -DOOR_W / 2 - 0.35, maxX: -DOOR_W / 2, minY: 0, maxY: DOOR_H, minZ: back, maxZ: back + 0.4 },
      { minX: DOOR_W / 2, maxX: DOOR_W / 2 + 0.35, minY: 0, maxY: DOOR_H, minZ: back, maxZ: back + 0.4 },
    ];

    const savedStep = CONFIG.bakeStep;
    CONFIG.bakeStep = step;
    const baker = createBaker(items, lights, occluders);
    while (!baker.step(1000));      // ~12k vertices; not worth a progress bar
    CONFIG.bakeStep = savedStep;

    const mesh = new THREE.Mesh(mergeGeometries(items.map((i) => i.geometry)), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    // The light through the doorway, as a flat bright card.
    this.doorGlow = createGlowMaterial(0xfff4dc, { additive: true, depthWrite: false, gain: 2.6 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), this.doorGlow);
    glow.position.set(0, DOOR_H / 2, back - 0.25);
    this.scene.add(glow);

    // The thing itself, hanging over the plinth like an exhibit. Uses the same
    // material the hunters use in game, so the menu is showing you the actual
    // model rather than a stand-in — including your own ghost.glb if you have
    // supplied one.
    this.ghostMat = createGhostMaterial();
    this.ghostMat.uniforms.uRage.value = 0.22;
    const custom = modelInstance('ghost');
    if (custom) {
      this.ghost = custom;
    } else {
      const body = new THREE.CapsuleGeometry(0.40, 1.45, 8, 18);
      body.translate(0, 1.18, 0);
      this.ghost = new THREE.Mesh(body, this.ghostMat);
    }
    // Standing on the floor, well down the corridor, between you and the only
    // real light. No plinth: it is not on display, it is in the way.
    this.ghostHome = back + 4.4;
    this.ghost.position.set(0.35, 0, this.ghostHome);
    this.ghost.frustumCulled = false;
    this.ghost.renderOrder = 2;
    this.scene.add(this.ghost);

    this._buildDust(back, front);
    this.ready = true;
  }

  /**
   * Dust. A single Points object rather than meshes: five hundred motes for
   * one draw call, and it is what sells the shaft of light more than anything
   * else in here.
   */
  _buildDust(back, front) {
    const N = 900;
    const pos = new Float32Array(N * 3);
    this.dustSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * W * 0.92;
      pos[i * 3 + 1] = Math.random() * H;
      pos[i * 3 + 2] = back + Math.random() * (front - back);
      this.dustSeed[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffe0b0, size: 0.035, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;

    // Two out-of-phase sines per axis, so the drift never quite loops.
    this.camera.position.set(
      Math.sin(t * 0.13) * 0.40 + Math.sin(t * 0.31) * 0.12,
      1.52 + Math.sin(t * 0.19) * 0.07,
      L / 2 - 1.6 + Math.sin(t * 0.11) * 0.45,
    );
    this.camera.lookAt(
      Math.sin(t * 0.09) * 0.30,
      1.30 + Math.sin(t * 0.23) * 0.05,
      -L,
    );

    this.material.uniforms.uFlickerA.value = flickerSignal(t, 0);
    this.material.uniforms.uFlickerB.value = flickerSignal(t, 2.7);
    this.doorGlow.uniforms.uTime.value = t;
    if (this.ghostMat) {
      this.ghostMat.uniforms.uTime.value = t;
      // Drifts towards agitated and back, so it is never quite still.
      this.ghostMat.uniforms.uRage.value = 0.20 + 0.18 * (0.5 + 0.5 * Math.sin(t * 0.21));
    }
    // Never quite still, and never quite approaching. It sways, drifts a
    // little nearer over about half a minute, then eases back.
    this.ghost.rotation.y = Math.sin(t * 0.11) * 0.5;
    this.ghost.position.y = Math.sin(t * 0.6) * 0.05;
    this.ghost.position.z = this.ghostHome + Math.sin(t * 0.037) * 2.6;
    this.ghost.position.x = 0.35 + Math.sin(t * 0.08) * 0.5;

    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.dustSeed.length; i++) {
      const s = this.dustSeed[i];
      let y = p.getY(i) + (0.04 + (s % 1) * 0.05) * dt;
      if (y > 3.6) y -= 3.6;
      p.setY(i, y);
      p.setX(i, p.getX(i) + Math.sin(t * 0.4 + s) * 0.0016);
    }
    p.needsUpdate = true;
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) {
        o.geometry?.dispose();
        o.material?.dispose();
      }
    });
  }
}
