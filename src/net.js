import { Peer } from 'peerjs';

// ---------------------------------------------------------------------------
// Transport.
//
// Star topology: everyone connects to the host, the host relays. At six players
// that is five connections for the host and one for everyone else, which is far
// cheaper than a 15-edge mesh and gives us a single authority for free.
//
// TWO connections per peer, not one. PeerJS sets reliability per *connection*,
// not per message, so mixing 15 Hz position spam with door-unlock events on one
// ordered channel means a single dropped position packet stalls every event
// behind it. That shows up as rubber-banding and late knives. So:
//
//   rel   — ordered and retransmitted: lobby, pickups, downs, revives, endings
//   unrel — unordered, no retransmits: position snapshots, which are worthless
//           the moment a newer one exists
//
// Voice deliberately does NOT go through here. See voice.js.
// ---------------------------------------------------------------------------

export const MSG = {
  HELLO: 'hello',      // client -> host: who I am
  LOBBY: 'lobby',      // host -> all: roster
  CHAR: 'ch',          // player picked a character / toggled ready
  POWER: 'pw',         // someone used an ability
  TRAP: 'tp',          // host laid a snare / someone stepped in one
  HIDE: 'hd',          // someone got into or out of a closet
  RELIC: 'rl',         // terminal started, solved, relic taken, relic placed
  BOARD: 'bd',         // a chalk stroke, or a wipe
  VOTE: 'vt',          // everyone is down: the group revive vote
  DENY: 'no',          // host refusing a join, with a reason
  START: 'start',      // host -> all: difficulty + seed, go build the maze
  LOADED: 'loaded',    // client -> host: my bake finished
  BEGIN: 'begin',      // host -> all: everyone is ready, unpause
  STATE: 'st',         // client -> host: my position (unreliable)
  SNAP: 'sn',          // host -> all: everyone's positions + the ghost (unreliable)
  PICKUP: 'pk',        // pickup claim / confirmation
  KNIFE: 'kn',         // host -> all: a knife was thrown
  DOWN: 'dn',          // host -> all: someone was knocked down
  REVIVE: 'rv',        // client -> host: I finished reviving X / host -> all: confirmed
  END: 'end',          // host -> all: run over
};

/**
 * Bumped whenever the wire format changes. A player on a stale cached build
 * otherwise joins successfully and then behaves inexplicably, which is far
 * harder to diagnose than being told to refresh.
 */
export const PROTOCOL = 5;

/**
 * A stable id for this browser, surviving refreshes.
 *
 * PeerJS hands out a new peer id every page load, so a player who refreshes
 * arrives as a stranger while their old connection sits in the roster until it
 * times out — which is how the same person ends up listed twice. Matching on
 * this instead lets the host recognise a reconnect and replace them.
 */
export function sessionId() {
  const KEY = 'darkhouse.session.v1';
  try {
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    this._mem = this._mem ?? `s${Math.random().toString(36).slice(2, 10)}`;
    return this._mem;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const PREFIX = 'darkhouse-v1-';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.isHost = false;
    this.id = null;
    this.code = null;
    this.hostId = null;
    this.conns = new Map();      // peerId -> { rel, unrel, name, ready }
    this.handlers = new Map();
    this.open = false;
    /** Host-side: return a reason string to refuse a connection, or null. */
    this.gate = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
    return this;
  }

  _emit(type, payload, from) {
    for (const fn of this.handlers.get(type) ?? []) fn(payload, from);
  }

  // -- lifecycle ------------------------------------------------------------

  /**
   * Open a room.
   *
   * The host's peer id is derived from the room code, which means it is
   * guessable — somebody can register `darkhouse-v1-ABCDE` first and hijack
   * that code, and two hosts can collide by chance. PeerServer reports this as
   * `unavailable-id`, so a collision simply takes a different code rather than
   * failing the player with an error they cannot act on.
   */
  hostGame(name, attempt = 0) {
    this.isHost = true;
    this.code = makeCode();
    this.hostId = PREFIX + this.code;
    return new Promise((resolve, reject) => {
      this.peer = new Peer(this.hostId, { debug: 1 });
      this.peer.on('open', (id) => {
        this.id = id;
        this.open = true;
        this._emit('open', { id, code: this.code });
        resolve(this.code);
      });
      this.peer.on('error', (err) => {
        if (!this.open && err?.type === 'unavailable-id' && attempt < 5) {
          try { this.peer.destroy(); } catch { /* never opened */ }
          resolve(this.hostGame(name, attempt + 1));
          return;
        }
        this._emit('error', err);
        if (!this.open) reject(err);
      });
      this.peer.on('connection', (conn) => this._acceptConnection(conn));
      this.peer.on('call', (call) => this._emit('call', call));
    });
  }

  joinGame(code, name) {
    this.isHost = false;
    this.code = code.trim().toUpperCase();
    this.hostId = PREFIX + this.code;
    return new Promise((resolve, reject) => {
      this.peer = new Peer({ debug: 1 });
      const timer = setTimeout(() => reject(new Error('No answer from that code.')), 12000);

      this.peer.on('open', (id) => {
        this.id = id;
        const rel = this.peer.connect(this.hostId, {
          reliable: true, serialization: 'json',
          metadata: { role: 'rel', name, protocol: PROTOCOL, sid: sessionId() },
        });
        const unrel = this.peer.connect(this.hostId, {
          reliable: false, serialization: 'json',
          metadata: { role: 'unrel' },
        });

        this.conns.set(this.hostId, { rel, unrel, name: 'host' });
        this._wire(this.hostId, rel);
        this._wire(this.hostId, unrel);

        rel.on('open', () => {
          clearTimeout(timer);
          this.open = true;
          this.send(this.hostId, MSG.HELLO, { name }, true);
          this._emit('open', { id, code: this.code });
          resolve(this.code);

          // A channel opening only proves the signalling server still has the
          // id registered. If the host closed their tab without the server
          // noticing, the socket opens and then nothing ever arrives. Require
          // a real reply, not just a connection.
          this._handshake = setTimeout(() => {
            if (!this._greeted) this._emit('deadroom', {});
          }, 9000);
        });
      });

      this.peer.on('error', (err) => {
        clearTimeout(timer);
        this._emit('error', err);
        if (!this.open) reject(err);
      });
      this.peer.on('call', (call) => this._emit('call', call));
    });
  }

  _acceptConnection(conn) {
    // A client never expects anybody to dial it. PeerJS ids are visible in the
    // lobby, so without this a stranger could open a channel straight to a
    // client and send it forged state, bypassing the host entirely. Voice is
    // unaffected: media calls arrive through peer.on('call'), not here.
    if (!this.isHost) {
      try { conn.close(); } catch { /* already gone */ }
      return;
    }

    const role = conn.metadata?.role ?? 'rel';
    // Refuse before wiring anything up, so a rejected peer never lands in the
    // roster or receives a snapshot.
    if (role === 'rel' && this.gate) {
      const why = this.gate(conn);
      if (why) {
        conn.on('open', () => {
          conn.send({ t: 'no', d: { why } });
          setTimeout(() => conn.close(), 400);
        });
        return;
      }
    }

    let entry = this.conns.get(conn.peer);
    if (!entry) {
      entry = {
        rel: null, unrel: null, ready: false, announced: false,
        name: conn.metadata?.name ?? 'Someone',
        sid: conn.metadata?.sid ?? null,
        lastSeen: Date.now(),
      };
      this.conns.set(conn.peer, entry);
    }
    entry[role] = conn;
    if (conn.metadata?.name) entry.name = conn.metadata.name;
    if (conn.metadata?.sid) entry.sid = conn.metadata.sid;
    this._wire(conn.peer, conn);

    const announce = () => {
      // Both channels up, and exactly once. Each connection fires its own
      // open event, and if the second is already open when its handler is
      // attached, both would announce — which put the same player in the
      // roster twice.
      if (entry.announced) return;
      if (!entry.rel?.open || !entry.unrel?.open) return;
      entry.announced = true;
      this._emit('joined', { id: conn.peer, name: entry.name, sid: entry.sid });
    };
    conn.on('open', announce);
    announce();     // in case it opened before we got here
  }

  /**
   * Drop a peer deliberately. The reason reaches them before the socket
   * closes, so they see why rather than an unexplained disconnect.
   */
  kick(peerId, why) {
    const entry = this.conns.get(peerId);
    if (!entry) return;
    try { entry.rel?.send({ t: 'no', d: { why, kicked: true } }); } catch { /* already gone */ }
    setTimeout(() => {
      try { entry.rel?.close(); entry.unrel?.close(); } catch { /* already gone */ }
      this._dropped(peerId);
    }, 350);
  }

  /**
   * Heartbeat. PeerJS can take a long time to notice a browser that was closed
   * or went to sleep, and a ghost in the roster blocks a slot and stalls the
   * ready check forever.
   */
  startHeartbeat(timeoutMs = 12000) {
    clearInterval(this._hb);
    this._hb = setInterval(() => {
      const now = Date.now();
      for (const [peerId, entry] of [...this.conns]) {
        if (peerId === this.hostId && !this.isHost) continue;
        if (now - (entry.lastSeen ?? now) > timeoutMs) {
          this._emit('timeout', { id: peerId });
          this._dropped(peerId);
          continue;
        }
        try { entry.rel?.send({ t: 'ping', d: 0 }); } catch { /* dropping next tick */ }
      }
    }, 3000);
  }

  _wire(peerId, conn) {
    conn.on('data', (raw) => {
      if (!raw || typeof raw !== 'object') return;
      const entry = this.conns.get(peerId);
      if (entry) entry.lastSeen = Date.now();     // anything at all counts
      if (!this.isHost) {
        this._greeted = true;
        clearTimeout(this._handshake);
      }
      if (raw.t === 'ping') { try { conn.send({ t: 'pong', d: 0 }); } catch { /* gone */ } return; }
      if (raw.t === 'pong') return;
      this._emit(raw.t, raw.d, peerId);
    });
    conn.on('close', () => this._dropped(peerId));
    conn.on('error', () => this._dropped(peerId));
  }

  _dropped(peerId) {
    if (!this.conns.has(peerId)) return;
    this.conns.delete(peerId);
    this._emit('left', { id: peerId });
  }

  // -- sending --------------------------------------------------------------

  send(peerId, type, data, reliable = true) {
    const entry = this.conns.get(peerId);
    if (!entry) return;
    const conn = reliable ? entry.rel : (entry.unrel ?? entry.rel);
    if (conn?.open) conn.send({ t: type, d: data });
  }

  broadcast(type, data, reliable = true, exceptId = null) {
    for (const [peerId] of this.conns) {
      if (peerId === exceptId) continue;
      this.send(peerId, type, data, reliable);
    }
  }

  /** Clients talk only to the host; the host talks to everyone. */
  toHost(type, data, reliable = true) {
    if (this.isHost) return;
    this.send(this.hostId, type, data, reliable);
  }

  /** On a client, only the host is allowed to say anything. */
  isFromHost(peerId) {
    return !this.isHost && peerId === this.hostId;
  }

  get peerIds() { return [...this.conns.keys()].filter((id) => id !== this.hostId || this.isHost); }

  destroy() {
    clearInterval(this._hb);
    clearTimeout(this._handshake);
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.conns.clear();
    this.handlers.clear();
    this.peer = null;
    this.open = false;
  }
}
