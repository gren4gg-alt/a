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
