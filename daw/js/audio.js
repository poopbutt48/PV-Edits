'use strict';
/* Beatforge — audio graph: mixer tracks, channel strips, voice management, live/offline contexts. */
(() => {
const DAW = window.DAW;
const U = DAW.util, C = DAW.C, S = DAW.state, FX = DAW.fx, Inst = DAW.inst;

const gain = (ctx, v) => { const g = ctx.createGain(); g.gain.value = v == null ? 1 : v; return g; };

class FxSlot {
  constructor(g, model) {
    const ctx = g.ctx;
    this.g = g; this.id = model.id; this.type = model.type;
    this.inst = FX.types[model.type].create(ctx);
    this.in = gain(ctx); this.dry = gain(ctx, 0); this.wet = gain(ctx, 1); this.out = gain(ctx);
    this.in.connect(this.dry); this.dry.connect(this.out);
    this.in.connect(this.inst.in); this.inst.out.connect(this.wet); this.wet.connect(this.out);
    this.first = true;
  }
  sync(model) {
    const g = this.g, imm = this.first || g.imm;
    this.inst.update(model.p, { bpm: S.p.tempo }, imm);
    const mix = model.on ? model.mix : 0;
    const t = g.ctx.currentTime;
    if (imm) { this.dry.gain.value = 1 - mix; this.wet.gain.value = mix; } else {
      this.dry.gain.setTargetAtTime(1 - mix, t, 0.01); this.wet.gain.setTargetAtTime(mix, t, 0.01);
    }
    this.first = false;
  }
  dispose() {
    this.inst.dispose();
    [this.in, this.dry, this.wet, this.out].forEach(n => n.disconnect());
  }
}

class TrackNode {
  constructor(g, idx) {
    const ctx = g.ctx;
    this.g = g; this.idx = idx;
    this.in = gain(ctx);
    this.slots = new Array(C.FX_SLOTS).fill(null);
    this.eq = ['lowshelf', 'peaking', 'highshelf'].map(t => Object.assign(ctx.createBiquadFilter(), { type: t }));
    this.inv = gain(ctx);
    this.delay = ctx.createDelay(2);
    this.sp = ctx.createChannelSplitter(2); this.mg = ctx.createChannelMerger(2);
    this.mat = [0, 1, 2, 3].map(() => gain(ctx, 0));          // LL, RL, LR, RR
    this.pan = ctx.createStereoPanner();
    this.vol = gain(ctx, 0.64);
    this.muteG = gain(ctx);
    this.out = gain(ctx);
    this.routes = new Map();
    this.meterNodes = null;
    this.eq[0].connect(this.eq[1]); this.eq[1].connect(this.eq[2]); this.eq[2].connect(this.inv);
    this.inv.connect(this.delay); this.delay.connect(this.sp);
    this.sp.connect(this.mat[0], 0); this.sp.connect(this.mat[1], 0); this.sp.connect(this.mat[2], 1); this.sp.connect(this.mat[3], 1);
    this.mat[0].connect(this.mg, 0, 0); this.mat[2].connect(this.mg, 0, 0);
    this.mat[1].connect(this.mg, 0, 1); this.mat[3].connect(this.mg, 0, 1);
    this.mg.connect(this.pan); this.pan.connect(this.vol); this.vol.connect(this.muteG); this.muteG.connect(this.out);
    this.in.connect(this.eq[0]);
    this.sig = '';
  }
  /* idempotent: pushes the whole model onto the nodes */
  sync(m) {
    const g = this.g, ctx = g.ctx, imm = g.imm, t = ctx.currentTime;
    const set = (p, v) => (imm ? (p.value = v) : p.setTargetAtTime(v, t, 0.012));
    set(this.vol.gain, U.faderToGain(m.vol));
    set(this.pan.pan, m.pan);
    set(this.inv.gain, m.inv ? -1 : 1);
    set(this.delay.delayTime, Math.max(0, m.delay) / 1000);
    const w = 1 + m.sep, a = (1 + w) / 2, b = (1 - w) / 2;
    const mat = m.swap ? [b, a, a, b] : [a, b, b, a];
    this.mat.forEach((n, i) => set(n.gain, mat[i]));
    const e = m.eq, on = e.on;
    set(this.eq[0].frequency, e.lf); set(this.eq[0].gain, on ? e.lg : 0);
    set(this.eq[1].frequency, e.mf); set(this.eq[1].gain, on ? e.mg : 0); set(this.eq[1].Q, e.mq);
    set(this.eq[2].frequency, e.hf); set(this.eq[2].gain, on ? e.hg : 0);
    this.syncRoutes(m);
    this.syncFx(m);
  }
  syncRoutes(m) {
    const g = this.g;
    if (this.idx === 0) return;
    for (const [dest, node] of this.routes) {
      if (!(dest in m.routes)) { node.disconnect(); this.routes.delete(dest); }
    }
    for (const dest in m.routes) {
      const d = Number(dest);
      let node = this.routes.get(d);
      if (!node) {
        node = gain(g.ctx, 0);
        this.out.connect(node); node.connect(g.track(d).in);
        this.routes.set(d, node);
      }
      if (g.imm) node.gain.value = m.routes[dest]; else node.gain.setTargetAtTime(m.routes[dest], g.ctx.currentTime, 0.012);
    }
  }
  syncFx(m) {
    const sig = m.fx.map(f => (f ? f.id : 0)).join(',');
    if (sig !== this.sig) {
      this.sig = sig;
      this.slots.forEach((s, i) => { if (s && (!m.fx[i] || m.fx[i].id !== s.id)) { s.dispose(); this.slots[i] = null; } });
      m.fx.forEach((f, i) => { if (f && !this.slots[i]) this.slots[i] = new FxSlot(this.g, f); });
      this.in.disconnect();
      this.slots.forEach(s => { if (s) s.out.disconnect(); });
      let prev = this.in;
      this.slots.forEach(s => { if (s) { prev.connect(s.in); prev = s.out; } });
      prev.connect(this.eq[0]);
    }
    m.fx.forEach((f, i) => { if (f) this.slots[i].sync(f); });
  }
  meter() {
    if (!this.meterNodes) {
      const ctx = this.g.ctx, sp = ctx.createChannelSplitter(2);
      const an = [0, 1].map(() => { const a = ctx.createAnalyser(); a.fftSize = 512; a.smoothingTimeConstant = 0; return a; });
      this.vol.connect(sp); sp.connect(an[0], 0); sp.connect(an[1], 1);
      this.meterNodes = { sp, an, buf: new Float32Array(512) };
    }
    return this.meterNodes;
  }
  /** Peak of the most recent 512 samples for each channel (0..~1.5) */
  peak() {
    const m = this.meter(), out = [0, 0];
    m.an.forEach((a, i) => {
      a.getFloatTimeDomainData(m.buf);
      let pk = 0; for (let j = 0; j < m.buf.length; j++) { const v = Math.abs(m.buf[j]); if (v > pk) pk = v; }
      out[i] = pk;
    });
    return out;
  }
  dispose() {
    this.slots.forEach(s => s && s.dispose());
    [this.in, this.inv, this.delay, this.sp, this.mg, this.pan, this.vol, this.muteG, this.out, ...this.eq, ...this.mat].forEach(n => n.disconnect());
    for (const n of this.routes.values()) n.disconnect();
  }
}

class ChanNode {
  constructor(g, ch) {
    const ctx = g.ctx;
    this.g = g; this.id = ch.id;
    this.in = gain(ctx); this.pan = ctx.createStereoPanner(); this.out = gain(ctx);
    this.in.connect(this.pan); this.pan.connect(this.out);
    this.mix = -1; this.echo = null;
    this.sync(ch);
  }
  sync(ch) {
    const g = this.g, ctx = g.ctx, t = ctx.currentTime, imm = g.imm;
    const set = (p, v) => (imm ? (p.value = v) : p.setTargetAtTime(v, t, 0.012));
    set(this.in.gain, g.chanMuted(ch) ? 0 : U.faderToGain(ch.vol));
    set(this.pan.pan, ch.pan);
    if (this.mix !== ch.mix) {
      this.out.disconnect();
      this.out.connect(g.track(ch.mix).in);
      if (this.echo) { this.echo.lp.disconnect(); this.echo.lp.connect(this.echo.fb); this.echo.lp.connect(g.track(ch.mix).in); }
      this.mix = ch.mix;
    }
    const p = ch.p;
    if (p.echoOn && !this.echo) {
      const send = gain(ctx, 0), d = ctx.createDelay(4), fb = gain(ctx, 0.4), lp = Object.assign(ctx.createBiquadFilter(), { type: 'lowpass' });
      this.pan.connect(send); send.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(g.track(ch.mix).in);
      this.echo = { send, d, fb, lp };
    }
    if (this.echo) {
      const sec = FX.syncBeats[p.echoDiv] ? FX.syncBeats[p.echoDiv] * 60 / S.p.tempo : 0.25;
      set(this.echo.send.gain, p.echoOn ? p.echoMix : 0);
      set(this.echo.d.delayTime, Math.min(3.9, sec)); set(this.echo.fb.gain, p.echoFb); set(this.echo.lp.frequency, p.echoLp);
    }
  }
  dispose() {
    [this.in, this.pan, this.out].forEach(n => n.disconnect());
    if (this.echo) Object.values(this.echo).forEach(n => n.disconnect());
  }
}

class Graph {
  constructor(ctx, project, opts) {
    this.ctx = ctx; this.live = !!(opts && opts.live); this.imm = true;
    this.tracks = new Map(); this.chans = new Map(); this.voices = new Map();
    this.masterPitch = 0;
    this.finalIn = gain(ctx);
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.5; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.09;
    this.masterAn = ctx.createAnalyser(); this.masterAn.fftSize = 2048; this.masterAn.smoothingTimeConstant = 0.82;
    this.limOn = null;
    this.finalIn.connect(this.masterAn);
    this.setLimiter(opts && opts.limiter !== undefined ? opts.limiter : DAW.settings.get('masterLimiter'));
    this.syncAll(project);
    this.imm = !this.live;
    if (this.live) setTimeout(() => { this.imm = false; }, 50);
  }
  setLimiter(on) {
    if (this.limOn === on) return;
    this.limOn = on;
    this.finalIn.disconnect(); this.limiter.disconnect();
    this.finalIn.connect(this.masterAn);
    if (on) { this.finalIn.connect(this.limiter); this.limiter.connect(this.ctx.destination); } else this.finalIn.connect(this.ctx.destination);
  }
  track(i) {
    let t = this.tracks.get(i);
    if (!t) {
      t = new TrackNode(this, i);
      this.tracks.set(i, t);
      if (i === 0) t.out.connect(this.finalIn);
      const m = S.p.mixer.tracks[i];
      if (m) t.sync(m);
    }
    return t;
  }
  chan(id) {
    let c = this.chans.get(id);
    if (!c) { c = new ChanNode(this, S.getCh(id)); this.chans.set(id, c); }
    return c;
  }
  chanMuted(ch) {
    const anySolo = S.p.channels.some(c => c.solo);
    return ch.mute || (anySolo && !ch.solo);
  }
  syncAll(project) {
    const p = project || S.p;
    for (const [id, c] of this.chans) if (!p.channels.some(x => x.id === id)) { c.dispose(); this.chans.delete(id); }
    for (const [i, t] of this.tracks) if (i >= p.mixer.tracks.length) { t.dispose(); this.tracks.delete(i); }
    p.mixer.tracks.forEach((m, i) => this.track(i).sync(m));
    p.channels.forEach(ch => { if (Inst.types[ch.type] && !Inst.types[ch.type].noPlay || ch.type === 'audio') this.chan(ch.id).sync(ch); });
    this.syncMuteSolo();
    this.masterPitch = p.masterPitch || 0;
  }
  syncChannel(id) {
    const ch = S.getCh(id); if (!ch) return;
    this.chan(id).sync(ch);
  }
  syncAllChannels() { S.p.channels.forEach(ch => { const c = this.chans.get(ch.id); if (c) c.sync(ch); }); }
  syncTrack(i) { const m = S.p.mixer.tracks[i]; if (m) this.track(i).sync(m); this.syncMuteSolo(); }
  syncFx(i) { const m = S.p.mixer.tracks[i]; if (m) this.track(i).syncFx(m); }
  syncMuteSolo() {
    const tr = S.p.mixer.tracks, anySolo = tr.some(t => t.solo);
    const audible = new Set([0]);
    if (anySolo) {
      const add = i => { if (audible.has(i)) return; audible.add(i); Object.keys(tr[i].routes).forEach(d => add(Number(d))); };
      tr.forEach((t, i) => { if (t.solo) add(i); });
    }
    const t = this.ctx.currentTime;
    tr.forEach((m, i) => {
      const node = this.tracks.get(i); if (!node) return;
      const silent = m.mute || (anySolo && !audible.has(i));
      node.muteG.gain.setTargetAtTime(silent ? 0 : 1, t, 0.01);
    });
    this.syncAllChannels();
  }
  onTempo() {
    S.p.mixer.tracks.forEach((m, i) => { const n = this.tracks.get(i); if (n) n.syncFx(m); });
    this.syncAllChannels();
  }
  /** Run timed FX callbacks (volume shaper etc.) for a scheduling window. */
  scheduleFx(w) {
    for (const t of this.tracks.values()) t.slots.forEach(s => { if (s && s.inst.schedule) s.inst.schedule(w); });
  }

  /* ---- automation ---- */
  setParam(path, value, when) {
    const a = path.split(':'), t = when == null ? this.ctx.currentTime : when;
    const ramp = (prm, v) => prm.setTargetAtTime(v, t, 0.006);
    if (a[0] === 'ch') {
      const ch = S.getCh(Number(a[1])), c = this.chans.get(Number(a[1])); if (!ch || !c) return;
      if (a[2] === 'vol') ramp(c.in.gain, this.chanMuted(ch) ? 0 : U.faderToGain(value));
      else if (a[2] === 'pan') ramp(c.pan.pan, value);
    } else if (a[0] === 'mx') {
      const tr = this.tracks.get(Number(a[1])); if (!tr) return;
      if (a[2] === 'vol') ramp(tr.vol.gain, U.faderToGain(value));
      else if (a[2] === 'pan') ramp(tr.pan.pan, value);
      else if (a[2] === 'send') { const n = tr.routes.get(Number(a[3])); if (n) ramp(n.gain, value); }
    } else if (a[0] === 'fx' || a[0] === 'fxmix') {
      const tr = this.tracks.get(Number(a[1])), slot = tr && tr.slots[Number(a[2])]; if (!slot) return;
      const m = S.p.mixer.tracks[Number(a[1])].fx[Number(a[2])];
      if (a[0] === 'fxmix') { ramp(slot.dry.gain, 1 - value); ramp(slot.wet.gain, value); return; }
      const p = Object.assign({}, m.p, { [a[3]]: value });
      FX.when = t;
      try { slot.inst.update(p, { bpm: S.p.tempo }, false); } finally { FX.when = null; }
    }
  }

  /* ---- notes ---- */
  activeVoices(chId, at) {
    let a = this.voices.get(chId);
    if (!a) this.voices.set(chId, a = []);
    for (let i = a.length - 1; i >= 0; i--) if (a[i].end < at - 0.05) a.splice(i, 1);
    return a;
  }
  trigger(chId, ev, depth) {
    const ch = S.getCh(chId);
    if (!ch) return null;
    if (this.chanMuted(ch) && !ev.force) return null;
    if (ch.type === 'layer') {
      if ((depth || 0) > 3) return null;
      const out = [];
      ch.children.forEach(id => { const child = S.getCh(id); if (child) { const r = this.trigger(id, Object.assign({}, ev, { k: ev.k + ch.pitch, force: true }), (depth || 0) + 1); if (r) out.push(r); } });
      return out.length ? { release: t => out.forEach(v => v.release(t)), end: Math.max(...out.map(v => v.end)), kill: t => out.forEach(v => v.kill(t)) } : null;
    }
    const T = Inst.types[ch.type];
    if (!T || !T.play) return null;
    const when = Math.max(ev.when, this.ctx.currentTime);
    ev.when = when;
    const act = this.activeVoices(chId, when);
    const p = ch.p;
    const maxV = DAW.settings.get('maxVoices');
    const synthMono = ch.type === 'synth' && p.mono;
    if (p.cutSelf || synthMono) act.forEach(v => { if (v.end > when) v.kill(when); });
    else while (act.length >= maxV) { act.shift().kill(when); }
    if (p.cutGroup > 0) {
      S.p.channels.forEach(o => {
        if (o.id !== chId && o.p.cutGroup === p.cutGroup) this.activeVoices(o.id, when).forEach(v => { if (v.end > when) v.kill(when); });
      });
    }
    let v;
    try { v = T.play(this, ch, ev); } catch (e) { console.error('voice error', ch.type, e); v = null; }
    if (v) act.push(v);
    return v;
  }
  panic() {
    const t = this.ctx.currentTime;
    for (const a of this.voices.values()) { a.forEach(v => v.kill(t)); a.length = 0; }
  }
  /* ---- metronome (bypasses the mixer and exports) ---- */
  click(when, accent) {
    const ctx = this.ctx, st = DAW.settings, vol = st.get('metroVol');
    if (vol <= 0) return;
    const snd = st.get('metroSound'), o = ctx.createOscillator(), g = ctx.createGain();
    const f = accent && st.get('metroAccent') ? 1.5 : 1;
    if (snd === 'beep') { o.type = 'sine'; o.frequency.value = 880 * f; }
    else if (snd === 'wood') { o.type = 'triangle'; o.frequency.value = 1200 * f; }
    else if (snd === 'cowbell') { o.type = 'square'; o.frequency.value = 560 * f; }
    else { o.type = 'square'; o.frequency.value = 1500 * f; }
    const dec = snd === 'beep' ? 0.07 : snd === 'cowbell' ? 0.12 : 0.025;
    g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(vol * 0.5, when + 0.001); g.gain.setTargetAtTime(0, when + 0.001, dec / 3);
    o.connect(g); g.connect(ctx.destination);
    o.start(when); o.stop(when + dec * 2 + 0.05);
  }
  dispose() {
    for (const t of this.tracks.values()) t.dispose();
    for (const c of this.chans.values()) c.dispose();
    this.tracks.clear(); this.chans.clear();
  }
}
DAW.Graph = Graph;

/* ================= live audio singleton ================= */
const A = DAW.audio = { ctx: null, graph: null, ready: false };

A.ensure = async () => {
  if (!A.ctx) {
    const o = { latencyHint: DAW.settings.get('latency') };
    const sr = DAW.settings.get('sampleRate');
    if (sr) o.sampleRate = sr;
    try { A.ctx = new AudioContext(o); } catch (_) { A.ctx = new AudioContext(); }
    A.ctx.offline = false;
    A.graph = new Graph(A.ctx, S.p, { live: true });
    A.previewG = A.ctx.createGain(); A.previewG.connect(A.ctx.destination);
    A.ready = true;
    S.emit('audio-ready');
  }
  if (A.ctx.state !== 'running') { try { await A.ctx.resume(); } catch (_) { /* needs gesture */ } }
  return A.ctx;
};

A.restart = async () => {
  if (A.graph) A.graph.dispose();
  if (A.ctx) { try { await A.ctx.close(); } catch (_) { /* closed */ } }
  A.ctx = null; A.graph = null; A.ready = false;
  if (DAW.seq) DAW.seq.onContextReset();
  await A.ensure();
};

A.attach = () => {
  const g = () => A.graph;
  S.on('project', () => { if (g()) { g().dispose(); A.graph = new Graph(A.ctx, S.p, { live: true }); } });
  S.on('restore', () => { if (g()) g().syncAll(); });
  S.on('channels', () => { if (g()) g().syncAll(); });
  S.on('channel', id => { if (g()) g().syncChannel(id); });
  S.on('track', i => { if (g()) g().syncTrack(i); });
  S.on('fx', i => { if (g()) g().syncFx(i); });
  S.on('tempo', () => { if (g()) g().onTempo(); if (g()) g().masterPitch = S.p.masterPitch || 0; });
  DAW.settings.on('masterLimiter', v => { if (g()) g().setLimiter(v); });
  S.on('mixer', () => { if (g()) g().syncAll(); });
};

A.auditionBuffer = async (id) => {
  await A.ensure();
  const b = await DAW.samples.get(id);
  if (!b) return null;
  if (A.auditionSrc) { try { A.auditionSrc.stop(); } catch (_) { /* done */ } }
  const s = A.ctx.createBufferSource(); s.buffer = b;
  const g = A.ctx.createGain(); g.gain.value = DAW.settings.get('previewVol');
  s.connect(g); g.connect(A.previewG);
  s.start();
  A.auditionSrc = s;
  s.onended = () => { g.disconnect(); };
  return s;
};
A.stopAudition = () => { if (A.auditionSrc) { try { A.auditionSrc.stop(); } catch (_) { /* ok */ } A.auditionSrc = null; } };

/** Live note (touch keys / MIDI / typing). Returns a handle with off(). */
A.noteOn = async (chId, k, vel, extra) => {
  await A.ensure();
  const ch = S.getCh(chId);
  if (!ch) return null;
  const ev = Object.assign({ k, v: vel || 100, when: A.ctx.currentTime + 0.005, dur: Infinity, force: true }, extra || {});
  const v = A.graph.trigger(chId, ev);
  return { off() { if (v) v.release(A.ctx.currentTime + 0.005); } };
};
})();
