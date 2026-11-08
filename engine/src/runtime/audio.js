// Sound for games: built-in synthesised sound effects (so beginners have
// sounds without finding any files) plus imported sound files.

export const BUILTIN_SOUNDS = ['jump', 'coin', 'hit', 'explosion', 'powerup', 'laser', 'click', 'win', 'lose'];

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buffers = new Map(); // asset name -> AudioBuffer
    this.music = null;
    this.muted = false;
    this.master = null;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  async loadAssets(assets) {
    const ctx = this.ensure();
    if (!ctx) return;
    const jobs = [];
    for (const a of Object.values(assets || {})) {
      if (a.kind !== 'sound' || !a.data) continue;
      jobs.push(
        fetch(a.data)
          .then((r) => r.arrayBuffer())
          .then((buf) => ctx.decodeAudioData(buf))
          .then((decoded) => this.buffers.set(a.name, decoded))
          .catch(() => {}),
      );
    }
    await Promise.all(jobs);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  play(name, volume = 1) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    this.resume();
    const buf = this.buffers.get(name);
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
      src.start();
      return;
    }
    if (BUILTIN_SOUNDS.includes(name)) this.synth(name, volume);
    else throw new Error(`There is no sound called "${name}". Built-in sounds: ${BUILTIN_SOUNDS.join(', ')}.`);
  }

  playMusic(name, volume = 0.6) {
    const ctx = this.ensure();
    if (!ctx) return;
    this.resume();
    this.stopMusic();
    const buf = this.buffers.get(name);
    if (!buf) throw new Error(`There is no imported sound called "${name}" to use as music.`);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
    this.music = src;
  }

  stopMusic() {
    if (this.music) {
      try { this.music.stop(); } catch (_) { /* already stopped */ }
      this.music = null;
    }
  }

  stopAll() {
    this.stopMusic();
  }

  // Tiny synthesiser for the built-in effects.
  synth(name, volume) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = volume;
    out.connect(this.master);

    const tone = (type, f0, f1, start, dur, vol = 0.4) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t + start);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + start + dur);
      g.gain.setValueAtTime(0.0001, t + start);
      g.gain.exponentialRampToValueAtTime(vol, t + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(g).connect(out);
      o.start(t + start);
      o.stop(t + start + dur + 0.05);
    };
    const noise = (start, dur, vol = 0.5, filterFreq = 1200) => {
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(out);
      src.start(t + start);
    };

    switch (name) {
      case 'jump': tone('square', 260, 620, 0, 0.18, 0.25); break;
      case 'coin': tone('square', 988, 988, 0, 0.07, 0.25); tone('square', 1319, 1319, 0.07, 0.25, 0.25); break;
      case 'hit': tone('sawtooth', 300, 60, 0, 0.2, 0.35); noise(0, 0.12, 0.3, 2000); break;
      case 'explosion': noise(0, 0.6, 0.8, 900); tone('sine', 120, 30, 0, 0.5, 0.5); break;
      case 'powerup': [0, 0.08, 0.16, 0.24].forEach((s, i) => tone('square', 400 + i * 180, 500 + i * 220, s, 0.1, 0.22)); break;
      case 'laser': tone('sawtooth', 1400, 200, 0, 0.18, 0.2); break;
      case 'click': tone('sine', 900, 700, 0, 0.05, 0.3); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, i * 0.12, 0.25, 0.3)); break;
      case 'lose': [440, 370, 311, 220].forEach((f, i) => tone('triangle', f, f * 0.97, i * 0.16, 0.3, 0.3)); break;
      default: break;
    }
  }
}
