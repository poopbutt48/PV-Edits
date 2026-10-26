'use strict';
/* Beatforge — insert effects. Each type declares its parameters (the UI builds knobs from them)
   and a create() that returns {in, out, update(p, env, immediate), dispose()}. */
(() => {
const DAW = window.DAW;
const U = DAW.util;

const FX = DAW.fx = { types: {}, order: [], cats: ['EQ & Filter', 'Dynamics', 'Space', 'Modulation', 'Distortion', 'Stereo & Utility', 'Creative'] };

const K = (id, label, min, max, def, o) => Object.assign({ id, label, min, max, def, type: 'knob' }, o);
const SEL = (id, label, opts, def) => ({ id, label, type: 'select', def, options: opts.map(o => (Array.isArray(o) ? { v: o[0], l: o[1] } : { v: o, l: String(o) })) });
const TOG = (id, label, def) => ({ id, label, type: 'toggle', def: !!def });

const SYNC_OPTS = [['free', 'Free (ms)'], ['1/2', '1/2'], ['1/4', '1/4'], ['1/4D', '1/4 dotted'], ['1/4T', '1/4 triplet'], ['1/8', '1/8'], ['1/8D', '1/8 dotted'], ['1/8T', '1/8 triplet'], ['1/16', '1/16'], ['1/16T', '1/16 triplet'], ['1/32', '1/32'], ['bar', '1 bar']];
const BEATS = { '1/2': 2, '1/4': 1, '1/4D': 1.5, '1/4T': 2 / 3, '1/8': 0.5, '1/8D': 0.75, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125, bar: 4 };
FX.syncBeats = BEATS;
FX.syncOpts = SYNC_OPTS;
const syncSec = (div, ms, bpm) => (div === 'free' || !BEATS[div] ? ms / 1000 : BEATS[div] * 60 / bpm);

const WAVES = [['sine', 'Sine'], ['triangle', 'Triangle'], ['square', 'Square'], ['sawtooth', 'Saw']];

/* immediate set for offline/first call, smoothed otherwise */
FX.when = null; // set by the graph while applying timed automation
const put = (ctx, prm, v, imm) => {
  if (FX.when != null) { prm.setTargetAtTime(v, FX.when, 0.005); return; }
  if (imm || ctx.offline) { prm.cancelScheduledValues(0); prm.value = v; } else prm.setTargetAtTime(v, ctx.currentTime, 0.02);
};
const mkGain = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };
const mkOsc = (ctx, type, f) => { const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = f || 1; o.start(); return o; };

function def(type, label, cat, params, create, o) {
  FX.types[type] = Object.assign({ type, label, cat, params, create, mixDef: 1 }, o || {});
  FX.order.push(type);
}

/* ---------- EQ ---------- */
const EQ_BANDS = [[60, 'lowshelf'], [160, 'peaking'], [400, 'peaking'], [1000, 'peaking'], [2500, 'peaking'], [6000, 'peaking'], [12000, 'highshelf']];
FX.EQ_BANDS = EQ_BANDS;
def('eq', 'Parametric EQ', 'EQ & Filter', [
  ...EQ_BANDS.flatMap(([f], i) => [
    K('f' + i, 'Freq ' + (i + 1), 20, 20000, f, { curve: 'log', unit: 'Hz' }),
    K('g' + i, 'Gain ' + (i + 1), -18, 18, 0, { unit: 'dB' }),
    K('q' + i, 'Q ' + (i + 1), 0.1, 12, 0.8, { curve: 'log' }),
  ]),
  K('out', 'Output', -18, 18, 0, { unit: 'dB' }),
], ctx => {
  const bands = EQ_BANDS.map(([f, t]) => { const b = ctx.createBiquadFilter(); b.type = t; b.frequency.value = f; return b; });
  const out = mkGain(ctx);
  for (let i = 0; i < bands.length - 1; i++) bands[i].connect(bands[i + 1]);
  bands[bands.length - 1].connect(out);
  const an = ctx.createAnalyser(); an.fftSize = 2048; an.smoothingTimeConstant = 0.8;
  out.connect(an);
  return {
    in: bands[0], out, bands, analyser: an,
    update(p, env, imm) {
      bands.forEach((b, i) => { put(ctx, b.frequency, p['f' + i], imm); put(ctx, b.gain, p['g' + i], imm); put(ctx, b.Q, p['q' + i], imm); });
      put(ctx, out.gain, U.dbToGain(p.out), imm);
    },
    dispose() { bands.forEach(b => b.disconnect()); out.disconnect(); an.disconnect(); },
  };
});

def('filter', 'Filter', 'EQ & Filter', [
  SEL('ft', 'Type', [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass'], ['notch', 'Notch'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf'], ['peaking', 'Peak'], ['allpass', 'All-pass']], 'lowpass'),
  K('cut', 'Cutoff', 20, 20000, 2000, { curve: 'log', unit: 'Hz' }),
  K('res', 'Resonance', 0.1, 20, 0.8, { curve: 'log' }),
  K('gain', 'Gain', -24, 24, 0, { unit: 'dB' }),
  K('slope', 'Slope', 0, 1, 0, { step: 1, fmt: v => (v ? '24 dB' : '12 dB') }),
  K('lfoRate', 'LFO rate', 0.05, 20, 1, { curve: 'log', unit: 'Hz' }),
  K('lfoDepth', 'LFO depth', 0, 4, 0, { fmt: v => v.toFixed(2) + ' oct' }),
  SEL('lfoShape', 'LFO shape', WAVES, 'sine'),
], ctx => {
  const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
  const lfo = mkOsc(ctx, 'sine', 1), depth = mkGain(ctx, 0);
  lfo.connect(depth); depth.connect(a.detune); depth.connect(b.detune);
  const mid = mkGain(ctx);
  a.connect(mid);
  const out = mkGain(ctx);
  mid.connect(out);
  const st = { two: false };
  return {
    in: a, out,
    update(p, env, imm) {
      a.type = b.type = p.ft;
      put(ctx, a.frequency, p.cut, imm); put(ctx, b.frequency, p.cut, imm);
      put(ctx, a.Q, p.res, imm); put(ctx, b.Q, p.res, imm);
      put(ctx, a.gain, p.gain, imm); put(ctx, b.gain, p.gain, imm);
      if (!!p.slope !== st.two) {
        st.two = !!p.slope;
        a.disconnect(); b.disconnect();
        if (st.two) { a.connect(b); b.connect(mid); } else a.connect(mid);
      }
      lfo.type = p.lfoShape; put(ctx, lfo.frequency, p.lfoRate, imm); put(ctx, depth.gain, p.lfoDepth * 1200, imm);
    },
    dispose() { lfo.stop(); [a, b, mid, out, depth].forEach(n => n.disconnect()); },
  };
});

/* ---------- dynamics ---------- */
def('comp', 'Compressor', 'Dynamics', [
  K('thr', 'Threshold', -60, 0, -20, { unit: 'dB' }),
  K('ratio', 'Ratio', 1, 20, 4, { curve: 'log', unit: ':1' }),
  K('knee', 'Knee', 0, 40, 10, { unit: 'dB' }),
  K('att', 'Attack', 0.1, 200, 10, { curve: 'log', unit: 'ms' }),
  K('rel', 'Release', 10, 1200, 150, { curve: 'log', unit: 'ms' }),
  K('makeup', 'Makeup', -12, 24, 0, { unit: 'dB' }),
], ctx => {
  const c = ctx.createDynamicsCompressor(), mk = mkGain(ctx);
  c.connect(mk);
  return {
    in: c, out: mk, comp: c,
    update(p, env, imm) {
      put(ctx, c.threshold, p.thr, imm); put(ctx, c.ratio, p.ratio, imm); put(ctx, c.knee, p.knee, imm);
      put(ctx, c.attack, p.att / 1000, imm); put(ctx, c.release, p.rel / 1000, imm); put(ctx, mk.gain, U.dbToGain(p.makeup), imm);
    },
    dispose() { c.disconnect(); mk.disconnect(); },
  };
}, { mixDef: 1 });

def('limiter', 'Limiter', 'Dynamics', [
  K('gain', 'Input gain', 0, 24, 0, { unit: 'dB' }),
  K('ceil', 'Ceiling', -12, 0, -0.3, { unit: 'dB' }),
  K('rel', 'Release', 5, 500, 60, { curve: 'log', unit: 'ms' }),
], ctx => {
  const pre = mkGain(ctx), c = ctx.createDynamicsCompressor(), post = mkGain(ctx);
  c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.001;
  pre.connect(c); c.connect(post);
  return {
    in: pre, out: post, comp: c,
    update(p, env, imm) {
      put(ctx, pre.gain, U.dbToGain(p.gain), imm); put(ctx, c.threshold, p.ceil, imm);
      put(ctx, c.release, p.rel / 1000, imm);
    },
    dispose() { [pre, c, post].forEach(n => n.disconnect()); },
  };
});

def('mbcomp', 'Multiband Compressor', 'Dynamics', [
  K('f1', 'Low / mid', 60, 1000, 200, { curve: 'log', unit: 'Hz' }),
  K('f2', 'Mid / high', 1000, 12000, 3500, { curve: 'log', unit: 'Hz' }),
  ...['Low', 'Mid', 'High'].flatMap((n, i) => [
    K('t' + i, n + ' threshold', -60, 0, -22, { unit: 'dB' }),
    K('r' + i, n + ' ratio', 1, 20, 3, { curve: 'log', unit: ':1' }),
    K('g' + i, n + ' gain', -18, 18, 0, { unit: 'dB' }),
  ]),
], ctx => {
  const mk = (type, f) => { const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter(); a.type = b.type = type; a.Q.value = b.Q.value = 0.7071; a.frequency.value = b.frequency.value = f; a.connect(b); return { in: a, out: b, set: (v, imm) => { put(ctx, a.frequency, v, imm); put(ctx, b.frequency, v, imm); } }; };
  const inp = mkGain(ctx), out = mkGain(ctx);
  const lo = mk('lowpass', 200), hiA = mk('highpass', 200), loB = mk('lowpass', 3500), hi = mk('highpass', 3500);
  inp.connect(lo.in); inp.connect(hiA.in); hiA.out.connect(loB.in); hiA.out.connect(hi.in);
  const bands = [lo.out, loB.out, hi.out].map(src => {
    const c = ctx.createDynamicsCompressor(), g = mkGain(ctx); c.attack.value = 0.01; c.release.value = 0.15; c.knee.value = 6;
    src.connect(c); c.connect(g); g.connect(out); return { c, g };
  });
  return {
    in: inp, out,
    update(p, env, imm) {
      lo.set(p.f1, imm); hiA.set(p.f1, imm); loB.set(p.f2, imm); hi.set(p.f2, imm);
      bands.forEach((b, i) => { put(ctx, b.c.threshold, p['t' + i], imm); put(ctx, b.c.ratio, p['r' + i], imm); put(ctx, b.g.gain, U.dbToGain(p['g' + i]), imm); });
    },
    dispose() { [inp, out, lo.in, lo.out, hiA.in, hiA.out, loB.in, loB.out, hi.in, hi.out].forEach(n => n.disconnect()); bands.forEach(b => { b.c.disconnect(); b.g.disconnect(); }); },
  };
});

/* ---------- space ---------- */
function makeIR(ctx, decay, damp, width, sizeEarly) {
  const sr = ctx.sampleRate, len = Math.max(1, Math.floor(decay * sr + 0.02 * sr));
  const buf = ctx.createBuffer(2, len, sr);
  const rng = [U.rng(11), U.rng(23)];
  const dat = [buf.getChannelData(0), buf.getChannelData(1)];
  for (let c = 0; c < 2; c++) {
    let y = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const fc = Math.max(300, damp * (1 - 0.75 * Math.min(1, t / decay)));
      const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
      const x = (rng[c]() * 2 - 1) * Math.exp(-6.9 * t / decay) * Math.min(1, t / (0.004 + sizeEarly * 0.03));
      y += a * (x - y);
      dat[c][i] = y;
    }
  }
  if (width < 1) { for (let i = 0; i < len; i++) { const m = (dat[0][i] + dat[1][i]) / 2; dat[0][i] = m + (dat[0][i] - m) * width; dat[1][i] = m + (dat[1][i] - m) * width; } }
  let e = 0; for (let i = 0; i < len; i++) e += dat[0][i] * dat[0][i];
  const g = 1 / Math.sqrt(Math.max(1e-9, e)) * 0.18 * Math.sqrt(sr / 44100);
  for (let c = 0; c < 2; c++) for (let i = 0; i < len; i++) dat[c][i] *= g * 10;
  return buf;
}
def('reverb', 'Reverb', 'Space', [
  K('decay', 'Decay', 0.2, 10, 2.2, { curve: 'log', unit: 's' }),
  K('size', 'Room size', 0, 1, 0.5, { unit: '%' }),
  K('pre', 'Pre-delay', 0, 250, 15, { unit: 'ms' }),
  K('damp', 'Damping', 1000, 20000, 9000, { curve: 'log', unit: 'Hz' }),
  K('low', 'Low cut', 20, 1000, 120, { curve: 'log', unit: 'Hz' }),
  K('width', 'Width', 0, 1, 1, { unit: '%' }),
], ctx => {
  const pre = ctx.createDelay(0.5), hp = ctx.createBiquadFilter(), cv = ctx.createConvolver(), out = mkGain(ctx);
  hp.type = 'highpass'; hp.Q.value = 0.7;
  pre.connect(hp); hp.connect(cv); cv.connect(out);
  let key = '';
  const rebuild = U.debounce(k => { cv.buffer = k.buf; }, 120);
  return {
    in: pre, out,
    update(p, env, imm) {
      put(ctx, pre.delayTime, p.pre / 1000, imm); put(ctx, hp.frequency, p.low, imm);
      const k = [p.decay, p.damp, p.width, p.size].join('|');
      if (k !== key) {
        key = k;
        const buf = makeIR(ctx, p.decay, p.damp, p.width, p.size);
        if (imm || ctx.offline || !cv.buffer) cv.buffer = buf; else rebuild({ buf });
      }
    },
    dispose() { [pre, hp, cv, out].forEach(n => n.disconnect()); },
  };
}, { mixDef: 0.28 });

def('convolver', 'Convolution Reverb', 'Space', [
  { id: 'ir', label: 'Impulse response', type: 'sample', def: '' },
  K('pre', 'Pre-delay', 0, 250, 0, { unit: 'ms' }),
  K('lp', 'High cut', 1000, 20000, 20000, { curve: 'log', unit: 'Hz' }),
  K('gain', 'Gain', -24, 12, 0, { unit: 'dB' }),
], ctx => {
  const pre = ctx.createDelay(0.5), cv = ctx.createConvolver(), lp = ctx.createBiquadFilter(), out = mkGain(ctx);
  lp.type = 'lowpass'; pre.connect(cv); cv.connect(lp); lp.connect(out);
  let cur = null;
  return {
    in: pre, out,
    update(p, env, imm) {
      put(ctx, pre.delayTime, p.pre / 1000, imm); put(ctx, lp.frequency, p.lp, imm); put(ctx, out.gain, U.dbToGain(p.gain), imm);
      if (p.ir !== cur) {
        cur = p.ir;
        if (!p.ir) cv.buffer = null; else DAW.samples.get(p.ir).then(b => { if (b && cur === p.ir) cv.buffer = b; });
      }
    },
    dispose() { [pre, cv, lp, out].forEach(n => n.disconnect()); },
  };
}, { mixDef: 0.3 });

def('delay', 'Delay', 'Space', [
  SEL('div', 'Time sync', SYNC_OPTS, '1/8D'),
  K('time', 'Time', 1, 2000, 375, { curve: 'log', unit: 'ms' }),
  K('fb', 'Feedback', 0, 0.95, 0.4, { unit: '%' }),
  TOG('pp', 'Ping-pong', true),
  K('lp', 'High cut', 500, 20000, 7000, { curve: 'log', unit: 'Hz' }),
  K('hp', 'Low cut', 20, 2000, 120, { curve: 'log', unit: 'Hz' }),
  K('spread', 'Stereo offset', 0, 1, 0, { unit: '%' }),
], ctx => {
  const inp = mkGain(ctx), mono = mkGain(ctx);
  mono.channelCount = 1; mono.channelCountMode = 'explicit';
  inp.connect(mono);
  const mk = () => ({ d: ctx.createDelay(4), lp: Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' }), hp: Object.assign(ctx.createBiquadFilter(), { type: 'highpass' }), self: mkGain(ctx, 0), cross: mkGain(ctx, 0), inG: mkGain(ctx) });
  const L = mk(), R = mk();
  const merge = ctx.createChannelMerger(2);
  [[L, R, 0], [R, L, 1]].forEach(([a, b, ch]) => {
    mono.connect(a.inG); a.inG.connect(a.d); a.d.connect(a.hp); a.hp.connect(a.lp);
    a.lp.connect(a.self); a.self.connect(a.d); a.lp.connect(a.cross); a.cross.connect(b.d);
    a.lp.connect(merge, 0, ch);
  });
  return {
    in: inp, out: merge,
    update(p, env, imm) {
      const t = syncSec(p.div, p.time, env.bpm);
      put(ctx, L.d.delayTime, Math.min(3.9, t), imm); put(ctx, R.d.delayTime, Math.min(3.9, t * (1 + p.spread * 0.25)), imm);
      [L, R].forEach(x => { put(ctx, x.lp.frequency, p.lp, imm); put(ctx, x.hp.frequency, p.hp, imm); });
      put(ctx, L.self.gain, p.pp ? 0 : p.fb, imm); put(ctx, R.self.gain, p.pp ? 0 : p.fb, imm);
      put(ctx, L.cross.gain, p.pp ? p.fb : 0, imm); put(ctx, R.cross.gain, p.pp ? p.fb : 0, imm);
      put(ctx, L.inG.gain, 1, imm); put(ctx, R.inG.gain, p.pp ? 0 : 1, imm);
    },
    dispose() { [inp, mono, merge, ...Object.values(L), ...Object.values(R)].forEach(n => n.disconnect && n.disconnect()); },
  };
}, { mixDef: 0.3 });

/* ---------- modulation ---------- */
function modDelay(ctx, o) {
  const inp = mkGain(ctx), out = mkGain(ctx), merge = ctx.createChannelMerger(2), split = ctx.createChannelSplitter(2);
  inp.connect(split);
  const lfo = mkOsc(ctx, 'sine', 0.5);
  const sides = [0, 1].map(ch => {
    const d = ctx.createDelay(0.1), g = mkGain(ctx, ch ? -1 : 1), fb = mkGain(ctx, 0);
    split.connect(d, ch); lfo.connect(g); g.connect(d.delayTime); d.connect(fb); fb.connect(d); d.connect(merge, 0, ch);
    return { d, g, fb };
  });
  merge.connect(out);
  return { inp, out, lfo, sides, merge, split };
}
def('chorus', 'Chorus', 'Modulation', [
  K('rate', 'Rate', 0.05, 10, 0.8, { curve: 'log', unit: 'Hz' }),
  K('depth', 'Depth', 0, 12, 4, { unit: 'ms' }),
  K('delay', 'Delay', 4, 40, 16, { unit: 'ms' }),
  K('fb', 'Feedback', 0, 0.8, 0.1, { unit: '%' }),
  SEL('shape', 'LFO shape', WAVES.slice(0, 2), 'sine'),
], ctx => {
  const m = modDelay(ctx);
  return {
    in: m.inp, out: m.out,
    update(p, env, imm) {
      m.lfo.type = p.shape; put(ctx, m.lfo.frequency, p.rate, imm);
      m.sides.forEach(s => { put(ctx, s.d.delayTime, p.delay / 1000, imm); put(ctx, s.fb.gain, p.fb, imm); });
      put(ctx, m.sides[0].g.gain, p.depth / 1000, imm); put(ctx, m.sides[1].g.gain, -p.depth / 1000, imm);
    },
    dispose() { m.lfo.stop(); [m.inp, m.out, m.merge, m.split, ...m.sides.flatMap(s => [s.d, s.g, s.fb])].forEach(n => n.disconnect()); },
  };
}, { mixDef: 0.5 });

def('flanger', 'Flanger', 'Modulation', [
  K('rate', 'Rate', 0.02, 8, 0.25, { curve: 'log', unit: 'Hz' }),
  K('depth', 'Depth', 0, 5, 2, { unit: 'ms' }),
  K('delay', 'Delay', 0.3, 10, 2, { unit: 'ms' }),
  K('fb', 'Feedback', -0.95, 0.95, 0.5, { fmt: v => Math.round(v * 100) + '%' }),
  SEL('shape', 'LFO shape', WAVES.slice(0, 2), 'sine'),
], ctx => {
  const m = modDelay(ctx);
  return {
    in: m.inp, out: m.out,
    update(p, env, imm) {
      m.lfo.type = p.shape; put(ctx, m.lfo.frequency, p.rate, imm);
      m.sides.forEach(s => { put(ctx, s.d.delayTime, p.delay / 1000, imm); put(ctx, s.fb.gain, p.fb, imm); });
      put(ctx, m.sides[0].g.gain, p.depth / 1000, imm); put(ctx, m.sides[1].g.gain, -p.depth / 1000, imm);
    },
    dispose() { m.lfo.stop(); [m.inp, m.out, m.merge, m.split, ...m.sides.flatMap(s => [s.d, s.g, s.fb])].forEach(n => n.disconnect()); },
  };
}, { mixDef: 0.5 });

def('phaser', 'Phaser', 'Modulation', [
  K('rate', 'Rate', 0.02, 10, 0.4, { curve: 'log', unit: 'Hz' }),
  K('depth', 'Depth', 0, 2400, 1200, { unit: 'ct' }),
  K('cen', 'Centre', 100, 5000, 800, { curve: 'log', unit: 'Hz' }),
  K('q', 'Resonance', 0.2, 8, 1, { curve: 'log' }),
  K('fb', 'Feedback', 0, 0.9, 0.4, { unit: '%' }),
], ctx => {
  const inp = mkGain(ctx), out = mkGain(ctx), fb = mkGain(ctx, 0);
  const lfo = mkOsc(ctx, 'sine', 0.4), depth = mkGain(ctx, 1200);
  lfo.connect(depth);
  const stages = Array.from({ length: 6 }, () => { const a = ctx.createBiquadFilter(); a.type = 'allpass'; depth.connect(a.detune); return a; });
  inp.connect(stages[0]);
  for (let i = 0; i < 5; i++) stages[i].connect(stages[i + 1]);
  stages[5].connect(out); stages[5].connect(fb); fb.connect(stages[0]);
  return {
    in: inp, out,
    update(p, env, imm) {
      put(ctx, lfo.frequency, p.rate, imm); put(ctx, depth.gain, p.depth, imm); put(ctx, fb.gain, p.fb, imm);
      stages.forEach(s => { put(ctx, s.frequency, p.cen, imm); put(ctx, s.Q, p.q, imm); });
    },
    dispose() { lfo.stop(); [inp, out, fb, depth, ...stages].forEach(n => n.disconnect()); },
  };
}, { mixDef: 0.5 });

def('tremolo', 'Tremolo / Auto-pan', 'Modulation', [
  SEL('div', 'Rate sync', SYNC_OPTS, '1/8'),
  K('rate', 'Rate', 0.1, 20, 4, { curve: 'log', unit: 'Hz' }),
  K('depth', 'Volume depth', 0, 1, 0.6, { unit: '%' }),
  K('pdepth', 'Pan depth', 0, 1, 0, { unit: '%' }),
  SEL('shape', 'LFO shape', WAVES, 'sine'),
], ctx => {
  const inp = mkGain(ctx, 1), pan = ctx.createStereoPanner(), out = mkGain(ctx);
  const lfo = mkOsc(ctx, 'sine', 4), gd = mkGain(ctx, 0), pd = mkGain(ctx, 0);
  inp.connect(pan); pan.connect(out);
  lfo.connect(gd); gd.connect(inp.gain); lfo.connect(pd); pd.connect(pan.pan);
  return {
    in: inp, out,
    update(p, env, imm) {
      lfo.type = p.shape;
      const f = p.div === 'free' ? p.rate : 1 / syncSec(p.div, 0, env.bpm);
      put(ctx, lfo.frequency, f, imm);
      put(ctx, inp.gain, 1 - p.depth / 2, imm); put(ctx, gd.gain, p.depth / 2, imm); put(ctx, pd.gain, p.pdepth, imm);
    },
    dispose() { lfo.stop(); [inp, pan, out, gd, pd].forEach(n => n.disconnect()); },
  };
}, { mixDef: 1 });

/* ---------- distortion ---------- */
function shaperCurve(kind, drive, bits) {
  const n = 4096, c = new Float32Array(n), k = Math.pow(10, drive / 20);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, v = x * k;
    let y;
    switch (kind) {
      case 'hard': y = Math.max(-1, Math.min(1, v)); break;
      case 'fold': { let a = v; while (a > 1 || a < -1) a = a > 1 ? 2 - a : -2 - a; y = a; break; }
      case 'tube': y = v >= 0 ? Math.tanh(v) : Math.tanh(v * 0.55) * 1.2; break;
      case 'crush': { const lv = Math.pow(2, bits - 1); y = Math.round(Math.max(-1, Math.min(1, v)) * lv) / lv; break; }
      case 'sine': y = Math.sin(Math.max(-1, Math.min(1, v)) * Math.PI / 2 * (1 + k * 0.15)); break;
      default: y = Math.tanh(v);
    }
    c[i] = y;
  }
  return c;
}
def('dist', 'Distortion', 'Distortion', [
  SEL('kind', 'Type', [['soft', 'Soft clip'], ['hard', 'Hard clip'], ['tube', 'Tube'], ['fold', 'Wave fold'], ['sine', 'Sine shaper'], ['crush', 'Bit crush']], 'soft'),
  K('drive', 'Drive', 0, 48, 14, { unit: 'dB' }),
  K('bits', 'Bit depth', 2, 16, 8, { step: 1, unit: 'int' }),
  K('tone', 'Tone', 400, 20000, 12000, { curve: 'log', unit: 'Hz' }),
  K('low', 'Low cut', 20, 1000, 20, { curve: 'log', unit: 'Hz' }),
  K('level', 'Output', -24, 12, -6, { unit: 'dB' }),
], ctx => {
  const hp = ctx.createBiquadFilter(), ws = ctx.createWaveShaper(), lp = ctx.createBiquadFilter(), out = mkGain(ctx);
  hp.type = 'highpass'; hp.Q.value = 0.7; lp.type = 'lowpass'; ws.oversample = '4x';
  hp.connect(ws); ws.connect(lp); lp.connect(out);
  let key = '';
  return {
    in: hp, out,
    update(p, env, imm) {
      const k = [p.kind, p.drive, p.bits].join('|');
      if (k !== key) { key = k; ws.curve = shaperCurve(p.kind, p.drive, Math.round(p.bits)); }
      put(ctx, hp.frequency, p.low, imm); put(ctx, lp.frequency, p.tone, imm); put(ctx, out.gain, U.dbToGain(p.level), imm);
    },
    dispose() { [hp, ws, lp, out].forEach(n => n.disconnect()); },
  };
}, { mixDef: 1 });

def('tape', 'Tape / Lo-fi', 'Distortion', [
  K('sat', 'Saturation', 0, 24, 6, { unit: 'dB' }),
  K('wow', 'Wow', 0, 1, 0.3, { unit: '%' }),
  K('flutter', 'Flutter', 0, 1, 0.2, { unit: '%' }),
  K('lp', 'High roll-off', 1000, 20000, 9000, { curve: 'log', unit: 'Hz' }),
  K('hp', 'Low roll-off', 20, 800, 50, { curve: 'log', unit: 'Hz' }),
  K('noise', 'Hiss', 0, 1, 0, { unit: '%' }),
], ctx => {
  const inp = mkGain(ctx), ws = ctx.createWaveShaper(), d = ctx.createDelay(0.1), lp = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), out = mkGain(ctx);
  lp.type = 'lowpass'; hp.type = 'highpass'; d.delayTime.value = 0.012;
  const wow = mkOsc(ctx, 'sine', 0.6), flut = mkOsc(ctx, 'sine', 7.3), wg = mkGain(ctx, 0), fg = mkGain(ctx, 0);
  wow.connect(wg); flut.connect(fg); wg.connect(d.delayTime); fg.connect(d.delayTime);
  inp.connect(ws); ws.connect(d); d.connect(lp); lp.connect(hp); hp.connect(out);
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0), r = U.rng(5);
  for (let i = 0; i < nd.length; i++) nd[i] = r() * 2 - 1;
  const ns = ctx.createBufferSource(); ns.buffer = nb; ns.loop = true; ns.start();
  const nf = ctx.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000; const ng = mkGain(ctx, 0);
  ns.connect(nf); nf.connect(ng); ng.connect(out);
  let key = '';
  return {
    in: inp, out,
    update(p, env, imm) {
      if (key !== String(p.sat)) { key = String(p.sat); ws.curve = shaperCurve('soft', p.sat, 8); }
      put(ctx, wg.gain, p.wow * 0.0025, imm); put(ctx, fg.gain, p.flutter * 0.0003, imm);
      put(ctx, lp.frequency, p.lp, imm); put(ctx, hp.frequency, p.hp, imm); put(ctx, ng.gain, p.noise * 0.05, imm);
    },
    dispose() { wow.stop(); flut.stop(); ns.stop(); [inp, ws, d, lp, hp, out, wg, fg, nf, ng].forEach(n => n.disconnect()); },
  };
}, { mixDef: 1 });

/* ---------- stereo & utility ---------- */
def('width', 'Stereo Shaper', 'Stereo & Utility', [
  K('width', 'Width', 0, 2, 1, { unit: '%' }),
  K('mid', 'Mid gain', -18, 18, 0, { unit: 'dB' }),
  K('side', 'Side gain', -18, 18, 0, { unit: 'dB' }),
  K('pan', 'Balance', -1, 1, 0, { unit: 'pan' }),
], ctx => {
  const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), pan = ctx.createStereoPanner();
  const mL = mkGain(ctx, 0.5), mR = mkGain(ctx, 0.5), sL = mkGain(ctx, 0.5), sR = mkGain(ctx, -0.5);
  const M = mkGain(ctx), Sd = mkGain(ctx), Sn = mkGain(ctx, -1);
  const inp = mkGain(ctx);
  inp.connect(sp);
  sp.connect(mL, 0); sp.connect(mR, 1); sp.connect(sL, 0); sp.connect(sR, 1);
  mL.connect(M); mR.connect(M); sL.connect(Sd); sR.connect(Sd); Sd.connect(Sn);
  M.connect(mg, 0, 0); Sd.connect(mg, 0, 0); M.connect(mg, 0, 1); Sn.connect(mg, 0, 1);
  mg.connect(pan);
  return {
    in: inp, out: pan,
    update(p, env, imm) {
      put(ctx, M.gain, U.dbToGain(p.mid), imm);
      put(ctx, Sd.gain, U.dbToGain(p.side) * p.width, imm); put(ctx, Sn.gain, -1, imm);
      put(ctx, pan.pan, p.pan, imm);
    },
    dispose() { [sp, mg, pan, mL, mR, sL, sR, M, Sd, Sn, inp].forEach(n => n.disconnect()); },
  };
});

def('utility', 'Gain / Phase', 'Stereo & Utility', [
  K('gain', 'Gain', -36, 24, 0, { unit: 'dB' }),
  K('pan', 'Pan', -1, 1, 0, { unit: 'pan' }),
  TOG('invL', 'Invert left', false),
  TOG('invR', 'Invert right', false),
  TOG('mono', 'Mono', false),
  TOG('swap', 'Swap L/R', false),
], ctx => {
  const inp = mkGain(ctx), sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2), gL = mkGain(ctx), gR = mkGain(ctx), pan = ctx.createStereoPanner(), out = mkGain(ctx);
  const x = [mkGain(ctx), mkGain(ctx), mkGain(ctx), mkGain(ctx)]; // LL, LR, RL, RR matrix
  inp.connect(sp);
  sp.connect(x[0], 0); sp.connect(x[1], 0); sp.connect(x[2], 1); sp.connect(x[3], 1);
  x[0].connect(gL); x[2].connect(gL); x[1].connect(gR); x[3].connect(gR);
  gL.connect(mg, 0, 0); gR.connect(mg, 0, 1); mg.connect(pan); pan.connect(out);
  return {
    in: inp, out,
    update(p, env, imm) {
      let m = [1, 0, 0, 1];
      if (p.mono) m = [0.5, 0.5, 0.5, 0.5]; else if (p.swap) m = [0, 1, 1, 0];
      x.forEach((n, i) => put(ctx, n.gain, m[i], imm));
      const g = U.dbToGain(p.gain);
      put(ctx, gL.gain, g * (p.invL ? -1 : 1), imm); put(ctx, gR.gain, g * (p.invR ? -1 : 1), imm); put(ctx, pan.pan, p.pan, imm);
    },
    dispose() { [inp, sp, mg, gL, gR, pan, out, ...x].forEach(n => n.disconnect()); },
  };
});

/* ---------- creative ---------- */
const PUMP = [0.05, 0.3, 0.65, 0.92, 0.05, 0.3, 0.65, 0.92, 0.05, 0.3, 0.65, 0.92, 0.05, 0.3, 0.65, 0.92];
def('shaper', 'Volume Shaper (Sidechain / Gate)', 'Creative', [
  SEL('div', 'Step length', [['1/4', '1/4'], ['1/8', '1/8'], ['1/16', '1/16'], ['1/32', '1/32']], '1/16'),
  K('depth', 'Depth', 0, 1, 1, { unit: '%' }),
  K('smooth', 'Smoothing', 1, 200, 18, { curve: 'log', unit: 'ms' }),
  ...PUMP.map((v, i) => K('s' + (i + 1), 'Step ' + (i + 1), 0, 1, v, { unit: '%', step: 0.01 })),
], ctx => {
  const g = mkGain(ctx);
  let cur = null;
  return {
    in: g, out: g,
    update(p) { cur = p; },
    /* called by the sequencer for every scheduling window */
    schedule(w) {
      if (!cur) return;
      const beats = BEATS[cur.div] || 0.25, stepTicks = beats * DAW.C.PPQ;
      let i = Math.ceil(w.t0 / stepTicks - 1e-6);
      for (; i * stepTicks < w.t1; i++) {
        const when = w.timeOf(i * stepTicks), s = cur['s' + ((((i % 16) + 16) % 16) + 1)];
        g.gain.setTargetAtTime(1 - cur.depth * (1 - s), Math.max(when, ctx.currentTime), cur.smooth / 3000);
      }
    },
    dispose() { g.disconnect(); },
  };
});

def('analyzer', 'Analyzer', 'Creative', [
  SEL('mode', 'View', [['spectrum', 'Spectrum'], ['scope', 'Oscilloscope'], ['bars', 'Level bars']], 'spectrum'),
  K('smooth', 'Smoothing', 0, 0.95, 0.8, { unit: '%' }),
], ctx => {
  const g = mkGain(ctx), an = ctx.createAnalyser(); an.fftSize = 2048;
  g.connect(an);
  return { in: g, out: g, analyser: an, update(p) { an.smoothingTimeConstant = p.smooth; }, dispose() { g.disconnect(); an.disconnect(); } };
});

})();
