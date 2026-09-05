import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Character preview.
//
// Its own small renderer on its own canvas rather than a corner of the game
// view: the selection screen is a DOM overlay, and threading a second camera
// through the main render loop just to draw a mannequin costs more complexity
// than a second context costs performance. It is created when the screen opens
// and disposed when it closes, so there is never a spare context during play.
//
// Unlike the maze, this scene uses real lights. Nothing here is baked, it is
// six triangle-thin figures on a turntable, and standard materials look far
// better than the unlit shader the house needs.
// ---------------------------------------------------------------------------

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40);
    this.camera.position.set(0, 1.15, 4.6);
    this.camera.lookAt(0, 0.95, 0);

    const key = new THREE.DirectionalLight(0xfff0dd, 2.1);
    key.position.set(2.5, 4, 3);
    const rim = new THREE.DirectionalLight(0x7fb4ff, 1.5);
    rim.position.set(-3, 2, -2.5);
    this.scene.add(key, rim, new THREE.AmbientLight(0x404a58, 1.1));

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x11151c, transparent: true, opacity: 0.7 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.scene.add(this.floor);

    this.figure = new THREE.Group();
    this.scene.add(this.figure);

    this.yaw = 0.5;
    this.autoSpin = true;
    this.dragging = false;
    this.lastX = 0;
    this.running = false;

    this._bindDrag();
  }

  _bindDrag() {
    const down = (x) => { this.dragging = true; this.autoSpin = false; this.lastX = x; };
    const move = (x) => {
      if (!this.dragging) return;
      this.yaw += (x - this.lastX) * 0.011;
      this.lastX = x;
    };
    const up = () => { this.dragging = false; };

    this.canvas.addEventListener('pointerdown', (e) => { down(e.clientX); this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => move(e.clientX));
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    this.canvas.addEventListener('dblclick', () => { this.autoSpin = true; });
  }

  show(character) {
    this.figure.clear();
    this.figure.add(buildFigure(character));
    this.resize();
    this._frame();
    if (!this.running) { this.running = true; this._loop(); }
  }

  /**
   * Measure the figure and place the camera to fit it, rather than assuming a
   * size. The hand-tuned camera left everyone floating high in the frame, and
   * it would have been wrong for every supplied player.glb as well.
   */
  _frame() {
    const box = new THREE.Box3().setFromObject(this.figure);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const centre = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(centre);

    // Fit the taller of the two constraints, with a margin, so a wide figure
    // is not cropped on a narrow canvas.
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const distV = (size.y / 2) / Math.tan(fovV / 2);
    const distH = (Math.max(size.x, size.z) / 2) / Math.tan(fovH / 2);
    const dist = Math.max(distV, distH) * 1.45 + 0.6;

    this.pivotY = centre.y;
    this.camera.position.set(0, centre.y + size.y * 0.06, dist);
    this.camera.lookAt(0, centre.y, 0);

    // The turntable disc sits under the feet, wherever they turn out to be.
    if (this.floor) {
      this.floor.position.y = box.min.y + 0.005;
      this.floor.scale.setScalar(Math.max(0.5, Math.max(size.x, size.z) * 0.9));
    }
  }

  resize() {
    const w = this.canvas.clientWidth || 260;
    const h = this.canvas.clientHeight || 320;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // Re-fit: the framing depends on aspect, so a resize changes it.
    if (this.figure?.children.length) this._frame();
  }

  _loop() {
    if (!this.running) return;
    requestAnimationFrame(() => this._loop());
    if (this.autoSpin && !this.dragging) this.yaw += 0.006;
    this.figure.rotation.y = this.yaw;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.running = false;
    this.figure.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
    });
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------------------
// Figures built from primitives. Each silhouette differs enough to be
// recognisable at a glance in the dark, which is the only thing that matters:
// in game you see a coloured capsule and a bead of light, not a face.
// ---------------------------------------------------------------------------

function buildFigure(c) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.62, metalness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.45, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2129, roughness: 0.8 });

  const s = c.silhouette;
  const width = s === 'broad' ? 0.42 : s === 'lean' ? 0.27 : 0.33;
  const height = s === 'lean' ? 1.16 : s === 'broad' ? 0.98 : 1.06;

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(width, height, 6, 18), body);
  torso.position.y = 0.62 + height / 2 - 0.28;
  g.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(width * 0.62, 20, 14), dark);
  head.position.y = torso.position.y + height / 2 + width * 0.55;
  g.add(head);

  const legs = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.78, width * 0.6, 0.62, 14), dark);
  legs.position.y = 0.31;
  g.add(legs);

  if (s === 'hooded') {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(width * 0.95, 0.62, 16, 1, true), body);
    hood.position.y = head.position.y + 0.04;
    g.add(hood);
  }
  if (s === 'lantern') {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.5, 8), dark);
    arm.position.set(width + 0.16, torso.position.y + 0.12, 0.16);
    g.add(arm);
    const lamp = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.15, 0),
      new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 2.4, roughness: 0.3 }),
    );
    lamp.position.set(width + 0.16, torso.position.y - 0.18, 0.16);
    g.add(lamp);
    g.add(new THREE.PointLight(c.accent, 3.5, 3).translateY(lamp.position.y).translateX(lamp.position.x));
  }
  if (s === 'satchel') {
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.18), trim);
    bag.position.set(-width - 0.06, torso.position.y - 0.22, 0.1);
    g.add(bag);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(width + 0.05, 0.028, 6, 20), trim);
    strap.rotation.set(Math.PI / 2, 0, 0.42);
    strap.position.y = torso.position.y + 0.12;
    g.add(strap);
  }
  if (s === 'hooked') {
    const hook = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.032, 6, 18, Math.PI * 1.4), trim);
    hook.position.set(width + 0.14, torso.position.y - 0.06, 0.1);
    hook.rotation.z = 0.6;
    g.add(hook);
  }
  if (s === 'broad') {
    const pads = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 4, 12), trim);
    pads.rotation.z = Math.PI / 2;
    pads.position.y = torso.position.y + height / 2 - 0.06;
    g.add(pads);
  }
  if (s === 'lean') {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(width * 0.72, 0.05, 6, 18), trim);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = head.position.y - width * 0.55;
    g.add(scarf);
  }

  return g;
}
