import * as THREE from 'three';
import { buildFigure } from './preview.js';
import { instanceScaled } from './models.js';

// ---------------------------------------------------------------------------
// The character room.
//
// A whole dark room rather than a thumbnail on a panel. Shop and character
// select both render into it full screen, with the list overlaid on the left
// and the figure standing to the right of centre, so you look at somebody in a
// place rather than a cut-out on a page.
//
// It replaces the two small canvases those screens used to carry. Three live
// WebGL contexts on a phone is a real cost — browsers cap them and quietly
// drop the oldest — so consolidating is worth more than the code it saves.
//
// Real lights here, unlike the house: it is six boxes and one figure, and the
// baked pipeline has nothing to offer at that size.
// ---------------------------------------------------------------------------

const ROOM_W = 7.0;
const ROOM_D = 6.5;
const ROOM_H = 3.2;
const T = 0.25;

export class CharacterRoom {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.time = 0;
    this.yaw = 0.45;
    this.spin = true;
    this.dragging = false;
    this.lastX = 0;
    this.offsetX = 1.15;

    this.figure = new THREE.Group();
    this.scene.add(this.figure);
    this._build();
  }

  _build() {
    const wall = new THREE.MeshStandardMaterial({ color: 0x2b2119, roughness: 0.96 });
    const floor = new THREE.MeshStandardMaterial({ color: 0x241b12, roughness: 1.0 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x1a130c, roughness: 1.0 });

    const box = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };

    box(ROOM_W, T, ROOM_D, 0, -T / 2, 0, floor);
    box(ROOM_W, T, ROOM_D, 0, ROOM_H, 0, wall);
    box(ROOM_W, ROOM_H, T, 0, ROOM_H / 2, -ROOM_D / 2, wall);
    box(T, ROOM_H, ROOM_D, -ROOM_W / 2, ROOM_H / 2, 0, wall);
    box(T, ROOM_H, ROOM_D, ROOM_W / 2, ROOM_H / 2, 0, wall);

    // Skirting and a picture rail, the same two lines the house shader draws.
    // They are what stop a brown box reading as one continuous surface.
    box(ROOM_W, 0.18, T * 0.5, 0, 0.09, -ROOM_D / 2 + T * 0.6, trim);
    box(ROOM_W, 0.09, T * 0.5, 0, ROOM_H - 0.34, -ROOM_D / 2 + T * 0.6, trim);

    // A doorway behind, so the room has somewhere to be rather than being sealed.
    const gap = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 2.1),
      new THREE.MeshBasicMaterial({ color: 0x0a0d12 }),
    );
    gap.position.set(-2.1, 1.05, -ROOM_D / 2 + T * 0.62);
    this.scene.add(gap);

    // One warm lamp low and to the side does more for a silhouette than any
    // three-point rig; the cold fill behind separates them from the back wall.
    this.lamp = new THREE.PointLight(0xffb066, 16, 11, 2);
    this.lamp.position.set(-0.9, 1.25, 2.0);
    const fill = new THREE.PointLight(0x6f9fd0, 7, 10, 2);
    fill.position.set(2.6, 2.3, -1.6);
    this.scene.add(this.lamp, fill, new THREE.AmbientLight(0x171c22, 1.5));

    this.bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    this.bulb.position.copy(this.lamp.position);
    this.scene.add(this.bulb);

    // Dust, for the same reason the menu has it.
    const N = 220;
    const pos = new Float32Array(N * 3);
    this.seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * ROOM_W * 0.9;
      pos[i * 3 + 1] = Math.random() * ROOM_H;
      pos[i * 3 + 2] = (Math.random() - 0.5) * ROOM_D * 0.9;
      this.seeds[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffe0b0, size: 0.03, transparent: true, opacity: 0.5,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.scene.add(this.dust);
  }

  show(character) {
    this.figure.clear();
    // A supplied player.glb if there is one; the primitive silhouette if not.
    const model = instanceScaled('player', 1.75);
    this.figure.add(model ?? buildFigure(character));
    this.character = character;

    // Tint the lamp towards the character, so each one owns the room a little.
    this.lamp.color.setHex(character.color).lerp(new THREE.Color(0xffb066), 0.55);
    this.bulb.material.color.copy(this.lamp.color);
  }

  /**
   * The list sits on the left on a wide screen, so the figure stands right of
   * centre. On a narrow one the list is full width, so it goes back to middle.
   */
  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.offsetX = w > 900 ? 1.15 : 0;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;

    if (this.spin && !this.dragging) this.yaw += dt * 0.18;
    this.figure.rotation.y = this.yaw;
    this.figure.position.set(this.offsetX, 0, 0);

    // A slow drift, so a still screen is never quite still.
    this.camera.position.set(
      this.offsetX * 0.45 + Math.sin(t * 0.12) * 0.16,
      1.42 + Math.sin(t * 0.17) * 0.05,
      3.15,
    );
    this.camera.lookAt(this.offsetX, 1.02, 0);

    const flicker = 0.9 + 0.1 * Math.sin(t * 2.1) * Math.sin(t * 5.3);
    this.lamp.intensity = 16 * flicker;

    const p = this.dust.geometry.attributes.position;
    for (let i = 0; i < this.seeds.length; i++) {
      let y = p.getY(i) + (0.03 + (this.seeds[i] % 1) * 0.04) * dt;
      if (y > ROOM_H) y -= ROOM_H;
      p.setY(i, y);
    }
    p.needsUpdate = true;
  }

  /** Wire drag-to-turn onto whatever element sits over the room. */
  bindDrag(el) {
    if (this._bound?.has(el)) return;
    (this._bound ??= new Set()).add(el);

    const isBackdrop = (e) => e.target === el;
    el.addEventListener('pointerdown', (e) => {
      if (!isBackdrop(e)) return;      // never steal a click from the list
      this.dragging = true;
      this.spin = false;
      this.lastX = e.clientX;
      el.setPointerCapture?.(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * 0.011;
      this.lastX = e.clientX;
    });
    const up = () => { this.dragging = false; };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dblclick', (e) => { if (isBackdrop(e)) this.spin = true; });
  }

  dispose() {
    this.scene.traverse((o) => {
      if (o.isMesh || o.isPoints) { o.geometry?.dispose(); o.material?.dispose(); }
    });
  }
}
