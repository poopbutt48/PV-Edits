'use strict';
/* Beatforge — transport, event scheduling (shared by live playback and offline render), automation, recording. */
(() => {
const DAW = window.DAW;
const U = DAW.util, C = DAW.C, S = DAW.state, FX = DAW.fx, Inst = DAW.inst;

/* ---------- automation helpers ---------- */
const Auto = DAW.auto = {};
/** Map a normalized automation value (0..1) to the real parameter value for a target path. */
Auto.map = (path, n) => {
  const a = path.split(':');
  if (a[0] === 'ch' || a[0] === 'mx') {
    if (a[2] === 'pan') return n * 2 - 1;
    return n; // vol / send are stored as fader position 0..1
  }
  if (a[0] === 'fxmix') return n;
  if (a[0] === 'fx') {
    const m = S.p.mixer.tracks[Number(a[1])] && S.p.mixer.tracks[Number(a[1])].fx[Number(a[2])];
    const d = m && FX.types[m.type].params.find(x => x.id === a[3]);
    if (d && d.type === 'knob') return U.fromNorm(d, n);
    return n;
  }
  return n;
};
Auto.label = path => {
  const a = path.split(':');
  if (a[0] === 'ch') { const c = S.getCh(Number(a[1])); return (c ? c.name : '?') + ' ' + a[2]; }
  if (a[0] === 'mx') { const t = S.p.mixer.tracks[Number(a[1])]; return (t ? t.name : '?') + ' ' + (a[2] === 'send' ? 'send → ' + a[3] : a[2]); }
  if (a[0] === 'fx' || a[0] === 'fxmix') {
    const t = S.p.mixer.tracks[Number(a[1])], f = t && t.fx[Number(a[2])];
    if (!f) return path;
    const d = a[0] === 'fx' ? FX.types[f.type].params.find(x => x.id === a[3]) : null;
    return t.name + ' › ' + FX.types[f.type].label + ' › ' + (d ? d.label : 'Mix');
  }
  return path;
};
Auto.eval = (au, x) => {
  const pts = au.points;
  if (!pts.length) return 0.5;
  if (x <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (x >= last.t) return last.v;
  let i = 1;
  while (pts[i].t < x) i++;
  const p0 = pts[i - 1], p1 = pts[i];
  if (p0.h) return p0.v;
  let u = (x - p0.t) / (p1.t - p0.t);
  const c = p0.c || 0;
  u = c >= 0 ? Math.pow(u, 1 + c * 3) : 1 - Math.pow(1 - u, 1 - c * 3);
  return p0.v + (p1.v - p0.v) * u;
};
S.newAutomation = (target, name) => {
  const au = { id: S.id(), name: name || Auto.label(target), target, points: [{ t: 0, v: 0.5, c: 0 }, { t: C.PPQ * 4, v: 0.5, c: 0 }] };
  S.p.automation.push(au);
  return au;
};

/* ---------- event generation ---------- */
const RES = 6; // automation sampling resolution in ticks

function arpExpand(p, group) {
  // group: [{k,v,...}] sharing start/length -> array of {off, k, d, v} within the held length
  let keys = group.map(n => n.k).sort((a, b) => a - b);
  if (p.arpChord !== 'none') { const base = group[0].k, iv = C.CHORDS[p.arpChord] || [0]; keys = iv.map(i => base + i); }
  const full = [];
  for (let o = 0; o < p.arpRange; o++) keys.forEach(k => full.push(k + 12 * o));
  let seq = full.slice();
  if (p.arpDir === 'down') seq.reverse();
  else if (p.arpDir === 'updown') seq = full.concat(full.slice(1, -1).reverse());
  else if (p.arpDir === 'asplayed') seq = (p.arpChord === 'none' ? group.map(n => n.k) : keys);
  const len = Math.max(...group.map(n => n.d)), out = [];
  const rate = p.arpRate;
  for (let i = 0, off = 0; off < len - 1; i++, off += rate) {
    const k = p.arpDir === 'random' ? full[Math.floor(Math.random() * full.length)] : seq[i % seq.length];
    out.push({ off, k, d: Math.min(rate * p.arpGate, len - off), v: group[0].v });
  }
  return out;
}

/** Collect note events (pattern-time) for one channel in [a0,a1). Returns [{tick,note,d,k}] with tick being pattern-local. */
function channelNotes(ch, notes, a0, a1) {
  const p = ch.p, out = [];
  if (p.arpOn) {
    const groups = new Map();
    for (const n of notes) { if (n.t >= a0 && n.t < a1) { const key = n.t; (groups.get(key) || groups.set(key, []).get(key)).push(n); } }
    for (const [t, grp] of groups) arpExpand(p, grp).forEach(x => out.push({ tick: t + x.off, n: Object.assign({}, grp[0], { k: x.k, d: x.d, v: x.v }) }));
  } else {
    for (const n of notes) if (n.t >= a0 && n.t < a1) out.push({ tick: n.t, n });
  }
  return out;
}

function fire(g, ch, tick, n, dRaw, limitTick, timeOf) {
  const p = ch.p, spt = S.secPerTick();
  const swing = Math.max(S.p.swing || 0, p.swing || 0);
  let shift = (p.nShift || 0);
  if (swing > 0 && tick % C.STEP === 0 && Math.round(tick / C.STEP) % 2 === 1) shift += swing * C.STEP * 0.5;
  let d = dRaw * p.gate;
  if (limitTick != null) d = Math.min(d, Math.max(1, limitTick - tick));
  const when = timeOf(tick + shift) + p.nDelay / 1000;
  g.trigger(ch.id, {
    k: n.k, v: n.v == null ? 100 : n.v, pan: n.pan || 0, rel: n.rel == null ? 0.5 : n.rel, fine: n.fine || 0,
    mx: n.mx == null ? 0.5 : n.mx, my: n.my == null ? 0.5 : n.my, slide: !!n.sl, when, dur: Math.max(0.004, d * spt),
  });
}

function playAudioClip(g, clip, whenTime, skipTicks) {
  const ch = S.getCh(clip.ref);
  if (!ch || g.chanMuted(ch) || !ch.sample) return;
  const ctx = g.ctx, p = ch.p, spt = S.secPerTick();
  const buf = p.reverse ? DAW.samples.reversed(ch.sample) : DAW.samples.getSync(ch.sample);
  if (!buf) return;
  const stretch = p.stretchBpm > 0 ? S.p.tempo / p.stretchBpm : 1;
  const rate = Math.pow(2, p.tune / 12) * stretch;
  const skipSec = (skipTicks || 0) * spt * rate;
  const off = (clip.off || 0) + skipSec;
  if (off >= buf.duration) return;
  const durSec = Math.min((clip.d - (skipTicks || 0)) * spt, (buf.duration - off) / rate);
  if (durSec <= 0) return;
  const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
  const gn = ctx.createGain(), pn = ctx.createStereoPanner();
  pn.pan.value = U.clamp(p.pan, -1, 1);
  const peak = U.dbToGain(p.gain);
  const fi = Math.max(0.001, p.fadeIn / 1000), fo = Math.max(0.002, p.fadeOut / 1000);
  gn.gain.setValueAtTime(0, whenTime);
  gn.gain.linearRampToValueAtTime(peak, whenTime + Math.min(fi, durSec / 2));
  gn.gain.setValueAtTime(peak, Math.max(whenTime + fi, whenTime + durSec - fo));
  gn.gain.linearRampToValueAtTime(0, whenTime + durSec);
  src.connect(gn); gn.connect(pn); pn.connect(g.chan(ch.id).in);
  src.start(whenTime, off, durSec + 0.01);
  src.onended = () => { [src, gn, pn].forEach(n => n.disconnect()); };
  const list = g.voices.get(ch.id) || (g.voices.set(ch.id, []), g.voices.get(ch.id));
  list.push({ end: whenTime + durSec, release() {}, kill(t) { try { gn.gain.cancelScheduledValues(t); gn.gain.setValueAtTime(0, t); src.stop(t + 0.02); } catch (_) { /* done */ } } });
}

/** Schedule everything that starts inside timeline window [w0,w1) (ticks). timeOf maps ticks to context time. */
function scheduleRange(g, w0, w1, timeOf, o) {
  o = o || {};
  const p = S.p, tpb = S.ticksPerBar();
  if (o.metro && w1 > w0) {
    for (let b = Math.ceil(w0 / C.PPQ); b * C.PPQ < w1; b++) {
      g.click(timeOf(b * C.PPQ), (b * C.PPQ) % tpb === 0);
    }
  }
  if (p.mode === 'pattern' || o.mode === 'pattern') {
    const pat = o.pattern || S.curPat();
    if (!pat) return;
    for (const ch of p.channels) {
      const T = Inst.types[ch.type];
      if (!T || !T.play) continue;
      const notes = pat.notes[ch.id];
      if (!notes) continue;
      channelNotes(ch, notes, w0, w1).forEach(e => fire(g, ch, e.tick, e.n, e.n.d, null, timeOf));
    }
  } else {
    const tracks = p.playlist.tracks, anySolo = tracks.some(t => t.solo);
    for (const c of p.playlist.clips) {
      const tr = tracks[c.track];
      if (c.mute || !tr || tr.mute || (anySolo && !tr.solo)) continue;
      const cEnd = c.t + c.d;
      if (cEnd <= w0 || c.t >= w1) { if (!(c.type === 'aud' && o.midAudio && c.t < w0 && cEnd > w0 && w0 === o.midAudio)) continue; }
      if (c.type === 'pat') {
        const pat = S.getPat(c.ref); if (!pat) continue;
        const L = S.patLenTicks(pat), base = c.t - (c.off || 0);
        const r0 = Math.max(0, Math.floor((Math.max(w0, c.t) - base) / L)), r1 = Math.ceil((Math.min(w1, cEnd) - base) / L);
        for (let r = r0; r <= r1; r++) {
          const s = base + r * L;
          for (const ch of p.channels) {
            const T = Inst.types[ch.type]; if (!T || !T.play) continue;
            const notes = pat.notes[ch.id]; if (!notes) continue;
            const a0 = Math.max(w0, c.t, s) - s, a1 = Math.min(w1, cEnd, s + L) - s;
            if (a1 <= a0) continue;
            channelNotes(ch, notes, a0, a1).forEach(e => fire(g, ch, s + e.tick, e.n, e.n.d, cEnd, timeOf));
          }
        }
      } else if (c.type === 'aud') {
        if (c.t >= w0 && c.t < w1) playAudioClip(g, c, timeOf(c.t), 0);
        else if (o.midAudio === w0) playAudioClip(g, c, timeOf(w0), w0 - c.t);
      } else if (c.type === 'auto') {
        const au = p.automation.find(a => a.id === c.ref); if (!au) continue;
        const a0 = Math.max(w0, c.t), a1 = Math.min(w1, cEnd);
        for (let x = Math.ceil(a0 / RES) * RES; x < a1; x += RES) {
          g.setParam(au.target, Auto.map(au.target, Auto.eval(au, x - c.t + (c.off || 0))), timeOf(x));
        }
      }
    }
  }
  g.scheduleFx({ t0: w0, t1: w1, timeOf });
}
DAW.scheduleRange = scheduleRange;

/* ---------- transport ---------- */
const ev = new U.Emitter();
const Seq = DAW.seq = {
  playing: false, recording: false, metronome: false, loop: true,
  startPos: 0, anchors: [], nextPos: 0, nextTime: 0, timer: null, countIn: 0, recNotes: new Map(), recOpen: new Map(),
  on: (e, f) => ev.on(e, f),
};
const LOOKAHEAD = 0.14;

function loopBounds() {
  const L = S.p.playlist;
  if (S.p.mode === 'pattern') return { a: 0, b: S.patLenTicks(S.curPat()) };
  if (L.loopOn && L.loopEnd > L.loopStart) return { a: L.loopStart, b: L.loopEnd };
  return null;
}

Seq.getPos = () => {
  const A = DAW.audio;
  if (!Seq.playing || !A.ctx) return Seq.startPos;
  const now = A.ctx.currentTime - (A.ctx.outputLatency || A.ctx.baseLatency || 0);
  let a = null;
  for (const x of Seq.anchors) if (x.time <= now) a = x;
  if (!a) return Seq.anchors.length ? Seq.anchors[0].pos : Seq.startPos;
  return a.pos + (now - a.time) / a.spt;
};
Seq.inCountIn = () => Seq.playing && Seq.getPos() < 0;

Seq.setPos = t => {
  const was = Seq.playing;
  if (was) Seq.halt(false);
  Seq.startPos = Math.max(0, t);
  if (was) Seq.start();
  ev.emit('pos');
};

function pump() {
  const A = DAW.audio;
  if (!Seq.playing || !A.ctx) return;
  const g = A.graph, now = A.ctx.currentTime, horizon = now + LOOKAHEAD;
  let guard = 0;
  while (Seq.nextTime < horizon && guard++ < 40) {
    const spt = S.secPerTick();
    const lb = loopBounds();
    let chunk = Math.max(1, Math.ceil((horizon - Seq.nextTime) / spt));
    if (lb && Seq.loop && Seq.nextPos < lb.b) chunk = Math.min(chunk, lb.b - Seq.nextPos);
    const p0 = Seq.nextPos, t0 = Seq.nextTime;
    Seq.anchors.push({ time: t0, pos: p0, spt });
    if (Seq.anchors.length > 12) Seq.anchors.shift();
    const metro = (Seq.metronome && (DAW.settings.get('metroMode') === 'always' || Seq.recording)) || (Seq.recording && p0 < 0);
    scheduleRange(g, p0, p0 + chunk, tp => t0 + (tp - p0) * spt, { metro });
    Seq.nextPos = p0 + chunk; Seq.nextTime = t0 + chunk * spt;
    if (lb && Seq.loop && Seq.nextPos >= lb.b) {
      Seq.nextPos = lb.a;
      if (Seq.recording && !DAW.settings.get('loopRec')) Seq.recording = false, ev.emit('transport');
    } else if (!lb && S.p.mode === 'song' && Seq.nextPos > S.songEnd() + S.ticksPerBar() * 2 && !Seq.recording) {
      Seq.stopAfter = Seq.nextTime + 1.5;
    }
  }
  if (Seq.stopAfter && now > Seq.stopAfter) { Seq.stopAfter = 0; Seq.stop(); }
}

Seq.start = async () => {
  const A = DAW.audio;
  await A.ensure();
  if (Seq.playing) return;
  await DAW.samples.preload(S.p);
  const spt = S.secPerTick();
  let from = Seq.startPos;
  if (Seq.recording && Seq.countIn) from = -Seq.countIn * S.ticksPerBar();
  Seq.playing = true; Seq.stopAfter = 0;
  Seq.nextPos = from; Seq.nextTime = A.ctx.currentTime + 0.06; Seq.anchors = [{ time: Seq.nextTime, pos: from, spt }];
  if (S.p.mode === 'song' && from >= 0) {
    // clips already running at the start position
    scheduleRange(A.graph, from, from, () => Seq.nextTime, {});
    S.p.playlist.clips.forEach(c => { if (c.type === 'aud' && !c.mute && c.t < from && c.t + c.d > from) { const tr = S.p.playlist.tracks[c.track]; if (tr && !tr.mute) playAudioClip(A.graph, c, Seq.nextTime, from - c.t); } });
  }
  if (!Seq.worker) {
    try {
      const url = URL.createObjectURL(new Blob(['let id=0;onmessage=e=>{clearInterval(id);if(e.data==="start")id=setInterval(()=>postMessage(0),22)}'], { type: 'application/javascript' }));
      Seq.worker = new Worker(url);
      Seq.worker.onmessage = pump;
    } catch (_) { Seq.worker = null; }
  }
  if (Seq.worker) Seq.worker.postMessage('start'); else Seq.interval = setInterval(pump, 25);
  pump();
  requestWake(true);
  ev.emit('transport');
};

function requestWake(on) {
  try {
    if (on && DAW.settings.get('wakeLock') && navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { Seq.wake = l; }).catch(() => {});
    else if (!on && Seq.wake) { Seq.wake.release(); Seq.wake = null; }
  } catch (_) { /* unsupported */ }
}

Seq.halt = keepPos => {
  if (!Seq.playing) return;
  if (keepPos) Seq.startPos = Math.max(0, Seq.getPos());
  Seq.playing = false;
  if (Seq.worker) Seq.worker.postMessage('stop');
  if (Seq.interval) { clearInterval(Seq.interval); Seq.interval = 0; }
  const A = DAW.audio;
  if (A.graph) A.graph.panic();
  requestWake(false);
  Seq.flushRecording();
};
Seq.pause = () => { Seq.halt(true); ev.emit('transport'); };
Seq.stop = () => {
  const was = Seq.playing;
  Seq.halt(false);
  Seq.recording = false;
  const L = S.p.playlist;
  Seq.startPos = S.p.mode === 'song' && L.loopOn ? L.loopStart : 0;
  if (!was) Seq.startPos = 0;
  ev.emit('transport'); ev.emit('pos');
};
Seq.toggle = () => (Seq.playing ? Seq.pause() : Seq.start());
Seq.toggleRecord = () => {
  Seq.recording = !Seq.recording;
  Seq.countIn = Seq.recording ? DAW.settings.get('countIn') * 1 : 0;
  if (Seq.recording && !Seq.playing) Seq.start();
  else if (!Seq.recording) Seq.flushRecording();
  ev.emit('transport');
};
Seq.onContextReset = () => { Seq.halt(false); ev.emit('transport'); };

/* ---------- note recording ---------- */
const quantTicks = () => ({ none: 0, step: C.STEP, '1/2b': 48, beat: C.PPQ }[DAW.settings.get('recQuant')] || 0);
Seq.recNoteOn = (chId, k, vel) => {
  if (!Seq.recording || !Seq.playing) return;
  const pos = Seq.getPos();
  if (pos < 0) return;
  Seq.recOpen.set(chId + ':' + k, { chId, k, vel, t: pos });
};
Seq.recNoteOff = (chId, k) => {
  const key = chId + ':' + k, o = Seq.recOpen.get(chId + ':' + k);
  if (!o) return;
  Seq.recOpen.delete(key);
  const pat = S.curPat(), L = S.patLenTicks(pat), q = quantTicks();
  let t = S.p.mode === 'pattern' ? o.t % L : o.t % L;
  let d = Math.max(6, Seq.getPos() - o.t);
  if (q) { t = Math.round(t / q) * q; d = Math.max(q, Math.round(d / q) * q); }
  S.addNote(pat, chId, { t: Math.round(t), d: Math.round(d), k, v: o.vel });
  S.emit('notes', pat.id, chId);
};
Seq.flushRecording = () => {
  const open = Array.from(Seq.recOpen.values());
  open.forEach(o => Seq.recNoteOff(o.chId, o.k));
  if (open.length) S.commit('Record notes');
};

/* tempo / mode changes while playing take effect on the next scheduled chunk */
S.on('tempo', () => ev.emit('transport'));

/* ---------- offline render ---------- */
DAW.render = async opts => {
  opts = Object.assign({ sampleRate: 44100, mode: S.p.mode, tail: 2, limiter: true, loops: 1, solo: null }, opts || {});
  const p = S.p, spt = S.secPerTick();
  let lenTicks;
  if (opts.mode === 'pattern') lenTicks = S.patLenTicks(S.curPat()) * opts.loops;
  else {
    const L = p.playlist;
    lenTicks = L.loopOn && L.loopEnd > L.loopStart ? L.loopEnd : S.songEnd();
    if (opts.fromStart !== false && L.loopOn && L.loopEnd > L.loopStart) opts.startTick = L.loopStart;
  }
  const startTick = opts.startTick || 0;
  const total = Math.ceil(((lenTicks - startTick) * spt + opts.tail) * opts.sampleRate);
  if (total < 1 || lenTicks <= startTick) throw new Error('Nothing to render — add notes or place patterns in the playlist first.');
  await DAW.samples.preload(p);
  const ctx = new OfflineAudioContext(2, total, opts.sampleRate);
  ctx.offline = true;
  const saveMode = p.mode; p.mode = opts.mode;
  const g = new DAW.Graph(ctx, p, { live: false, limiter: opts.limiter });
  if (opts.soloTrack != null) {
    p.mixer.tracks.forEach((t, i) => { const n = g.tracks.get(i); if (n && i !== 0) n.muteG.gain.value = (i === opts.soloTrack) ? 1 : 0; });
  }
  const timeOf = tp => (tp - startTick) * spt;
  try {
    const chunk = C.PPQ * 16;
    for (let a = startTick; a < lenTicks; a += chunk) {
      scheduleRange(g, a, Math.min(lenTicks, a + chunk), timeOf, { mode: opts.mode === 'pattern' ? 'pattern' : undefined, midAudio: a === startTick && startTick > 0 ? a : undefined });
      if (opts.mode === 'pattern' && opts.loops > 1) { /* pattern loops handled below */ }
    }
    if (opts.mode === 'pattern' && opts.loops > 1) {
      const L = S.patLenTicks(S.curPat());
      for (let l = 1; l < opts.loops; l++) scheduleRange(g, 0, L, tp => (tp + l * L) * spt, { mode: 'pattern' });
    }
  } finally { p.mode = saveMode; }
  const buf = await ctx.startRendering();
  g.dispose();
  return buf;
};
})();
