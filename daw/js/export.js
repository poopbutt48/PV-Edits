'use strict';
/* Beatforge — WAV encode, Standard MIDI File export/import, project bundles. */
(() => {
const DAW = window.DAW;
const U = DAW.util, C = DAW.C, S = DAW.state;

/* ---------- WAV ---------- */
DAW.wav = {
  encode(buf, bits, o) {
    o = o || {};
    const nch = buf.numberOfChannels, len = buf.length, sr = buf.sampleRate;
    const chans = [];
    for (let c = 0; c < nch; c++) chans.push(buf.getChannelData(c));
    let gain = 1;
    if (o.normalize) {
      let pk = 0; chans.forEach(d => { for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; } });
      if (pk > 0) gain = U.dbToGain(-0.3) / pk;
    }
    const bps = bits === 32 ? 4 : bits / 8, dataLen = len * nch * bps;
    const ab = new ArrayBuffer(44 + dataLen), v = new DataView(ab);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nch, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nch * bps, true); v.setUint16(32, nch * bps, true); v.setUint16(34, bps * 8, true);
    str(36, 'data'); v.setUint32(40, dataLen, true);
    let off = 44;
    const rnd = Math.random;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < nch; c++) {
        let x = chans[c][i] * gain;
        if (bits === 32) { v.setFloat32(off, x, true); off += 4; continue; }
        x = Math.max(-1, Math.min(1, x));
        if (bits === 16) {
          if (o.dither) x += (rnd() - rnd()) / 32768;
          const n = Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
          v.setInt16(off, n, true); off += 2;
        } else {
          const n = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607)));
          v.setUint8(off, n & 255); v.setUint8(off + 1, (n >> 8) & 255); v.setUint8(off + 2, (n >> 16) & 255); off += 3;
        }
      }
    }
    return ab;
  },
  download(buf, name) {
    const st = DAW.settings;
    const ab = DAW.wav.encode(buf, st.get('rBits'), { normalize: st.get('rNormalize'), dither: st.get('rDither') && st.get('rBits') === 16 });
    U.saveBlob(new Blob([ab], { type: 'audio/wav' }), name);
  },
};

/* ---------- MIDI export ---------- */
function vlq(n) {
  const out = [n & 127];
  while ((n >>= 7)) out.unshift((n & 127) | 128);
  return out;
}
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >> 8) & 255, n & 255];
const text = s => Array.from(new TextEncoder().encode(s));

function trackBytes(events, name) {
  events.sort((a, b) => a.t - b.t || (a.order || 0) - (b.order || 0));
  const out = [0, 0xff, 0x03, ...vlq(name.length), ...text(name)];
  let last = 0;
  events.forEach(e => { out.push(...vlq(Math.max(0, Math.round(e.t - last))), ...e.bytes); last = e.t; });
  out.push(0, 0xff, 0x2f, 0);
  return [...text('MTrk'), ...be32(out.length), ...out];
}

DAW.midi = DAW.midi || {};
DAW.midi.exportSMF = (mode) => {
  const p = S.p;
  const chans = p.channels.filter(c => DAW.inst.types[c.type] && DAW.inst.types[c.type].play && c.type !== 'layer');
  const tempo = Math.round(60000000 / p.tempo);
  const meta = [0, 0xff, 0x51, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255,
    0, 0xff, 0x58, 4, p.num, Math.log2(p.den), 24, 8];
  const tr0 = [...meta, ...[0, 0xff, 0x03, ...vlq(p.meta.name.length), ...text(p.meta.name)], 0, 0xff, 0x2f, 0];
  const tracks = [[...text('MTrk'), ...be32(tr0.length), ...tr0]];
  const spans = [];
  if (mode === 'song') {
    p.playlist.clips.filter(c => c.type === 'pat' && !c.mute).forEach(c => {
      const pat = S.getPat(c.ref); if (!pat) return;
      const L = S.patLenTicks(pat);
      for (let s = c.t - (c.off || 0); s < c.t + c.d; s += L) spans.push({ pat, base: s, lo: c.t, hi: c.t + c.d });
    });
  } else { const pat = S.curPat(); spans.push({ pat, base: 0, lo: 0, hi: Infinity }); }
  chans.forEach((ch, idx) => {
    const ev = [], midiCh = idx % 16 === 9 ? 10 : idx % 16;
    spans.forEach(sp => (sp.pat.notes[ch.id] || []).forEach(n => {
      const a = sp.base + n.t; if (a < sp.lo || a >= sp.hi) return;
      const k = U.clamp(n.k + ch.pitch, 0, 127);
      ev.push({ t: a, order: 1, bytes: [0x90 | midiCh, k, U.clamp(n.v || 100, 1, 127)] });
      ev.push({ t: Math.min(a + n.d, sp.hi), order: 0, bytes: [0x80 | midiCh, k, 0] });
    }));
    if (ev.length) tracks.push(trackBytes(ev, ch.name));
  });
  const head = [...text('MThd'), ...be32(6), ...be16(1), ...be16(tracks.length), ...be16(C.PPQ)];
  return new Uint8Array([...head, ...tracks.flat()]);
};

/* ---------- MIDI import -> new pattern ---------- */
DAW.midi.importSMF = (ab, name) => {
  const d = new DataView(ab);
  const u32 = o => d.getUint32(o), u16 = o => d.getUint16(o);
  if (u32(0) !== 0x4d546864) throw new Error('Not a MIDI file');
  const ntr = u16(10), div = u16(12);
  if (div & 0x8000) throw new Error('SMPTE time division is not supported');
  const scale = C.PPQ / div;
  let off = 14, tempo = null;
  const pat = S.addPattern((name || 'MIDI import').slice(0, 24));
  let made = 0;
  for (let t = 0; t < ntr && off < ab.byteLength; t++) {
    if (u32(off) !== 0x4d54726b) break;
    const len = u32(off + 4); let p = off + 8; const end = p + len;
    let time = 0, run = 0, tname = '';
    const open = new Map(), notes = [];
    const readV = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 127); } while (b & 128); return v; };
    let program = 0;
    while (p < end) {
      time += readV();
      let st = d.getUint8(p);
      if (st < 0x80) st = run; else { p++; if (st < 0xf0) run = st; }
      if (st === 0xff) {
        const type = d.getUint8(p++), l = readV();
        if (type === 0x51 && l === 3 && tempo === null) tempo = (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2);
        if (type === 0x03) tname = new TextDecoder().decode(new Uint8Array(ab, p, l));
        p += l;
      } else if (st === 0xf0 || st === 0xf7) { p += readV(); } else {
        const hi = st & 0xf0, ch = st & 15;
        if (hi === 0xc0 || hi === 0xd0) { if (hi === 0xc0) program = d.getUint8(p); p += 1; } else {
          const a = d.getUint8(p), b = d.getUint8(p + 1); p += 2;
          const key = ch * 128 + a;
          if (hi === 0x90 && b > 0) open.set(key, { t: time, v: b, ch });
          else if (hi === 0x80 || (hi === 0x90 && b === 0)) {
            const o = open.get(key);
            if (o) { notes.push({ t: Math.round(o.t * scale), d: Math.max(1, Math.round((time - o.t) * scale)), k: a, v: o.v, ch: o.ch }); open.delete(key); }
          }
        }
      }
    }
    off = end;
    if (notes.length) {
      const drum = notes.every(n => n.ch === 9);
      const ch = drum ? S.addChannel('drum', { name: tname || 'Drums' }) : S.addChannel('synth', { name: tname || 'MIDI track ' + (t + 1), p: Object.assign({}, DAW.inst.synthPresets[program >= 88 ? 'Warm pad' : 'Electric piano']) });
      notes.forEach(n => S.addNote(pat, ch.id, { t: n.t, d: n.d, k: n.k, v: n.v }));
      made++;
    }
  }
  if (tempo) S.p.tempo = Math.round(60000000 / tempo * 100) / 100;
  S.p.patterns.length && S.emit('pattern');
  S.emit('tempo');
  return { pattern: pat, channels: made };
};

/* ---------- project bundle (project JSON + every sample it uses, base64) ---------- */
DAW.bundle = {
  async export() {
    const p = S.p, ids = new Set();
    p.channels.forEach(c => { if (c.sample && c.sample.startsWith('u:')) ids.add(c.sample); });
    p.mixer.tracks.forEach(t => t.fx.forEach(f => { if (f && f.p && typeof f.p.ir === 'string' && f.p.ir.startsWith('u:')) ids.add(f.p.ir); }));
    const samples = {};
    for (const id of ids) {
      const rec = await DAW.db.get('samples', id);
      if (rec) samples[id] = { name: rec.name, cat: rec.cat, data: U.b64(rec.bytes) };
    }
    return new Blob([JSON.stringify({ beatforge: 1, project: p, samples })], { type: 'application/json' });
  },
  async import(text) {
    const o = JSON.parse(text);
    if (!o.project) { S.importJSON(text); return; }
    for (const id in o.samples || {}) {
      const s = o.samples[id];
      const exists = await DAW.db.get('samples', id);
      if (!exists) {
        const bytes = U.unb64(s.data);
        await DAW.db.put('samples', id, { name: s.name, cat: s.cat, bytes });
      }
    }
    await DAW.samples.loadUserList();
    for (const id in o.samples || {}) await DAW.samples.get(id);
    S.setProject(S.migrate(o.project));
  },
};
})();
