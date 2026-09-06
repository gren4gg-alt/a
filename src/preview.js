import * as THREE from 'three';

// ---------------------------------------------------------------------------
// The character silhouettes.
//
// Previously this also owned a small turntable renderer, used twice. Both
// screens now render into one full-screen room instead (charroom.js), which
// removed two live WebGL contexts — browsers cap those and quietly drop the
// oldest, and on a phone the cap is low.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Figures built from primitives. Each silhouette differs enough to be
// recognisable at a glance in the dark, which is the only thing that matters:
// in game you see a coloured capsule and a bead of light, not a face.
// ---------------------------------------------------------------------------

export function buildFigure(c) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.62, metalness: 0.08 });
  const trim = new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.45, metalness: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2129, roughness: 0.8 });

  const s = c.silhouette;
  const width = s === 'broad' ? 0.42 : s === 'armoured' ? 0.45 : (s === 'lean' || s === 'watcher') ? 0.27 : 0.33;
  const height = (s === 'lean' || s === 'watcher') ? 1.16 : s === 'broad' ? 0.98 : s === 'armoured' ? 1.02 : 1.06;

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
  if (s === 'armoured') {
    // Plated, and squared off, so it reads as the one that stops things.
    const chest = new THREE.Mesh(new THREE.BoxGeometry(width * 1.9, 0.52, width * 1.15), trim);
    chest.position.y = torso.position.y + 0.18;
    g.add(chest);
    const pauldrons = new THREE.Mesh(new THREE.BoxGeometry(width * 2.5, 0.2, width * 1.1), trim);
    pauldrons.position.y = torso.position.y + height / 2 - 0.02;
    g.add(pauldrons);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.09, 0.06),
      new THREE.MeshStandardMaterial({ color: c.accent, emissive: c.accent, emissiveIntensity: 2.2 }),
    );
    visor.position.set(0, head.position.y + 0.03, -width * 0.55);
    g.add(visor);
  }
  if (s === 'lean') {
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(width * 0.72, 0.05, 6, 18), trim);
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = head.position.y - width * 0.55;
    g.add(scarf);
  }
  if (s === 'watcher') {
    // Glass over the eyes and nothing else. The one who is only ever looking.
    const lens = new THREE.MeshStandardMaterial({
      color: c.accent, emissive: c.accent, emissiveIntensity: 1.9, roughness: 0.25,
    });
    for (const side of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.13, 14), lens);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(side * width * 0.3, head.position.y + 0.02, -width * 0.62);
      g.add(barrel);
    }
    const band = new THREE.Mesh(new THREE.TorusGeometry(width * 0.66, 0.028, 6, 20), trim);
    band.rotation.x = Math.PI / 2;
    band.position.y = head.position.y + 0.02;
    g.add(band);
  }

  return g;
}
