'use strict';
/* Beatforge — automation clips: creation from any knob and the curve editor. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq;

/** Called from a knob's long-press menu. */
ui.makeAutomation = (path, def, cur) => {
  const a = path.split(':');
  if (a[2] === 'p') { ui.toast('Instrument parameters can’t be automated yet — try volume, pan, mixer or effect knobs.', 4200); return; }
  let n = 0.5;
  if (cur != null) {
    if (a[0] === 'fx') n = U.toNorm(def, cur);
    else if (a[2] === 'pan') n = (cur + 1) / 2;
    else n = U.clamp(cur, 0, 1);
  }
  const au = S.newAutomation(path);
  au.points = [{ t: 0, v: n, c: 0 }, { t: S.ticksPerBar(), v: n, c: 0 }];
  const t = Math.max(0, Math.floor(seq.startPos / S.ticksPerBar()) * S.ticksPerBar());
  const tracks = S.p.playlist.tracks;
  let track = 0;
  for (let i = 0; i < tracks.length; i++) if (!S.p.playlist.clips.some(c => c.track === i && c.t < t + S.ticksPerBar() && c.t + c.d > t)) { track = i; break; }
  S.addClip({ type: 'auto', track, t, d: S.ticksPerBar() * 2, ref: au.id, off: 0 });
  S.commit('Create automation');
  ui.toast('Automation clip added to the playlist');
  ui.openAutomation(au.id);
};

ui.openAutomation = id => {
  const au = S.p.automation.find(a => a.id === id);
  if (!au) return;
  const clip = S.p.playlist.clips.find(c => c.type === 'auto' && c.ref === id);
  const tpb = S.ticksPerBar();
  const body = h('div');
  const cv = h('canvas.eq-view', { style: { height: '15rem' } });
  let len = clip ? clip.d : tpb * 2, snap = C.PPQ / 4, sel = -1, W = 0, H = 0, dpr = 1, run = true;
  const info = h('div.tl', { style: { margin: '.4rem 0' } });
  const s = ui.sheet({ title: 'Automation · ' + au.name, content: body, full: true, onClose: () => { run = false; S.emit('playlist'); } });
  const X = t => 10 + (t / len) * (W - 20), T = x => ((x - 10) / (W - 20)) * len;
  const Y = v => 10 + (1 - v) * (H - 20), V = y => 1 - (y - 10) / (H - 20);
  const sn = t => Math.max(0, Math.min(len, Math.round(t / snap) * snap));
  const changed = l => { au.points.sort((a, b) => a.t - b.t); S.commit(l); S.emit('playlist'); };
  const real = v => { const m = DAW.auto.map(au.target, v); return typeof m === 'number' ? (+m.toFixed(3)) : m; };

  const draw = () => {
    if (!run) return;
    W = cv.clientWidth; H = cv.clientHeight; dpr = window.devicePixelRatio || 1;
    if (!W) { requestAnimationFrame(draw); return; }
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.strokeStyle = '#1d2330'; g.lineWidth = 1;
    for (let t = 0; t <= len; t += C.PPQ) { const x = Math.round(X(t)); g.strokeStyle = t % tpb === 0 ? '#394257' : '#1d2330'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    [0, 0.25, 0.5, 0.75, 1].forEach(v => { g.strokeStyle = '#1d2330'; g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); });
    g.strokeStyle = '#ff8a3d'; g.lineWidth = 2.5; g.beginPath();
    for (let x = 10; x <= W - 10; x += 2) { const y = Y(DAW.auto.eval(au, T(x))); x === 10 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
    g.fillStyle = 'rgba(255,138,61,.1)'; g.lineTo(W - 10, H - 10); g.lineTo(10, H - 10); g.fill();
    au.points.forEach((p, i) => {
      g.fillStyle = i === sel ? '#fff' : '#ff8a3d'; g.beginPath(); g.arc(X(p.t), Y(p.v), i === sel ? 10 : 8, 0, 7); g.fill();
      const nx = au.points[i + 1];
      if (nx && !p.h) { const mx = X((p.t + nx.t) / 2), my = Y(DAW.auto.eval(au, (p.t + nx.t) / 2)); g.fillStyle = '#37d6c5'; g.beginPath(); g.moveTo(mx, my - 6); g.lineTo(mx + 6, my); g.lineTo(mx, my + 6); g.lineTo(mx - 6, my); g.fill(); }
    });
    if (seq.playing && clip) { const x = X(seq.getPos() - clip.t); if (x >= 0 && x <= W) { g.fillStyle = '#37d6c5'; g.fillRect(x - 1, 0, 2, H); } }
    requestAnimationFrame(draw);
  };

  let d = null;
  const find = e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 24;
    au.points.forEach((p, i) => { const dd = Math.hypot(X(p.t) - x, Y(p.v) - y); if (dd < bd) { bd = dd; best = i; } });
    let mid = -1;
    if (best < 0) au.points.forEach((p, i) => { const nx = au.points[i + 1]; if (!nx) return; const mx = X((p.t + nx.t) / 2), my = Y(DAW.auto.eval(au, (p.t + nx.t) / 2)); if (Math.hypot(mx - x, my - y) < 20) mid = i; });
    return { x, y, best, mid };
  };
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const f = find(e);
    if (f.best >= 0) { sel = f.best; d = { type: 'pt', i: f.best, moved: false, x0: f.x, y0: f.y, hold: setTimeout(() => { if (d && !d.moved) { d.held = true; DAW.haptic(15); ptMenu(f.best); } }, DAW.settings.get('longPressMs')) }; } else if (f.mid >= 0) { d = { type: 'curve', i: f.mid, y0: f.y, c0: au.points[f.mid].c || 0 }; } else {
      const p = { t: sn(T(f.x)), v: U.clamp(V(f.y), 0, 1), c: 0 };
      au.points.push(p); au.points.sort((a, b) => a.t - b.t); sel = au.points.indexOf(p); d = { type: 'pt', i: sel, moved: true, added: true, x0: f.x, y0: f.y };
    }
  });
  cv.addEventListener('pointermove', e => {
    if (!d) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (d.type === 'pt') {
      if (Math.hypot(x - d.x0, y - d.y0) > 6) { d.moved = true; clearTimeout(d.hold); }
      if (!d.moved) return;
      const p = au.points[d.i], lo = d.i > 0 ? au.points[d.i - 1].t : 0, hi = d.i < au.points.length - 1 ? au.points[d.i + 1].t : len;
      p.t = U.clamp(sn(T(x)), lo, hi); p.v = U.clamp(V(y), 0, 1);
      if (d.i === 0) p.t = 0;
      info.textContent = 'Value ' + real(p.v) + ' at ' + (p.t / C.PPQ).toFixed(2) + ' beats';
    } else if (d.type === 'curve') {
      const p = au.points[d.i]; p.c = U.clamp(d.c0 + (y - d.y0) / 60 * (au.points[d.i + 1].v >= p.v ? 1 : -1), -1, 1);
    }
  });
  const up = () => { if (!d) return; clearTimeout(d.hold); const dd = d; d = null; if (dd.held) return; if (dd.type === 'curve') changed('Automation curve'); else if (dd.moved || dd.added) changed('Edit automation'); else info.textContent = 'Value ' + real(au.points[dd.i].v); };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const ptMenu = i => ui.menu([
    { label: au.points[i].h ? 'Make curve (smooth to next)' : 'Hold value until next point', icon: 'minus', onClick: () => { au.points[i].h = !au.points[i].h; changed('Automation step'); } },
    { label: 'Delete point', icon: 'trash', danger: true, disabled: au.points.length <= 2, onClick: () => { au.points.splice(i, 1); sel = -1; changed('Delete point'); } },
  ], { title: 'Point ' + (i + 1) });

  const fill = (shape, cycles) => {
    const pts = [], n = 32 * cycles;
    for (let i = 0; i <= n; i++) {
      const ph = (i / n * cycles) % 1, t = Math.round(i / n * len);
      let v;
      if (shape === 'sine') v = 0.5 + 0.5 * Math.sin(ph * Math.PI * 2 - Math.PI / 2);
      else if (shape === 'tri') v = ph < 0.5 ? ph * 2 : 2 - ph * 2;
      else if (shape === 'saw') v = ph;
      else if (shape === 'square') v = ph < 0.5 ? 1 : 0;
      else v = Math.random();
      pts.push({ t, v, c: 0 });
    }
    if (shape === 'square') pts.forEach(p => { p.h = true; });
    au.points = pts; changed('Automation LFO');
  };
  const bar = h('div.row', { style: { margin: '.4rem 0' } },
    h('button.chip', { onclick: () => ui.menu([['sine', 'Sine'], ['tri', 'Triangle'], ['saw', 'Ramp up'], ['square', 'Square (steps)'], ['rand', 'Random']].flatMap(([k, l]) => [1, 2, 4, 8].map(c => ({ label: l + ' · ' + c + ' cycle' + (c > 1 ? 's' : ''), onClick: () => fill(k, c) }))), { title: 'Fill with LFO shape' }) }, U.icon('wave', 16), 'LFO shape'),
    h('button.chip', { onclick: () => { au.points.forEach(p => { p.v = 1 - p.v; }); changed('Invert automation'); } }, 'Invert'),
    h('button.chip', { onclick: () => { au.points.forEach(p => { p.t = len - p.t; }); au.points.reverse(); changed('Reverse automation'); } }, 'Reverse'),
    h('button.chip', { onclick: () => { au.points = [{ t: 0, v: 0.5, c: 0 }, { t: len, v: 0.5, c: 0 }]; changed('Flatten automation'); } }, 'Flatten'),
    h('button.chip', { onclick: async () => { const v = await ui.prompt('Length in bars', +(len / tpb).toFixed(2), { number: true }); const n = parseFloat(v); if (n > 0 && clip) { const nl = Math.round(n * tpb), k = nl / len; au.points.forEach(p => { p.t = Math.round(p.t * k); }); clip.d = nl; len = nl; changed('Automation length'); } } }, U.icon('clock', 16), 'Length'),
    ui.select('Snap', [[C.PPQ, 'Beat'], [C.PPQ / 2, '1/8'], [C.PPQ / 4, '1/16'], [C.PPQ / 8, '1/32'], [1, 'Free']].map(([v, l]) => ({ v, l })), snap, v => { snap = Number(v); }));
  body.append(h('div.tl', 'Target: ' + DAW.auto.label(au.target)), bar, cv, info,
    h('p.dim', 'Tap empty space to add a point · drag points · drag the teal diamonds to bend a segment · long-press a point for options.'),
    h('div.row', h('button.btn.small', { onclick: async () => { const n = await ui.prompt('Rename automation', au.name); if (n) { au.name = n; S.commit('Rename automation'); s.setTitle('Automation · ' + n); } } }, U.icon('pencil', 16), 'Rename'),
      h('button.btn.small.danger', { onclick: async () => { if (await ui.confirm('Delete this automation clip?', 'Delete', true)) { S.p.automation = S.p.automation.filter(a => a !== au); S.p.playlist.clips = S.p.playlist.clips.filter(c => c.ref !== au.id || c.type !== 'auto'); S.commit('Delete automation'); s.close(); } } }, U.icon('trash', 16), 'Delete clip')));
  requestAnimationFrame(draw);
};
})();
