'use strict';
/* Beatforge — sample library: procedurally generated factory sounds plus user imports (IndexedDB). */
(() => {
const DAW = window.DAW;
const U = DAW.util;
const SR = 44100;
const TAU = Math.PI * 2;

/* ---------- tiny DSP helpers used by the generators ---------- */
const noiseGen = seed => { const r = U.rng(seed); return () => r() * 2 - 1; };
function biquad(x, type, f, q) {
  const w = TAU * f / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w);
  let b0, b1, b2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const gen = (sec, fn) => {
  const n = Math.floor(sec * SR), a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn(i / SR, i);
  return a;
};
const mixIn = (...arrs) => {
  const n = Math.max(...arrs.map(a => a.length)), o = new Float32Array(n);
  arrs.forEach(a => { for (let i = 0; i < a.length; i++) o[i] += a[i]; });
  return o;
};
const gain = (a, g) => { for (let i = 0; i < a.length; i++) a[i] *= g; return a; };
const norm = (a, peak) => {
  let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) gain(a, (peak || 0.9) / m);
  // short fade-out so one-shots never end on a click
  const f = Math.min(a.length, 200);
  for (let i = 0; i < f; i++) a[a.length - 1 - i] *= i / f;
  return a;
};
const sat = (a, d) => { for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * d) / Math.tanh(d); return a; };
const sweepSine = (sec, f0, f1, rate, decay, extra) => {
  let ph = 0;
  return gen(sec, t => {
    const f = f1 + (f0 - f1) * Math.exp(-t * rate);
    ph += TAU * f / SR;
    return Math.sin(ph) * Math.exp(-t * decay) * (extra ? extra(t) : 1);
  });
};

/* ---------- factory sounds ---------- */
const F = {};
F.kick808 = () => norm(sat(sweepSine(1.1, 190, 46, 38, 3.2), 1.6));
F.kickPunch = () => { const n = noiseGen(1); return norm(sat(mixIn(sweepSine(0.45, 220, 52, 55, 8), gen(0.02, t => n() * Math.exp(-t * 260) * 0.5)), 2.2)); };
F.kickTight = () => norm(sat(sweepSine(0.3, 170, 58, 70, 12), 1.8));
F.kickSub = () => norm(sweepSine(1.4, 90, 38, 18, 2.4));
F.kickHard = () => { const n = noiseGen(2); return norm(sat(mixIn(sweepSine(0.6, 260, 48, 45, 6), gen(0.03, t => n() * Math.exp(-t * 180) * 0.6)), 5)); };
F.snare1 = () => {
  const n = noiseGen(3);
  const noise = biquad(gen(0.35, t => n() * Math.exp(-t * 17)), 'hp', 1500, 0.7);
  return norm(mixIn(gain(noise, 0.9), sweepSine(0.2, 260, 175, 30, 22, null)));
};
F.snare808 = () => {
  const n = noiseGen(4);
  const noise = biquad(gen(0.3, t => n() * Math.exp(-t * 14)), 'bp', 3200, 0.6);
  return norm(mixIn(gain(noise, 1.3), gain(sweepSine(0.25, 330, 190, 20, 16), 0.9)));
};
F.snareSnap = () => { const n = noiseGen(5); return norm(sat(mixIn(biquad(gen(0.18, t => n() * Math.exp(-t * 30)), 'hp', 2200, 0.8), gain(sweepSine(0.1, 320, 200, 40, 35), 0.8)), 2)); };
F.rim = () => { const n = noiseGen(6); return norm(mixIn(gen(0.08, t => Math.sin(TAU * 1700 * t) * Math.exp(-t * 120)), gain(biquad(gen(0.05, t => n() * Math.exp(-t * 130)), 'bp', 3000, 1), 0.7))); };
F.clap1 = () => {
  const n = noiseGen(7);
  const burst = (t0, dec) => gen(0.4, t => (t < t0 ? 0 : n() * Math.exp(-(t - t0) * dec)));
  const raw = mixIn(burst(0, 160), burst(0.011, 160), burst(0.023, 160), burst(0.036, 22));
  return norm(biquad(raw, 'bp', 1300, 0.9));
};
F.clap808 = () => {
  const n = noiseGen(8);
  const raw = gen(0.35, t => n() * (Math.exp(-t * 30) + (t > 0.015 ? 0.6 * Math.exp(-(t - 0.015) * 40) : 0)));
  return norm(biquad(raw, 'bp', 1800, 1.1));
};
const hat = (seed, dec, hp) => {
  const fr = [205.3, 304.4, 369.6, 522.7, 540, 800];
  const raw = gen(Math.min(1.2, 5 / dec), t => fr.reduce((s, f) => s + (Math.sin(TAU * f * 2.3 * t) > 0 ? 1 : -1), 0) * Math.exp(-t * dec));
  return norm(biquad(biquad(raw, 'hp', hp, 0.8), 'hp', hp * 0.7, 0.8));
};
F.hatC1 = () => hat(1, 70, 7200);
F.hatC2 = () => hat(2, 110, 8800);
F.hatO1 = () => hat(3, 9, 7000);
F.hatO2 = () => hat(4, 5, 6200);
F.hatPed = () => hat(5, 40, 5200);
F.tomL = () => norm(sat(sweepSine(0.6, 150, 80, 14, 6), 1.5));
F.tomM = () => norm(sat(sweepSine(0.5, 210, 120, 14, 7), 1.5));
F.tomH = () => norm(sat(sweepSine(0.4, 290, 170, 14, 8), 1.5));
F.cowbell = () => norm(gen(0.5, t => (Math.sin(TAU * 560 * t) + Math.sin(TAU * 845 * t)) * 0.5 * (Math.exp(-t * 14) * 0.75 + Math.exp(-t * 60) * 0.5)));
F.clave = () => norm(gen(0.12, t => Math.sin(TAU * 2500 * t) * Math.exp(-t * 55)));
F.wood = () => norm(gen(0.15, t => (Math.sin(TAU * 900 * t) + 0.5 * Math.sin(TAU * 1730 * t)) * Math.exp(-t * 45)));
F.conga = () => norm(sweepSine(0.45, 330, 210, 25, 9));
F.shaker = () => { const n = noiseGen(9); return norm(biquad(gen(0.22, t => n() * Math.min(1, t * 90) * Math.exp(-t * 16)), 'bp', 7000, 0.8)); };
F.tamb = () => { const n = noiseGen(10); return norm(biquad(gen(0.35, t => n() * Math.exp(-t * 12) * (1 + Math.sin(TAU * 38 * t) * 0.4)), 'hp', 6000, 0.8)); };
F.crash = () => { const n = noiseGen(11); return norm(biquad(gen(2.2, t => n() * Math.exp(-t * 2.4)), 'hp', 3500, 0.7)); };
F.ride = () => norm(biquad(gen(1.6, t => [412, 637, 913, 1259, 2150, 3233].reduce((s, f, i) => s + Math.sin(TAU * f * t + i) / (i + 1), 0) * Math.exp(-t * 4.2)), 'hp', 1200, 0.7));
F.riser = () => { const n = noiseGen(12); let f = 0; return norm(gen(4, t => { f += TAU * (200 + 7000 * t * t / 16) / SR; return (n() * 0.5 + Math.sin(f) * 0.4) * (t / 4); }), 0.8); };
F.fall = () => { const n = noiseGen(13); let ph = 0; return norm(gen(3, t => { ph += TAU * (3000 * Math.exp(-t * 1.4) + 60) / SR; return (n() * 0.35 + Math.sin(ph) * 0.5) * (1 - t / 3); }), 0.8); };
F.impact = () => { const n = noiseGen(14); return norm(sat(mixIn(sweepSine(2, 120, 34, 5, 1.8), biquad(gen(2, t => n() * Math.exp(-t * 3)), 'lp', 2400, 0.7)), 1.4)); };
F.zap = () => { let ph = 0; return norm(gen(0.35, t => { ph += TAU * (4200 * Math.exp(-t * 14) + 120) / SR; return Math.sin(ph) * Math.exp(-t * 8); })); };
F.sub808 = () => norm(sat(gen(1.6, t => Math.sin(TAU * 32.7 * t + 0.6 * Math.sin(TAU * 32.7 * t) * Math.exp(-t * 20)) * Math.exp(-t * 2.2)), 1.4));
F.pluck = () => {
  const f = 261.63, n = Math.round(SR / f), buf = new Float32Array(Math.floor(1.6 * SR)), r = noiseGen(15);
  for (let i = 0; i < n; i++) buf[i] = r();
  for (let i = n; i < buf.length; i++) buf[i] = 0.4985 * (buf[i - n] + buf[i - n + 1 < i ? i - n + 1 : i - n]);
  return norm(buf);
};
F.bell = () => norm(gen(2.2, t => [1, 2.76, 5.4, 8.93].reduce((s, m, i) => s + Math.sin(TAU * 523.25 * m * t) * Math.exp(-t * (2 + i * 2.2)) / (i + 1), 0)));
F.stab = () => norm(biquad(gen(0.7, t => [0, 4, 7, 11].reduce((s, st) => s + ((((261.63 * Math.pow(2, st / 12) * t) % 1) * 2 - 1)), 0) * Math.exp(-t * 5)), 'lp', 2400, 0.9));
F.vox = () => { const n = noiseGen(16); return norm(biquad(gen(0.6, t => (((220 * t) % 1) * 2 - 1) * (Math.exp(-t * 3)) + n() * 0.02), 'bp', 900, 3)); };

const LIB = [
  ['kick808', '808 Kick', 'Kicks'], ['kickPunch', 'Punch Kick', 'Kicks'], ['kickTight', 'Tight Kick', 'Kicks'], ['kickSub', 'Sub Kick', 'Kicks'], ['kickHard', 'Hard Kick', 'Kicks'],
  ['snare1', 'Classic Snare', 'Snares'], ['snare808', '808 Snare', 'Snares'], ['snareSnap', 'Snap Snare', 'Snares'], ['rim', 'Rim Shot', 'Snares'],
  ['clap1', 'Clap', 'Claps'], ['clap808', '808 Clap', 'Claps'],
  ['hatC1', 'Closed Hat 1', 'Hats'], ['hatC2', 'Closed Hat 2', 'Hats'], ['hatO1', 'Open Hat 1', 'Hats'], ['hatO2', 'Open Hat 2', 'Hats'], ['hatPed', 'Pedal Hat', 'Hats'],
  ['tomL', 'Tom Low', 'Toms'], ['tomM', 'Tom Mid', 'Toms'], ['tomH', 'Tom High', 'Toms'],
  ['cowbell', 'Cowbell', 'Percussion'], ['clave', 'Clave', 'Percussion'], ['wood', 'Woodblock', 'Percussion'], ['conga', 'Conga', 'Percussion'], ['shaker', 'Shaker', 'Percussion'], ['tamb', 'Tambourine', 'Percussion'],
  ['crash', 'Crash', 'Cymbals'], ['ride', 'Ride', 'Cymbals'],
  ['riser', 'Riser', 'FX'], ['fall', 'Downlifter', 'FX'], ['impact', 'Impact', 'FX'], ['zap', 'Zap', 'FX'],
  ['sub808', '808 Bass (C1)', 'Bass'], ['pluck', 'Pluck (C5)', 'Melodic'], ['bell', 'Bell (C5)', 'Melodic'], ['stab', 'Chord Stab', 'Melodic'], ['vox', 'Vox Ah', 'Melodic'],
].map(([k, name, cat]) => ({ id: 'f:' + k, name, cat, key: k, factory: true }));

const cache = new Map();
const userMeta = new Map();
const peakCache = new Map();

const Samples = DAW.samples = {
  factory: LIB,
  cats: () => Array.from(new Set(LIB.map(s => s.cat))),
  info(id) {
    return LIB.find(s => s.id === id) || userMeta.get(id) || null;
  },
  name(id) { const i = Samples.info(id); return i ? i.name : '(missing)'; },
  /** Synchronous lookup for already-loaded buffers. Factory sounds are generated on first use. */
  getSync(id) {
    if (cache.has(id)) return cache.get(id);
    const s = LIB.find(x => x.id === id);
    if (s) {
      const data = F[s.key]();
      const b = new AudioBuffer({ length: data.length, sampleRate: SR, numberOfChannels: 1 });
      b.copyToChannel(data, 0);
      cache.set(id, b);
      return b;
    }
    return null;
  },
  async get(id) {
    const b = Samples.getSync(id);
    if (b) return b;
    const rec = await DAW.db.get('samples', id);
    if (!rec) return null;
    return Samples.decode(id, rec);
  },
  async decode(id, rec) {
    const ctx = DAW.audio && DAW.audio.ctx ? DAW.audio.ctx : new OfflineAudioContext(1, 1, SR);
    const buf = await ctx.decodeAudioData(rec.bytes.slice(0));
    cache.set(id, buf);
    return buf;
  },
  async loadUserList() {
    const all = await DAW.db.all('samples');
    all.forEach(({ key, val }) => userMeta.set(key, { id: key, name: val.name, cat: val.cat || 'Imported', user: true }));
  },
  userList: () => Array.from(userMeta.values()),
  /** Decode and persist an audio file. cat is the browser folder it lands in. */
  async importFile(file, cat) {
    const bytes = await U.readAB(file);
    return Samples.importBytes(bytes, file.name.replace(/\.[^.]+$/, ''), cat);
  },
  async importBytes(bytes, name, cat) {
    const id = 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const rec = { name, cat: cat || 'Imported', bytes };
    await Samples.decode(id, rec);
    await DAW.db.put('samples', id, rec);
    userMeta.set(id, { id, name, cat: rec.cat, user: true });
    return id;
  },
  async importBuffer(buf, name, cat) {
    const wav = DAW.wav.encode(buf, 16);
    return Samples.importBytes(wav, name, cat);
  },
  async remove(id) { userMeta.delete(id); cache.delete(id); await DAW.db.del('samples', id); },
  /** Reverse-copy of a buffer, cached. */
  reversed(id) {
    const key = id + '#rev';
    if (cache.has(key)) return cache.get(key);
    const b = Samples.getSync(id);
    if (!b) return null;
    const r = new AudioBuffer({ length: b.length, sampleRate: b.sampleRate, numberOfChannels: b.numberOfChannels });
    for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c).slice(); d.reverse(); r.copyToChannel(d, c); }
    cache.set(key, r);
    return r;
  },
  /** Min/max peaks for waveform drawing. */
  peaks(id, n) {
    const key = id + '@' + n;
    if (peakCache.has(key)) return peakCache.get(key);
    const b = Samples.getSync(id);
    if (!b) return null;
    const d = b.getChannelData(0), out = new Float32Array(n * 2), step = d.length / n;
    for (let i = 0; i < n; i++) {
      let lo = 1, hi = -1;
      const a = Math.floor(i * step), z = Math.min(d.length, Math.max(a + 1, Math.floor((i + 1) * step)));
      const stride = Math.max(1, Math.floor((z - a) / 64));
      for (let j = a; j < z; j += stride) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
      out[i * 2] = lo; out[i * 2 + 1] = hi;
    }
    peakCache.set(key, out);
    return out;
  },
  /** Preload every buffer a project uses so playback never waits on decoding. */
  async preload(project) {
    const ids = new Set();
    project.channels.forEach(c => { if (c.sample) ids.add(c.sample); });
    for (const id of ids) await Samples.get(id);
  },
};
})();
