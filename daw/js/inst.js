'use strict';
/* Beatforge — instruments. Each type declares parameter groups (UI is generated from them)
   and play(graph, channel, event) which builds a short-lived voice graph on the audio context. */
(() => {
const DAW = window.DAW;
const U = DAW.util, C = DAW.C;

const K = (id, label, min, max, def, o) => Object.assign({ id, label, min, max, def, type: 'knob' }, o);
const SEL = (id, label, opts, def) => ({ id, label, type: 'select', def, options: opts.map(o => (Array.isArray(o) ? { v: o[0], l: o[1] } : { v: o, l: String(o) })) });
const TOG = (id, label, def) => ({ id, label, type: 'toggle', def: !!def });

const Inst = DAW.inst = { types: {}, common: [] };
const WAVE_OPTS = [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'], ['square', 'Square'], ['pulse25', 'Pulse 25%'], ['pulse12', 'Pulse 12%'], ['organ', 'Organ'], ['bell', 'Bell'], ['vowel', 'Vowel'], ['warm', 'Warm saw']];
const LFO_SHAPES = [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Saw']];
const FILTER_OPTS = [['off', 'Off'], ['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass'], ['notch', 'Notch'], ['peaking', 'Peak']];

/* ---------- parameters shared by every note-based instrument ---------- */
Inst.common = [
  { name: 'Time', params: [
    K('swing', 'Swing', 0, 1, 0, { unit: '%' }),
    K('gate', 'Note length', 0.1, 2, 1, { unit: 'x', curve: 'log' }),
    K('nDelay', 'Note delay', 0, 500, 0, { unit: 'ms' }),
    K('nShift', 'Time shift', -48, 48, 0, { step: 1, fmt: v => (v > 0 ? '+' : '') + v + ' tk' }),
    K('bend', 'Pitch bend range', 0, 24, 2, { step: 1, unit: 'st' }),
  ] },
  { name: 'Arpeggiator', params: [
    TOG('arpOn', 'Arpeggiator', false),
    SEL('arpDir', 'Direction', [['up', 'Up'], ['down', 'Down'], ['updown', 'Up / down'], ['random', 'Random'], ['asplayed', 'As played']], 'up'),
    SEL('arpRate', 'Rate', [[12, '1/32'], [24, '1/16'], [32, '1/12 triplet'], [48, '1/8'], [96, '1/4']], 24),
    K('arpRange', 'Octave range', 1, 4, 1, { step: 1, unit: 'int' }),
    K('arpGate', 'Gate', 0.1, 1.5, 0.8, { unit: '%' }),
    SEL('arpChord', 'Chord preset', [['none', 'Use played notes'], ...Object.keys(C.CHORDS).map(k => [k, k])], 'none'),
  ] },
  { name: 'Echo', params: [
    TOG('echoOn', 'Echo', false),
    SEL('echoDiv', 'Time', DAW.fx ? DAW.fx.syncOpts.filter(o => o[0] !== 'free') : [['1/8', '1/8']], '1/8D'),
    K('echoFb', 'Feedback', 0, 0.9, 0.4, { unit: '%' }),
    K('echoMix', 'Level', 0, 1, 0.35, { unit: '%' }),
    K('echoLp', 'High cut', 500, 20000, 6000, { curve: 'log', unit: 'Hz' }),
  ] },
  { name: 'Misc', params: [
    K('velVol', 'Velocity → volume', 0, 1, 1, { unit: '%' }),
    K('cutGroup', 'Cut group', 0, 8, 0, { step: 1, fmt: v => (v ? 'Group ' + v : 'None') }),
    TOG('cutSelf', 'Cut itself (mono)', false),
    TOG('invert', 'Reverse polarity', false),
    TOG('swapLR', 'Swap L/R', false),
  ] },
];
Inst.commonDefaults = () => {
  const o = {};
  Inst.common.forEach(g => g.params.forEach(d => { o[d.id] = d.def; }));
  return o;
};
Inst.allParams = type => {
  const T = Inst.types[type], list = [];
  (T.groups || []).forEach(g => g.params.forEach(d => list.push(d)));
  Inst.common.forEach(g => g.params.forEach(d => list.push(d)));
  return list;
};

function register(type, label, groups, play, o) {
  const T = Inst.types[type] = Object.assign({ type, label, groups, play, icon: 'wave' }, o || {});
  T.defaults = () => {
    const r = {};
    groups.forEach(g => g.params.forEach(d => { r[d.id] = d.def; }));
    return Object.assign(r, (o && o.preset) || {});
  };
}

/* ---------- shared voice helpers ---------- */
const waveCache = new WeakMap();
function getWave(ctx, name) {
  if (['sine', 'triangle', 'sawtooth', 'square'].includes(name)) return name;
  let m = waveCache.get(ctx);
  if (!m) waveCache.set(ctx, m = {});
  if (m[name]) return m[name];
  const N = 64, re = new Float32Array(N), im = new Float32Array(N);
  if (name === 'pulse25' || name === 'pulse12') {
    const d = name === 'pulse25' ? 0.25 : 0.125;
    for (let n = 1; n < N; n++) re[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  } else if (name === 'organ') {
    [[1, 1], [2, 0.8], [3, 0.55], [4, 0.45], [6, 0.3], [8, 0.2]].forEach(([n, a]) => { im[n] = a; });
  } else if (name === 'bell') {
    [[1, 1], [3, 0.5], [5, 0.3], [8, 0.35], [13, 0.18]].forEach(([n, a]) => { im[n] = a; });
  } else if (name === 'vowel') {
    [1, 0.9, 0.25, 0.6, 0.85, 0.4, 0.2, 0.1, 0.05, 0.25, 0.3, 0.15].forEach((a, i) => { im[i + 1] = a; });
  } else {
    for (let n = 1; n < N; n++) im[n] = 1 / Math.pow(n, 1.35);
  }
  return (m[name] = ctx.createPeriodicWave(re, im));
}
function setOscType(ctx, o, name) {
  const w = getWave(ctx, name);
  if (typeof w === 'string') o.type = w; else o.setPeriodicWave(w);
}

let noiseBufs = new WeakMap();
function noiseBuf(ctx) {
  let b = noiseBufs.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0), r = U.rng(99);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    noiseBufs.set(ctx, b);
  }
  return b;
}

/** Schedules attack/decay/sustain/release on an AudioParam. dur=Infinity leaves it sustaining and returns rel(t). */
function adsr(param, t0, dur, a, d, s, r, lo, hi) {
  a = Math.max(a, 0.002); r = Math.max(r, 0.006);
  const sus = lo + (hi - lo) * s, tau = Math.max(d / 3, 1e-4);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(lo, t0);
  if (dur === Infinity) {
    param.linearRampToValueAtTime(hi, t0 + a);
    param.setTargetAtTime(sus, t0 + a, tau);
    return {
      end: Infinity,
      rel(t) {
        if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
        else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
        param.setTargetAtTime(lo, t, r / 3);
        return t + r * 1.7;
      },
    };
  }
  const tEnd = t0 + Math.max(dur, 0.004);
  let level;
  if (tEnd - t0 <= a) {
    level = lo + (hi - lo) * (tEnd - t0) / a;
    param.linearRampToValueAtTime(level, tEnd);
  } else {
    param.linearRampToValueAtTime(hi, t0 + a);
    param.setTargetAtTime(sus, t0 + a, tau);
    level = sus + (hi - sus) * Math.exp(-(tEnd - t0 - a) / tau);
    param.setValueAtTime(level, tEnd);
  }
  param.setTargetAtTime(lo, tEnd, r / 3);
  return { end: tEnd + r * 1.7, rel() { return tEnd + r * 1.7; } };
}
Inst.adsr = adsr;

function lfoSetup(ctx, v, t0, tEnd, shape, rate, targets) {
  const o = ctx.createOscillator(); o.type = shape; o.frequency.value = rate;
  targets.forEach(([param, amount]) => { const g = ctx.createGain(); g.gain.value = amount; o.connect(g); g.connect(param); v.nodes.push(g); });
  o.start(t0);
  v.stops.push(o);
  v.nodes.push(o);
  void tEnd;
}

class Voice {
  constructor(g, ch, ev) {
    this.g = g; this.ch = ch; this.ev = ev;
    this.nodes = []; this.stops = [];
    this.end = ev.when + 0.1;
    this.gainNode = null; this.relFns = [];
  }
  finish(end) {
    this.end = end;
    this.stops.forEach(s => { try { s.stop(end); } catch (_) { /* already stopped */ } });
    const last = this.stops[0];
    const nodes = this.nodes;
    if (last) last.onended = () => nodes.forEach(n => { try { n.disconnect(); } catch (_) { /* gone */ } });
  }
  release(t) {
    let end = 0;
    this.relFns.forEach(f => { end = Math.max(end, f(t)); });
    this.finish(end || t + 0.05);
  }
  kill(t) {
    const g = this.gainNode;
    if (g) {
      try {
        if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(t);
        else { g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); }
        g.gain.linearRampToValueAtTime(0, t + 0.012);
      } catch (_) { /* ignore */ }
    }
    this.end = Math.min(this.end, t + 0.02);
    this.stops.forEach(s => { try { s.stop(t + 0.025); } catch (_) { /* ignore */ } });
  }
}
Inst.Voice = Voice;

const velAmp = (ev, p) => (1 - p.velVol) + p.velVol * Math.pow(Math.max(ev.v, 1) / 127, 1.25);
const relScale = ev => Math.pow(4, ((ev.rel == null ? 0.5 : ev.rel) - 0.5) * 2);

/** Common tail of every voice: stereo pan / polarity / swap, then into the channel strip. */
function outStage(g, ch, ev, v, src) {
  const ctx = g.ctx, p = ch.p;
  let node = src;
  if (p.invert || p.swapLR) {
    const amp = ctx.createGain(); amp.gain.value = p.invert ? -1 : 1;
    node.connect(amp); node = amp; v.nodes.push(amp);
  }
  const pan = ctx.createStereoPanner();
  pan.pan.value = U.clamp((ev.pan || 0), -1, 1);
  node.connect(pan); v.nodes.push(pan);
  pan.connect(g.chan(ch.id).in);
  return pan;
}

/* ================= Sampler ================= */
register('sampler', 'Sampler', [
  { name: 'Sample', params: [
    K('root', 'Root note', 0, 127, 60, { step: 1, fmt: U.noteName }),
    K('tune', 'Tune', -48, 48, 0, { step: 0.01, unit: 'st' }),
    K('start', 'Start', 0, 1, 0, { unit: '%' }),
    K('end', 'End', 0, 1, 1, { unit: '%' }),
    TOG('reverse', 'Reverse', false),
    TOG('oneShot', 'Play full sample (ignore note length)', true),
    TOG('loop', 'Loop', false),
    K('loopStart', 'Loop start', 0, 1, 0, { unit: '%' }),
    K('loopEnd', 'Loop end', 0, 1, 1, { unit: '%' }),
    K('pan', 'Pan', -1, 1, 0, { unit: 'pan' }),
    K('gain', 'Sample gain', -24, 12, 0, { unit: 'dB' }),
  ] },
  { name: 'Envelope', params: [
    TOG('useEnv', 'Use volume envelope', false),
    K('a', 'Attack', 0, 3000, 2, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('d', 'Decay', 0, 5000, 300, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('s', 'Sustain', 0, 1, 1, { unit: '%' }),
    K('r', 'Release', 5, 6000, 80, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('pEnv', 'Pitch envelope', -24, 24, 0, { unit: 'st' }),
    K('pDec', 'Pitch decay', 5, 2000, 120, { curve: 'pow', pow: 3, unit: 'ms' }),
  ] },
  { name: 'Filter', params: [
    SEL('fType', 'Type', FILTER_OPTS, 'off'),
    K('cut', 'Cutoff', 20, 20000, 20000, { curve: 'log', unit: 'Hz' }),
    K('res', 'Resonance', 0.1, 20, 0.8, { curve: 'log' }),
    K('fEnv', 'Env amount', -6, 6, 0, { fmt: v => v.toFixed(1) + ' oct' }),
    K('fDec', 'Env decay', 5, 3000, 250, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('velCut', 'Velocity → cutoff', 0, 4, 0, { fmt: v => v.toFixed(1) + ' oct' }),
  ] },
  { name: 'LFO', params: [
    SEL('lfoTarget', 'Target', [['none', 'Off'], ['pitch', 'Pitch'], ['vol', 'Volume'], ['cut', 'Cutoff'], ['pan', 'Pan']], 'none'),
    SEL('lfoShape', 'Shape', LFO_SHAPES, 'sine'),
    K('lfoRate', 'Rate', 0.05, 30, 5, { curve: 'log', unit: 'Hz' }),
    K('lfoAmt', 'Amount', 0, 1, 0.3, { unit: '%' }),
  ] },
], (g, ch, ev) => {
  const ctx = g.ctx, p = ch.p;
  const sid = ch.sample;
  let buf = sid ? (p.reverse ? DAW.samples.reversed(sid) : DAW.samples.getSync(sid)) : null;
  if (!buf) return null;
  const v = new Voice(g, ch, ev), t0 = ev.when;
  const semis = ev.k - p.root + ch.pitch + p.tune + (ev.fine || 0) / 100 + g.masterPitch;
  const rate = Math.pow(2, semis / 12);
  const s0 = p.start * buf.duration, s1 = Math.max(s0 + 0.002, p.end * buf.duration);
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  if (p.loop) { src.loop = true; src.loopStart = p.loopStart * buf.duration; src.loopEnd = Math.max(src.loopStart + 0.005, p.loopEnd * buf.duration); }
  const vca = ctx.createGain(); v.gainNode = vca;
  const amp = velAmp(ev, p) * U.dbToGain(p.gain);
  v.nodes.push(src, vca); v.stops.push(src);
  let node = src;
  let filt = null;
  if (p.fType !== 'off') {
    filt = ctx.createBiquadFilter(); filt.type = p.fType; filt.Q.value = U.clamp(p.res + (ev.my == null ? 0 : (ev.my - 0.5) * 6), 0.1, 30);
    const base = U.clamp(p.cut * Math.pow(2, (ev.mx == null ? 0 : (ev.mx - 0.5) * 4) + p.velCut * (ev.v / 127 - 0.5)), 20, 20000);
    filt.frequency.setValueAtTime(base * Math.pow(2, p.fEnv), t0);
    if (p.fEnv) filt.frequency.setTargetAtTime(base, t0, Math.max(p.fDec / 3000, 1e-3));
    node.connect(filt); node = filt; v.nodes.push(filt);
  }
  node.connect(vca);
  if (p.pEnv) { src.detune.setValueAtTime(p.pEnv * 100, t0); src.detune.setTargetAtTime(0, t0, Math.max(p.pDec / 3000, 1e-3)); }
  const nat = p.loop ? Infinity : (s1 - s0) / rate;
  let end;
  if (p.useEnv || !p.oneShot) {
    const dur = ev.dur === Infinity ? Infinity : ev.dur;
    const e = adsr(vca.gain, t0, p.useEnv ? dur : Math.min(dur, nat), p.useEnv ? p.a / 1000 : 0.002, p.useEnv ? p.d / 1000 : 0.1, p.useEnv ? p.s : 1, (p.useEnv ? p.r / 1000 : 0.02) * relScale(ev), 0, amp);
    v.relFns.push(e.rel); end = e.end;
  } else {
    vca.gain.setValueAtTime(0, t0); vca.gain.linearRampToValueAtTime(amp, t0 + 0.001);
    end = t0 + nat + 0.02;
  }
  if (p.lfoTarget !== 'none') {
    const t = [];
    if (p.lfoTarget === 'pitch') t.push([src.detune, p.lfoAmt * 200]);
    if (p.lfoTarget === 'vol') t.push([vca.gain, p.lfoAmt * amp * 0.5]);
    if (p.lfoTarget === 'cut' && filt) t.push([filt.detune, p.lfoAmt * 2400]);
    if (t.length) lfoSetup(ctx, v, t0, end, p.lfoShape, p.lfoRate, t);
  }
  outStage(g, ch, Object.assign({}, ev, { pan: U.clamp((ev.pan || 0) + p.pan, -1, 1) }), v, vca);
  if (p.loop) src.start(t0, s0); else src.start(t0, s0, Math.min(s1 - s0, buf.duration - s0));
  if (end === Infinity) { v.end = Infinity; } else v.finish(Math.min(end, t0 + nat + 0.05 + (p.useEnv ? p.r / 1000 * 2 : 0.1)));
  return v;
}, { icon: 'wave', usesSample: true });

/* ================= Subtractive synth ================= */
const oscGroup = n => ({
  name: 'Osc ' + n, params: [
    SEL('w' + n, 'Wave', WAVE_OPTS, n === 1 ? 'sawtooth' : n === 2 ? 'square' : 'sine'),
    K('o' + n, 'Octave', -3, 3, 0, { step: 1, unit: 'int' }),
    K('s' + n, 'Semitone', -12, 12, 0, { step: 1, unit: 'st' }),
    K('f' + n, 'Fine', -100, 100, n === 1 ? 0 : (n === 2 ? 7 : 0), { unit: 'ct' }),
    K('l' + n, 'Level', 0, 1, n === 1 ? 0.7 : 0, { unit: '%' }),
    K('u' + n, 'Unison voices', 1, 7, 1, { step: 1, unit: 'int' }),
    K('ud' + n, 'Unison detune', 0, 100, 18, { unit: 'ct' }),
    K('us' + n, 'Unison spread', 0, 1, 0.6, { unit: '%' }),
  ],
});
const SYNTH_GROUPS = [
  oscGroup(1), oscGroup(2), oscGroup(3),
  { name: 'Mix', params: [
    K('sub', 'Sub osc', 0, 1, 0, { unit: '%' }),
    SEL('subOct', 'Sub octave', [[-1, '-1 oct'], [-2, '-2 oct']], -1),
    K('noise', 'Noise', 0, 1, 0, { unit: '%' }),
    K('fm', 'FM (osc 2 → osc 1)', 0, 12, 0, { fmt: v => v.toFixed(1) }),
    K('drive', 'Drive', 0, 24, 0, { unit: 'dB' }),
    K('glide', 'Portamento', 0, 1000, 0, { curve: 'pow', pow: 2, unit: 'ms' }),
    TOG('mono', 'Mono / legato', false),
  ] },
  { name: 'Filter', params: [
    SEL('fType', 'Type', FILTER_OPTS.slice(1), 'lowpass'),
    K('cut', 'Cutoff', 20, 20000, 5000, { curve: 'log', unit: 'Hz' }),
    K('res', 'Resonance', 0.1, 20, 1, { curve: 'log' }),
    K('slope', '24 dB slope', 0, 1, 0, { step: 1, fmt: v => (v ? '24 dB' : '12 dB') }),
    K('fEnv', 'Env amount', -6, 6, 2, { fmt: v => v.toFixed(1) + ' oct' }),
    K('key', 'Key tracking', 0, 1, 0.3, { unit: '%' }),
    K('velCut', 'Velocity → cutoff', 0, 4, 0.5, { fmt: v => v.toFixed(1) + ' oct' }),
  ] },
  { name: 'Amp env', params: [
    K('a', 'Attack', 0, 4000, 5, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('d', 'Decay', 0, 5000, 350, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('s', 'Sustain', 0, 1, 0.7, { unit: '%' }),
    K('r', 'Release', 5, 8000, 220, { curve: 'pow', pow: 3, unit: 'ms' }),
  ] },
  { name: 'Filter env', params: [
    K('fa', 'Attack', 0, 4000, 2, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('fd', 'Decay', 0, 5000, 400, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('fs', 'Sustain', 0, 1, 0.2, { unit: '%' }),
    K('fr', 'Release', 5, 8000, 250, { curve: 'pow', pow: 3, unit: 'ms' }),
  ] },
  { name: 'LFO 1', params: [
    SEL('lfoTarget', 'Target', [['none', 'Off'], ['pitch', 'Pitch'], ['cut', 'Cutoff'], ['vol', 'Volume'], ['pan', 'Pan'], ['res', 'Resonance']], 'none'),
    SEL('lfoShape', 'Shape', LFO_SHAPES, 'sine'),
    K('lfoRate', 'Rate', 0.05, 30, 5, { curve: 'log', unit: 'Hz' }),
    K('lfoAmt', 'Amount', 0, 1, 0.3, { unit: '%' }),
    K('lfoDelay', 'Fade-in', 0, 2000, 0, { unit: 'ms' }),
  ] },
  { name: 'LFO 2', params: [
    SEL('lfo2Target', 'Target', [['none', 'Off'], ['pitch', 'Pitch'], ['cut', 'Cutoff'], ['vol', 'Volume'], ['pan', 'Pan'], ['res', 'Resonance']], 'none'),
    SEL('lfo2Shape', 'Shape', LFO_SHAPES, 'triangle'),
    K('lfo2Rate', 'Rate', 0.05, 30, 0.7, { curve: 'log', unit: 'Hz' }),
    K('lfo2Amt', 'Amount', 0, 1, 0.3, { unit: '%' }),
  ] },
];

const lastFreq = new WeakMap();
function synthPlay(g, ch, ev) {
  const ctx = g.ctx, p = ch.p, t0 = ev.when;
  const v = new Voice(g, ch, ev);
  const semi0 = ev.k + ch.pitch + g.masterPitch + (ev.fine || 0) / 100;
  const f0 = U.mtof(semi0);
  const amp = velAmp(ev, p);
  const vca = ctx.createGain(); v.gainNode = vca; v.nodes.push(vca);
  const mix = ctx.createGain(); v.nodes.push(mix);
  let oscs = [];
  let fmTarget = null;
  const prev = lastFreq.get(ch);
  lastFreq.set(ch, f0);
  const glide = p.glide / 1000;
  [1, 2, 3].forEach(n => {
    const lvl = p['l' + n];
    const needFM = n === 1 && p.fm > 0;
    const isMod = n === 2 && p.fm > 0;
    if (lvl <= 0 && !isMod) return;
    const cnt = isMod ? 1 : Math.round(p['u' + n]);
    const ratio = Math.pow(2, p['o' + n] + p['s' + n] / 12);
    for (let i = 0; i < cnt; i++) {
      const o = ctx.createOscillator(); setOscType(ctx, o, p['w' + n]);
      const pos = cnt > 1 ? (i / (cnt - 1)) * 2 - 1 : 0;
      o.detune.value = p['f' + n] + pos * p['ud' + n];
      const fr = f0 * ratio;
      if (glide > 0 && prev && (p.mono || ev.slide)) { o.frequency.setValueAtTime(prev * ratio, t0); o.frequency.exponentialRampToValueAtTime(fr, t0 + Math.max(glide, 0.005)); } else o.frequency.setValueAtTime(fr, t0);
      v.nodes.push(o); v.stops.push(o);
      oscs.push({ o, n, ratio });
      if (isMod) {
        const dev = ctx.createGain(); dev.gain.value = p.fm * f0 * ratio; o.connect(dev); v.nodes.push(dev);
        if (lvl > 0) { const aud = ctx.createGain(); aud.gain.value = lvl; o.connect(aud); aud.connect(mix); v.nodes.push(aud); }
        fmTarget = dev;
        continue;
      }
      const gn = ctx.createGain(); gn.gain.value = lvl / Math.sqrt(cnt); o.connect(gn); v.nodes.push(gn);
      if (cnt > 1 && p['us' + n] > 0) {
        const pn = ctx.createStereoPanner(); pn.pan.value = pos * p['us' + n]; gn.connect(pn); pn.connect(mix); v.nodes.push(pn);
      } else gn.connect(mix);
      if (needFM && fmTarget === null) { /* connected after osc2 exists */ }
    }
  });
  if (fmTarget) oscs.filter(x => x.n === 1).forEach(x => fmTarget.connect(x.o.frequency));
  if (p.sub > 0) {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0 * Math.pow(2, p.subOct), t0);
    const gn = ctx.createGain(); gn.gain.value = p.sub; o.connect(gn); gn.connect(mix); v.nodes.push(o, gn); v.stops.push(o); oscs.push({ o, n: 0, ratio: Math.pow(2, p.subOct) });
  }
  if (p.noise > 0) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true;
    const gn = ctx.createGain(); gn.gain.value = p.noise * 0.6; s.connect(gn); gn.connect(mix); v.nodes.push(s, gn); v.stops.push(s);
    s.start(t0, Math.random() * 1.5);
  }
  if (!oscs.length && p.noise <= 0) return null;
  oscs.forEach(x => x.o.start(t0));
  let node = mix;
  if (p.drive > 0) {
    const ws = ctx.createWaveShaper(), k = U.dbToGain(p.drive), c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 1023) * 2 - 1) * k) / Math.tanh(k);
    ws.curve = c; node.connect(ws); node = ws; v.nodes.push(ws);
  }
  const fl = ctx.createBiquadFilter(); fl.type = p.fType; v.nodes.push(fl);
  const keyMul = Math.pow(2, (ev.k - 60) / 12 * p.key);
  const baseCut = U.clamp(p.cut * keyMul * Math.pow(2, (ev.mx == null ? 0 : (ev.mx - 0.5) * 4) + p.velCut * (ev.v / 127 - 0.5)), 20, 20000);
  fl.Q.value = U.clamp(p.res + (ev.my == null ? 0 : (ev.my - 0.5) * 6), 0.1, 30);
  const peakCut = U.clamp(baseCut * Math.pow(2, p.fEnv), 20, 20000);
  const fe = adsr(fl.frequency, t0, ev.dur, p.fa / 1000, p.fd / 1000, p.fs, p.fr / 1000 * relScale(ev), baseCut, peakCut);
  node.connect(fl); node = fl;
  if (p.slope) { const f2 = ctx.createBiquadFilter(); f2.type = p.fType; f2.Q.value = 0.7; fl.connect(f2); node = f2; v.nodes.push(f2); fe.f2 = f2.frequency; f2.frequency.setValueAtTime(baseCut, t0); f2.frequency.linearRampToValueAtTime(peakCut, t0 + Math.max(p.fa / 1000, 0.002)); f2.frequency.setTargetAtTime(baseCut + (peakCut - baseCut) * p.fs, t0 + p.fa / 1000, Math.max(p.fd / 3000, 1e-4)); }
  node.connect(vca);
  const ae = adsr(vca.gain, t0, ev.dur, p.a / 1000, p.d / 1000, p.s, p.r / 1000 * relScale(ev), 0, amp * 0.55);
  v.relFns.push(ae.rel, t => { fe.rel && fe.rel(t); return t; });
  [['lfoTarget', 'lfoShape', 'lfoRate', 'lfoAmt'], ['lfo2Target', 'lfo2Shape', 'lfo2Rate', 'lfo2Amt']].forEach(([tg, sh, rt, am]) => {
    if (p[tg] === 'none') return;
    const t = [], a = p[am];
    if (p[tg] === 'pitch') oscs.forEach(x => t.push([x.o.detune, a * 100]));
    else if (p[tg] === 'cut') t.push([fl.detune, a * 2400]);
    else if (p[tg] === 'res') t.push([fl.Q, a * 10]);
    else if (p[tg] === 'vol') t.push([mix.gain, a * 0.5]);
    if (t.length) lfoSetup(ctx, v, t0, 0, p[sh], p[rt], t);
  });
  const pan = outStage(g, ch, ev, v, vca);
  if (p.lfoTarget === 'pan') lfoSetup(ctx, v, t0, 0, p.lfoShape, p.lfoRate, [[pan.pan, p.lfoAmt]]);
  if (p.lfo2Target === 'pan') lfoSetup(ctx, v, t0, 0, p.lfo2Shape, p.lfo2Rate, [[pan.pan, p.lfo2Amt]]);
  if (ae.end === Infinity) v.end = Infinity; else v.finish(ae.end);
  return v;
}

register('synth', 'Synth', SYNTH_GROUPS, synthPlay, {
  icon: 'keys', melodic: true,
});
Inst.synthPresets = {
  'Init saw': {},
  'Fat saw lead': { w1: 'sawtooth', l1: 0.6, u1: 3, ud1: 14, l2: 0.35, w2: 'sawtooth', f2: 9, cut: 3800, res: 2, fEnv: 1.2, a: 6, d: 300, s: 0.75, r: 260, key: 0.5 },
  'Supersaw': { w1: 'sawtooth', l1: 0.7, u1: 7, ud1: 28, us1: 0.9, l2: 0, cut: 9000, res: 0.9, fEnv: 0.3, a: 12, d: 400, s: 0.85, r: 420, key: 0.6 },
  'Sub bass': { w1: 'sine', l1: 0.9, l2: 0, sub: 0.5, cut: 700, res: 0.8, fEnv: 0.5, a: 3, d: 200, s: 0.9, r: 90, mono: true, glide: 40, key: 0 },
  'Acid 303': { w1: 'sawtooth', l1: 0.8, l2: 0, cut: 600, res: 12, fEnv: 3.2, fd: 190, fs: 0, a: 2, d: 180, s: 0.6, r: 60, mono: true, glide: 55, drive: 6, key: 0.2, slope: 1 },
  'Warm pad': { w1: 'warm', l1: 0.55, u1: 4, ud1: 16, w2: 'triangle', l2: 0.4, f2: -9, cut: 2400, res: 0.8, fEnv: 0.8, fa: 700, fd: 900, fs: 0.6, a: 650, d: 800, s: 0.8, r: 1400, key: 0.4 },
  'Electric piano': { w1: 'bell', l1: 0.55, w2: 'sine', o2: 1, l2: 0.25, f2: 0, cut: 6500, fEnv: 0.4, fd: 500, a: 3, d: 1100, s: 0.15, r: 380, velCut: 1.5 },
  'Organ': { w1: 'organ', l1: 0.7, l2: 0, cut: 9000, fEnv: 0, a: 6, d: 100, s: 1, r: 70, key: 0.3 },
  'Pluck arp': { w1: 'square', l1: 0.5, w2: 'sawtooth', l2: 0.4, f2: 8, cut: 1400, res: 2.5, fEnv: 3, fd: 160, fs: 0, a: 2, d: 230, s: 0, r: 120 },
  'FM bell': { w1: 'sine', l1: 0.6, w2: 'sine', o2: 1, s2: 4, l2: 0, fm: 3.5, cut: 14000, fEnv: 0, a: 2, d: 1800, s: 0, r: 900, fType: 'lowpass' },
  'Brass': { w1: 'sawtooth', l1: 0.6, l2: 0.4, w2: 'sawtooth', f2: -11, cut: 1200, res: 1.3, fEnv: 2.2, fa: 90, fd: 250, fs: 0.5, a: 55, d: 250, s: 0.85, r: 180, key: 0.5 },
  'Chip lead': { w1: 'pulse25', l1: 0.6, l2: 0, cut: 14000, fEnv: 0, a: 1, d: 100, s: 0.85, r: 60, lfoTarget: 'pitch', lfoRate: 6, lfoAmt: 0.12, lfoDelay: 250 },
  'Wobble bass': { w1: 'sawtooth', l1: 0.7, w2: 'square', l2: 0.35, o2: -1, sub: 0.4, cut: 500, res: 6, fEnv: 0, a: 3, d: 200, s: 1, r: 120, lfoTarget: 'cut', lfoRate: 3, lfoAmt: 0.9, lfoShape: 'sine', mono: true },
  'Vowel pad': { w1: 'vowel', l1: 0.6, u1: 3, ud1: 12, l2: 0, cut: 4000, a: 400, d: 600, s: 0.8, r: 1000 },
};

/* ================= FM synth ================= */
const opGroup = n => ({
  name: 'Operator ' + n, params: [
    K('r' + n, 'Ratio', 0.25, 16, [1, 2, 1][n - 1], { step: 0.25, fmt: v => v + '×' }),
    K('fine' + n, 'Fine', -50, 50, 0, { unit: 'ct' }),
    K('lv' + n, n === 1 ? 'Output level' : 'Level / index', 0, 1, [0.8, 0.5, 0.3][n - 1], { unit: '%' }),
    K('a' + n, 'Attack', 0, 3000, 2, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('d' + n, 'Decay', 0, 5000, [900, 500, 300][n - 1], { curve: 'pow', pow: 3, unit: 'ms' }),
    K('s' + n, 'Sustain', 0, 1, [0.3, 0.2, 0][n - 1], { unit: '%' }),
    K('rl' + n, 'Release', 5, 6000, 250, { curve: 'pow', pow: 3, unit: 'ms' }),
  ],
});
register('fm', 'FM Synth', [
  { name: 'Algorithm', params: [
    SEL('algo', 'Algorithm', [[0, '3 → 2 → 1'], [1, '(2 + 3) → 1'], [2, '3 → 1  +  2'], [3, '1 + 2 + 3'], [4, '(3 → 2)  +  1']], 0),
    K('depth', 'Mod depth', 0, 20, 6, { fmt: v => v.toFixed(1) }),
    K('fb', 'Op 3 feedback', 0, 1, 0, { unit: '%' }),
    K('cut', 'Output low-pass', 200, 20000, 16000, { curve: 'log', unit: 'Hz' }),
  ] },
  opGroup(1), opGroup(2), opGroup(3),
], (g, ch, ev) => {
  const ctx = g.ctx, p = ch.p, t0 = ev.when, v = new Voice(g, ch, ev);
  const f0 = U.mtof(ev.k + ch.pitch + g.masterPitch + (ev.fine || 0) / 100), amp = velAmp(ev, p);
  const out = ctx.createGain(), lp = ctx.createBiquadFilter(), vca = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = p.cut; v.nodes.push(out, lp, vca); v.gainNode = vca;
  out.connect(lp); lp.connect(vca);
  const ops = [1, 2, 3].map(n => {
    const o = ctx.createOscillator(); o.type = 'sine';
    const fr = f0 * p['r' + n]; o.frequency.setValueAtTime(fr, t0); o.detune.value = p['fine' + n];
    const eg = ctx.createGain(); o.connect(eg);
    const e = adsr(eg.gain, t0, ev.dur, p['a' + n] / 1000, p['d' + n] / 1000, p['s' + n], p['rl' + n] / 1000 * relScale(ev), 0, p['lv' + n]);
    v.nodes.push(o, eg); v.stops.push(o); v.relFns.push(e.rel);
    return { o, eg, fr, e };
  });
  const dev = (src, dst) => { const d = ctx.createGain(); d.gain.value = p.depth * src.fr; src.eg.connect(d); d.connect(dst.o.frequency); v.nodes.push(d); };
  const car = x => x.eg.connect(out);
  const [o1, o2, o3] = ops;
  switch (Number(p.algo)) {
    case 0: dev(o3, o2); dev(o2, o1); car(o1); break;
    case 1: dev(o2, o1); dev(o3, o1); car(o1); break;
    case 2: dev(o3, o1); car(o1); car(o2); break;
    case 3: car(o1); car(o2); car(o3); break;
    default: dev(o3, o2); car(o2); car(o1);
  }
  if (p.fb > 0) { const d = ctx.createGain(); d.gain.value = p.fb * f0 * p.r3 * 2; o3.eg.connect(d); d.connect(o3.o.frequency); v.nodes.push(d); }
  ops.forEach(x => x.o.start(t0));
  const ae = adsr(vca.gain, t0, ev.dur, 0.002, 0.1, 1, 0.01, 0, amp * 0.45);
  const endMax = ev.dur === Infinity ? Infinity : Math.max(...ops.map(x => x.e.end), ae.end);
  v.relFns.push(ae.rel);
  outStage(g, ch, ev, v, vca);
  if (endMax === Infinity) v.end = Infinity; else v.finish(endMax);
  return v;
}, { icon: 'bolt', melodic: true });
Inst.fmPresets = {
  'E-piano': {},
  'Glass bell': { algo: 2, r1: 1, r2: 3.5, r3: 1, lv1: 0.7, lv2: 0.6, lv3: 0.3, d1: 2200, s1: 0, d2: 1200 },
  'FM bass': { algo: 0, r1: 1, r2: 1, r3: 2, lv1: 0.9, lv2: 0.7, lv3: 0.2, d1: 400, s1: 0.5, d2: 200, s2: 0, rl1: 80, depth: 5 },
  'Metal hit': { algo: 1, r1: 1, r2: 3.41, r3: 7.13, lv1: 0.7, lv2: 0.7, lv3: 0.6, d1: 1500, s1: 0, depth: 9, fb: 0.4 },
  'Organ FM': { algo: 3, r1: 1, r2: 2, r3: 4, lv1: 0.7, lv2: 0.4, lv3: 0.25, d1: 100, s1: 1, d2: 100, s2: 1, d3: 100, s3: 1 },
};

/* ================= Plucked string (Karplus–Strong, rendered per note) ================= */
const ksCache = new Map();
function ksBuffer(ctx, key, decay, bright, hard) {
  const ck = [key, decay, bright, hard, ctx.sampleRate].join('|');
  if (ksCache.has(ck)) return ksCache.get(ck);
  const sr = ctx.sampleRate, f = U.mtof(key), n = Math.max(2, Math.round(sr / f));
  const secs = Math.min(5, 0.6 + decay * 4), len = Math.floor(secs * sr);
  const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0), r = U.rng(key * 7 + 3);
  let lp = 0;
  for (let i = 0; i < n; i++) { const x = r() * 2 - 1; lp += bright * (x - lp) + (1 - bright) * 0; d[i] = hard ? x : lp + (x - lp) * 0.3; }
  const fb = 0.9 + decay * 0.0995;
  for (let i = n; i < len; i++) d[i] = fb * 0.5 * (d[i - n] + d[i - n + 1 < i ? i - n + 1 : i - n]);
  let m = 0; for (let i = 0; i < len; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < len; i++) d[i] /= m;
  if (ksCache.size > 300) ksCache.clear();
  ksCache.set(ck, buf);
  return buf;
}
register('pluck', 'Pluck', [
  { name: 'String', params: [
    K('decay', 'Sustain', 0, 1, 0.6, { unit: '%' }),
    K('bright', 'Brightness', 0.05, 1, 0.7, { unit: '%' }),
    TOG('hard', 'Hard pick', false),
    K('cut', 'Low-pass', 200, 20000, 12000, { curve: 'log', unit: 'Hz' }),
    K('res', 'Resonance', 0.1, 12, 0.7, { curve: 'log' }),
    K('r', 'Release', 5, 2000, 120, { curve: 'pow', pow: 3, unit: 'ms' }),
    K('pan', 'Pan', -1, 1, 0, { unit: 'pan' }),
  ] },
], (g, ch, ev) => {
  const ctx = g.ctx, p = ch.p, t0 = ev.when, v = new Voice(g, ch, ev);
  const k = Math.round(U.clamp(ev.k + ch.pitch + g.masterPitch, 12, 100));
  const src = ctx.createBufferSource(); src.buffer = ksBuffer(ctx, k, p.decay, p.bright, p.hard);
  src.detune.value = (ev.fine || 0);
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = p.cut; fl.Q.value = p.res;
  const vca = ctx.createGain(); v.gainNode = vca; v.nodes.push(src, fl, vca); v.stops.push(src);
  src.connect(fl); fl.connect(vca);
  const e = adsr(vca.gain, t0, Math.max(ev.dur, 0.1), 0.001, 0.05, 1, p.r / 1000 * relScale(ev), 0, velAmp(ev, p) * 0.8);
  v.relFns.push(e.rel);
  outStage(g, ch, Object.assign({}, ev, { pan: U.clamp((ev.pan || 0) + p.pan, -1, 1) }), v, vca);
  src.start(t0);
  if (e.end === Infinity) v.end = Infinity; else v.finish(Math.min(e.end, t0 + src.buffer.duration));
  return v;
}, { icon: 'wave', melodic: true });

/* ================= Drum synth ================= */
register('drum', 'Drum Synth', [
  { name: 'Drum', params: [
    SEL('kind', 'Drum', [['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['hat', 'Closed hat'], ['ohat', 'Open hat'], ['tom', 'Tom'], ['rim', 'Rim'], ['cowbell', 'Cowbell'], ['perc', 'FM perc']], 'kick'),
    K('tune', 'Tune', -12, 12, 0, { unit: 'st' }),
    K('decay', 'Decay', 0.2, 3, 1, { unit: 'x', curve: 'log' }),
    K('punch', 'Punch / sweep', 0, 1, 0.6, { unit: '%' }),
    K('tone', 'Tone', 0, 1, 0.5, { unit: '%' }),
    K('noise', 'Noise', 0, 1, 0.5, { unit: '%' }),
    K('drive', 'Drive', 0, 24, 3, { unit: 'dB' }),
    K('pan', 'Pan', -1, 1, 0, { unit: 'pan' }),
  ] },
], (g, ch, ev) => {
  const ctx = g.ctx, p = ch.p, t0 = ev.when, v = new Voice(g, ch, ev);
  const amp = velAmp(ev, p) * 0.9, tune = Math.pow(2, (p.tune + (ev.k - 60) * 0.5 * (p.kind === 'kick' || p.kind === 'tom' ? 2 : 0) + ch.pitch) / 12);
  const vca = ctx.createGain(); v.gainNode = vca; v.nodes.push(vca);
  const D = p.decay;
  let end = t0 + 0.3;
  const osc = (type, f0, f1, sweep) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + sweep);
    v.nodes.push(o); v.stops.push(o); return o;
  };
  const env = (node, peak, dec, att) => {
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0, t0); g2.gain.linearRampToValueAtTime(peak, t0 + (att || 0.001));
    g2.gain.setTargetAtTime(0, t0 + (att || 0.001), dec / 3); node.connect(g2); v.nodes.push(g2); return g2;
  };
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf(ctx); s.loop = true; v.nodes.push(s); v.stops.push(s); s.start(t0, Math.random()); return s; };
  const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q || 0.8; v.nodes.push(b); return b; };
  switch (p.kind) {
    case 'kick': {
      const o = osc('sine', (110 + p.punch * 220) * tune, 42 * tune, 0.05 + 0.1 * (1 - p.punch) + 0.02);
      env(o, 1, 0.35 * D).connect(vca);
      if (p.noise > 0) { const n = noise(), f = bq('highpass', 1800); n.connect(f); env(f, p.noise * 0.5, 0.012).connect(vca); }
      end = t0 + 0.35 * D * 2.5; break;
    }
    case 'snare': {
      const o = osc('triangle', 190 * tune * (0.8 + p.tone * 0.5), 150 * tune, 0.08);
      env(o, 0.7, 0.1 * D).connect(vca);
      const n = noise(), f = bq('highpass', 1200 + p.tone * 3000); n.connect(f); env(f, 0.4 + p.noise * 0.7, 0.16 * D).connect(vca);
      end = t0 + 0.16 * D * 3; break;
    }
    case 'clap': {
      const n = noise(), f = bq('bandpass', (1000 + p.tone * 1800) * tune, 1.1); n.connect(f);
      const g2 = ctx.createGain(); f.connect(g2); v.nodes.push(g2);
      [0, 0.011, 0.023].forEach(o => { g2.gain.setValueAtTime(0, t0 + o); g2.gain.linearRampToValueAtTime(1, t0 + o + 0.001); g2.gain.setTargetAtTime(0, t0 + o + 0.002, 0.006); });
      g2.gain.setValueAtTime(0, t0 + 0.034); g2.gain.linearRampToValueAtTime(1, t0 + 0.035); g2.gain.setTargetAtTime(0, t0 + 0.036, 0.07 * D);
      g2.connect(vca); end = t0 + 0.036 + 0.07 * D * 4; break;
    }
    case 'hat': case 'ohat': {
      const dec = (p.kind === 'hat' ? 0.04 : 0.28) * D, hp = bq('highpass', 6500 + p.tone * 3500);
      [205.3, 304.4, 369.6, 522.7, 540, 800].forEach(f => { const o = osc('square', f * 2.3 * tune, f * 2.3 * tune, 0); o.connect(hp); });
      env(hp, 0.35, dec).connect(vca); end = t0 + dec * 4; break;
    }
    case 'tom': {
      const o = osc('sine', 220 * tune, 110 * tune, 0.12);
      env(o, 1, 0.22 * D).connect(vca); end = t0 + 0.22 * D * 3; break;
    }
    case 'rim': {
      const o = osc('sine', 1700 * tune, 1700 * tune, 0), o2 = osc('square', 480 * tune, 480 * tune, 0);
      const bp = bq('bandpass', 1800, 1.5); o.connect(bp); o2.connect(bp); env(bp, 0.9, 0.025 * D).connect(vca); end = t0 + 0.12 * D; break;
    }
    case 'cowbell': {
      const o = osc('square', 560 * tune, 560 * tune, 0), o2 = osc('square', 845 * tune, 845 * tune, 0), bp = bq('bandpass', 1100 + p.tone * 1500, 1.2);
      o.connect(bp); o2.connect(bp); env(bp, 0.5, 0.12 * D).connect(vca); end = t0 + 0.12 * D * 4; break;
    }
    default: {
      const m = osc('sine', 340 * tune * 1.5, 340 * tune * 1.5, 0), c = osc('sine', 340 * tune, 340 * tune * 0.6, 0.1);
      const mg = ctx.createGain(); mg.gain.value = 400 + 1500 * p.tone; m.connect(mg); mg.connect(c.frequency); v.nodes.push(mg);
      env(c, 0.9, 0.14 * D).connect(vca); end = t0 + 0.14 * D * 4;
    }
  }
  let node = vca;
  if (p.drive > 0) {
    const ws = ctx.createWaveShaper(), k = U.dbToGain(p.drive), c = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) c[i] = Math.tanh(((i / 1023) * 2 - 1) * k) / Math.tanh(k);
    ws.curve = c; node.connect(ws); node = ws; v.nodes.push(ws);
  }
  vca.gain.value = amp;
  v.stops.forEach(s => { if (s instanceof OscillatorNode) s.start(t0); });
  outStage(g, ch, Object.assign({}, ev, { pan: U.clamp((ev.pan || 0) + p.pan, -1, 1) }), v, node);
  v.finish(end);
  return v;
}, { icon: 'knob' });

/* ================= non-note channel types ================= */
register('layer', 'Layer', [], null, { icon: 'link', noPlay: true });
register('auto', 'Automation clip', [], null, { icon: 'graph', noPlay: true });
register('audio', 'Audio clip', [
  { name: 'Clip', params: [
    K('gain', 'Gain', -24, 12, 0, { unit: 'dB' }),
    K('pan', 'Pan', -1, 1, 0, { unit: 'pan' }),
    K('tune', 'Pitch', -24, 24, 0, { step: 0.01, unit: 'st' }),
    TOG('reverse', 'Reverse', false),
    K('fadeIn', 'Fade in', 0, 2000, 4, { unit: 'ms' }),
    K('fadeOut', 'Fade out', 0, 2000, 8, { unit: 'ms' }),
    K('stretchBpm', 'Stretch from BPM (0 = off)', 0, 300, 0, { step: 0.5, fmt: v => (v ? v + ' BPM' : 'Off') }),
  ] },
], null, { icon: 'wave', noPlay: true, usesSample: true });

})();
