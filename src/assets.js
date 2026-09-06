// ---------------------------------------------------------------------------
// Your textures go here.
//
// Drop image files into assets/textures/ and point these entries at them. Any
// entry whose file is missing or fails to decode falls back to the procedural
// tile automatically, so you can replace one surface at a time and the game
// still runs with nothing in the folder at all.
//
// metresPerTile is how much world one repeat of the image covers. Smaller
// numbers mean the pattern repeats more often and looks finer; larger numbers
// stretch it. Ceilings usually want a larger number than walls because you see
// them at a shallower angle.
//
// Requirements for anything you supply:
//   * seamlessly tileable, or the repeat will be obvious on a long wall
//   * square and power-of-two (1024x1024 or 2048x2048 are good)
//   * albedo/diffuse only, and as unlit as you can get it — the lighting is
//     baked separately and painted-in shadows will fight it
//   * mid-toned. Very dark or very bright images shift the whole house away
//     from what the light bake computed. The loader measures and warns.
// ---------------------------------------------------------------------------

export const TEXTURE_ASSETS = {
  wall: {
    url: 'assets/textures/wall.jpg',
    metresPerTile: 2.2,
  },
  floor: {
    url: 'assets/textures/floor.jpg',
    metresPerTile: 2.4,
  },
  ceiling: {
    url: 'assets/textures/ceiling.jpg',
    metresPerTile: 2.6,
  },
};

/**
 * Set false to ignore the files above and always use the generated tiles.
 * Useful when you want to compare the two without moving files around.
 */
export const USE_ASSET_TEXTURES = true;

// ---------------------------------------------------------------------------
// Models.
//
// Drop .glb files into assets/models/ and point these at them. Every slot is
// optional: anything missing falls back to the primitive shape the game
// already draws, so you can replace one thing at a time.
//
// `height` is the height in metres the model is scaled to, measured from its
// own bounding box. That means export units do not matter — Blender metres,
// Maya centimetres and marketplace models at arbitrary scale all end up right.
// The model is also recentred on X/Z and dropped so its feet sit on the floor,
// so you do not need to worry about where its origin is.
//
// Models should face DOWN -Z (three.js forward). If yours faces the other way,
// rotate it 180 degrees in your editor and re-export rather than fixing it in
// code, or every rotation in the game will be off by half a turn.
// ---------------------------------------------------------------------------

export const MODEL_ASSETS = {
  // The fallback body, used for anyone without their own model below.
  player:    { url: 'assets/models/player.glb',    height: 1.75 },

  // One per character, optional. Anything missing falls back to player.glb,
  // and then to the built-in silhouette, so you can add them one at a time.
  player_lamplighter: { url: 'assets/models/lamplighter.glb', height: 1.75 },
  player_runner:      { url: 'assets/models/runner.glb',      height: 1.75 },
  player_nurse:       { url: 'assets/models/nurse.glb',       height: 1.75 },
  player_scavenger:   { url: 'assets/models/scavenger.glb',   height: 1.75 },
  player_quiet:       { url: 'assets/models/quiet.glb',       height: 1.75 },
  player_warden:      { url: 'assets/models/warden.glb',      height: 1.80 },
  player_lookout:     { url: 'assets/models/lookout.glb',     height: 1.75 },
  player_terminator:  { url: 'assets/models/terminator.glb',  height: 1.85 },

  // The blade it throws at you.
  knife:     { url: 'assets/models/knife.glb',     height: 0.42 },
  // The thing that hunts you.
  ghost:     { url: 'assets/models/ghost.glb',     height: 2.10 },
  // A closet you can hide inside. Needs a visible door on its -Z face.
  closet:    { url: 'assets/models/closet.glb',    height: 2.15 },
  // The screen you sit at to win a relic.
  terminal:  { url: 'assets/models/terminal.glb',  height: 1.30 },
  // The four objects the door wants.
  relic:     { url: 'assets/models/relic.glb',     height: 0.34 },
  // The way out.
  door:      { url: 'assets/models/door.glb',      height: 2.90 },
  // --- Furniture. Every one optional; anything missing is drawn as a box.
  // The generator picks a real footprint for each piece and the loader scales
  // your model to it, so these heights are only a sane default.
  chair:     { url: 'assets/models/chair.glb',     height: 0.95 },
  table:     { url: 'assets/models/table.glb',     height: 0.75 },
  bed:       { url: 'assets/models/bed.glb',       height: 0.65 },
  shelf:     { url: 'assets/models/shelf.glb',     height: 1.85 },
  cabinet:   { url: 'assets/models/cabinet.glb',   height: 1.45 },
  crate:     { url: 'assets/models/crate.glb',     height: 0.65 },
  lamp:      { url: 'assets/models/lamp.glb',      height: 1.40 },
  rug:       { url: 'assets/models/rug.glb',       height: 0.03 },
  painting:  { url: 'assets/models/painting.glb',  height: 0.65 },
};

/** Set false to ignore assets/models entirely and use primitives. */
export const USE_ASSET_MODELS = true;

// ---------------------------------------------------------------------------
// THE SIZE DIALS. Start here when something looks too small or too big.
//
// Three of them, in the order you should reach for them:
//
//   1. PROP_SIZE, just below. A plain multiplier per slot, applied on top of
//      the automatic fit. 1.0 leaves it alone, 1.3 makes that one thing 30%
//      bigger, 0.8 shrinks it. The collider is rebuilt from the result, so you
//      cannot knock the hitbox out of alignment by turning these — change it,
//      reload, look, change it again. This is the one to tinker with.
//
//   2. `height` in MODEL_ASSETS above. Only matters for slots the generator
//      does NOT give a footprint to — the ghost, the door, the closet, the
//      terminal, the knife, the relic, and the player bodies. For furniture it
//      is only a starting measurement; the generator overrides it per piece.
//
//   3. MAX_STRETCH in models.js. How far one axis may deform away from the
//      others to fill the footprint the generator reserved. 1.0 is strictly
//      uniform. Raise it and boxy placeholders fill their space better; real
//      furniture starts looking squashed.
// ---------------------------------------------------------------------------

/**
 * Per-slot size multiplier. Anything not listed is 1.0.
 *
 * These are yours to play with. Nothing else in the game reads them, and
 * getting one wrong makes that model the wrong size and nothing more.
 */
/**
 * Half turns and quarter turns, in DEGREES, applied when a model is loaded.
 *
 * Blender is Z-up and its glTF exporter maps (x, y, z) to (x, z, -y), so
 * Blender +Y leaves as glTF -Z. A Mixamo character imported into Blender faces
 * -Y, which comes out as +Z — and three's forward is -Z. So every Mixamo
 * character arrives back to front, which is why teammates moonwalk.
 *
 * Fixing it at export is tidier (see face_forward() in the bake script) and
 * this is here for everything you would rather not re-export. Once a model is
 * fixed at the source, set its entry to 0 or the two corrections cancel out
 * and it is backwards again.
 */
export const MODEL_YAW = {
  player:             180,
  player_lamplighter: 180,
  player_runner:      180,
  player_nurse:       180,
  player_scavenger:   180,
  player_quiet:       180,
  player_warden:      180,
  player_lookout:     180,
  player_terminator:  180,
};

export const PROP_SIZE = {
  chair:     1.6,
  table:     1.6,
  bed:       2.1,
  shelf:     1.0,
  cabinet:   1.0,
  crate:     1.2,
  lamp:      1.0,
  rug:       1.8,
  painting:  1.0,
};

// ---------------------------------------------------------------------------
// Animations.
//
// Built for the Mixamo workflow and nothing else, because that is what is
// being used and a general retargeter would be ten times the code.
//
// HOW TO ADD ONE:
//   1. On mixamo.com pick any animation. Tick IN PLACE if the option is there
//      (the game moves the character itself; a clip that also walks forward
//      fights it and you get skating).
//   2. Download as FBX, then in Blender: File > Import > FBX, then File >
//      Export > glTF 2.0 (.glb). Or use any FBX-to-GLB converter.
//   3. Drop it in assets/animations/ and put its filename below.
//
// It does not matter WHICH Mixamo character you downloaded the animation on.
// Every Mixamo rig has the same bone names, and the clip is retargeted onto
// whichever character is wearing it, including scaling the hip motion for a
// taller or shorter body. Download everything on the default Y-Bot and it will
// work on all of them.
//
// Every entry is optional. A missing state falls back to a sensible neighbour
// (see ANIMATION_FALLBACK), and a character with no animations at all just
// stands there exactly as before.
// ---------------------------------------------------------------------------

export const ANIMATION_ASSETS = {
  idle:        'assets/animations/idle.glb',
  walk:        'assets/animations/walk.glb',
  run:         'assets/animations/run.glb',
  crouchIdle:  'assets/animations/crouch-idle.glb',
  crouchWalk:  'assets/animations/crouch-walk.glb',
  // Played once and held on the last frame, not looped.
  downed:      'assets/animations/downed.glb',
};

/** Set false to ignore assets/animations entirely. */
export const USE_ASSET_ANIMATIONS = true;

/** States that play once and hold their last frame instead of looping. */
export const ANIMATION_ONCE = ['downed'];

/**
 * What to use when a state has no clip of its own. Followed in order until
 * something exists, so you can ship with only idle.glb and walk.glb and add
 * the rest whenever.
 */
export const ANIMATION_FALLBACK = {
  walk:       ['idle'],
  run:        ['walk', 'idle'],
  crouchIdle: ['idle'],
  crouchWalk: ['crouchIdle', 'walk', 'idle'],
  downed:     [],
};

/**
 * The numbers to nudge when it looks wrong. All of them are about matching
 * playback to the speed the game is actually moving somebody at.
 */
export const ANIMATION_TUNING = {
  // Ground speed, in metres per second, that each clip looks correct at. If
  // feet skate forwards the clip is too slow, so LOWER the number; if they
  // scrabble, raise it. Mixamo's own walk is around 1.5 and its run around 4.
  walkSpeed: 1.5,
  runSpeed: 4.0,
  crouchWalkSpeed: 1.1,

  // How far playback may be stretched to match. Outside this it is clamped,
  // because a walk played at three times speed reads as a glitch.
  //
  // Against the CONFIG speeds in level.js nothing comes near these edges:
  //   crouchWalk 1.45 / 1.1 = 1.32
  //   walk        2.4 / 1.5 = 1.60
  //   run         5.0 / 4.0 = 1.25
  // If you change a CONFIG speed, redo that arithmetic. A state that clamps
  // is a state whose feet skate.
  rateRange: [0.55, 1.8],

  // Below this many m/s somebody counts as standing still, above runAbove
  // they count as running.
  //
  // These are compared against GROUND speed, so they have to bracket the real
  // CONFIG speeds in level.js: 2.4 walking, 5.0 sprinting, 1.45 crouched.
  // runAbove sitting below the ordinary walk is what made every moving player
  // pick 'run'.
  moveAbove: 0.4,
  runAbove: 3.7,

  // Dead band either side of each threshold above.
  //
  // Without one, a speed parked on a threshold flips state every frame, and
  // since every flip starts a fresh cross-fade that never has time to finish,
  // two clips end up permanently blended — the character walks and runs at the
  // same time. Entering a state needs threshold + band; leaving it needs to
  // fall below threshold - band.
  //
  // A BAND MUST BE SMALLER THAN ITS OWN THRESHOLD. moveAbove - moveBand is the
  // speed below which somebody is standing still; make that negative and no
  // speed can ever satisfy it, so a body that starts walking never returns to
  // idle and walks on the spot forever. That is why these are two numbers and
  // not one shared value: 0.4 and 3.7 cannot use the same band.
  moveBand: 0.15,   // idle below 0.25, moving above 0.55
  runBand: 0.5,     // run above 4.2, back to walk below 3.2

  // Seconds to blend between two states.
  fade: 0.18,
};

// ---------------------------------------------------------------------------
// Colour for models that arrive with none.
//
// glTF carries a base colour and image textures, and nothing else. A material
// built out of procedural nodes — noise, gradients, a whole shader graph —
// has nothing an exporter can write down, so it comes across as a plain white
// base colour and the shading you set up never leaves the modelling package.
// That is why some pieces are white and some are not: the ones that are fine
// had an image texture in them, the ones that are not were procedural.
//
// THE REAL FIX IS TO BAKE. In Blender: select the mesh, add an Image Texture
// node with a new blank image, select that node, Render Properties > set the
// engine to Cycles, Bake > Bake Type: Diffuse with Direct and Indirect
// unticked so you get colour only, then plug the baked image into Base Color
// and re-export. Ten minutes per model and it looks like what you made.
//
// Everything below is what happens until then.
// ---------------------------------------------------------------------------

/**
 * Per-slot tint, as a hex colour. Multiplies whatever colour the model has.
 *
 * Set an entry here to force a specific colour on one slot. Anything not
 * listed falls back to AUTO_TINT below, so you do not have to fill this in.
 */
export const MODEL_TINT = {
  // crate:  0x8a6a44,
};

/**
 * Applied automatically to any material that arrives with NO texture and a
 * near-white base colour — which is exactly the signature of a procedural
 * material that did not survive the export.
 *
 * A material carrying an image texture, or one with a base colour its author
 * actually chose, is left completely alone: this only ever repaints the
 * pieces that would otherwise be flat white. Set AUTO_TINT to null to turn
 * the whole thing off and see the raw white for yourself.
 *
 * The colours are house timber and old paint, chosen to sit under the torch
 * without becoming the brightest thing in the room.
 */
export const AUTO_TINT = {
  // Taken off the chair script's own ColorRamp: its two stops are #240D03 and
  // #6F3C1D in sRGB, and this is roughly where the noise sits between them.
  chair:     0x512912,
  table:     0x6f5334,
  bed:       0x6a5a4a,
  shelf:     0x5f462c,
  cabinet:   0x655036,
  crate:     0x8a6a44,
  lamp:      0x8a7550,
  rug:       0x6b4436,
  painting:  0x5a4a38,
  closet:    0x6b5a44,
  door:      0x5a4632,
  terminal:  0x4a4f55,
  knife:     0x9aa0a6,
  relic:     0xc9a63c,
  // Only reached by a ghost.glb that arrived untextured and flat white. Cold
  // and desaturated so a supplied model does not read as another player.
  ghost:     0x9fb0bd,
  // Anything not listed, including the player bodies.
  _default:  0x8a8175,
};

/**
 * How white a base colour has to be before AUTO_TINT steps in. 1.0 is pure
 * white. Raise it towards 1 to only catch dead-white materials; lower it to
 * catch pale greys as well.
 */
export const AUTO_TINT_THRESHOLD = 0.92;

/**
 * Brightens everything AUTO_TINT paints, before it is applied.
 *
 * The honest colour off a Blender ColorRamp is usually darker than it should
 * be in here. Those values were picked under a render light; this house has
 * one torch and a fog term that eats the rest, so a piece that reads as dark
 * oak in the viewport reads as a hole in the floor in game. 1.0 uses the
 * colours exactly as written above.
 */
export const AUTO_TINT_LIFT = 1.6;

/**
 * Objects to throw away as soon as a .glb is parsed.
 *
 * Placeholder models very often ship with a label attached — Blender's text
 * object is called "Text" and reads "Text", and it exports along with the
 * mesh. It floats in the room, and worse, it counts towards the model's
 * bounding box, so the fit that scales the model to its slot height is
 * measuring the label as well and everything comes out smaller than asked.
 *
 * Matched against the object's name, case-insensitively, whole name only, so
 * "Text" and "Text.001" go and a crate called "TextureTest" stays. Set to null
 * to keep everything.
 */
export const STRIP_MODEL_OBJECTS = /^(text|label|placeholder)(\.\d+)?$/i;
