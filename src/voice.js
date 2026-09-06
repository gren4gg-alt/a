// ---------------------------------------------------------------------------
// Proximity voice.
//
// Deliberately a FULL MESH, unlike game state. Routing audio through the host
// would double every packet's latency and put five upstream audio flows on one
// player's connection — the host would sound worst and everyone would hear the
// lag. At six players a mesh is five up and five down each, which any
// connection that can do a video call handles comfortably.
//
// Each incoming stream goes through a PannerNode positioned at that player's
// avatar, so voices fade with distance and come from the right direction. That
// is the whole social mechanic: you can hear someone two rooms away shouting,
// faintly, and you cannot hear them across the maze.
// ---------------------------------------------------------------------------

const MAX_DISTANCE = 22;
const REF_DISTANCE = 2.5;

export class Voice {
  constructor(audio) {
    this.audio = audio;           // shared Audio instance, for its AudioContext
    this.stream = null;
    this.enabled = false;
    this.muted = false;
    this.pushToTalk = true;
    this.talking = false;
    this.denied = false;
    /** Peers we could not establish audio with. Voice only; nothing else. */
    this.failed = new Set();
    /** peerId -> { n, at }: retry count and last attempt, for the backoff. */
    this.attempts = new Map();
    /** Elements blocked by autoplay policy, replayed on the next gesture. */
    this._blocked = new Set();
    this.peers = new Map();       // peerId -> { call, panner, gain, el, source }
    this.onStatus = null;

    // The raw microphone goes through a gain node before it reaches anyone, so
    // the input slider is a real change to what is transmitted rather than a
    // hint to the other end. The analyser sits after it, which means the level
    // the ghost hears is the level everyone else hears.
    this.inputGain = null;
    this.analyser = null;
    this.outgoing = null;
    this.level = 0;
    this._levelData = null;
  }

  get ctx() { return this.audio.ctx; }

  async enable() {
    if (this.enabled) return true;
    this.audio.resume();
    if (!this.ctx) return false;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      this._buildInputChain();
      this.enabled = true;
      this.denied = false;
      this._applyTracks();
      this.onStatus?.('on');
      return true;
    } catch (err) {
      // NotAllowedError means they said no (or the browser remembered a no).
      // Anything else is usually no input device at all — different fix, so
      // different message.
      this.denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      this.onStatus?.(this.denied ? 'denied' : 'nodevice');
      return false;
    }
  }

  _buildInputChain() {
    const ctx = this.ctx;
    if (!ctx || !this.stream) { this.outgoing = this.stream; return; }
    const source = ctx.createMediaStreamSource(this.stream);
    this.inputGain = ctx.createGain();
    this.inputGain.gain.value = this._pendingGain ?? 1;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.6;
    this._levelData = new Uint8Array(this.analyser.fftSize);

    const dest = ctx.createMediaStreamDestination();
    source.connect(this.inputGain);
    this.inputGain.connect(this.analyser);
    this.inputGain.connect(dest);
    this.outgoing = dest.stream;
  }

  /** 0..1, roughly how loud you are right now. Read every frame. */
  sampleLevel() {
    if (!this.analyser || !this.enabled || this.muted) { this.level = 0; return 0; }
    this.analyser.getByteTimeDomainData(this._levelData);
    let sum = 0;
    for (let i = 0; i < this._levelData.length; i++) {
      const v = (this._levelData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this._levelData.length);
    // Perceptual-ish curve so normal speech sits mid-range instead of near zero.
    const shaped = Math.min(1, Math.pow(rms * 3.4, 0.7));
    this.level += (shaped - this.level) * 0.35;
    return this.level;
  }

  setInputGain(g) {
    this._pendingGain = g;
    if (this.inputGain && this.ctx) {
      this.inputGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Push to talk. Separate from setMuted so the mute button and the talk key
   * cannot fight each other: muted always wins.
   */
  setTalking(talking) {
    this.talking = talking;
    this._applyTracks();
  }

  setMuted(muted) {
    this.muted = muted;
    this._applyTracks();
    this.onStatus?.(muted ? 'muted' : 'on');
  }

  _applyTracks() {
    if (!this.stream) return;
    const live = !this.muted && (!this.pushToTalk || this.talking);
    for (const track of this.stream.getAudioTracks()) track.enabled = live;
  }

  setPushToTalk(on) {
    this.pushToTalk = on;
    this._applyTracks();
  }

  /**
   * Ring everyone in the room we are not already talking to.
   *
   * SAFE TO CALL REPEATEDLY, and it is meant to be — see reconcile(). That is
   * the fix for voice working for some pairs and not others.
   *
   * The old version ran once per roster change, and combined with the
   * lexicographic tiebreak below that left a hole big enough to drive a bug
   * through: only the peer with the SMALLER id places the call, so if that
   * peer had not switched their microphone on yet, the call was never placed
   * — and nothing ever went back to place it later. Turn your mic on second
   * and, depending on which random id PeerJS handed you, you either worked or
   * you were silent for the whole run with no way to tell which.
   */
  callAll(peer, ids) {
    if (!this.enabled || !peer) return;
    const now = Date.now();
    for (const id of ids) {
      if (id === peer.id || this.peers.has(id)) continue;
      // Lexicographic tiebreak: only one side places the call, or we would end
      // up with two audio paths per pair and everyone doubled.
      if (peer.id > id) continue;

      // Back off on a pair that keeps failing, so a genuinely unreachable peer
      // does not mean a new PeerConnection every few seconds forever.
      const attempt = this.attempts.get(id) ?? { n: 0, at: 0 };
      const wait = Math.min(30000, 2000 * (2 ** attempt.n));
      if (now - attempt.at < wait) continue;
      this.attempts.set(id, { n: attempt.n + 1, at: now });

      const call = peer.call(id, this.outgoing ?? this.stream);
      if (call) this._attach(id, call);
    }
  }

  /**
   * Try again for anybody in the room we still cannot hear.
   *
   * Called on a timer rather than only when the roster changes, because the
   * things that break a pair — one side enabling their microphone later, a
   * candidate gathering failure, a peer connection that dropped mid-run — do
   * not change the roster at all.
   */
  reconcile(peer, ids) {
    if (!this.enabled || !peer) return;
    this.callAll(peer, ids);
  }

  /** Answer an incoming call. */
  accept(call) {
    if (!this.enabled) {
      // Nothing to answer with yet. Closing is right — but the caller has to
      // come back later, which is what reconcile() is for on their side.
      try { call.close(); } catch { /* already gone */ }
      return;
    }
    // Whoever called us got through, so clear their backoff: if we later have
    // to call them, we should not start halfway up a retry ladder.
    this.attempts.delete(call.peer);
    call.answer(this.outgoing ?? this.stream);
    this._attach(call.peer, call);
  }

  _attach(peerId, call) {
    // A pair that cannot complete its own handshake — a strict NAT, a corporate
    // firewall — is normal and must stay contained. Game state goes through the
    // host, so only this one link is lost; everything else keeps working, and
    // the pair is reported rather than silently missing.
    const timer = setTimeout(() => {
      if (!this.peers.has(peerId)) {
        this.failed.add(peerId);
        this.onStatus?.('peerfail');
      }
    }, 12000);
    call.on('stream', (remote) => {
      clearTimeout(timer);
      this.failed.delete(peerId);
      this._connectStream(peerId, call, remote);
    });
    call.on('close', () => { clearTimeout(timer); this.drop(peerId); });
    call.on('error', () => {
      clearTimeout(timer);
      this.failed.add(peerId);
      this.onStatus?.('peerfail');
      this.drop(peerId);
    });
  }

  _connectStream(peerId, call, remote) {
    if (this.peers.has(peerId)) this.drop(peerId);
    const ctx = this.ctx;
    if (!ctx) return;

    // Chrome will not pump a WebRTC MediaStream into Web Audio unless the
    // stream is also attached to a media element. The element stays muted and
    // silent; it exists purely to start the flow. This is a long-standing bug,
    // not a superstition — without it the PannerNode receives nothing.
    const el = new window.Audio();
    el.srcObject = remote;
    el.muted = true;
    el.play().catch(() => {
      // Autoplay policy. The comment here used to say "retried on next
      // gesture" and nothing retried, so a tab that had not been clicked yet
      // when somebody joined lost that voice permanently. resumeBlocked() is
      // the retry, and main.js calls it on the first real interaction.
      this._blocked.add(el);
    });

    const source = ctx.createMediaStreamSource(remote);
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = REF_DISTANCE;
    panner.maxDistance = MAX_DISTANCE;
    panner.rolloffFactor = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = 1.0;

    source.connect(panner).connect(gain).connect(this.audio.voiceBus ?? ctx.destination);
    this.peers.set(peerId, { call, panner, gain, el, source });
  }

  /**
   * Play anything the autoplay policy refused. Cheap and idempotent; call it
   * from any user gesture.
   */
  resumeBlocked() {
    this.audio.resume();
    for (const el of [...this._blocked]) {
      el.play().then(() => this._blocked.delete(el)).catch(() => { /* still blocked */ });
    }
  }

  /** Move a voice to where that player's avatar is standing. */
  setPosition(peerId, x, y, z) {
    const p = this.peers.get(peerId);
    if (!p || !this.ctx) return;
    const t = this.ctx.currentTime;
    if (p.panner.positionX) {
      p.panner.positionX.setTargetAtTime(x, t, 0.03);
      p.panner.positionY.setTargetAtTime(y, t, 0.03);
      p.panner.positionZ.setTargetAtTime(z, t, 0.03);
    } else {
      p.panner.setPosition(x, y, z);   // Safari
    }
  }

  /** Point the listener at the camera each frame. */
  setListener(camera) {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    // Forward is -Z of the camera basis; up is +Y.
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];

    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.setTargetAtTime(ux, t, 0.02);
      l.upY.setTargetAtTime(uy, t, 0.02);
      l.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  /** Downed players speak more quietly. Small touch, big effect. */
  setVolume(peerId, v) {
    const p = this.peers.get(peerId);
    if (p && this.ctx) p.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.15);
  }

  /** How many people you can hear, and how many you cannot. */
  get linkReport() {
    return { connected: this.peers.size, failed: this.failed.size };
  }

  /** Forget a peer entirely — they left the room, not just the call. */
  forget(peerId) {
    this.drop(peerId);
    this.attempts.delete(peerId);
    this.failed.delete(peerId);
  }

  drop(peerId) {
    this.failed.delete(peerId);
    const p = this.peers.get(peerId);
    if (!p) return;
    this._blocked.delete(p.el);
    try { p.source.disconnect(); p.panner.disconnect(); p.gain.disconnect(); } catch { /* already torn down */ }
    try { p.el.srcObject = null; } catch { /* ignore */ }
    try { p.call.close(); } catch { /* ignore */ }
    this.peers.delete(peerId);
  }

  shutdown() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.attempts.clear();
    this.failed.clear();
    this._blocked.clear();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    // The nodes built in _buildInputChain outlive the stream otherwise, and a
    // second enable() stacks another chain onto the same context.
    try { this.inputGain?.disconnect(); this.analyser?.disconnect(); } catch { /* already down */ }
    this.inputGain = null;
    this.analyser = null;
    this.outgoing = null;
    this.stream = null;
    this.enabled = false;
  }
}
