'use strict';
/* Beatforge — piano roll: canvas editor with touch drawing, pinch zoom, tools, scale, ghost notes and controller lanes. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq, st = DAW.settings;

const view = {};
ui.registerView('piano', view);

const KW = 58, RH = 26;
const pr = {
  tool: 'draw', snap: 'step', zx: 1.1, rh: 24, ox: 0, oy: 0, sel: new Set(), stamp: null, lane: 'v',
  lastLen: 0, clip: null,
};
ui.pr = pr;
let root, wrap, base, over, lane, laneCv, selBar, chBtn, snapBtn, toolEls = {}, laneChips, stampChip;
let W = 0, H = 0, LH = 0, dpr = 1;
let ptrs = new Map(), drag = null, nav = null, auditioned = null;

const LANES = [['v', 'Velocity'], ['pan', 'Pan'], ['rel', 'Release'], ['fine', 'Pitch'], ['mx', 'Mod X'], ['my', 'Mod Y']];
const laneDef = id => ({ v: { min: 1, max: 127, def: 100, bip: false }, pan: { min: -1, max: 1, def: 0, bip: true }, rel: { min: 0, max: 1, def: 0.5, bip: false }, fine: { min: -100, max: 100, def: 0, bip: true }, mx: { min: 0, max: 1, def: 0.5, bip: false }, my: { min: 0, max: 1, def: 0.5, bip: false } }[id]);

const ch = () => S.curCh();
const pat = () => S.curPat();
const notes = () => { const c = ch(); return c ? S.notesOf(pat(), c.id, true) : []; };
const tx = t => KW + (t - pr.ox) * pr.zx;
const xt = x => (x - KW) / pr.zx + pr.ox;
const ky = k => RH + (127 - k) * pr.rh - pr.oy;
const yk = y => 127 - Math.floor((y - RH + pr.oy) / pr.rh);

function snapTicks() {
  const s = C.SNAPS.find(x => x.id === pr.snap) || C.SNAPS[6];
  if (s.ticks === -2) return S.ticksPerBar();
  if (s.ticks === -1) {
    const opts = [4, 6, 8, 12, 24, 48, 96, S.ticksPerBar()];
    return opts.find(o => o * pr.zx >= 14) || opts[opts.length - 1];
  }
  return s.ticks || 1;
}
const snapT = (t, mode) => { const g = snapTicks(); return g <= 1 ? Math.round(t) : (mode === 'floor' ? Math.floor(t / g) * g : Math.round(t / g) * g); };

function inScale(k) {
  const root = st.get('prScaleRoot'), sc = C.SCALES[st.get('prScaleName')] || C.SCALES.Major;
  return sc.includes((((k - root) % 12) + 12) % 12);
}

function clampView() {
  const patLen = S.patLenTicks(pat());
  const maxX = Math.max(0, patLen + S.ticksPerBar() * 2 - (W - KW) / pr.zx * 0.5);
  pr.ox = U.clamp(pr.ox, 0, maxX);
  const total = 128 * pr.rh, avail = H - RH;
  pr.oy = U.clamp(pr.oy, 0, Math.max(0, total - avail));
}

/* ---------- drawing ---------- */
let dirty = true;
const invalidate = () => { dirty = true; };
function drawBase() {
  if (!W) return;
  const g = base.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const c = ch(), p = pat();
  const hl = st.get('prScaleHL');
  const kTop = Math.max(0, yk(RH)), kBot = Math.max(0, yk(H));
  // rows
  for (let k = Math.min(127, kTop); k >= kBot && k >= 0; k--) {
    const y = ky(k);
    const blk = U.isBlack(k);
    g.fillStyle = blk ? '#0c0f14' : '#12161e';
    if (hl && !inScale(k)) g.fillStyle = blk ? '#080a0d' : '#0d1015';
    g.fillRect(KW, y, W - KW, pr.rh);
    if (hl && inScale(k) && ((k - st.get('prScaleRoot')) % 12 + 12) % 12 === 0) { g.fillStyle = 'rgba(255,138,61,.1)'; g.fillRect(KW, y, W - KW, pr.rh); }
    g.fillStyle = k % 12 === 0 ? '#2e3646' : '#1a1f29';
    g.fillRect(KW, y + pr.rh - 1, W - KW, 1);
  }
  // vertical grid
  const tpb = S.ticksPerBar(), snap = snapTicks();
  const t0 = Math.max(0, Math.floor(xt(KW))), t1 = xt(W);
  const sg = Math.max(snap, 1);
  const fine = sg * pr.zx >= 6;
  if (fine) { g.fillStyle = '#171c26'; for (let t = Math.ceil(t0 / sg) * sg; t < t1; t += sg) g.fillRect(Math.round(tx(t)), RH, 1, H - RH); }
  g.fillStyle = '#212836';
  for (let t = Math.ceil(t0 / C.STEP) * C.STEP; t < t1; t += C.STEP) { if (C.STEP * pr.zx >= 5) g.fillRect(Math.round(tx(t)), RH, 1, H - RH); }
  g.fillStyle = '#2d3546';
  for (let t = Math.ceil(t0 / C.PPQ) * C.PPQ; t < t1; t += C.PPQ) g.fillRect(Math.round(tx(t)), RH, 1, H - RH);
  g.fillStyle = '#46506a';
  for (let t = Math.ceil(t0 / tpb) * tpb; t < t1; t += tpb) g.fillRect(Math.round(tx(t)), RH, 2, H - RH);
  // pattern end
  const pl = S.patLenTicks(p);
  if (tx(pl) < W) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(Math.max(KW, tx(pl)), RH, W, H - RH); g.fillStyle = '#ff8a3d'; g.fillRect(tx(pl) - 1, RH, 2, H - RH); }
  // ghosts
  if (st.get('prGhost')) {
    for (const o of S.p.channels) {
      if (c && o.id === c.id) continue;
      const list = p.notes[o.id]; if (!list) continue;
      g.fillStyle = U.rgba(o.color, 0.16);
      for (const n of list) {
        const x = tx(n.t), w = n.d * pr.zx, y = ky(n.k);
        if (x + w < KW || x > W || y + pr.rh < RH || y > H) continue;
        g.fillRect(x, y + 2, Math.max(2, w - 1), pr.rh - 4);
      }
    }
  }
  // notes
  if (c) {
    const list = S.notesOf(p, c.id), velC = st.get('prVelColor'), labels = st.get('prNoteLabels');
    g.font = '600 ' + Math.min(12, pr.rh - 8) + 'px sans-serif'; g.textBaseline = 'middle';
    for (const n of list) {
      const x = tx(n.t), w = Math.max(3, n.d * pr.zx - 1), y = ky(n.k);
      if (x + w < KW || x > W || y + pr.rh < RH || y > H) continue;
      const sel = pr.sel.has(n.id);
      const a = velC ? 0.5 + 0.5 * (n.v || 100) / 127 : 1;
      g.fillStyle = n.m ? '#4a5266' : U.rgba(c.color, a);
      roundRect(g, x, y + 1, w, pr.rh - 2, 4); g.fill();
      g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x + 1, y + 2, Math.max(0, w - 2), 2);
      if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 2; roundRect(g, x, y + 1, w, pr.rh - 2, 4); g.stroke(); }
      if (n.sl) { g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.moveTo(x, y + pr.rh - 3); g.lineTo(x + 8, y + pr.rh - 3); g.lineTo(x, y + pr.rh - 10); g.fill(); }
      if (labels && w > 30 && pr.rh >= 18) { g.fillStyle = 'rgba(0,0,0,.65)'; g.fillText(U.noteName(n.k), x + 5, y + pr.rh / 2 + 0.5); }
      if (st.get('bigHandles') && w > 18) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x + w - 5, y + 5, 2, pr.rh - 10); }
    }
  }
  // keyboard gutter
  g.fillStyle = '#0a0c10'; g.fillRect(0, RH, KW, H - RH);
  const lbl = st.get('prKeyLabels');
  for (let k = Math.min(127, kTop); k >= kBot && k >= 0; k--) {
    const y = ky(k), blk = U.isBlack(k), act = auditioned === k;
    g.fillStyle = act ? '#ff8a3d' : blk ? '#1b2029' : '#d9deea';
    g.fillRect(0, y, blk ? KW * 0.68 : KW - 1, pr.rh - 1);
    if (blk) { g.fillStyle = '#0a0c10'; g.fillRect(KW * 0.68, y, KW * 0.32, pr.rh - 1); g.fillStyle = act ? '#ff8a3d' : '#d9deea'; g.fillRect(KW * 0.68, y + pr.rh / 2 - 1, KW * 0.32 - 1, 2); }
    if ((lbl === 'all' || (lbl === 'c' && k % 12 === 0)) && pr.rh >= 14) { g.fillStyle = blk ? '#aab3c8' : '#1a1f29'; g.font = '600 ' + Math.min(11, pr.rh - 8) + 'px sans-serif'; g.textBaseline = 'middle'; g.fillText(U.noteName(k), blk ? 5 : KW - 28, y + pr.rh / 2); }
  }
  // ruler
  g.fillStyle = '#10131a'; g.fillRect(0, 0, W, RH);
  g.strokeStyle = '#262d3b'; g.beginPath(); g.moveTo(0, RH - 0.5); g.lineTo(W, RH - 0.5); g.stroke();
  g.font = '600 11px sans-serif'; g.textBaseline = 'middle';
  for (let t = Math.ceil(t0 / C.PPQ) * C.PPQ; t < t1; t += C.PPQ) {
    const x = tx(t), bar = t % tpb === 0;
    g.fillStyle = bar ? '#aab3c8' : '#46506a'; g.fillRect(Math.round(x), bar ? 4 : 14, 1, bar ? RH - 4 : RH - 14);
    if (bar && pr.zx * tpb > 50) { g.fillStyle = '#aab3c8'; g.fillText(String(t / tpb + 1), x + 4, 9); }
  }
  g.fillStyle = '#0a0c10'; g.fillRect(0, 0, KW, RH);
  g.fillStyle = '#646e84'; g.font = '10px sans-serif'; g.fillText(snapLabel(), 6, RH / 2);
  dirty = false;
}
function snapLabel() { const s = C.SNAPS.find(x => x.id === pr.snap); return s ? s.label : ''; }
function roundRect(g, x, y, w, h2, r) {
  r = Math.min(r, w / 2, h2 / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h2, r); g.arcTo(x + w, y + h2, x, y + h2, r); g.arcTo(x, y + h2, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

let marquee = null;
function drawOver(pos) {
  if (!W) return;
  const g = over.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (pos != null && seq.playing && pos >= 0) {
    const L = S.patLenTicks(pat());
    const p = S.p.mode === 'pattern' ? pos % L : pos;
    const x = tx(p);
    if (x >= KW && x <= W) { g.fillStyle = '#37d6c5'; g.fillRect(x - 1, 0, 2, H); g.fillStyle = 'rgba(55,214,197,.12)'; g.fillRect(x - 6, RH, 6, H - RH); }
  }
  if (marquee) {
    g.strokeStyle = '#ff8a3d'; g.fillStyle = 'rgba(255,138,61,.12)'; g.lineWidth = 1.5;
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1), w = Math.abs(marquee.x1 - marquee.x0), hh = Math.abs(marquee.y1 - marquee.y0);
    g.fillRect(x, y, w, hh); g.strokeRect(x, y, w, hh);
  }
}

/* ---------- controller lane ---------- */
function drawLane() {
  if (!LH) return;
  const g = laneCv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, LH);
  g.fillStyle = '#0a0c10'; g.fillRect(0, 0, KW, LH);
  const d = laneDef(pr.lane), c = ch();
  g.fillStyle = '#646e84'; g.font = '10px sans-serif'; g.textBaseline = 'top';
  g.fillText(LANES.find(l => l[0] === pr.lane)[1], 6, 6);
  g.fillStyle = '#171c26'; g.fillRect(KW, LH / 2, W - KW, 1);
  const tpb = S.ticksPerBar();
  g.fillStyle = '#262d3b';
  for (let t = Math.ceil(Math.max(0, xt(KW)) / tpb) * tpb; t < xt(W); t += tpb) g.fillRect(Math.round(tx(t)), 0, 1, LH);
  if (!c) return;
  const pad = 14;
  for (const n of S.notesOf(pat(), c.id)) {
    const x = tx(n.t);
    if (x < KW - 4 || x > W) continue;
    const v = n[pr.lane] == null ? d.def : n[pr.lane];
    const norm = (v - d.min) / (d.max - d.min);
    const y0 = d.bip ? LH / 2 : LH - 4, y1 = LH - pad - norm * (LH - pad - 6) + (d.bip ? 0 : 0);
    const yy = d.bip ? LH / 2 - (norm - 0.5) * (LH - 20) : y1;
    const sel = pr.sel.has(n.id);
    g.strokeStyle = sel ? '#ffffff' : U.rgba(c.color, 0.95); g.lineWidth = 3;
    g.beginPath(); g.moveTo(x + 1, y0); g.lineTo(x + 1, yy); g.stroke();
    g.fillStyle = sel ? '#fff' : c.color; g.beginPath(); g.arc(x + 1, yy, 5, 0, 7); g.fill();
  }
}
const laneSet = (e, last) => {
  const r = laneCv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, d = laneDef(pr.lane), c = ch();
  if (!c) return;
  const norm = d.bip ? 0.5 - (y - LH / 2) / (LH - 20) : 1 - (y - 14) / (LH - 20);
  let v = U.clamp(d.min + norm * (d.max - d.min), d.min, d.max);
  if (pr.lane === 'v' || pr.lane === 'fine') v = Math.round(v);
  const x0 = last == null ? x : last;
  const lo = Math.min(x, x0) - 9, hi = Math.max(x, x0) + 9;
  let hit = 0;
  const list = S.notesOf(pat(), c.id);
  const targets = list.filter(n => { const nx = tx(n.t); return nx >= lo && nx <= hi; });
  const best = targets.length > 1 ? targets : targets.length ? targets : [];
  best.forEach(n => { if (pr.sel.size === 0 || pr.sel.has(n.id) || targets.length) { n[pr.lane] = v; hit++; } });
  if (hit) { invalidate(); }
  return x;
};

/* ---------- operations ---------- */
const selNotes = () => notes().filter(n => pr.sel.has(n.id));
function preview(k, vel) {
  const c = ch(); if (!c || !st.get('prPreview')) return;
  DAW.audio.noteOn(c.id, k, vel || 100).then(hd => { if (hd) setTimeout(() => hd.off(), 230); });
}
function done(label) { S.commit(label); S.emit('notes', S.ui.pat, S.ui.ch); invalidate(); refreshSelBar(); }

function addNote(t, k, d) {
  const c = ch(); if (!c) return null;
  const list = S.notesOf(pat(), c.id, true);
  if (st.get('prScaleLock') && !inScale(k)) { let kk = k; while (!inScale(kk) && kk < 127) kk++; k = kk; }
  const chord = pr.stamp ? C.CHORDS[pr.stamp] : [0];
  let first = null;
  chord.forEach(iv => {
    const kk = k + iv; if (kk > 127) return;
    if (list.some(n => n.k === kk && n.t === t)) return;
    const n = S.addNote(pat(), c.id, { t, d, k: kk, v: Math.round(st.get('prDefVel')) });
    if (!first) first = n;
  });
  if (!first) { first = list.find(n => n.k === k && n.t === t); }
  const need = Math.ceil((t + d) / S.ticksPerBar());
  if (need > pat().bars) pat().bars = need;
  return first;
}

function hit(x, y) {
  const c = ch(); if (!c) return null;
  const list = S.notesOf(pat(), c.id);
  for (let i = list.length - 1; i >= 0; i--) {
    const n = list[i], nx = tx(n.t), nw = Math.max(6, n.d * pr.zx), ny = ky(n.k);
    const pad = st.get('bigHandles') ? 4 : 0;
    if (x >= nx - pad && x <= nx + nw + pad && y >= ny && y <= ny + pr.rh) {
      const hw = st.get('bigHandles') ? Math.min(nw * 0.5, 22) : Math.min(nw * 0.35, 10);
      return { n, edge: x > nx + nw - hw };
    }
  }
  return null;
}

/* ---------- pointer handling ---------- */
function pt(e) { const r = over.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function allowTool(e) { return !(st.get('stylusOnly') && e.pointerType === 'touch'); }

function startNav() {
  const a = Array.from(ptrs.values());
  nav = { cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2, dx: Math.max(30, Math.abs(a[0].x - a[1].x)), dy: Math.max(30, Math.abs(a[0].y - a[1].y)), zx: pr.zx, rh: pr.rh, ox: pr.ox, oy: pr.oy };
  cancelDrag(true);
}
function cancelDrag(revert) {
  if (drag && revert && drag.type !== 'none') { drag.orig && drag.orig.forEach((o, n) => { Object.assign(n, o); }); if (drag.created) { const c = ch(); pat().notes[c.id] = S.notesOf(pat(), c.id).filter(n => n !== drag.created); pr.sel.delete(drag.created.id); } }
  drag = null; marquee = null; invalidate();
}

function onDown(e) {
  e.preventDefault();
  const p = pt(e);
  ptrs.set(e.pointerId, p);
  try { over.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  if (ptrs.size === 2 && st.get('twoFingerNav')) { startNav(); return; }
  if (ptrs.size > 2) return;
  if (!allowTool(e)) { drag = { type: 'pan', x0: p.x, y0: p.y, ox: pr.ox, oy: pr.oy, id: e.pointerId }; return; }
  if (p.y < RH && p.x >= KW) { drag = { type: 'seek', id: e.pointerId }; seekTo(p.x); return; }
  if (p.x < KW && p.y >= RH) { drag = { type: 'key', id: e.pointerId, k: -1 }; keyAt(p.y); return; }
  if (p.y < RH) return;
  const t = xt(p.x), k = yk(p.y);
  const c = ch(); if (!c) return;
  const tool = pr.tool;
  if (tool === 'pan') { drag = { type: 'pan', x0: p.x, y0: p.y, ox: pr.ox, oy: pr.oy, id: e.pointerId }; return; }
  const hh = hit(p.x, p.y);
  const holdT = setTimeout(() => {
    if (drag && !drag.moved && drag.id === e.pointerId) {
      drag.held = true; DAW.haptic(18);
      if (drag.note) { if (!pr.sel.has(drag.note.id)) { pr.sel.clear(); pr.sel.add(drag.note.id); invalidate(); refreshSelBar(); } cancelMoveOnly(); openProps(selNotes()); }
      else if (!drag.created && tool === 'draw') { drag.paint = true; }
    }
  }, st.get('longPressMs'));
  if (tool === 'erase') {
    drag = { type: 'erase', id: e.pointerId, holdT, removed: 0 }; if (hh) eraseNote(hh.n); return;
  }
  if (tool === 'mute') { if (hh) { hh.n.m = hh.n.m ? 0 : 1; done('Mute note'); } clearTimeout(holdT); return; }
  if (tool === 'slice') { if (hh) sliceNote(hh.n, snapT(t)); clearTimeout(holdT); return; }
  if (hh) {
    const n = hh.n;
    const group = pr.sel.has(n.id) ? selNotes() : [n];
    drag = { type: hh.edge ? 'resize' : 'move', id: e.pointerId, note: n, group, orig: new Map(group.map(g2 => [g2, { t: g2.t, d: g2.d, k: g2.k }])), t0: t, k0: k, offT: t - n.t, moved: false, holdT, wasSel: pr.sel.has(n.id), px0: p.x, py0: p.y };
    if (!pr.sel.has(n.id) && tool !== 'select') { /* selected on release if it was only a tap */ }
    if (hh.edge && st.get('bigHandles')) DAW.haptic(5);
    return;
  }
  if (tool === 'select') { drag = { type: 'marquee', id: e.pointerId, x0: p.x, y0: p.y, holdT, add: false }; marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }
  // draw: create a note, then dragging stretches it
  const len = pr.lastLen || Math.round(st.get('prDefLen'));
  const t0 = snapT(t, 'floor');
  const n = addNote(Math.max(0, t0), k, len);
  if (!n) return;
  pr.sel.clear(); pr.sel.add(n.id);
  drag = { type: 'resize', id: e.pointerId, note: n, group: [n], orig: new Map([[n, { t: n.t, d: n.d, k: n.k }]]), created: n, moved: false, holdT, t0: t, k0: k, grow: true, px0: p.x, py0: p.y };
  if (k !== auditioned) preview(k, n.v);
  invalidate(); refreshSelBar();
}
function cancelMoveOnly() { if (drag) { drag.orig.forEach((o, n) => Object.assign(n, o)); drag.type = 'none'; } }

function onMove(e) {
  if (!ptrs.has(e.pointerId)) return;
  const p = pt(e); ptrs.set(e.pointerId, p);
  if (nav && ptrs.size >= 2) {
    const a = Array.from(ptrs.values());
    const cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
    const dx = Math.max(30, Math.abs(a[0].x - a[1].x)), dy = Math.max(30, Math.abs(a[0].y - a[1].y));
    const tAnchor = (nav.cx - KW) / nav.zx + nav.ox, kAnchor = (nav.cy - RH + nav.oy) / nav.rh;
    pr.zx = U.clamp(nav.zx * dx / nav.dx, 0.12, 5);
    pr.rh = U.clamp(nav.rh * dy / nav.dy, 12, 56);
    pr.ox = tAnchor - (cx - KW) / pr.zx;
    pr.oy = kAnchor * pr.rh - (cy - RH);
    clampView(); invalidate(); return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  const t = xt(p.x), k = yk(p.y);
  if (drag.type === 'seek') { seekTo(p.x); return; }
  if (drag.type === 'key') { keyAt(p.y); return; }
  if (drag.type === 'pan') { pr.ox = drag.ox - (p.x - drag.x0) / pr.zx; pr.oy = drag.oy - (p.y - drag.y0); clampView(); invalidate(); return; }
  if (drag.type === 'erase') { const hh = hit(p.x, p.y); if (hh) eraseNote(hh.n); return; }
  if (drag.type === 'marquee') {
    marquee.x1 = p.x; marquee.y1 = p.y;
    if (Math.hypot(p.x - drag.x0, p.y - drag.y0) > 6) clearTimeout(drag.holdT);
    return;
  }
  if (!drag.orig) return;
  const mv = Math.hypot(p.x - (drag.px0 == null ? (drag.px0 = p.x) : drag.px0), p.y - (drag.py0 == null ? (drag.py0 = p.y) : drag.py0));
  if (mv > 5) { drag.moved = true; clearTimeout(drag.holdT); }
  if (!drag.moved) return;
  if (drag.type === 'move') {
    const prim = drag.note, o = drag.orig.get(prim);
    const nt = snapT(t - drag.offT), dt = nt - o.t, dk = k - drag.k0;
    drag.group.forEach(n => { const oo = drag.orig.get(n); n.t = Math.max(0, oo.t + dt); n.k = U.clamp(oo.k + dk, 0, 127); });
    if (prim.k !== auditioned) { auditioned = prim.k; preview(prim.k, prim.v); }
    invalidate();
  } else if (drag.type === 'resize') {
    const prim = drag.note, o = drag.orig.get(prim);
    const g = snapTicks();
    let end = snapT(t) ; if (end <= prim.t) end = prim.t + Math.max(g, 1);
    const nd = Math.max(g > 1 ? g : 6, end - o.t), dd = nd - o.d;
    drag.group.forEach(n => { n.d = Math.max(g > 1 ? g : 6, drag.orig.get(n).d + dd); });
    const need = Math.ceil((prim.t + prim.d) / S.ticksPerBar()); if (need > pat().bars) pat().bars = need;
    invalidate();
  }
}

function onUp(e) {
  const had = ptrs.has(e.pointerId);
  ptrs.delete(e.pointerId);
  if (nav) { if (ptrs.size < 2) { nav = null; } return; }
  if (!had || !drag || drag.id !== e.pointerId) return;
  const d = drag; drag = null; clearTimeout(d.holdT);
  auditioned = null; invalidate();
  if (d.type === 'marquee') {
    const x0 = Math.min(marquee.x0, marquee.x1), x1 = Math.max(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1), y1 = Math.max(marquee.y0, marquee.y1);
    marquee = null;
    if (x1 - x0 < 6 && y1 - y0 < 6) { pr.sel.clear(); } else {
      pr.sel.clear();
      notes().forEach(n => { const nx = tx(n.t), nw = n.d * pr.zx, ny = ky(n.k); if (nx + nw >= x0 && nx <= x1 && ny + pr.rh >= y0 && ny <= y1) pr.sel.add(n.id); });
    }
    refreshSelBar(); return;
  }
  if (d.type === 'erase') { if (d.removed) done('Erase notes'); return; }
  if (d.type === 'none' || d.held) { return; }
  if (d.type === 'move' || d.type === 'resize') {
    if (d.moved) {
      if (d.type === 'resize' && d.note) pr.lastLen = d.note.d;
      done(d.type === 'move' ? 'Move notes' : 'Resize notes');
    } else if (d.created) {
      done('Add note');
    } else {
      // plain tap on a note: toggle / replace selection
      if (pr.sel.has(d.note.id)) pr.sel.delete(d.note.id);
      else { if (pr.tool !== 'select') pr.sel.clear(); pr.sel.add(d.note.id); }
      preview(d.note.k, d.note.v);
      invalidate(); refreshSelBar();
    }
  }
}
function eraseNote(n) {
  const c = ch(); pat().notes[c.id] = S.notesOf(pat(), c.id).filter(x => x !== n); pr.sel.delete(n.id);
  if (drag && drag.type === 'erase') drag.removed++; else done('Erase note');
  invalidate();
}
function sliceNote(n, t) {
  if (t <= n.t + 1 || t >= n.t + n.d - 1) { ui.toast('Tap inside the note to cut it'); return; }
  const c = ch(), right = Object.assign({}, n, { id: S.id(), t, d: n.t + n.d - t });
  n.d = t - n.t;
  S.notesOf(pat(), c.id).push(right);
  done('Slice note');
}
function seekTo(x) { const t = Math.max(0, snapT(xt(x))); const L = S.patLenTicks(pat()); seq.setPos(S.p.mode === 'pattern' ? Math.min(t, L) : t); drawOver(t); }
let lastKey = -1;
function keyAt(y) {
  const k = U.clamp(yk(y), 0, 127);
  if (k === lastKey) return;
  lastKey = k; auditioned = k; invalidate();
  const c = ch(); if (!c) return;
  if (drag && drag.hd) drag.hd.off();
  DAW.audio.noteOn(c.id, k, 100).then(hd => { if (drag && drag.type === 'key') { if (drag.hd) drag.hd.off(); drag.hd = hd; } else if (hd) hd.off(); });
}

/* ---------- selection helpers / ops ---------- */
function openProps(list) { if (!list.length) return; ui.noteProps(list, () => done('Edit notes')); }
function refreshSelBar() {
  const n = pr.sel.size;
  selBar.hidden = n === 0;
  selBar.querySelector('.sel-count').textContent = n + ' selected';
  drawLane();
}
const ops = {
  delete() { const c = ch(); pat().notes[c.id] = S.notesOf(pat(), c.id).filter(n => !pr.sel.has(n.id)); pr.sel.clear(); done('Delete notes'); },
  dup() {
    const list = selNotes(); if (!list.length) return;
    const t0 = Math.min(...list.map(n => n.t)), t1 = Math.max(...list.map(n => n.t + n.d)), span = Math.ceil((t1 - t0) / C.STEP) * C.STEP;
    pr.sel.clear();
    list.forEach(n => { const c2 = S.addNote(pat(), ch().id, Object.assign({}, n, { t: n.t + span })); pr.sel.add(c2.id); });
    const need = Math.ceil((t1 + span) / S.ticksPerBar()); if (need > pat().bars) pat().bars = need;
    done('Duplicate notes');
  },
  copy() { const list = selNotes(); if (!list.length) return; const t0 = Math.min(...list.map(n => n.t)); pr.clip = list.map(n => Object.assign({}, n, { t: n.t - t0 })); ui.toast(list.length + ' notes copied'); },
  paste() {
    if (!pr.clip) { ui.toast('Nothing copied yet'); return; }
    const at = snapT(seq.playing ? seq.getPos() : pr.ox + 0);
    pr.sel.clear();
    pr.clip.forEach(n => { const c2 = S.addNote(pat(), ch().id, Object.assign({}, n, { t: n.t + at })); pr.sel.add(c2.id); });
    const need = Math.ceil(Math.max(...pr.clip.map(n => n.t + n.d + at)) / S.ticksPerBar()); if (need > pat().bars) pat().bars = need;
    done('Paste notes');
  },
  all() { notes().forEach(n => pr.sel.add(n.id)); invalidate(); refreshSelBar(); },
  none() { pr.sel.clear(); invalidate(); refreshSelBar(); },
  invert() { const next = new Set(); notes().forEach(n => { if (!pr.sel.has(n.id)) next.add(n.id); }); pr.sel = next; invalidate(); refreshSelBar(); },
  transpose(d) { target().forEach(n => { n.k = U.clamp(n.k + d, 0, 127); }); done('Transpose'); },
  vel(d) { target().forEach(n => { n.v = U.clamp((n.v || 100) + d, 1, 127); }); done('Velocity'); },
  quantize(mode) {
    const g = snapTicks() > 1 ? snapTicks() : C.STEP;
    target().forEach(n => { const nt = Math.round(n.t / g) * g; if (mode !== 'end') { const e = n.t + n.d; n.t = nt; if (mode === 'both') n.d = Math.max(g, Math.round(e / g) * g - nt); else n.d = Math.max(1, e - nt); } if (mode === 'end') n.d = Math.max(g, Math.round((n.t + n.d) / g) * g - n.t); });
    done('Quantize');
  },
  humanize() { target().forEach(n => { n.t = Math.max(0, n.t + Math.round(U.rnd(-4, 4))); n.v = U.clamp((n.v || 100) + Math.round(U.rnd(-12, 12)), 1, 127); }); done('Humanize'); },
  randVel() { target().forEach(n => { n.v = Math.round(U.rnd(50, 127)); }); done('Randomize velocity'); },
  reverse() { const l = target(); if (!l.length) return; const a = Math.min(...l.map(n => n.t)), b = Math.max(...l.map(n => n.t + n.d)); l.forEach(n => { n.t = a + b - (n.t + n.d); }); done('Reverse'); },
  flip() { const l = target(); if (!l.length) return; const a = Math.min(...l.map(n => n.k)), b = Math.max(...l.map(n => n.k)); l.forEach(n => { n.k = a + b - n.k; }); done('Flip pitch'); },
  legato() { const l = target().slice().sort((a, b) => a.t - b.t); l.forEach((n, i) => { const nx = l.slice(i + 1).find(m => m.t > n.t); if (nx) n.d = Math.max(1, nx.t - n.t); }); done('Legato'); },
  stretch(f) { const l = target(); if (!l.length) return; const a = Math.min(...l.map(n => n.t)); l.forEach(n => { n.t = Math.round(a + (n.t - a) * f); n.d = Math.max(1, Math.round(n.d * f)); }); done('Stretch'); },
  chop(n) { const out = []; target().forEach(nt => { const part = Math.max(1, Math.floor(nt.d / n)); for (let i = 1; i < n; i++) out.push(Object.assign({}, nt, { id: S.id(), t: nt.t + i * part, d: part })); nt.d = part; }); S.notesOf(pat(), ch().id).push(...out); done('Chop'); },
  strum(dir) { const groups = new Map(); target().forEach(n => { (groups.get(n.t) || groups.set(n.t, []).get(n.t)).push(n); }); groups.forEach(g2 => { g2.sort((a, b) => (dir > 0 ? a.k - b.k : b.k - a.k)).forEach((n, i) => { n.t += i * 4; n.d = Math.max(4, n.d - i * 4); }); }); done('Strum'); },
  toScale() { target().forEach(n => { let d = 0; while (!inScale(n.k + d) && !inScale(n.k - d) && d < 12) d++; n.k = inScale(n.k - d) ? n.k - d : n.k + d; }); done('Snap to scale'); },
  setLen() { const g = snapTicks() > 1 ? snapTicks() : C.STEP; target().forEach(n => { n.d = g; }); done('Set length'); },
  toggleMute() { target().forEach(n => { n.m = n.m ? 0 : 1; }); done('Mute notes'); },
};
const target = () => (pr.sel.size ? selNotes() : notes());

function opsMenu() {
  const has = pr.sel.size > 0, sc = has ? 'selection' : 'all notes';
  ui.menu([
    { sep: true, label: 'Select' },
    { label: 'Select all', icon: 'select', onClick: ops.all },
    { label: 'Invert selection', icon: 'swap', onClick: ops.invert },
    { label: 'Copy', icon: 'copy', disabled: !has, onClick: ops.copy },
    { label: 'Paste at playhead', icon: 'paste', disabled: !pr.clip, onClick: ops.paste },
    { label: 'Duplicate selection', icon: 'copy', disabled: !has, onClick: ops.dup },
    { label: 'Delete selection', icon: 'trash', disabled: !has, danger: true, onClick: ops.delete },
    { sep: true, label: 'Transform · ' + sc },
    { label: 'Quantize to grid', icon: 'snap', onClick: () => ops.quantize('both') },
    { label: 'Quantize note starts only', icon: 'snap', onClick: () => ops.quantize('start') },
    { label: 'Quantize note ends', icon: 'snap', onClick: () => ops.quantize('end') },
    { label: 'Set all lengths to grid', icon: 'minus', onClick: ops.setLen },
    { label: 'Legato (fill gaps)', icon: 'right', onClick: ops.legato },
    { label: 'Chop into 2', icon: 'slice', onClick: () => ops.chop(2) },
    { label: 'Chop into 4', icon: 'slice', onClick: () => ops.chop(4) },
    { label: 'Stretch ×2', icon: 'expand', onClick: () => ops.stretch(2) },
    { label: 'Stretch ×0.5', icon: 'expand', onClick: () => ops.stretch(0.5) },
    { label: 'Reverse in time', icon: 'rewind', onClick: ops.reverse },
    { label: 'Flip pitch', icon: 'swap', onClick: ops.flip },
    { label: 'Strum up', icon: 'up', onClick: () => ops.strum(1) },
    { label: 'Strum down', icon: 'down', onClick: () => ops.strum(-1) },
    { label: 'Snap to scale', icon: 'scale', onClick: ops.toScale },
    { label: 'Mute / unmute', icon: 'mute', onClick: ops.toggleMute },
    { sep: true, label: 'Randomize' },
    { label: 'Humanize timing and velocity', icon: 'dice', onClick: ops.humanize },
    { label: 'Random velocities', icon: 'dice', onClick: ops.randVel },
    { label: 'Generate melody / chords / bass…', icon: 'wand', onClick: () => ui.generator && ui.generator() },
  ], { title: 'Piano roll' });
}
function scaleSheet() {
  const body = h('div.dialog');
  body.append(
    ui.toggle('Highlight scale', st.get('prScaleHL'), v => { st.set('prScaleHL', v); invalidate(); }),
    ui.toggle('Lock drawn notes to scale', st.get('prScaleLock'), v => st.set('prScaleLock', v)),
    h('div.row', ui.select('Root', C.NOTE_NAMES.map((n, i) => ({ v: i, l: n })), st.get('prScaleRoot'), v => { st.set('prScaleRoot', Number(v)); invalidate(); }),
      ui.select('Scale', Object.keys(C.SCALES).map(n => ({ v: n, l: n })), st.get('prScaleName'), v => { st.set('prScaleName', v); invalidate(); })),
    h('div.sec-title', 'Chord stamp'),
    h('p.dim', 'Pick a chord and every note you draw becomes that chord.'),
    ui.select('Chord', [{ v: '', l: 'Off (single notes)' }, ...Object.keys(C.CHORDS).map(n => ({ v: n, l: n }))], pr.stamp || '', v => { pr.stamp = v || null; stampChipUpdate(); }));
  ui.sheet({ title: 'Scale & chords', content: body });
}
function stampChipUpdate() { stampChip.hidden = !pr.stamp; stampChip.firstChild.nodeValue = 'Chord: ' + (pr.stamp || '') + ' '; }

function pickChannel() {
  const body = h('div.menu-list');
  S.p.channels.filter(c => DAW.inst.types[c.type].play || c.type === 'layer').forEach(c => body.appendChild(h('button.br-item', { onclick: () => { S.ui.ch = c.id; S.emit('select'); s.close(); } },
    h('span.bi-ic', { style: { background: c.color, color: '#111' } }, U.icon('note', 16)), h('span.bi-t', h('b', c.name), h('small', DAW.inst.types[c.type].label)), c.id === S.ui.ch ? U.icon('check', 18) : null)));
  const s = ui.sheet({ title: 'Channel', content: body });
}
function stepChannel(d) {
  const list = S.p.channels.filter(c => DAW.inst.types[c.type].play || c.type === 'layer'); if (!list.length) return;
  const i = list.findIndex(c => c.id === S.ui.ch);
  S.ui.ch = list[(i + d + list.length) % list.length].id; S.emit('select');
}

/* ---------- layout ---------- */
function resize() {
  const r = wrap.getBoundingClientRect();
  const lr = lane.getBoundingClientRect();
  dpr = window.devicePixelRatio || 1;
  W = Math.round(r.width); H = Math.round(r.height); LH = Math.round(lr.height);
  [base, over].forEach(cv => { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); });
  laneCv.width = Math.round(W * dpr); laneCv.height = Math.round(LH * dpr);
  clampView(); invalidate(); drawLane();
}
function focusDefault() {
  const list = notes();
  const mid = list.length ? list.reduce((a, n) => a + n.k, 0) / list.length : 62;
  pr.oy = (127 - mid) * pr.rh - (H - RH) / 2; pr.ox = 0; clampView(); invalidate();
}

function snapMenu() {
  ui.menu(C.SNAPS.map(s => ({ label: s.label, checked: pr.snap === s.id, onClick: () => { pr.snap = s.id; snapBtn.lastChild.textContent = s.label; invalidate(); } })), { title: 'Snap to' });
}

let focusKey = '';
view.show = () => {
  if (!W) resize();
  refreshChan(); invalidate();
  const key = S.ui.ch + ':' + S.ui.pat;
  if (key !== focusKey) { focusKey = key; focusDefault(); }
};
view.tick = pos => {
  if (!root || ui.cur !== 'piano') return;
  if (dirty) { drawBase(); drawLane(); }
  drawOver(pos);
  if (seq.playing && pos >= 0 && !drag && !nav && st.get('followPlayhead') !== 'off') {
    const L = S.patLenTicks(pat()), p = S.p.mode === 'pattern' ? pos % L : pos, x = tx(p);
    if (x > W - 30 || x < KW) { pr.ox = Math.max(0, p - 20 / pr.zx); invalidate(); }
  }
};
function refreshChan() {
  const c = ch();
  chBtn.replaceChildren(h('i', { style: { width: '.7rem', height: '.7rem', borderRadius: '3px', background: c ? c.color : '#555', display: 'block' } }), c ? c.name : 'No channel', U.icon('chevD', 14));
}
ui.openPiano = id => { if (id != null) S.ui.ch = id; ui.show('piano'); };

view.build = () => {
  root = U.$('#v-piano');
  chBtn = h('button.chip', { onclick: pickChannel, 'aria-label': 'Channel' });
  const toolDefs = [['draw', 'pencil', 'Draw'], ['select', 'select', 'Select'], ['erase', 'eraser', 'Erase'], ['slice', 'slice', 'Slice'], ['mute', 'mute', 'Mute'], ['pan', 'hand', 'Pan']];
  const tools = h('div.toolrow', toolDefs.map(([id, icon, label]) => (toolEls[id] = h('button.tool' + (id === pr.tool ? '.on' : ''), { title: label, 'aria-label': label, onclick: () => { pr.tool = id; Object.keys(toolEls).forEach(k => toolEls[k].classList.toggle('on', k === id)); } }, U.icon(icon, 20)))));
  snapBtn = h('button.chip', { onclick: snapMenu, 'aria-label': 'Snap' }, U.icon('snap', 16), snapLabel());
  stampChip = h('button.chip.on', { hidden: true, onclick: () => { pr.stamp = null; stampChipUpdate(); } }, 'Chord ', U.icon('x', 12));
  const patB = h('button.chip', { onclick: ui.patternPicker, 'aria-label': 'Pattern' });
  const sub = h('div.subbar', ui.ibtn('chevL', 'Previous channel', () => stepChannel(-1)), chBtn, ui.ibtn('chevR', 'Next channel', () => stepChannel(1)), tools, snapBtn, stampChip,
    h('button.chip', { onclick: scaleSheet }, U.icon('scale', 16), 'Scale'), h('button.chip', { onclick: opsMenu }, U.icon('dots', 16), 'Edit'), patB);
  base = h('canvas'); over = h('canvas.over');
  wrap = h('div.ed', base, over);
  laneCv = h('canvas');
  lane = h('div.lane', laneCv);
  laneChips = h('div.lane-bar', LANES.map(([id, label]) => h('button.chip' + (id === pr.lane ? '.on' : ''), { dataset: { lane: id }, onclick: () => { pr.lane = id; U.$$('.chip', laneChips).forEach(b => b.classList.toggle('on', b.dataset.lane === id)); drawLane(); } }, label)));
  selBar = h('div.lane-bar', { hidden: true },
    h('span.chip.on.sel-count', '0 selected'),
    ui.ibtn('copy', 'Duplicate', () => ops.dup()), ui.ibtn('up', 'Transpose up', () => ops.transpose(1)), ui.ibtn('down', 'Transpose down', () => ops.transpose(-1)),
    h('button.chip', { onclick: () => ops.transpose(12) }, '+8ve'), h('button.chip', { onclick: () => ops.transpose(-12) }, '−8ve'),
    h('button.chip', { onclick: () => ops.vel(10) }, 'Vel +'), h('button.chip', { onclick: () => ops.vel(-10) }, 'Vel −'),
    h('button.chip', { onclick: () => ops.quantize('both') }, 'Quantize'), ui.ibtn('gear', 'Properties', () => openProps(selNotes())), ui.ibtn('trash', 'Delete', () => ops.delete()), ui.ibtn('x', 'Deselect', () => ops.none()));
  root.append(sub, wrap, selBar, lane, laneChips);
  over.addEventListener('pointerdown', onDown);
  over.addEventListener('pointermove', onMove);
  over.addEventListener('pointerup', e => { onUp(e); if (drag === null && lastKey >= 0) lastKey = -1; });
  over.addEventListener('pointercancel', onUp);
  over.addEventListener('lostpointercapture', e => { if (drag && drag.type === 'key') { if (drag.hd) drag.hd.off(); lastKey = -1; auditioned = null; invalidate(); } });
  over.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.ctrlKey) { const tA = xt(e.offsetX); pr.zx = U.clamp(pr.zx * (e.deltaY > 0 ? 0.9 : 1.1), 0.12, 5); pr.ox = tA - (e.offsetX - KW) / pr.zx; } else if (e.shiftKey) pr.ox += e.deltaY / pr.zx; else { pr.oy += e.deltaY; pr.ox += e.deltaX / pr.zx; }
    clampView(); invalidate();
  }, { passive: false });
  let ld = null;
  lane.addEventListener('pointerdown', e => { e.preventDefault(); lane.setPointerCapture(e.pointerId); ld = laneSet(e, null); });
  lane.addEventListener('pointermove', e => { if (ld != null) ld = laneSet(e, ld); });
  const lu = () => { if (ld != null) { ld = null; done('Edit ' + LANES.find(l => l[0] === pr.lane)[1]); } };
  lane.addEventListener('pointerup', lu); lane.addEventListener('pointercancel', lu);
  new ResizeObserver(() => { if (ui.cur === 'piano') resize(); }).observe(wrap);
  window.addEventListener('keydown', e => {
    if (ui.cur !== 'piano' || e.target.closest('input,textarea,select') || document.querySelector('.sheet-back')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { if (pr.sel.size) ops.delete(); } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); ops.all(); } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') ops.copy(); else if ((e.ctrlKey || e.metaKey) && e.key === 'v') ops.paste();
    else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); ops.dup(); }
  });
  ['restore', 'project'].forEach(ev => S.on(ev, () => { pr.sel.clear(); invalidate(); if (ui.cur === 'piano') { refreshSelBar(); refreshChan(); } }));
  S.on('select', () => { pr.sel.clear(); refreshChan(); invalidate(); refreshSelBar(); });
  S.on('pattern', () => { pr.sel.clear(); invalidate(); refreshSelBar(); });
  S.on('channels', () => { refreshChan(); invalidate(); });
  S.on('notes', () => invalidate());
  S.on('tempo', () => invalidate());
  ['prScaleHL', 'prScaleRoot', 'prScaleName', 'prGhost', 'prKeyLabels', 'prNoteLabels', 'prVelColor', 'bigHandles'].forEach(k => st.on(k, invalidate));
  patB.replaceChildren(U.icon('note', 16), 'Pattern');
  setTimeout(() => { resize(); focusDefault(); }, 0);
};
ui.pianoFocus = focusDefault;
})();
