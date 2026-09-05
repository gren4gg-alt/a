import { adjacency, RoomLookup, CONFIG } from './level.js';

// ---------------------------------------------------------------------------
// Visibility.
//
// Frustum culling alone is useless indoors — it has no idea a wall is in the
// way, so it happily draws the far side of the maze. Portal culling fixes that,
// but at maze scale it needs two adjustments over the six-room version:
//
//   * Two hops, not one. Corridors are nav nodes, so a room you can see through
//     a doorway is room -> corridor -> room away. One hop would pop it out of
//     existence while you stared straight down the passage at it.
//
//   * A distance cutoff. Past ~34 m the fog is opaque, so anything beyond it is
//     invisible whatever the graph says. On a 156-room maze this is what keeps
//     the frame cost flat: the visible set stops growing with the maze.
//
// Walls are chunked on a coarse grid rather than portal-culled. Assigning wall
// segments to rooms would leave holes wherever two rects share a plane without
// sharing a door, and a distance test plus three's own frustum culling gets
// almost all of the win with none of the risk.
// ---------------------------------------------------------------------------

export class Visibility {
  /**
   * @param {object} level
   * @param {Map<string, THREE.Object3D>} roomMeshes
   * @param {Array<{mesh: THREE.Object3D, cx: number, cz: number}>} wallChunks
   */
  constructor(level, roomMeshes, wallChunks) {
    this.level = level;
    this.roomMeshes = roomMeshes;
    this.wallChunks = wallChunks;
    this.lookup = new RoomLookup(level);

    const adj = adjacency(level);

    // Precompute the two-hop neighbourhood once. ~10 entries per room on a
    // 156-room maze, so this is a few thousand strings, built in a millisecond.
    this.near = new Map();
    for (const [id, ones] of adj) {
      const set = new Set(ones);
      for (const n of ones) for (const nn of adj.get(n) ?? []) set.add(nn);
      this.near.set(id, set);
    }

    this.centers = new Map();
    for (const r of level.rooms) {
      this.centers.set(r.id, { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
    }

    this.currentId = null;
    this.currentRoom = null;
    this.drawn = 0;
    this._lastKnown = level.entranceId;
  }

  update(px, pz) {
    const room = this.lookup.at(px, pz);
    // Doorways sit fractionally outside both rects; hold the last known room
    // rather than blinking the world off for a frame.
    const id = room ? room.id : this._lastKnown;
    const changed = id !== this.currentId;

    if (changed) {
      this.currentId = id;
      this._lastKnown = id;
      this.currentRoom = room ?? this.currentRoom;
      this._visible = this.near.get(id) ?? new Set([id]);
    }

    const far2 = CONFIG.drawDistance * CONFIG.drawDistance;
    let drawn = 0;

    for (const [roomId, mesh] of this.roomMeshes) {
      let on = this._visible.has(roomId);
      if (on) {
        const c = this.centers.get(roomId);
        const dx = c.x - px, dz = c.z - pz;
        if (dx * dx + dz * dz > far2) on = false;
      }
      mesh.visible = on;
      if (on) drawn++;
    }

    const chunkReach = CONFIG.drawDistance + CONFIG.wallChunkSize * 0.75;
    const chunkReach2 = chunkReach * chunkReach;
    for (const c of this.wallChunks) {
      const dx = c.cx - px, dz = c.cz - pz;
      const on = dx * dx + dz * dz < chunkReach2;
      c.mesh.visible = on;
      if (on) drawn++;
    }

    this.drawn = drawn;
    return changed;
  }

  get roomName() {
    return this.currentRoom?.name ?? '\u2014';
  }
}
