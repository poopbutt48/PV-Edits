'use strict';
/* Beatforge — playlist (song arrangement): pattern, audio and automation clips on tracks. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq, st = DAW.settings;

const view = {};
ui.registerView('playlist', view);

const HW = 84, RH = 28;
const pl = { tool: 'draw', snap: 'bar', zx: 0.2, ox: 0, oy: 0, sel: new Set(), clip: null };
ui.pl = pl;
let root, wrap, base, over, selBar, snapBtn, patBtn, toolEls = {};
let W = 0, H = 0, dpr = 1, dirty = true;
let ptrs = new Map(), drag = null, nav = null, marquee = null;

const th = () => st.get('plTrackH');
const tx = t => HW + (t - pl.ox) * pl.zx;
const xt = x => (x - HW) / pl.zx + pl.ox;
const ty = i => RH + i * th() - pl.oy;
const yt = y => Math.floor((y - RH + pl.oy) / th());
const invalidate = () => { dirty = true; };
const clips = () => S.p.playlist.clips;
const spt = () => S.secPerTick();

function snapTicks() {
  const s = C.SNAPS.find(x => x.id === pl.snap) || C.SNAPS[10];
  if (s.ticks === -2) return S.ticksPerBar();
  if (s.ticks === -1) { const o = [6, 24, 48, 96, S.ticksPerBar(), S.ticksPerBar() * 4]; return o.find(v => v * pl.zx >= 10) || o[o.length - 1]; }
  return s.ticks || 1;
}
const snapT = (t, mode) => { const g = snapTicks(); return g <= 1 ? Math.round(t) : (mode === 'floor' ? Math.floor(t / g) * g : Math.round(t / g) * g); };

function clampView() {
  const end = Math.max(S.songEnd(), S.ticksPerBar() * 16) + S.ticksPerBar() * 8;
  pl.ox = U.clamp(pl.ox, 0, Math.max(0, end - (W - HW) / pl.zx * 0.4));
  pl.oy = U.clamp(pl.oy, 0, Math.max(0, S.p.playlist.tracks.length * th() - (H - RH) + th()));
}

const clipColor = c => {
  if (c.type === 'pat') { const p = S.getPat(c.ref); return p ? p.color : '#888'; }
  if (c.type === 'aud') { const ch = S.getCh(c.ref); return ch ? ch.color : '#6aa'; }
  return '#c88a5a';
};
const clipName = c => {
  if (c.type === 'pat') { const p = S.getPat(c.ref); return p ? p.name : '(deleted)'; }
  if (c.type === 'aud') { const ch = S.getCh(c.ref); return ch ? ch.name : '(deleted)'; }
  const a = S.p.automation.find(x => x.id === c.ref); return a ? a.name : 'Automation';
};
function audioLenTicks(ch) {
  const b = DAW.samples.getSync(ch.sample); if (!b) return S.ticksPerBar();
  return Math.max(6, Math.round(b.duration / spt() / Math.pow(2, ch.p.tune / 12) / (ch.p.stretchBpm > 0 ? S.p.tempo / ch.p.stretchBpm : 1)));
}

/* ---------- drawing ---------- */
function rr(g, x, y, w, hh, r) { r = Math.min(r, w / 2, hh / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function drawClip(g, c, y, hh) {
  const x = tx(c.t), w = Math.max(3, c.d * pl.zx - 1), col = c.mute ? '#4a5266' : clipColor(c);
  if (x + w < HW || x > W) return;
  const sel = pl.sel.has(c.id);
  g.save();
  rr(g, x, y, w, hh, 5); g.clip();
  g.fillStyle = U.rgba(col, c.mute ? 0.5 : 0.4); g.fillRect(x, y, w, hh);
  g.fillStyle = col; g.fillRect(x, y, w, Math.min(15, hh * 0.32));
  if (c.type === 'pat' && st.get('plClipPreview') && w > 20) {
    const p = S.getPat(c.ref);
    if (p) {
      const L = S.patLenTicks(p); let lo = 127, hi = 0, any = false;
      for (const k in p.notes) for (const n of p.notes[k]) { any = true; if (n.k < lo) lo = n.k; if (n.k > hi) hi = n.k; }
      if (any) {
        const span = Math.max(8, hi - lo + 1), top = y + Math.min(15, hh * 0.32) + 2, ah = hh - (top - y) - 3, nh = Math.max(1.5, Math.min(4, ah / span));
        g.fillStyle = 'rgba(255,255,255,.75)';
        const base = c.t - (c.off || 0);
        for (let r = Math.max(0, Math.floor((Math.max(pl.ox, c.t) - base) / L)); base + r * L < Math.min(c.t + c.d, xt(W)); r++) {
          for (const k in p.notes) for (const n of p.notes[k]) {
            const nt = base + r * L + n.t; if (nt < c.t || nt >= c.t + c.d) continue;
            const nx = tx(nt); if (nx > W || nx + n.d * pl.zx < HW) continue;
            g.fillRect(nx, top + (hi - n.k) / span * (ah - nh), Math.max(1.5, n.d * pl.zx - 0.5), nh);
          }
          if (r > 400) break;
        }
        g.fillStyle = 'rgba(0,0,0,.25)';
        for (let r = 1; base + r * L < c.t + c.d; r++) { const lx = tx(base + r * L); if (lx > x && lx < x + w) g.fillRect(lx, y + 15, 1, hh - 15); }
      }
    }
  } else if (c.type === 'aud' && st.get('plWaveforms')) {
    const ch = S.getCh(c.ref), pk = ch && ch.sample ? DAW.samples.peaks(ch.sample, 1024) : null;
    if (pk) {
      const buf = DAW.samples.getSync(ch.sample), top = y + 16, mid = top + (hh - 18) / 2, amp = (hh - 20) / 2;
      const rate = Math.pow(2, ch.p.tune / 12) * (ch.p.stretchBpm > 0 ? S.p.tempo / ch.p.stretchBpm : 1);
      g.fillStyle = 'rgba(255,255,255,.8)';
      const x0 = Math.max(Math.floor(x), HW), x1 = Math.min(Math.ceil(x + w), W);
      for (let px = x0; px < x1; px += 1) {
        const sec = (c.off || 0) + (xt(px) - c.t) * spt() * rate, f = sec / buf.duration;
        if (f < 0 || f >= 1) continue;
        const i = Math.floor(f * 1024) * 2, lo = pk[i], hi2 = pk[i + 1];
        g.fillRect(px, mid - hi2 * amp, 1, Math.max(1, (hi2 - lo) * amp));
      }
    }
  } else if (c.type === 'auto') {
    const au = S.p.automation.find(a => a.id === c.ref);
    if (au) {
      g.strokeStyle = '#fff'; g.lineWidth = 1.6; g.beginPath();
      const top = y + 17, ah = hh - 21;
      for (let px = Math.max(Math.floor(x), HW); px < Math.min(x + w, W); px += 2) {
        const v = DAW.auto.eval(au, xt(px) - c.t + (c.off || 0)), yy = top + (1 - v) * ah;
        px === Math.max(Math.floor(x), HW) ? g.moveTo(px, yy) : g.lineTo(px, yy);
      }
      g.stroke();
    }
  }
  g.fillStyle = 'rgba(0,0,0,.72)'; g.font = '600 11px sans-serif'; g.textBaseline = 'top';
  if (w > 26) g.fillText(clipName(c), Math.max(x, HW) + 5, y + 2);
  g.restore();
  if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; rr(g, x, y, w, hh, 5); g.stroke(); }
  if (st.get('bigHandles') && w > 24) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x + w - 5, y + hh / 2 - 7, 2, 14); }
}

function drawBase() {
  if (!W) return;
  const g = base.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const tracks = S.p.playlist.tracks, T = th(), tpb = S.ticksPerBar();
  const i0 = Math.max(0, yt(RH)), i1 = Math.min(tracks.length - 1, yt(H));
  const t0 = Math.max(0, xt(HW)), t1 = xt(W);
  const solo = tracks.some(t => t.solo);
  for (let i = i0; i <= i1; i++) {
    const y = ty(i);
    g.fillStyle = i % 2 ? '#0e1117' : '#12161e'; g.fillRect(HW, y, W - HW, T);
    g.fillStyle = '#1b212c'; g.fillRect(HW, y + T - 1, W - HW, 1);
  }
  // grid
  const sg = snapTicks();
  if (sg * pl.zx >= 7) { g.fillStyle = '#161b25'; for (let t = Math.ceil(t0 / sg) * sg; t < t1; t += sg) g.fillRect(Math.round(tx(t)), RH, 1, H - RH); }
  g.fillStyle = '#212836';
  for (let t = Math.ceil(t0 / C.PPQ) * C.PPQ; t < t1 && C.PPQ * pl.zx >= 12; t += C.PPQ) g.fillRect(Math.round(tx(t)), RH, 1, H - RH);
  g.fillStyle = '#2f384a';
  for (let t = Math.ceil(t0 / tpb) * tpb; t < t1; t += tpb) g.fillRect(Math.round(tx(t)), RH, 1, H - RH);
  // loop
  const L = S.p.playlist;
  if (L.loopOn && L.loopEnd > L.loopStart) { g.fillStyle = 'rgba(55,214,197,.07)'; g.fillRect(tx(L.loopStart), RH, (L.loopEnd - L.loopStart) * pl.zx, H - RH); }
  // clips
  for (const c of clips()) {
    const i = c.track; if (i < i0 || i > i1) continue;
    const tr = tracks[i];
    g.globalAlpha = tr && (tr.mute || (solo && !tr.solo)) ? 0.4 : 1;
    drawClip(g, c, ty(i) + 2, T - 4);
    g.globalAlpha = 1;
  }
  // track headers
  g.fillStyle = '#10131a'; g.fillRect(0, RH, HW, H - RH);
  for (let i = i0; i <= i1; i++) {
    const tr = tracks[i], y = ty(i), col = tr.col || '#3a4560';
    g.fillStyle = '#171b24'; g.fillRect(0, y, HW - 1, T - 1);
    g.fillStyle = col; g.fillRect(0, y, 4, T - 1);
    g.fillStyle = tr.mute ? '#646e84' : '#dde2ee'; g.font = '600 12px sans-serif'; g.textBaseline = 'top';
    g.fillText(clip(g, tr.name, HW - 14), 9, y + 5);
    const by = y + T - 24;
    [['M', 9, tr.mute, '#4a5575', '#fff'], ['S', 39, tr.solo, '#ffd24d', '#2b2100']].forEach(([l, bx, on, bg, fg]) => {
      g.fillStyle = on ? bg : '#252b38'; rr(g, bx, by, 26, 20, 5); g.fill();
      g.fillStyle = on ? fg : '#9aa4ba'; g.font = '700 11px sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(l, bx + 13, by + 10.5); g.textAlign = 'left';
    });
  }
  if (S.p.playlist.tracks.length < C.MAX_PL_TRACKS) {
    const y = ty(tracks.length);
    if (y < H) { g.fillStyle = '#ff8a3d'; g.font = '600 12px sans-serif'; g.textBaseline = 'middle'; g.fillText('+  Add track', 12, y + 22); }
  }
  // ruler
  g.fillStyle = '#10131a'; g.fillRect(0, 0, W, RH);
  g.strokeStyle = '#262d3b'; g.beginPath(); g.moveTo(0, RH - 0.5); g.lineTo(W, RH - 0.5); g.stroke();
  if (L.loopOn && L.loopEnd > L.loopStart) { g.fillStyle = 'rgba(55,214,197,.35)'; g.fillRect(tx(L.loopStart), RH - 6, (L.loopEnd - L.loopStart) * pl.zx, 6); }
  g.font = '600 11px sans-serif'; g.textBaseline = 'middle';
  const labelEvery = Math.max(1, Math.ceil(46 / (tpb * pl.zx)));
  for (let b = Math.floor(t0 / tpb); b * tpb < t1; b++) {
    const x = tx(b * tpb); if (x < HW - 1) continue;
    g.fillStyle = '#46506a'; g.fillRect(Math.round(x), 8, 1, RH - 8);
    if (b % labelEvery === 0) { g.fillStyle = '#aab3c8'; g.fillText(String(b + 1), x + 4, 12); }
  }
  for (const m of L.markers || []) {
    const x = tx(m.t); if (x < HW || x > W) continue;
    g.fillStyle = m.col || '#ffd24d'; g.fillRect(x, 0, 2, RH); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 7 + g.measureText(m.name).width, 0); g.lineTo(x + 7 + g.measureText(m.name).width, 12); g.lineTo(x, 12); g.fill();
    g.fillStyle = '#1a1300'; g.font = '600 10px sans-serif'; g.fillText(m.name, x + 4, 6);
  }
  g.fillStyle = '#0a0c10'; g.fillRect(0, 0, HW, RH);
  g.fillStyle = '#646e84'; g.font = '10px sans-serif'; g.fillText(snapName(), 8, RH / 2);
  dirty = false;
}
function clip(g, s, w) { if (g.measureText(s).width <= w) return s; while (s.length > 1 && g.measureText(s + '…').width > w) s = s.slice(0, -1); return s + '…'; }
function snapName() { const s = C.SNAPS.find(x => x.id === pl.snap); return s ? s.label : ''; }

function drawOver(pos) {
  if (!W) return;
  const g = over.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (S.p.mode === 'song' || !seq.playing) {
    const p = seq.playing ? pos : seq.startPos, x = tx(p);
    if (p >= 0 && x >= HW && x <= W) {
      g.fillStyle = seq.playing ? '#37d6c5' : 'rgba(55,214,197,.6)'; g.fillRect(x - 1, 0, 2, H);
      g.beginPath(); g.moveTo(x - 6, 0); g.lineTo(x + 6, 0); g.lineTo(x, 9); g.fill();
    }
  }
  if (marquee) {
    g.strokeStyle = '#ff8a3d'; g.fillStyle = 'rgba(255,138,61,.12)'; g.lineWidth = 1.5;
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), hh = Math.abs(marquee.y1 - marquee.y0);
    g.fillRect(x, y, w, hh); g.strokeRect(x, y, w, hh);
  }
  if (drag && drag.type === 'loop') { g.fillStyle = 'rgba(55,214,197,.3)'; const a = tx(Math.min(drag.a, drag.b)), b = tx(Math.max(drag.a, drag.b)); g.fillRect(a, 0, b - a, H); }
}

/* ---------- ops ---------- */
function done(label) { S.commit(label); S.emit('playlist'); invalidate(); refreshSel(); }
const selClips = () => clips().filter(c => pl.sel.has(c.id));
function refreshSel() { selBar.hidden = pl.sel.size === 0; selBar.querySelector('.sel-count').textContent = pl.sel.size + ' selected'; }

function freeTrackAt(t, d) {
  const tr = S.p.playlist.tracks;
  for (let i = 0; i < tr.length; i++) if (!clips().some(c => c.track === i && c.t < t + d && c.t + c.d > t)) return i;
  return 0;
}
ui.addTrack = () => {
  const tr = S.p.playlist.tracks;
  if (tr.length >= C.MAX_PL_TRACKS) { ui.toast('Maximum of ' + C.MAX_PL_TRACKS + ' tracks'); return; }
  tr.push({ name: 'Track ' + (tr.length + 1), col: null, mute: false, solo: false }); S.commit('Add track'); S.emit('playlist'); invalidate();
};
ui.addMarker = async () => {
  const n = await ui.prompt('Marker name', 'Marker ' + ((S.p.playlist.markers || []).length + 1));
  if (!n) return;
  (S.p.playlist.markers = S.p.playlist.markers || []).push({ id: S.id(), t: Math.max(0, Math.round(seq.playing ? seq.getPos() : seq.startPos)), name: n });
  S.commit('Add marker'); invalidate();
};
ui.addAudioClip = (sampleId) => {
  const info = DAW.samples.info(sampleId);
  const ch = S.addChannel('audio', { name: info ? info.name : 'Audio', sample: sampleId });
  DAW.samples.preload(S.p).then(() => {
    const t = snapT(seq.startPos, 'floor'), d = audioLenTicks(ch);
    S.addClip({ type: 'aud', track: freeTrackAt(t, d), t, d, ref: ch.id, off: 0 });
    S.commit('Add audio clip'); invalidate(); ui.toast('Audio clip added to the playlist');
  });
};
ui.placeClip = (type, ref, t, track, d) => { const c = S.addClip({ type, track, t, d, ref, off: 0 }); S.commit('Add clip'); invalidate(); return c; };

function clipMenu(c) {
  const p = c.type === 'pat' ? S.getPat(c.ref) : null;
  ui.menu([
    c.type === 'pat' ? { label: 'Edit pattern', icon: 'rack', onClick: () => { S.ui.pat = c.ref; S.emit('pattern'); ui.show('rack'); } } : null,
    c.type === 'pat' ? { label: 'Open in piano roll', icon: 'piano', onClick: () => { S.ui.pat = c.ref; S.emit('pattern'); ui.show('piano'); } } : null,
    c.type === 'auto' ? { label: 'Edit automation', icon: 'graph', onClick: () => ui.openAutomation && ui.openAutomation(c.ref) } : null,
    c.type === 'aud' ? { label: 'Channel settings', icon: 'gear', onClick: () => ui.openChannel(c.ref) } : null,
    c.type === 'pat' ? { label: 'Make unique (clone pattern)', icon: 'copy', onClick: () => { const np = S.clonePattern(c.ref); c.ref = np.id; S.commit('Make unique'); invalidate(); } } : null,
    { label: c.mute ? 'Unmute clip' : 'Mute clip', icon: 'mute', onClick: () => { c.mute = !c.mute; done('Mute clip'); } },
    { label: 'Duplicate', icon: 'copy', onClick: () => { pl.sel.clear(); pl.sel.add(c.id); ops.dup(); } },
    { label: 'Length…', icon: 'clock', onClick: async () => { const v = await ui.prompt('Clip length in bars', +(c.d / S.ticksPerBar()).toFixed(2), { number: true }); const n = parseFloat(v); if (n > 0) { c.d = Math.max(6, Math.round(n * S.ticksPerBar())); done('Clip length'); } } },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => { S.p.playlist.clips = clips().filter(x => x !== c); pl.sel.delete(c.id); done('Delete clip'); } },
  ], { title: clipName(c) + (p ? '' : '') });
}
const ops = {
  delete() { S.p.playlist.clips = clips().filter(c => !pl.sel.has(c.id)); pl.sel.clear(); done('Delete clips'); },
  dup() {
    const l = selClips(); if (!l.length) return;
    const a = Math.min(...l.map(c => c.t)), b = Math.max(...l.map(c => c.t + c.d)), span = Math.ceil((b - a) / S.ticksPerBar()) * S.ticksPerBar();
    pl.sel.clear();
    l.forEach(c => { const n = S.addClip(Object.assign({}, c, { t: c.t + span })); pl.sel.add(n.id); });
    done('Duplicate clips');
  },
  copy() { const l = selClips(); if (!l.length) return; const a = Math.min(...l.map(c => c.t)); pl.clip = l.map(c => Object.assign({}, c, { t: c.t - a })); ui.toast(l.length + ' clips copied'); },
  paste() { if (!pl.clip) return; const at = snapT(seq.startPos); pl.sel.clear(); pl.clip.forEach(c => { const n = S.addClip(Object.assign({}, c, { t: c.t + at })); pl.sel.add(n.id); }); done('Paste clips'); },
  mute() { selClips().forEach(c => { c.mute = !c.mute; }); done('Mute clips'); },
  all() { clips().forEach(c => pl.sel.add(c.id)); invalidate(); refreshSel(); },
  none() { pl.sel.clear(); invalidate(); refreshSel(); },
  slice(c, t) {
    if (t <= c.t + 3 || t >= c.t + c.d - 3) return;
    const n = Object.assign({}, c, { id: S.id(), t, d: c.t + c.d - t });
    n.off = (c.off || 0) + (c.type === 'aud' ? (t - c.t) * spt() : (t - c.t));
    c.d = t - c.t;
    clips().push(n); done('Slice clip');
  },
};

/* ---------- interaction ---------- */
const pt = e => { const r = over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
function hit(x, y) {
  const T = th();
  for (let i = clips().length - 1; i >= 0; i--) {
    const c = clips()[i], cx = tx(c.t), cw = Math.max(6, c.d * pl.zx), cy = ty(c.track);
    if (x >= cx - 3 && x <= cx + cw + 3 && y >= cy && y <= cy + T) {
      const hw = st.get('bigHandles') ? Math.min(cw * 0.35, 24) : Math.min(cw * 0.3, 10);
      return { c, right: x > cx + cw - hw, left: cw > 70 && x < cx + Math.min(cw * 0.2, 14) };
    }
  }
  return null;
}
function headerHit(x, y) {
  const i = yt(y), tr = S.p.playlist.tracks;
  if (i < 0) return null;
  if (i === tr.length) return { add: true };
  if (i >= tr.length) return null;
  const by = ty(i) + th() - 24;
  if (y >= by && y <= by + 20) { if (x >= 9 && x <= 35) return { i, btn: 'M' }; if (x >= 39 && x <= 65) return { i, btn: 'S' }; }
  return { i };
}
function trackMenu(i) {
  const tr = S.p.playlist.tracks[i];
  ui.menu([
    { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await ui.prompt('Rename track', tr.name); if (n) { tr.name = n; S.commit('Rename track'); invalidate(); } } },
    { label: 'Colour', icon: 'paint', onClick: async () => { const c = await ui.pickColor(tr.col, true); if (c != null) { tr.col = c || null; S.commit('Track colour'); invalidate(); } } },
    { label: 'Clear track', icon: 'eraser', onClick: () => { S.p.playlist.clips = clips().filter(c => c.track !== i); done('Clear track'); } },
    { label: 'Insert track above', icon: 'up', onClick: () => { S.p.playlist.tracks.splice(i, 0, { name: 'Track', col: null, mute: false, solo: false }); clips().forEach(c => { if (c.track >= i) c.track++; }); done('Insert track'); } },
    { label: 'Delete track', icon: 'trash', danger: true, onClick: () => { if (S.p.playlist.tracks.length <= 1) return; S.p.playlist.tracks.splice(i, 1); S.p.playlist.clips = clips().filter(c => c.track !== i); clips().forEach(c => { if (c.track > i) c.track--; }); done('Delete track'); } },
  ], { title: tr.name });
}

function onDown(e) {
  e.preventDefault();
  const p = pt(e); ptrs.set(e.pointerId, p);
  try { over.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (ptrs.size === 2 && st.get('twoFingerNav')) {
    const a = Array.from(ptrs.values());
    nav = { cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, dx: Math.max(30, Math.abs(a[0].x - a[1].x)), zx: pl.zx, ox: pl.ox, oy: pl.oy };
    drag = null; marquee = null; return;
  }
  if (ptrs.size > 2) return;
  if (st.get('stylusOnly') && e.pointerType === 'touch') { drag = { type: 'pan', id: e.pointerId, x0: p.x, y0: p.y, ox: pl.ox, oy: pl.oy }; return; }
  if (p.y < RH) {
    if (p.x < HW) { snapMenu(); return; }
    const t = Math.max(0, xt(p.x));
    drag = { type: 'ruler', id: e.pointerId, a: snapT(t), b: snapT(t), x0: p.x, moved: false };
    drag.holdT = setTimeout(() => { if (drag && !drag.moved) { drag.held = true; DAW.haptic(15); rulerMenu(drag.a); } }, st.get('longPressMs'));
    return;
  }
  if (p.x < HW) {
    const hh = headerHit(p.x, p.y); if (!hh) return;
    if (hh.add) { ui.addTrack(); return; }
    const tr = S.p.playlist.tracks[hh.i];
    if (hh.btn === 'M') { tr.mute = !tr.mute; S.commit('Mute track'); invalidate(); return; }
    if (hh.btn === 'S') { tr.solo = !tr.solo; S.commit('Solo track'); invalidate(); return; }
    drag = { type: 'hdr', id: e.pointerId, i: hh.i, holdT: setTimeout(() => { DAW.haptic(15); drag.held = true; trackMenu(hh.i); }, st.get('longPressMs')), x0: p.x, y0: p.y };
    return;
  }
  const t = xt(p.x), tk = yt(p.y), tool = pl.tool;
  if (tool === 'pan') { drag = { type: 'pan', id: e.pointerId, x0: p.x, y0: p.y, ox: pl.ox, oy: pl.oy }; return; }
  const hh = hit(p.x, p.y);
  if (tool === 'erase') { drag = { type: 'erase', id: e.pointerId, n: 0 }; if (hh) eraseClip(hh.c); return; }
  if (tool === 'mute') { if (hh) { hh.c.mute = !hh.c.mute; done('Mute clip'); } return; }
  if (tool === 'slice') { if (hh) ops.slice(hh.c, snapT(t)); return; }
  if (hh) {
    const c = hh.c, group = pl.sel.has(c.id) ? selClips() : [c];
    drag = { type: hh.right ? 'resize' : hh.left ? 'trim' : 'move', id: e.pointerId, c, group, orig: new Map(group.map(g2 => [g2, { t: g2.t, d: g2.d, track: g2.track, off: g2.off || 0 }])), t0: t, tk0: tk, offT: t - c.t, moved: false, x0: p.x, y0: p.y };
    drag.holdT = setTimeout(() => { if (drag && !drag.moved && drag.c === c) { drag.held = true; DAW.haptic(18); drag.group.forEach(g2 => { const o = drag.orig.get(g2); Object.assign(g2, o); }); clipMenu(c); } }, st.get('longPressMs'));
    return;
  }
  if (tool === 'select' || tk >= S.p.playlist.tracks.length) { drag = { type: 'marquee', id: e.pointerId, x0: p.x, y0: p.y }; marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }
  // draw: place the selected pattern at the snapped position
  const pat = S.curPat(); if (!pat) return;
  const tc = Math.max(0, snapT(t, 'floor')), d = S.patLenTicks(pat);
  const c = S.addClip({ type: 'pat', track: tk, t: tc, d, ref: pat.id, off: 0 });
  pl.sel.clear(); pl.sel.add(c.id);
  drag = { type: 'resize', id: e.pointerId, c, group: [c], orig: new Map([[c, { t: c.t, d: c.d, track: c.track, off: 0 }]]), created: true, moved: false, x0: p.x, y0: p.y, t0: t };
  invalidate(); refreshSel();
}
function eraseClip(c) { S.p.playlist.clips = clips().filter(x => x !== c); pl.sel.delete(c.id); if (drag) drag.n++; invalidate(); }

function onMove(e) {
  if (!ptrs.has(e.pointerId)) return;
  const p = pt(e); ptrs.set(e.pointerId, p);
  if (nav && ptrs.size >= 2) {
    const a = Array.from(ptrs.values()), cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2, dx = Math.max(30, Math.abs(a[0].x - a[1].x));
    const tA = (nav.cx - HW) / nav.zx + nav.ox;
    pl.zx = U.clamp(nav.zx * dx / nav.dx, 0.02, 1.4);
    pl.ox = tA - (cx - HW) / pl.zx; pl.oy = nav.oy - (cy - nav.cy);
    clampView(); invalidate(); return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  const t = xt(p.x), tk = yt(p.y);
  if (drag.type === 'pan') { pl.ox = drag.ox - (p.x - drag.x0) / pl.zx; pl.oy = drag.oy - (p.y - drag.y0); clampView(); invalidate(); return; }
  if (drag.type === 'ruler') {
    if (Math.abs(p.x - drag.x0) > 10) { drag.moved = true; clearTimeout(drag.holdT); drag.type = 'loop'; }
    return;
  }
  if (drag.type === 'loop') { drag.b = Math.max(0, snapT(t)); return; }
  if (drag.type === 'hdr') { if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 8) { clearTimeout(drag.holdT); } return; }
  if (drag.type === 'erase') { const hh = hit(p.x, p.y); if (hh) eraseClip(hh.c); return; }
  if (drag.type === 'marquee') { marquee.x1 = p.x; marquee.y1 = p.y; return; }
  if (!drag.orig) return;
  if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 6) { drag.moved = true; clearTimeout(drag.holdT); }
  if (!drag.moved) return;
  if (drag.type === 'move') {
    const o = drag.orig.get(drag.c), nt = snapT(t - drag.offT), dt = nt - o.t, dk = tk - drag.tk0;
    drag.group.forEach(c => { const oo = drag.orig.get(c); c.t = Math.max(0, oo.t + dt); c.track = U.clamp(oo.track + dk, 0, S.p.playlist.tracks.length - 1); });
  } else if (drag.type === 'resize') {
    const o = drag.orig.get(drag.c), g = snapTicks();
    let end = snapT(t); if (end <= drag.c.t) end = drag.c.t + Math.max(g, 6);
    const dd = end - o.t - o.d;
    drag.group.forEach(c => { c.d = Math.max(6, drag.orig.get(c).d + dd); });
  } else if (drag.type === 'trim') {
    const o = drag.orig.get(drag.c), nt = Math.max(0, snapT(t)), dt = Math.min(nt - o.t, o.d - 6);
    drag.group.forEach(c => { const oo = drag.orig.get(c); c.t = oo.t + dt; c.d = oo.d - dt; c.off = oo.off + (c.type === 'aud' ? dt * spt() : dt); if (c.off < 0) { c.off = 0; } });
  }
  invalidate();
}
function onUp(e) {
  ptrs.delete(e.pointerId);
  if (nav) { if (ptrs.size < 2) nav = null; return; }
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag; drag = null; clearTimeout(d.holdT);
  invalidate();
  if (d.type === 'ruler') { seq.setPos(Math.max(0, d.a)); return; }
  if (d.type === 'loop') {
    const a = Math.min(d.a, d.b), b = Math.max(d.a, d.b);
    if (b - a >= C.STEP) { const L = S.p.playlist; L.loopStart = a; L.loopEnd = b; L.loopOn = true; S.commit('Loop region'); S.emit('playlist'); ui.toast('Loop region set'); }
    return;
  }
  if (d.type === 'hdr') { if (!d.held) { const tr = S.p.playlist.tracks[d.i]; ui.prompt('Rename track', tr.name).then(n => { if (n) { tr.name = n; S.commit('Rename track'); invalidate(); } }); } return; }
  if (d.type === 'marquee') {
    const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
    marquee = null; pl.sel.clear();
    if (x1 - x0 > 6 || y1 - y0 > 6) clips().forEach(c => { const cx = tx(c.t), cw = c.d * pl.zx, cy = ty(c.track); if (cx + cw >= x0 && cx <= x1 && cy + th() >= y0 && cy <= y1) pl.sel.add(c.id); });
    refreshSel(); return;
  }
  if (d.type === 'erase') { if (d.n) done('Erase clips'); return; }
  if (d.held) return;
  if (d.moved || d.created) { done(d.created && !d.moved ? 'Add clip' : d.type === 'move' ? 'Move clips' : 'Resize clips'); return; }
  // plain tap on a clip
  if (pl.sel.has(d.c.id)) pl.sel.delete(d.c.id); else { if (pl.tool !== 'select') pl.sel.clear(); pl.sel.add(d.c.id); }
  refreshSel();
}
function rulerMenu(t) {
  const L = S.p.playlist;
  ui.menu([
    { label: 'Add marker here', icon: 'star', onClick: async () => { const n = await ui.prompt('Marker name', 'Marker ' + ((L.markers || []).length + 1)); if (n) { (L.markers = L.markers || []).push({ id: S.id(), t, name: n }); S.commit('Add marker'); invalidate(); } } },
    { label: 'Set loop start here', icon: 'loop', onClick: () => { L.loopStart = t; if (L.loopEnd <= t) L.loopEnd = t + S.ticksPerBar() * 4; L.loopOn = true; S.commit('Loop'); S.emit('playlist'); invalidate(); } },
    { label: 'Set loop end here', icon: 'loop', onClick: () => { if (t > L.loopStart) { L.loopEnd = t; L.loopOn = true; S.commit('Loop'); S.emit('playlist'); invalidate(); } } },
    { label: 'Clear loop region', icon: 'x', onClick: () => { L.loopOn = false; S.commit('Loop'); S.emit('playlist'); invalidate(); } },
    ...(L.markers || []).filter(m => Math.abs(m.t - t) < S.ticksPerBar()).map(m => ({ label: 'Delete marker “' + m.name + '”', icon: 'trash', danger: true, onClick: () => { L.markers = L.markers.filter(x => x !== m); S.commit('Delete marker'); invalidate(); } })),
  ], { title: 'Bar ' + (Math.floor(t / S.ticksPerBar()) + 1) });
}
function snapMenu() { ui.menu(C.SNAPS.map(s => ({ label: s.label, checked: pl.snap === s.id, onClick: () => { pl.snap = s.id; snapBtn.lastChild.textContent = s.label; invalidate(); } })), { title: 'Snap to' }); }
function markerList() {
  const L = S.p.playlist;
  const list = L.markers || [];
  ui.menu(list.length ? list.slice().sort((a, b) => a.t - b.t).map(m => ({ label: m.name, hint: 'bar ' + (Math.floor(m.t / S.ticksPerBar()) + 1), icon: 'star', onClick: () => { seq.setPos(m.t); pl.ox = Math.max(0, m.t - 20 / pl.zx); invalidate(); } })) : [{ label: 'No markers yet — long-press the ruler to add one', disabled: true }], { title: 'Markers' });
}

function resize() {
  const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  W = Math.round(r.width); H = Math.round(r.height);
  [base, over].forEach(cv => { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); });
  clampView(); invalidate();
}
function refreshPat() {
  const p = S.curPat();
  patBtn.replaceChildren(h('i', { style: { width: '.7rem', height: '.7rem', borderRadius: '3px', background: p.color, display: 'block' } }), p.name, U.icon('chevD', 14));
}

view.show = () => { if (!W) resize(); refreshPat(); invalidate(); };
view.tick = pos => {
  if (!root || ui.cur !== 'playlist') return;
  if (dirty) drawBase();
  drawOver(pos);
  if (seq.playing && S.p.mode === 'song' && !drag && !nav && st.get('followPlayhead') !== 'off') {
    const x = tx(pos);
    if (x > W - 20 || x < HW) { pl.ox = Math.max(0, pos - 30 / pl.zx); invalidate(); }
  }
};
view.build = () => {
  root = U.$('#v-playlist');
  patBtn = h('button.chip', { onclick: ui.patternPicker, 'aria-label': 'Pattern to place' });
  const defs = [['draw', 'pencil', 'Draw / move'], ['select', 'select', 'Select'], ['erase', 'eraser', 'Erase'], ['slice', 'slice', 'Slice'], ['mute', 'mute', 'Mute'], ['pan', 'hand', 'Pan']];
  const tools = h('div.toolrow', defs.map(([id, icon, label]) => (toolEls[id] = h('button.tool' + (id === pl.tool ? '.on' : ''), { title: label, 'aria-label': label, onclick: () => { pl.tool = id; Object.keys(toolEls).forEach(k => toolEls[k].classList.toggle('on', k === id)); } }, U.icon(icon, 20)))));
  snapBtn = h('button.chip', { onclick: snapMenu }, U.icon('snap', 16), snapName());
  const sub = h('div.subbar', patBtn, tools, snapBtn,
    h('button.chip', { onclick: markerList }, U.icon('star', 16), 'Markers'),
    h('button.chip', { onclick: () => { S.p.playlist.loopOn = !S.p.playlist.loopOn; S.commit('Loop'); S.emit('playlist'); invalidate(); } }, U.icon('loop', 16), 'Loop'),
    h('button.chip', { onclick: ui.addTrack }, U.icon('plus', 14), 'Track'),
    h('button.chip', { onclick: () => { const t = snapT(seq.startPos, 'floor'); ui.pickSample().then(id => id && ui.addAudioClip(id)); void t; } }, U.icon('wave', 16), 'Audio'),
    h('button.chip', { onclick: () => { pl.zx = U.clamp(pl.zx * 0.7, 0.02, 1.4); invalidate(); } }, U.icon('minus', 14)),
    h('button.chip', { onclick: () => { pl.zx = U.clamp(pl.zx * 1.4, 0.02, 1.4); invalidate(); } }, U.icon('plus', 14)));
  base = h('canvas'); over = h('canvas');
  wrap = h('div.ed', base, over);
  selBar = h('div.lane-bar', { hidden: true }, h('span.chip.on.sel-count', '0 selected'),
    ui.ibtn('copy', 'Duplicate', ops.dup), ui.ibtn('mute', 'Mute', ops.mute), ui.ibtn('trash', 'Delete', ops.delete), ui.ibtn('x', 'Deselect', ops.none));
  root.append(sub, wrap, selBar);
  over.addEventListener('pointerdown', onDown); over.addEventListener('pointermove', onMove);
  over.addEventListener('pointerup', onUp); over.addEventListener('pointercancel', onUp);
  over.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) { const tA = xt(e.offsetX); pl.zx = U.clamp(pl.zx * (e.deltaY > 0 ? 0.9 : 1.1), 0.02, 1.4); pl.ox = tA - (e.offsetX - HW) / pl.zx; } else if (e.shiftKey) pl.ox += e.deltaY / pl.zx; else { pl.oy += e.deltaY; pl.ox += e.deltaX / pl.zx; }
    clampView(); invalidate();
  }, { passive: false });
  new ResizeObserver(() => { if (ui.cur === 'playlist') resize(); }).observe(wrap);
  window.addEventListener('keydown', e => {
    if (ui.cur !== 'playlist' || e.target.closest('input,textarea,select') || document.querySelector('.sheet-back')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (pl.sel.size) ops.delete(); } else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); ops.dup(); } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') ops.copy(); else if ((e.ctrlKey || e.metaKey) && e.key === 'v') ops.paste();
  });
  ['project', 'restore', 'playlist', 'pattern', 'channels', 'notes', 'samples'].forEach(ev => S.on(ev, () => { if (ev === 'restore' || ev === 'project') { pl.sel.clear(); refreshSel(); } if (S.p) { invalidate(); if (ui.cur === 'playlist') refreshPat(); } }));
  st.on('plTrackH', invalidate);
};
})();
