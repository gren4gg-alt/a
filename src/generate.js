import { CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// Maze generation.
//
// The output is exactly the shape the hand-authored level had — rooms as
// rectangles, doors as openings on wall planes — so build.js, bake.js and the
// culler need no idea this is procedural.
//
// Layout strategy: a lattice of plots, one room per plot, connected by straight
// corridors. Corridors are just narrow rooms, which means walls, floors, doors
// and collision all fall out of the existing pipeline for free.
//
// The one invariant that makes straight corridors always possible: every room
// must contain the "spine" band through its plot centre. Two horizontally
// adjacent plots share a centre Z, so both rooms straddle the same Z band and a
// corridor can run between them without ever needing to turn. Same for Z with
// centre X. Getting that invariant right is what removes L-shaped corridors,
// junction overlaps, and every geometry bug that comes with them.
// ---------------------------------------------------------------------------

export const GEN = {
  plotW: 16,
  plotD: 14,
  inset: 1.6,          // minimum gap between a room wall and its plot edge
  corridorWidth: 2.2,
  tunnelWidth: 1.7,    // narrower, because you are on your hands and knees
};

const CATEGORIES = [
  { id: 'closet', weight: 14, w: [3.5, 4.5],  d: [3.0, 4.2],   props: [0, 1], lightScale: 0.5 },
  { id: 'small',  weight: 30, w: [5.0, 6.5],  d: [4.5, 6.0],   props: [1, 3], lightScale: 0.9 },
  { id: 'medium', weight: 28, w: [7.0, 9.0],  d: [6.5, 8.5],   props: [2, 5], lightScale: 1.0 },
  { id: 'large',  weight: 20, w: [9.5, 12.0], d: [8.5, 10.5],  props: [4, 8], lightScale: 1.2 },
  { id: 'hall',   weight:  8, w: [12.0, 12.8],d: [10.4, 10.8], props: [5, 10],lightScale: 1.4 },
];

const WARM = [0xffb066, 0xffa040, 0xff8c3a, 0xffc890];
const COLD = [0x8fa8c8, 0xb8dcff, 0x6d84a0, 0x86d8b0];

const LOOT_TABLE = [
  { id: 'candlestick', name: 'Tarnished candlestick', weight: 34, value: 14 },
  { id: 'locket',      name: 'Silver locket',         weight: 26, value: 26 },
  { id: 'music_box',   name: 'Music box',             weight: 18, value: 45 },
  { id: 'ledger',      name: "The house ledger",      weight: 12, value: 80 },
  { id: 'ivory_key',   name: 'Ivory key',             weight:  7, value: 150 },
  { id: 'reliquary',   name: 'Sealed reliquary',      weight:  3, value: 320 },
];

// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

function pickWeighted(list, rand) {
  const total = list.reduce((s, c) => s + c.weight, 0);
  let r = rand() * total;
  for (const c of list) { r -= c.weight; if (r <= 0) return c; }
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------

export function generateLevel(difficulty, seed = (Math.random() * 1e9) | 0) {
  const rand = mulberry32(seed);
  const [cols, rows] = difficulty.grid;
  const cw = GEN.corridorWidth;

  // -- 1. One room per plot -------------------------------------------------

  const plots = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = i * GEN.plotW + GEN.plotW / 2;
      const cz = j * GEN.plotD + GEN.plotD / 2;
      // Plot (0,0) is the entrance, and six people have to spawn in it
      // without standing inside each other or inside a wall. A closet-sized
      // entrance was how players ended up outside the room entirely.
      const isEntrance = i === 0 && j === 0;
      const cat = isEntrance
        ? CATEGORIES.find((c) => c.id === 'large')
        : pickWeighted(CATEGORIES, rand);

      const w = lerp(cat.w[0], cat.w[1], rand());
      const d = lerp(cat.d[0], cat.d[1], rand());

      // Jitter is bounded twice: keep the room inside its plot, and keep the
      // centre spine band inside the room.
      const jxMax = Math.min(GEN.plotW / 2 - GEN.inset - w / 2, w / 2 - cw / 2 - 0.2);
      const jzMax = Math.min(GEN.plotD / 2 - GEN.inset - d / 2, d / 2 - cw / 2 - 0.2);
      const jx = (rand() * 2 - 1) * Math.max(0, jxMax);
      const jz = (rand() * 2 - 1) * Math.max(0, jzMax);

      plots.push({
        i, j, cat: cat.id, cx, cz,
        x0: cx + jx - w / 2, x1: cx + jx + w / 2,
        z0: cz + jz - d / 2, z1: cz + jz + d / 2,
        lightScale: cat.lightScale,
        propRange: cat.props,
      });
    }
  }
  const plotAt = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? null : plots[j * cols + i]);

  // -- 2. Carve the maze ----------------------------------------------------

  const links = new Set();
  const linkKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const idx = (i, j) => j * cols + i;

  // Recursive backtracker, iterative so deep mazes don't blow the stack.
  const seen = new Array(cols * rows).fill(false);
  const stack = [idx(0, 0)];
  seen[0] = true;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const ci = cur % cols, cj = (cur / cols) | 0;
    const options = [];
    if (ci > 0 && !seen[idx(ci - 1, cj)]) options.push(idx(ci - 1, cj));
    if (ci < cols - 1 && !seen[idx(ci + 1, cj)]) options.push(idx(ci + 1, cj));
    if (cj > 0 && !seen[idx(ci, cj - 1)]) options.push(idx(ci, cj - 1));
    if (cj < rows - 1 && !seen[idx(ci, cj + 1)]) options.push(idx(ci, cj + 1));
    if (!options.length) { stack.pop(); continue; }
    const next = options[(rand() * options.length) | 0];
    links.add(linkKey(cur, next));
    seen[next] = true;
    stack.push(next);
  }

  // A perfect maze is all dead ends, which is atmospheric but unfair once
  // something is chasing you. Sprinkle in loops so there is a way around.
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (i < cols - 1 && rand() < difficulty.loopChance) links.add(linkKey(idx(i, j), idx(i + 1, j)));
      if (j < rows - 1 && rand() < difficulty.loopChance) links.add(linkKey(idx(i, j), idx(i, j + 1)));
    }
  }

  // -- 3. Rooms, corridors and doors ---------------------------------------

  const rooms = [];
  const doors = [];
  let corridorNo = 0;
  let tunnelNo = 0;

  for (const p of plots) {
    rooms.push({
      id: `r${p.i}_${p.j}`,
      name: roomName(p, rand),
      x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1,
      // Aged timber. The texture supplies the grain; these supply the colour
      // and how dark it sits, which is where the mood actually comes from.
      floor: shade(0x33261a, rand, 0.18),
      wall: shade(0x3f2f1f, rand, 0.18),
      ceil: shade(0x1d1610, rand, 0.14),
      plot: p,
      isCorridor: false,
    });
  }

  // Crawl tunnels are laid on top of the maze as extra connections between
  // plots that the maze did not already join. They are the only route the ghost
  // cannot take, so they are shortcuts bought with vulnerability: you move at
  // half speed, on your knees, in the dark.
  const tunnelLinks = new Set();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const here = idx(i, j);
      if (i < cols - 1) {
        const k = linkKey(here, idx(i + 1, j));
        if (!links.has(k) && rand() < (difficulty.tunnelChance ?? 0)) tunnelLinks.add(k);
      }
      if (j < rows - 1) {
        const k = linkKey(here, idx(i, j + 1));
        if (!links.has(k) && rand() < (difficulty.tunnelChance ?? 0)) tunnelLinks.add(k);
      }
    }
  }

  const connect = (key, tunnel) => {
    const [a, b] = key.split('|').map(Number);
    const pa = plots[a], pb = plots[b];
    const horizontal = pa.j === pb.j;
    const [lo, hi] = horizontal
      ? (pa.cx < pb.cx ? [pa, pb] : [pb, pa])
      : (pa.cz < pb.cz ? [pa, pb] : [pb, pa]);

    const width = tunnel ? GEN.tunnelWidth : cw;
    const doorHeight = tunnel ? CONFIG.tunnelDoorHeight : CONFIG.doorHeight;
    const id = tunnel ? `t${tunnelNo++}` : `c${corridorNo++}`;
    const loId = `r${lo.i}_${lo.j}`;
    const hiId = `r${hi.i}_${hi.j}`;

    const shell = {
      id,
      name: tunnel ? 'Crawlspace' : 'Passage',
      isCorridor: true,
      isTunnel: tunnel,
      ceilHeight: tunnel ? CONFIG.tunnelHeight : CONFIG.roomHeight,
      floor: tunnel ? 0x1f1811 : 0x2a2016,
      wall: tunnel ? 0x2a2015 : 0x352818,
      ceil: tunnel ? 0x140f0a : 0x181209,
    };

    if (horizontal) {
      const band = lo.cz;                       // shared plot centre Z
      rooms.push({ ...shell, x0: lo.x1, x1: hi.x0, z0: band - width / 2, z1: band + width / 2 });
      doors.push({ a: loId, b: id, axis: 'x', coord: lo.x1, center: band, width, height: doorHeight, tunnel });
      doors.push({ a: id, b: hiId, axis: 'x', coord: hi.x0, center: band, width, height: doorHeight, tunnel });
    } else {
      const band = lo.cx;
      rooms.push({ ...shell, x0: band - width / 2, x1: band + width / 2, z0: lo.z1, z1: hi.z0 });
      doors.push({ a: loId, b: id, axis: 'z', coord: lo.z1, center: band, width, height: doorHeight, tunnel });
      doors.push({ a: id, b: hiId, axis: 'z', coord: hi.z0, center: band, width, height: doorHeight, tunnel });
    }
  };

  for (const key of links) connect(key, false);
  for (const key of tunnelLinks) connect(key, true);

  // -- 4. Nav graph ---------------------------------------------------------
  // Built after both corridors and tunnels exist, so every edge is present.

  const nav = buildNav(rooms, doors);

  // -- 5. Entrance and exit -------------------------------------------------

  const entrance = rooms[0];                      // plot (0,0)
  const far = farthestRoom(nav, entrance.id, rooms);
  const exit = far;
  exit.isExit = true;
  entrance.name = 'Entrance';
  exit.name = 'The way out';

  // -- 6. Lights ------------------------------------------------------------

  const lights = [];

  // Flicker channel: 0 steady, 1 and 2 are the two live channels the shader
  // can modulate. Two rather than one, so a corridor full of failing bulbs
  // does not blink in perfect unison like a stage cue.
  let flickerToggle = 1;

  for (const r of rooms) {
    if (r.isTunnel) continue;                       // crawlspaces are unlit, always
    if (r.isCorridor) {
      // Long passages need a light every so often rather than one in the middle.
      const len = Math.max(r.x1 - r.x0, r.z1 - r.z0);
      const slots = Math.max(1, Math.round(len / 8));
      for (let k = 0; k < slots; k++) {
        if (rand() > difficulty.lightChance * 0.7) continue;
        const t = (k + 0.5) / slots;
        const flick = rand() < 0.45 ? (flickerToggle = flickerToggle === 1 ? 2 : 1) : 0;
        lights.push(makeLight(
          lerp(r.x0, r.x1, r.x1 - r.x0 > r.z1 - r.z0 ? t : 0.5),
          lerp(r.z0, r.z1, r.z1 - r.z0 >= r.x1 - r.x0 ? t : 0.5),
          COLD, rand, 0.85, flick,
        ));
      }
      continue;
    }

    const chance = difficulty.lightChance * (r.plot?.lightScale ?? 1);
    if (rand() > chance) continue;

    // Rooms are 6x the floor area they used to be, so one bulb in the middle
    // would leave most of them black. Scale the count with the space.
    const area = (r.x1 - r.x0) * (r.z1 - r.z0);
    const count = Math.max(1, Math.min(3, Math.round(area / 45)));
    for (let k = 0; k < count; k++) {
      const palette = rand() < 0.68 ? WARM : COLD;
      const flick = rand() < 0.22 ? (flickerToggle = flickerToggle === 1 ? 2 : 1) : 0;
      lights.push(makeLight(
        lerp(r.x0 + 1.2, r.x1 - 1.2, rand()),
        lerp(r.z0 + 1.2, r.z1 - 1.2, rand()),
        palette, rand, r.plot?.lightScale ?? 1, flick,
      ));
    }
  }

  // The exit is always lit, always steady, and always the wrong colour for
  // this house. Steady on purpose: it should be the one thing you can trust.
  lights.push({
    x: mid(exit.x0, exit.x1), y: 2.5, z: mid(exit.z0, exit.z1),
    color: 0x9fffc8, intensity: 3.4, range: 12, flicker: 0,
  });

  // -- 7. Props -------------------------------------------------------------

  const props = [];
  for (const r of rooms) {
    if (r.isCorridor || r.isExit) continue;
    const [lo, hi] = r.propRange ?? r.plot?.propRange ?? [1, 3];
    const n = lo + ((rand() * (hi - lo + 1)) | 0);
    // Props now avoid each other as well as the doorway spines. They used to
    // be placed independently, so two could occupy the same square metre.
    const here = [];
    for (let k = 0; k < n; k++) {
      const p = placeFurniture(r, rand, here);
      if (!p) continue;
      props.push(p);
      here.push(p);
    }
  }

  // -- 8. Loot --------------------------------------------------------------

  const candidates = rooms.filter((r) => !r.isCorridor && r !== entrance && !r.isExit);
  shuffle(candidates, rand);
  const loot = [];
  for (let k = 0; k < Math.min(difficulty.lootCount, candidates.length); k++) {
    const r = candidates[k];
    const item = pickWeighted(LOOT_TABLE, rand);
    loot.push({
      ...item,
      uid: `loot${k}`,
      x: lerp(r.x0 + 1.0, r.x1 - 1.0, rand()),
      z: lerp(r.z0 + 1.0, r.z1 - 1.0, rand()),
      room: r.id,
    });
  }

  // -- 8b. Closets ----------------------------------------------------------
  //
  // One per ten rooms, set against a wall and facing back into the room. Only
  // one person fits, and the peephole is the whole point: from outside you can
  // see whether one is already taken, and from inside you can watch the thing
  // walk past without being able to do anything about it.
  const closetRooms = rooms.filter((r) => !r.isCorridor && r.id !== entrance.id && !r.isExit);
  shuffle(closetRooms, rand);
  const closets = [];
  const closetTarget = Math.max(2, Math.round(cols * rows * 0.10));
  const propsByRoom = new Map();
  for (const pr of props) {
    if (!propsByRoom.has(pr.room)) propsByRoom.set(pr.room, []);
    propsByRoom.get(pr.room).push(pr);
  }
  const placed = new Map();     // roomId -> things already put down there

  for (const r of closetRooms) {
    if (closets.length >= closetTarget) break;
    const blockers = [...(propsByRoom.get(r.id) ?? []), ...(placed.get(r.id) ?? [])];
    const spot = againstWall(r, rand, 0.55, blockers);
    if (!spot) continue;
    const closet = { id: `k${closets.length}`, room: r.id, ...spot, w: 1.1, d: 0.8, h: 2.15 };
    closets.push(closet);
    if (!placed.has(r.id)) placed.set(r.id, []);
    placed.get(r.id).push(closet);
  }

  // -- 8c. Relics, their terminals, and the door that needs them ------------
  //
  // Four objects, four holders on the way out. Each sits by a screen you have
  // to sit down and beat, and every second that screen is on it is telling the
  // house exactly where you are.
  const GAMES = ['tiles', 'sums', 'blocks'];
  const relicRooms = rooms.filter(
    (r) => !r.isCorridor && r.id !== entrance.id && !r.isExit
      && !closets.some((c) => c.room === r.id),
  );
  shuffle(relicRooms, rand);
  const relics = [];
  for (let k = 0; k < 4 && k < relicRooms.length; k++) {
    const r = relicRooms[k];
    const blockers = [...(propsByRoom.get(r.id) ?? []), ...(placed.get(r.id) ?? [])];
    const spot = againstWall(r, rand, 0.7, blockers);
    const relic = {
      id: `relic${k}`,
      name: RELIC_NAMES[k],
      room: r.id,
      game: GAMES[k % GAMES.length],
      x: spot ? spot.x : mid(r.x0, r.x1),
      z: spot ? spot.z : mid(r.z0, r.z1),
      facing: spot ? spot.facing : 0,
    };
    relics.push(relic);
    // Register it, or anything placed in this room afterwards — a blackboard,
    // most likely — can land on top of the terminal or block the spot you have
    // to stand in to use it.
    if (!placed.has(r.id)) placed.set(r.id, []);
    placed.get(r.id).push({ ...relic, w: 1.0, d: 0.7 });
  }

  // -- 8d. Blackboards, and the notice by the front door -------------------
  //
  // Boards are the only way to leave something behind for the people you are
  // separated from. Placed like everything else: against a wall, clear of the
  // doorway spines and clear of the furniture.
  const boardRooms = rooms.filter(
    (r) => !r.isCorridor && r.id !== entrance.id && !r.isExit,
  );
  shuffle(boardRooms, rand);
  const boards = [];
  const boardTarget = Math.max(2, Math.round(cols * rows * 0.09));
  for (const r of boardRooms) {
    if (boards.length >= boardTarget) break;
    const blockers = [...(propsByRoom.get(r.id) ?? []), ...(placed.get(r.id) ?? [])];
    const spot = againstWall(r, rand, 0.18, blockers);
    if (!spot) continue;
    const board = { id: `b${boards.length}`, room: r.id, ...spot };
    boards.push(board);
    if (!placed.has(r.id)) placed.set(r.id, []);
    placed.get(r.id).push({ ...board, w: 1.9, d: 0.5 });
  }

  // The rules, on the wall of the room you wake up in.
  // Tried several times before falling back: the fallback ignores the doorway
  // spines, so it must genuinely be a last resort rather than the usual path.
  let noticeSpot = null;
  for (let attempt = 0; attempt < 6 && !noticeSpot; attempt++) {
    noticeSpot = againstWall(entrance, rand, 0.14, propsByRoom.get(entrance.id) ?? []);
  }
  noticeSpot = noticeSpot
    ?? { x: mid(entrance.x0, entrance.x1) + 1.6, z: entrance.z0 + 0.14, facing: Math.PI };

  // Four holders across the face of the exit door.
  const exitCx = mid(exit.x0, exit.x1);
  const exitCz = mid(exit.z0, exit.z1);
  const holders = [0, 1, 2, 3].map((i) => ({
    index: i,
    x: exitCx + (i - 1.5) * 0.75,
    z: exitCz,
  }));

  // -- 9. Ghost spawn and par time -----------------------------------------

  // Deliberately maximise the *smaller* of the two graph distances. Picking
  // "farthest from the exit" would land it next to the entrance, because the
  // exit is by construction the farthest room from there — the ghost would
  // spawn on the player's head. Far from both endpoints puts it mid-maze.
  const dFromEntrance = bfsDistances(nav, entrance.id);
  const dFromExit = bfsDistances(nav, exit.id);
  //
  // With more than one of them, spacing them from each other matters as much as
  // spacing them from the player: three ghosts that spawn in the same wing are
  // one ghost with extra steps, and leave two thirds of the house empty.
  // Roughly one per ten rooms. A fixed three barely registered in a
  // 187-room house — you could walk for minutes without meeting anything.
  const ghostCount = Math.max(
    1, Math.min(28, Math.round(cols * rows * (difficulty.ghostShare ?? 0.10))),
  );
  const ghostPool = rooms.filter(
    (r) => !r.isCorridor && r.id !== entrance.id && r.id !== exit.id
      && dFromEntrance.has(r.id) && dFromExit.has(r.id),
  );
  const ghostRooms = [];
  for (let g = 0; g < ghostCount && ghostPool.length; g++) {
    let best = null, bestScore = -Infinity;
    for (const r of ghostPool) {
      if (ghostRooms.includes(r)) continue;
      const fromEnds = Math.min(dFromEntrance.get(r.id), dFromExit.get(r.id));
      let fromPeers = Infinity;
      for (const other of ghostRooms) {
        fromPeers = Math.min(fromPeers, Math.hypot(
          mid(r.x0, r.x1) - mid(other.x0, other.x1),
          mid(r.z0, r.z1) - mid(other.z0, other.z1),
        ) / GEN.plotW);
      }
      const score = ghostRooms.length ? Math.min(fromEnds, fromPeers) : fromEnds;
      if (score > bestScore) { bestScore = score; best = r; }
    }
    if (!best) break;
    ghostRooms.push(best);
  }
  const ghostStart = ghostRooms[0] ?? exit;

  // Par is measured off the maze rather than guessed per difficulty: the
  // shortest route walked at full speed, times three for getting lost, plus a
  // detour allowance per item worth collecting.
  const route = findPath(nav, entrance.id, exit.id);
  let metres = 0;
  let prev = { x: mid(entrance.x0, entrance.x1), z: mid(entrance.z0, entrance.z1) };
  for (const w of route) { metres += Math.hypot(w.x - prev.x, w.z - prev.z); prev = w; }
  const parSeconds = Math.round((metres / 3.1) * 3.0 + difficulty.lootCount * 8);

  // Scale the bake tessellation with the maze so load time stays sane.
  // Rooms are back to their original size but there are roughly 2.5x as many,
  // so total surface area still grew a great deal. The step scales with plot
  // count to hold the vertex budget; the cap is what stops the largest house
  // from spending half a second in the bake.
  CONFIG.bakeStep = clamp(0.30 * Math.sqrt((cols * rows) / 14), 0.30, 0.62)
    * (CONFIG.bakeStepScale ?? 1);
  CONFIG.fogDensity = difficulty.fogDensity;

  return {
    seed,
    difficulty: difficulty.id,
    spawn: {
      x: mid(entrance.x0, entrance.x1),
      z: mid(entrance.z0, entrance.z1),
      yaw: Math.PI,
      // How far out the spawn ring may go before it meets a wall. Callers
      // clamp to this instead of guessing a radius.
      radius: Math.max(0, Math.min(
        (entrance.x1 - entrance.x0) / 2,
        (entrance.z1 - entrance.z0) / 2,
      ) - 1.0),
    },
    rooms, doors, lights, props, loot, nav,
    entranceId: entrance.id,
    exitId: exit.id,
    closets,
    relics,
    holders,
    boards,
    notice: noticeSpot,
    parSeconds,
    routeMetres: Math.round(metres),
    trapInterval: difficulty.trapInterval ?? 0,
    ghostSpawn: { x: mid(ghostStart.x0, ghostStart.x1), z: mid(ghostStart.z0, ghostStart.z1), node: ghostStart.id },
    ghostSpawns: ghostRooms.map((r) => ({
      x: mid(r.x0, r.x1), z: mid(r.z0, r.z1), node: r.id,
    })),
    ghostCount,
    bounds: {
      x0: 0, z0: 0,
      x1: cols * GEN.plotW, z1: rows * GEN.plotD,
    },
    stats: {
      plots: cols * rows, corridors: corridorNo, tunnels: tunnelNo,
      lights: lights.length, props: props.length,
      closets: closets.length, ghosts: ghostCount, boards: boards.length,
    },
  };
}

// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mid = (a, b) => (a + b) / 2;

function shade(hex, rand, amount) {
  const f = 1 + (rand() * 2 - 1) * amount;
  const r = clamp(Math.round(((hex >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((hex >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((hex & 255) * f), 0, 255);
  return (r << 16) | (g << 8) | b;
}

function makeLight(x, z, palette, rand, scale, flicker = 0) {
  return {
    x, y: lerp(2.1, 2.6, rand()), z,
    color: palette[(rand() * palette.length) | 0],
    intensity: lerp(1.8, 3.1, rand()) * scale,
    range: lerp(6.5, 9.5, rand()),
    flicker,
  };
}

const NAMES = ['Bedroom', 'Study', 'Pantry', 'Parlour', 'Nursery', 'Cellar room',
  'Washroom', 'Store room', 'Dining room', 'Sitting room', 'Music room',
  'Linen room', 'Servants\u2019 room', 'Gallery', 'Chapel'];

function roomName(p, rand) {
  if (p.cat === 'hall') return 'Great hall';
  if (p.cat === 'closet') return 'Closet';
  return NAMES[(rand() * NAMES.length) | 0];
}

const RELIC_NAMES = ['Brass key', 'Cracked lens', 'Bone comb', 'Iron seal'];

/** Circle of radius r at (x,z) against an axis-aligned obstacle footprint. */
function overlaps(x, z, r, o) {
  const hw = (o.w ?? 0.9) / 2 + r;
  const hd = (o.d ?? 0.9) / 2 + r;
  return Math.abs(x - o.x) < hw && Math.abs(z - o.z) < hd;
}

/**
 * A point set against one of a room's walls, facing back into the room.
 * Returns null for rooms too small to hold the object clear of the doorways.
 */
function againstWall(r, rand, depth, obstacles = []) {
  const cw = GEN.corridorWidth;
  const cx = r.plot ? r.plot.cx : mid(r.x0, r.x1);
  const cz = r.plot ? r.plot.cz : mid(r.z0, r.z1);
  const margin = 1.0;

  for (let attempt = 0; attempt < 10; attempt++) {
    const side = (rand() * 4) | 0;
    let x, z, facing;
    // Facing must point INTO the room. With rotation order YXZ forward is
    // (-sin y, -cos y), so an object on the south wall wants yaw = PI, not 0.
    // Getting this backwards puts every closet door and screen inside the wall.
    if (side === 0)      { x = lerp(r.x0 + margin, r.x1 - margin, rand()); z = r.z0 + depth; facing = Math.PI; }
    else if (side === 1) { x = lerp(r.x0 + margin, r.x1 - margin, rand()); z = r.z1 - depth; facing = 0; }
    else if (side === 2) { z = lerp(r.z0 + margin, r.z1 - margin, rand()); x = r.x0 + depth; facing = -Math.PI / 2; }
    else                 { z = lerp(r.z0 + margin, r.z1 - margin, rand()); x = r.x1 - depth; facing = Math.PI / 2; }

    // Never sit in a doorway's approach: the spine through the room centre is
    // what every door opens onto.
    if (Math.abs(x - cx) < cw / 2 + 0.9) continue;
    if (Math.abs(z - cz) < cw / 2 + 0.9) continue;
    // The inset guard must not be larger than the depth being asked for, or
    // anything mounted flat against a wall — a board, a notice — is rejected
    // before it is ever considered. Freestanding objects still get 0.4 m.
    const edge = Math.min(0.4, depth);
    if (x < r.x0 + edge || x > r.x1 - edge || z < r.z0 + edge || z > r.z1 - edge) continue;

    // Furniture is placed first, so an object dropped against a wall can land
    // on a wardrobe, and the spot a player has to stand in to use it can be
    // occupied even when the object itself is clear. Check both: half of them
    // were unreachable before this.
    const ax = x - Math.sin(facing) * 1.15;
    const az = z - Math.cos(facing) * 1.15;
    if (obstacles.some((o) => overlaps(x, z, 0.75, o) || overlaps(ax, az, 0.65, o))) continue;

    return { x, z, facing };
  }
  return null;
}

function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Props must never block the cross-shaped spine through a room's centre,
 * because that spine is what every doorway opens onto. Keeping it clear is
 * what guarantees the maze stays traversable without ever running a solver.
 */
/**
 * Furniture. Each kind has a real footprint, so a supplied model can be scaled
 * to it and the collider still matches what you see. Anything marked `wall`
 * is set against one and faces back into the room; the rest stand free.
 *
 * `mount` lifts a thing off the floor — paintings hang, they do not stand.
 */
const FURNITURE = [
  { kind: 'chair',    weight: 18, w: [0.48, 0.62], d: [0.48, 0.62], h: [0.85, 1.05] },
  { kind: 'table',    weight: 12, w: [1.00, 1.80], d: [0.80, 1.20], h: [0.70, 0.80] },
  { kind: 'crate',    weight: 12, w: [0.55, 0.90], d: [0.55, 0.90], h: [0.45, 0.85] },
  { kind: 'lamp',     weight:  7, w: [0.34, 0.46], d: [0.34, 0.46], h: [1.20, 1.60] },
  { kind: 'rug',      weight:  8, w: [1.60, 2.60], d: [1.20, 2.00], h: [0.02, 0.03], noCollide: true },
  { kind: 'bed',      weight:  8, w: [1.35, 1.75], d: [1.95, 2.20], h: [0.55, 0.75], wall: true },
  { kind: 'shelf',    weight: 11, w: [0.85, 1.60], d: [0.32, 0.45], h: [1.60, 2.10], wall: true },
  { kind: 'cabinet',  weight: 10, w: [0.90, 1.40], d: [0.50, 0.68], h: [1.10, 1.80], wall: true },
  { kind: 'painting', weight: 10, w: [0.55, 1.05], d: [0.06, 0.09], h: [0.45, 0.85],
    wall: true, mount: 1.55, noCollide: true },
];

const FURNITURE_TINT = {
  chair: 0x2f2318, table: 0x33261a, crate: 0x3a2c1c, lamp: 0x4a3a24,
  rug: 0x4a2620, bed: 0x2c2119, shelf: 0x2a1f14, cabinet: 0x30241a,
  painting: 0x5a4326,
};

function placeFurniture(r, rand, obstacles) {
  const cat = pickWeighted(FURNITURE, rand);
  const w = lerp(cat.w[0], cat.w[1], rand());
  const d = lerp(cat.d[0], cat.d[1], rand());
  const h = lerp(cat.h[0], cat.h[1], rand());

  let spot;
  if (cat.wall) {
    spot = againstWall(r, rand, d / 2 + 0.08, obstacles);
  } else {
    spot = tryPlaceProp(r, rand, Math.max(w, d), obstacles);
  }
  if (!spot) return null;

  // Against a side wall the piece stands end-on, so its axis-aligned footprint
  // is the other way round. Colliders and the fallback box both read w/d
  // directly, so resolve it here rather than in three places downstream.
  const endOn = Math.abs(Math.cos(spot.facing ?? 0)) < 0.5;
  return {
    room: r.id,
    kind: cat.kind,
    x: spot.x, z: spot.z,
    y: cat.mount ?? 0,
    w: endOn ? d : w,
    d: endOn ? w : d,
    h,
    facing: spot.facing ?? rand() * Math.PI * 2,
    noCollide: !!cat.noCollide,
    color: shade(FURNITURE_TINT[cat.kind] ?? 0x2b2119, rand, 0.22),
  };
}

function tryPlaceProp(r, rand, size = 1.2, obstacles = []) {
  const cw = GEN.corridorWidth;
  const cx = r.plot ? r.plot.cx : mid(r.x0, r.x1);
  const cz = r.plot ? r.plot.cz : mid(r.z0, r.z1);
  const pad = 0.7;

  for (let attempt = 0; attempt < 10; attempt++) {
    const half = size / 2;
    const x = lerp(r.x0 + half + 0.35, r.x1 - half - 0.35, rand());
    const z = lerp(r.z0 + half + 0.35, r.z1 - half - 0.35, rand());

    if (Math.abs(x - cx) < cw / 2 + pad + half) continue;
    if (Math.abs(z - cz) < cw / 2 + pad + half) continue;
    if (obstacles.some((o) => overlaps(x, z, half + 0.25, o))) continue;

    return { x, z, facing: rand() * Math.PI * 2 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Nav graph: one node per room and corridor, edges through doorways with the
// doorway's world position as the waypoint. The ghost paths on this.
// ---------------------------------------------------------------------------

function buildNav(rooms, doors) {
  const nodes = new Map();
  for (const r of rooms) {
    nodes.set(r.id, {
      id: r.id,
      x: mid(r.x0, r.x1),
      z: mid(r.z0, r.z1),
      rect: { x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1 },
      edges: [],
      isCorridor: !!r.isCorridor,
      isTunnel: !!r.isTunnel,
    });
  }
  for (const d of doors) {
    const A = nodes.get(d.a), B = nodes.get(d.b);
    if (!A || !B) continue;
    const wx = d.axis === 'x' ? d.coord : d.center;
    const wz = d.axis === 'x' ? d.center : d.coord;
    const cost = Math.hypot(A.x - B.x, A.z - B.z);
    const crawl = !!d.tunnel;
    A.edges.push({ to: B.id, wx, wz, cost, crawl });
    B.edges.push({ to: A.id, wx, wz, cost, crawl });
  }
  return { nodes };
}

function bfsDistances(nav, fromId) {
  const dist = new Map([[fromId, 0]]);
  const queue = [fromId];
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    for (const e of nav.nodes.get(id).edges) {
      if (dist.has(e.to)) continue;
      dist.set(e.to, dist.get(id) + 1);
      queue.push(e.to);
    }
  }
  return dist;
}

function farthestRoom(nav, fromId, pool) {
  const dist = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length) {
    const id = queue.shift();
    const node = nav.nodes.get(id);
    for (const e of node.edges) {
      if (dist.has(e.to)) continue;
      dist.set(e.to, dist.get(id) + 1);
      queue.push(e.to);
    }
  }
  let best = null, bestD = -1;
  for (const r of pool) {
    if (r.isCorridor) continue;
    const d = dist.get(r.id);
    if (d !== undefined && d > bestD) { bestD = d; best = r; }
  }
  return best ?? pool.find((r) => !r.isCorridor) ?? pool[0];
}

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    this.ids.push(id); this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this._swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.ids[0];
    const lastId = this.ids.pop(), lastKey = this.keys.pop();
    if (this.ids.length) {
      this.ids[0] = lastId; this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this._swap(i, m); i = m;
      }
    }
    return top;
  }
  _swap(a, b) {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

/**
 * A* over the nav graph.
 * @param allowCrawl false for the ghost, which is too tall for the tunnels.
 *   Colliders enforce this physically as well; refusing the edges here just
 *   stops it planning a route it would then stand and grind against.
 */
export function findPath(nav, fromId, toId, allowCrawl = true) {
  if (fromId === toId) return [];
  const goal = nav.nodes.get(toId);
  if (!goal) return [];

  // A binary heap rather than sorting the open list on every pop. With one
  // ghost the sort was invisible; with one per ten rooms it is nineteen
  // searches a second over four hundred nodes.
  const open = new MinHeap();
  open.push(fromId, 0);
  const g = new Map([[fromId, 0]]);
  const cameFrom = new Map();

  while (open.size) {
    const cur = open.pop();
    if (cur === toId) break;
    const node = nav.nodes.get(cur);
    const base = g.get(cur);
    for (const e of node.edges) {
      if (!allowCrawl && e.crawl) continue;
      const tentative = base + e.cost;
      if (g.has(e.to) && tentative >= g.get(e.to)) continue;
      g.set(e.to, tentative);
      cameFrom.set(e.to, { from: cur, wx: e.wx, wz: e.wz });
      const n = nav.nodes.get(e.to);
      open.push(e.to, tentative + Math.hypot(n.x - goal.x, n.z - goal.z));
    }
  }

  if (!cameFrom.has(toId)) return [];
  const chain = [];
  let id = toId;
  while (id !== fromId) {
    const step = cameFrom.get(id);
    if (!step) return [];
    const n = nav.nodes.get(id);
    chain.push({ x: n.x, z: n.z });      // node centre
    chain.push({ x: step.wx, z: step.wz }); // the doorway to reach it
    id = step.from;
  }
  chain.reverse();
  return chain;
}
