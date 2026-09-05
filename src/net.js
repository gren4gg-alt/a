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

  hostGame(name) {
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
          metadata: { role: 'rel', name },
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
    const role = conn.metadata?.role ?? 'rel';
    let entry = this.conns.get(conn.peer);
    if (!entry) {
      entry = { rel: null, unrel: null, name: conn.metadata?.name ?? 'Someone', ready: false };
      this.conns.set(conn.peer, entry);
    }
    entry[role] = conn;
    if (conn.metadata?.name) entry.name = conn.metadata.name;
    this._wire(conn.peer, conn);

    conn.on('open', () => {
      // Only announce once both channels are up, or we would broadcast a
      // roster to someone who cannot yet hear the unreliable stream.
      if (entry.rel?.open && entry.unrel?.open) this._emit('joined', { id: conn.peer, name: entry.name });
    });
  }

  _wire(peerId, conn) {
    conn.on('data', (raw) => {
      if (!raw || typeof raw !== 'object') return;
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

  get peerIds() { return [...this.conns.keys()].filter((id) => id !== this.hostId || this.isHost); }

  destroy() {
    try { this.peer?.destroy(); } catch { /* already gone */ }
    this.conns.clear();
    this.handlers.clear();
    this.peer = null;
    this.open = false;
  }
}
