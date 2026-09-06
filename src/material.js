import * as THREE from 'three';
import { CONFIG } from './level.js';
import { AUTO_TINT, AUTO_TINT_THRESHOLD, AUTO_TINT_LIFT } from './assets.js';
import { createHauntedTextures } from './textures.js';

// One material for the entire house. Still unlit — all steady lighting lives in
// the aLit attribute — but now doing three things per fragment:
//
//   TEXTURE. There are no UV attributes. Every surface here is axis-aligned, so
//   the shader projects world coordinates onto whichever axis the face points
//   down and samples that. The projection is exact, there are no seams, and a
//   thirty-metre wall tiles correctly without anyone authoring a lightmap UV.
//   Three samplers blended by a per-vertex surface weight rather than a branch,
//   because a branch around a texture fetch breaks the derivatives that pick
//   the mip level, and grazing-angle walls would shimmer.
//
//   FLICKER. Lights marked as failing were baked into their own channels. Here
//   they are added back scaled by a live uniform, so a dying bulb still casts
//   the correct baked shadow while its brightness jumps around.
//
//   TORCH. Wider, longer and brighter than before, because the rooms are now
//   large enough that the old cone lit a patch of floor and nothing else.

const vert = /* glsl */`
attribute vec3 aLit;
attribute vec3 aAlbedo;
attribute vec3 aFlickA;
attribute vec3 aFlickB;
attribute float aSurf;
attribute vec4 aVariant;

varying vec3 vLit;
varying vec3 vAlbedo;
varying vec3 vFlickA;
varying vec3 vFlickB;
varying vec3 vSurfW;
varying vec4 vVariant;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld  = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLit    = aLit;
  vAlbedo = aAlbedo;
  vFlickA = aFlickA;
  vFlickB = aFlickB;
  vVariant = aVariant;

  // 0 wall, 1 floor, 2 ceiling -> one-hot weights the fragment stage blends by.
  vSurfW = vec3(
    step(aSurf, 0.5),
    step(0.5, aSurf) * step(aSurf, 1.5),
    step(1.5, aSurf)
  );

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */`
uniform sampler2D uTexWall;
uniform sampler2D uTexFloor;
uniform sampler2D uTexCeiling;
uniform vec3 uTexScale;   // repeats per metre, one per surface type
uniform float uRoomHeight;
uniform vec3 uPacked;   // 1 = three greyscale variants in RGB, 0 = a supplied image

uniform vec3  uFlashPos;
uniform vec3  uFlashDir;
uniform vec3  uFlashColor;
uniform float uFlashInner;
uniform float uFlashOuter;
uniform float uFlashRange;
uniform float uFlashGain;
uniform float uFlashOn;
uniform float uFlashFlicker;

uniform vec3  uFlarePos;
uniform vec3  uFlareColor;
uniform float uFlareRange;
uniform float uFlareOn;

uniform float uFlickerA;
uniform float uFlickerB;

uniform vec3  uFogColor;
uniform float uFogDensity;

varying vec3 vLit;
varying vec3 vAlbedo;
varying vec3 vFlickA;
varying vec3 vFlickB;
varying vec3 vSurfW;
varying vec4 vVariant;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 an = abs(n);

  // Project along the dominant axis. Exact for axis-aligned geometry.
  vec2 uv;
  if (an.y > max(an.x, an.z))      uv = vWorld.xz;
  else if (an.x > an.z)            uv = vWorld.zy;
  else                             uv = vWorld.xy;

  // Per-room variant: an optional quarter turn, then a shift. Rotating first
  // means the grain direction changes between rooms rather than only its
  // phase, which is what stops one shared tile reading as one shared room.
  if (vVariant.z > 0.5) uv = vec2(uv.y, -uv.x);

  // One fetch per surface type, as before. A generated tile holds three
  // greyscale patterns in R, G and B, so picking a variant is a dot product
  // with a one-hot weight rather than another sampler. A supplied image is a
  // colour picture, so uPacked keeps its RGB untouched.
  vec3 sel = vec3(
    step(vVariant.w, 0.5),
    step(0.5, vVariant.w) * step(vVariant.w, 1.5),
    step(1.5, vVariant.w)
  );

  vec3 wS = texture2D(uTexWall,    uv * uTexScale.x + vVariant.xy).rgb;
  vec3 fS = texture2D(uTexFloor,   uv * uTexScale.y + vVariant.xy).rgb;
  vec3 cS = texture2D(uTexCeiling, uv * uTexScale.z + vVariant.xy).rgb;

  vec3 tex = mix(wS, vec3(dot(wS, sel)), uPacked.x) * vSurfW.x
           + mix(fS, vec3(dot(fS, sel)), uPacked.y) * vSurfW.y
           + mix(cS, vec3(dot(cS, sel)), uPacked.z) * vSurfW.z;
  tex *= 2.0;   // the tiles average about 0.5, so this lands back at unity

  // Skirting board and picture rail, on walls only, from world height. Two
  // smoothsteps and no geometry, and they do more to separate wall from floor
  // and wall from ceiling than any amount of texture work: a room without them
  // reads as one continuous wooden box.
  float wall = vSurfW.x;
  float skirt = wall * (1.0 - smoothstep(0.24, 0.30, vWorld.y));
  float lip   = wall * (1.0 - smoothstep(0.30, 0.34, vWorld.y)) * smoothstep(0.24, 0.30, vWorld.y);
  float rail  = wall * smoothstep(uRoomHeight - 0.40, uRoomHeight - 0.34, vWorld.y)
                     * (1.0 - smoothstep(uRoomHeight - 0.26, uRoomHeight - 0.20, vWorld.y));
  tex *= 1.0 - skirt * 0.42 - rail * 0.34;
  tex += vec3(0.10, 0.08, 0.06) * lip;

  // Ceilings sit a shade colder and darker than the timber below them, so a
  // glance upward is never mistaken for a glance along.
  tex *= mix(vec3(1.0), vec3(0.80, 0.84, 0.92), vSurfW.z);

  vec3 lit = vLit + vFlickA * uFlickerA + vFlickB * uFlickerB;
  vec3 col = lit * tex;
  vec3 surfaceAlbedo = vAlbedo * tex;

  if (uFlashOn > 0.5) {
    vec3  toFrag = vWorld - uFlashPos;
    float d = length(toFrag);
    vec3  L = toFrag / max(d, 1e-4);

    float cone = smoothstep(uFlashOuter, uFlashInner, dot(L, uFlashDir));
    // A soft outer spill so the beam does not end in a hard-edged disc.
    float spill = smoothstep(uFlashOuter - 0.22, uFlashOuter, dot(L, uFlashDir)) * 0.22;
    float att  = clamp(1.0 - d / uFlashRange, 0.0, 1.0);
    att *= att;
    float ndl  = max(dot(n, -L), 0.0);

    col += surfaceAlbedo * uFlashColor * ((cone + spill) * att * ndl * uFlashGain * uFlashFlicker);
  }

  if (uFlareOn > 0.5) {
    vec3  toFlare = uFlarePos - vWorld;
    float fd = length(toFlare);
    vec3  FL = toFlare / max(fd, 1e-4);
    float fatt = clamp(1.0 - fd / uFlareRange, 0.0, 1.0);
    fatt *= fatt;
    float fndl = max(dot(n, FL), 0.0);
    col += surfaceAlbedo * uFlareColor * (fatt * fndl * uFlareOn);
  }

  float dist = length(vWorld - cameraPosition);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * @param surfaces the object from loadSurfaceTextures(), or undefined to fall
 *   straight back to the generated tiles.
 */
export function createHouseMaterial(surfaces, anisotropy = 4) {
  const tex = surfaces ?? createHauntedTextures(anisotropy);
  const m = tex.metres ?? CONFIG.textureMetres;
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTexWall:     { value: tex.wall },
      uTexFloor:    { value: tex.floor },
      uTexCeiling:  { value: tex.ceiling },
      uTexScale:    { value: new THREE.Vector3(1 / m.wall, 1 / m.floor, 1 / m.ceiling) },
      uRoomHeight:  { value: CONFIG.roomHeight },
      uPacked:      { value: new THREE.Vector3(
        surfaces?.packed?.wall ?? 1,
        surfaces?.packed?.floor ?? 1,
        surfaces?.packed?.ceiling ?? 1,
      ) },

      uFlashPos:    { value: new THREE.Vector3() },
      uFlashDir:    { value: new THREE.Vector3(0, 0, -1) },
      uFlashColor:  { value: new THREE.Color().setHex(0xfff0d4, THREE.SRGBColorSpace) },
      uFlashInner:  { value: Math.cos(THREE.MathUtils.degToRad(14)) },
      uFlashOuter:  { value: Math.cos(THREE.MathUtils.degToRad(34)) },
      uFlashRange:  { value: 22.0 },
      uFlashGain:   { value: 1.4 },
      uFlashOn:     { value: 1.0 },
      uFlashFlicker:{ value: 1.0 },

      uFlarePos:    { value: new THREE.Vector3() },
      uFlareColor:  { value: new THREE.Color().setHex(0xff8a30, THREE.SRGBColorSpace) },
      uFlareRange:  { value: 12.0 },
      uFlareOn:     { value: 0.0 },

      uFlickerA:    { value: 1.0 },
      uFlickerB:    { value: 1.0 },

      uFogColor:    { value: new THREE.Color().setHex(CONFIG.fogColor, THREE.SRGBColorSpace) },
      uFogDensity:  { value: CONFIG.fogDensity },
    },
    side: THREE.FrontSide,
  });
}

/**
 * The flicker signal. Mostly on, with brief stutters that arrive in clusters —
 * a steady sine reads as a pulsing disco light, not a failing filament. Two
 * offset phases so the two channels never fail together.
 */
export function flickerSignal(t, phase) {
  const slow = Math.sin(t * 0.7 + phase) * 0.5 + Math.sin(t * 1.13 + phase * 2.3) * 0.5;
  const gate = Math.sin(t * 0.31 + phase * 1.7);
  if (gate > 0.72) {
    // In a stutter: rapid, ugly, and occasionally fully dark.
    const fast = Math.sin(t * 47.0 + phase) * Math.sin(t * 31.0 + phase * 3.1);
    return Math.min(1.12, Math.max(0.0, 0.55 + fast * 0.75));
  }
  return Math.min(1.12, 0.92 + slow * 0.08);
}

// ---------------------------------------------------------------------------
// Everything below is self-lit. The baked lighting cannot touch dynamic objects
// (their meshes are not tessellated for it), so the ghost, the knives, the loot
// and the exit each carry their own light with them.
// ---------------------------------------------------------------------------

/**
 * The ghost. A rim-lit shell: bright where the surface turns away from you,
 * transparent face-on, additively blended so it never occludes anything. Costs
 * one dot product per fragment and reads as a shape made of cold air.
 */
export function createGhostMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:    { value: 0 },
      uRage:    { value: 0 },   // 0 calm, 1 hunting
      uCalm:    { value: new THREE.Color().setHex(0x7fd6ff, THREE.SRGBColorSpace) },
      uAngry:   { value: new THREE.Color().setHex(0xff5a3c, THREE.SRGBColorSpace) },
    },
    vertexShader: /* glsl */`
      uniform float uTime;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vHeight;
      void main() {
        vHeight = position.y;
        vec3 p = position;
        // Slow vertical drift so the silhouette never quite settles.
        p.x += sin(uTime * 1.7 + position.y * 2.1) * 0.06 * (1.0 + position.y);
        p.z += cos(uTime * 1.3 + position.y * 1.8) * 0.06 * (1.0 + position.y);
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uRage;
      uniform vec3  uCalm;
      uniform vec3  uAngry;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      varying float vHeight;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = 1.0 - abs(dot(normalize(vNormalW), view));
        rim = pow(clamp(rim, 0.0, 1.0), 2.2);

        // Dissolve towards the floor so it has no feet.
        float foot = smoothstep(-0.1, 0.9, vHeight);
        float pulse = 0.82 + 0.18 * sin(uTime * (2.2 + uRage * 5.0));

        vec3 tint = mix(uCalm, uAngry, uRage);
        float a = rim * foot * pulse * (0.5 + uRage * 0.5);

        gl_FragColor = vec4(tint * a, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

/** Small bright unlit objects: knives, loot, the exit marker. */
export function createGlowMaterial(hex, opts = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    // depthTest:false is what actually makes something visible THROUGH a wall.
    // depthWrite:false only stops it occluding whatever comes after it.
    depthTest: opts.depthTest ?? true,
    depthWrite: opts.depthWrite ?? true,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: opts.side ?? THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color().setHex(hex, THREE.SRGBColorSpace) },
      uTime:  { value: 0 },
      uPulse: { value: opts.pulse ?? 0.0 },
      uGain:  { value: opts.gain ?? 1.0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3  uColor;
      uniform float uTime;
      uniform float uPulse;
      uniform float uGain;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vec3 view = normalize(cameraPosition - vWorld);
        float rim = 1.0 - abs(dot(normalize(vNormalW), view));
        float body = 0.45 + 0.55 * pow(clamp(rim, 0.0, 1.0), 1.6);
        float pulse = 1.0 - uPulse + uPulse * (0.7 + 0.3 * sin(uTime * 3.0));
        gl_FragColor = vec4(uColor * body * pulse * uGain, body * pulse);
        #include <colorspace_fragment>
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Supplied models: furniture, characters, anything that arrives as a .glb.
//
// This is the fix for "every model is a black cube".
//
// There is not a single THREE.Light in the house. All steady lighting lives in
// the aLit vertex attribute the baker writes, and the torch is a hand-rolled
// cone in the shader above. A GLB arrives carrying MeshStandardMaterial, which
// is a physically based material and therefore needs lights to reflect — put
// one in a scene with no lights and it renders exactly what it is told to
// render, which is black. Nothing was wrong with the models; they were being
// asked to reflect light that does not exist.
//
// So every material on an imported model is swapped for one built here: the
// model's own base colour and texture, lit by the same torch, the same flare
// and the same fog as the walls around it. MeshBasicMaterial rather than a raw
// ShaderMaterial on purpose — three's own vertex pipeline comes with it, so
// skinned characters, morph targets and vertex colours all keep working, and
// the lighting is injected with onBeforeCompile rather than reimplemented.
// ---------------------------------------------------------------------------

const PROP_UNIFORMS = [
  'uFlashPos', 'uFlashDir', 'uFlashColor', 'uFlashInner', 'uFlashOuter',
  'uFlashRange', 'uFlashGain', 'uFlashOn', 'uFlashFlicker',
  'uFlarePos', 'uFlareColor', 'uFlareRange', 'uFlareOn',
  'uFogColor', 'uFogDensity',
];

const PROP_DECL = /* glsl */`
uniform vec3  uFlashPos;
uniform vec3  uFlashDir;
uniform vec3  uFlashColor;
uniform float uFlashInner;
uniform float uFlashOuter;
uniform float uFlashRange;
uniform float uFlashGain;
uniform float uFlashOn;
uniform float uFlashFlicker;
uniform vec3  uFlarePos;
uniform vec3  uFlareColor;
uniform float uFlareRange;
uniform float uFlareOn;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uAmbient;
varying vec3 vPropWorld;
varying vec3 vPropNormal;
`;

/**
 * One material per distinct source material, per run.
 *
 * Per run matters: models are parsed once and cloned, and a three.js clone
 * SHARES its material and geometry with the original. Disposing a run's scene
 * therefore used to reach back into the model cache and free the very things
 * the next run was going to clone, so the second house came up wrong. The
 * materials here belong to the run and are disposed with it; the cached
 * geometry is left alone (see the pooled flag in models.js).
 */
export class PropMaterials {
  constructor(house) {
    this.house = house;
    this.cache = new Map();
  }

  /**
   * Swap every material in a subtree. Returns the object, for chaining.
   *
   * `tint` multiplies the model's own base colour. It exists for the models
   * that arrive white: glTF carries a base colour and image textures, and
   * nothing else, so a material built out of procedural nodes exports as plain
   * white and the shading never leaves the modelling package. Baking those
   * nodes to an image is the real answer; this stops a crate being the
   * brightest object in the house in the meantime. See MODEL_TINT in
   * assets.js.
   */
  apply(root, { tint = null, slot = null } = {}) {
    if (!root) return root;
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh && !o.isPoints && !o.isLine) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => this._for(m, tint, slot))
        : this._for(o.material, tint, slot);
    });
    return root;
  }

  /**
   * Did this material lose its shading on the way out of the modelling
   * package?
   *
   * A procedural material — noise, gradients, a node graph — has nothing glTF
   * can carry, so the exporter writes a plain white base colour and no map.
   * That combination is the signature, and it is one nobody authors on
   * purpose: a piece of furniture somebody deliberately made pure white would
   * still normally have a texture on it. Anything with a map, vertex colours,
   * or a base colour its author actually picked is left alone.
   */
  static lostItsShading(source) {
    if (!source || source.map || source.vertexColors) return false;
    const c = source.color;
    if (!c) return true;
    return c.r >= AUTO_TINT_THRESHOLD
        && c.g >= AUTO_TINT_THRESHOLD
        && c.b >= AUTO_TINT_THRESHOLD;
  }

  _for(source, tint, slot) {
    if (!source || source.isShaderMaterial) return source;

    // An explicit tint wins and is used exactly as written. Otherwise repaint
    // it only if it came across as flat white, which means the shading did not
    // survive the export — and lift it, because a colour picked in a lit
    // viewport is always too dark for a house with one torch in it.
    let use = tint;
    let lift = 1;
    if (use === null && AUTO_TINT && PropMaterials.lostItsShading(source)) {
      use = AUTO_TINT[slot] ?? AUTO_TINT._default ?? null;
      lift = AUTO_TINT_LIFT ?? 1;
    }

    // Two props sharing a source material but tinted differently are two
    // materials, so the tint has to be part of the key.
    const key = `${source.uuid}|${use ?? 'none'}|${lift}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const made = this._build(source, use, lift);
    this.cache.set(key, made);
    return made;
  }

  _build(source, tint, lift = 1) {
    const m = new THREE.MeshBasicMaterial({
      map: source.map ?? null,
      color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
      // Cut-out foliage, glass, decals: whatever the exporter asked for.
      transparent: !!source.transparent,
      opacity: source.opacity ?? 1,
      alphaTest: source.alphaTest ?? 0,
      alphaMap: source.alphaMap ?? null,
      side: source.side ?? THREE.FrontSide,
      vertexColors: !!source.vertexColors,
      depthWrite: source.depthWrite !== false,
      // Our own fog, matched to the house's, is applied below. Three's would
      // be a second one on top of it.
      fog: false,
    });
    if (tint !== null && tint !== undefined) {
      // Multiply, not replace. On a model that came across white the base is
      // 1,1,1 and this lands exactly on the tint; on one with a real colour or
      // a texture an explicit MODEL_TINT shades what is already there rather
      // than painting over it.
      const c = new THREE.Color().setHex(tint, THREE.SRGBColorSpace);
      if (lift !== 1) c.multiplyScalar(lift);
      m.color.multiply(c);
    }
    m.name = `prop:${source.name || 'unnamed'}`;

    const u = this.house.uniforms;
    // 0.16 is a floor, not a light: enough that a chair in an unlit corner
    // reads as a shape rather than a hole, dim enough that the torch is still
    // the reason you can see anything.
    const ambient = { value: 0.16 };

    m.onBeforeCompile = (shader) => {
      // SHARED BY REFERENCE. main.js writes the torch position onto the house
      // material once a frame; sharing the uniform objects means these follow
      // it with nobody having to remember they exist.
      for (const name of PROP_UNIFORMS) shader.uniforms[name] = u[name];
      shader.uniforms.uAmbient = ambient;

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PROP_DECL}`)
        .replace('#include <project_vertex>', /* glsl */`
          #include <project_vertex>
          vec4 propWorld = modelMatrix * vec4(transformed, 1.0);
          vPropWorld  = propWorld.xyz;
          vPropNormal = normalize(mat3(modelMatrix) * normal);
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PROP_DECL}`)
        .replace('#include <tonemapping_fragment>', /* glsl */`
          {
            vec3 n = normalize(vPropNormal);
            vec3 lightSum = vec3(uAmbient);

            if (uFlashOn > 0.5) {
              vec3  toFrag = vPropWorld - uFlashPos;
              float d = length(toFrag);
              vec3  L = toFrag / max(d, 1e-4);
              float axis  = dot(L, uFlashDir);
              float cone  = smoothstep(uFlashOuter, uFlashInner, axis);
              float spill = smoothstep(uFlashOuter - 0.22, uFlashOuter, axis) * 0.22;
              float att   = clamp(1.0 - d / uFlashRange, 0.0, 1.0);
              att *= att;
              // Half lambert. A model's normals are not the tidy axis-aligned
              // ones the house is built from, and a hard dot leaves the far
              // side of a chair as a black cut-out even under a full beam.
              float ndl = mix(0.45, max(dot(n, -L), 0.0), 0.55);
              lightSum += uFlashColor * ((cone + spill) * att * ndl * uFlashGain * uFlashFlicker);
            }

            if (uFlareOn > 0.5) {
              vec3  toFlare = uFlarePos - vPropWorld;
              float fd = length(toFlare);
              vec3  FL = toFlare / max(fd, 1e-4);
              float fatt = clamp(1.0 - fd / uFlareRange, 0.0, 1.0);
              fatt *= fatt;
              float fndl = mix(0.45, max(dot(n, FL), 0.0), 0.55);
              lightSum += uFlareColor * (fatt * fndl * uFlareOn);
            }

            gl_FragColor.rgb *= lightSum;

            float propDist = length(vPropWorld - cameraPosition);
            float propFog  = 1.0 - exp(-uFogDensity * uFogDensity * propDist * propDist);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, clamp(propFog, 0.0, 1.0));
          }
          #include <tonemapping_fragment>
        `);
    };
    // Two materials with identical injected code can share a compiled program.
    m.customProgramCacheKey = () => 'prop-lit-v1';
    return m;
  }

  dispose() {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}
