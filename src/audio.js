// All sound is synthesised. No files to load, no decode step, and the whole
// thing is about a hundred lines — which for a game whose main feedback channel
// is "how close is it" turns out to be plenty.
//
// The AudioContext starts suspended until a user gesture, so nothing here makes
// noise before the player clicks.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { this.enabled = false; return; }
    this.ctx = new Ctx();

    // Three buses under one master. Without them a "sound effects" slider
    // would also duck the drone and the voices, which is not what anyone means
    // when they drag it.
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.ambienceBus = this.ctx.createGain();
    this.voiceBus = this.ctx.createGain();
    for (const bus of [this.sfxBus, this.ambienceBus, this.voiceBus]) bus.connect(this.master);

    // Reusable noise buffer — generating this once and replaying it is far
    // cheaper than a ScriptProcessor and sounds identical for short bursts.
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this._buildDrone();
    this.ready = true;
    if (this._pending) this.setVolumes(this._pending);
  }

  /** @param v {{master,sfx,ambience,voice}} each 0..1 */
  setVolumes(v) {
    this._pending = v;
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.ambienceBus.gain.setTargetAtTime(v.ambience, t, 0.05);
    this.voiceBus.gain.setTargetAtTime(v.voice, t, 0.05);
  }

  resume() {
    this.init();
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  /** A low bed that swells as the ghost closes in. The main tension channel. */
  _buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneGain.connect(this.ambienceBus);

    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 6;
    this.droneFilter.connect(this.droneGain);

    for (const f of [41, 58, 61.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.28;
      o.connect(g).connect(this.droneFilter);
      o.start();
    }

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const ng = ctx.createGain();
    ng.gain.value = 0.06;
    n.connect(ng).connect(this.droneFilter);
    n.start();
  }

  /** @param {number} proximity 0 = far or unseen, 1 = right behind you */
  setTension(proximity, hunting) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const target = Math.min(1, proximity) * (hunting ? 0.34 : 0.14);
    this.droneGain.gain.setTargetAtTime(target, t, 0.35);
    this.droneFilter.frequency.setTargetAtTime(160 + proximity * 520, t, 0.4);
  }

  _burst({ type = 'sine', freq, freq2, dur, gain = 0.3, noise = false, filter }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    let src;
    if (noise) {
      src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.6;
    } else {
      src = ctx.createOscillator();
      src.type = type;
      src.frequency.setValueAtTime(freq, t);
      if (freq2) src.frequency.exponentialRampToValueAtTime(freq2, t + dur);
    }

    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type ?? 'bandpass';
      f.frequency.setValueAtTime(filter.from, t);
      if (filter.to) f.frequency.exponentialRampToValueAtTime(filter.to, t + dur);
      f.Q.value = filter.Q ?? 2;
      src.connect(f).connect(g).connect(this.sfxBus);
    } else {
      src.connect(g).connect(this.sfxBus);
    }

    src.start(t);
    src.stop(t + dur + 0.05);
  }

  knifeThrow(dist) {
    const near = Math.max(0.15, 1 - dist / 20);
    this._burst({ noise: true, dur: 0.42, gain: 0.22 * near,
                  filter: { type: 'bandpass', from: 2400, to: 500, Q: 4 } });
  }

  hit() {
    this._burst({ type: 'sine', freq: 160, freq2: 42, dur: 0.7, gain: 0.5 });
    this._burst({ noise: true, dur: 0.35, gain: 0.3,
                  filter: { type: 'lowpass', from: 900, to: 180 } });
  }

  pickup(value) {
    const base = 520 + Math.min(value, 320) * 1.4;
    this._burst({ type: 'triangle', freq: base, dur: 0.16, gain: 0.16 });
    setTimeout(() => this._burst({ type: 'triangle', freq: base * 1.5, dur: 0.3, gain: 0.12 }), 70);
  }

  /**
   * A floorboard giving under weight. Three layers, because a creak is not one
   * sound: a low thud where the board takes the load, a slow rising squeal
   * from the nail, and a short splintery scrape. The squeal is what makes it
   * read as old timber rather than a footstep.
   *
   * The player makes none of these. Every creak in the house is something else
   * walking, which is the whole reason the cue works.
   *
   * @param near 0..1 proximity; drives volume and how bright the squeal is
   * @param hunting shorter and harsher when it is actually coming for you
   */
  creak(near, hunting = false) {
    if (!this.ready || !this.enabled) return;
    const g = 0.06 + near * 0.42;
    const jitter = 0.72 + Math.random() * 0.66;
    const dur = hunting ? 0.26 : 0.40;

    // The board taking the weight.
    this._burst({ type: 'sine', freq: 74 * jitter, freq2: 42 * jitter, dur: 0.20, gain: g * 0.9 });

    // The nail. A rising, narrow, slightly detuned squeal.
    this._burst({ type: 'sawtooth', freq: 190 * jitter, freq2: 660 * jitter, dur,
                  gain: g * (hunting ? 0.30 : 0.22),
                  filter: { type: 'bandpass', from: 420 * jitter, to: 1500 * jitter, Q: 9 } });

    // Splinters.
    this._burst({ noise: true, dur: dur * 0.7, gain: g * 0.20,
                  filter: { type: 'bandpass', from: 2400, to: 900, Q: 2 } });
  }

  /**
   * A terminal running. Deliberately unpleasant and deliberately loud: it is
   * the only feedback that the puzzle is calling them towards you, and without
   * it the whole risk of the mechanic is invisible.
   */
  terminalNoise() {
    this._burst({ type: 'square', freq: 240, freq2: 190, dur: 0.5, gain: 0.10,
                  filter: { type: 'bandpass', from: 900, to: 1500, Q: 3 } });
    this._burst({ noise: true, dur: 0.6, gain: 0.09,
                  filter: { type: 'highpass', from: 1800, to: 2600 } });
  }

  escape() {
    [392, 523, 659, 784].forEach((f, i) => {
      setTimeout(() => this._burst({ type: 'triangle', freq: f, dur: 0.9, gain: 0.14 }), i * 110);
    });
  }

  caught() {
    this._burst({ type: 'sawtooth', freq: 90, freq2: 28, dur: 2.0, gain: 0.35 });
  }

  silence() {
    if (this.ready) this.droneGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }
}
