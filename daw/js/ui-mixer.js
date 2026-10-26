'use strict';
/* Beatforge — mixer: strips, effect slots, EQ, routing and the effect editor. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, FX = DAW.fx;

const view = {};
ui.registerView('mixer', view);

let root, stripsEl, detailEl, tabName = 'fx';
const strips = new Map();   // idx -> {el, meter, fader, db}

const trackName = i => S.p.mixer.tracks[i].name;
const trackColor = i => S.p.mixer.tracks[i].col || (i === 0 ? '#5f6b8a' : '#3a4560');

function wouldCycle(src, dest) {
  const seen = new Set();
  const go = n => {
    if (n === src) return true;
    if (seen.has(n)) return false; seen.add(n);
    return Object.keys(S.p.mixer.tracks[n].routes).some(d => go(Number(d)));
  };
  return go(dest);
}

ui.addInsert = () => {
  if (S.p.mixer.tracks.length > C.MAX_INSERTS) { ui.toast('Maximum of ' + C.MAX_INSERTS + ' inserts reached'); return; }
  S.p.mixer.tracks.push(S.newTrack(S.p.mixer.tracks.length));
  S.commit('Add insert'); S.emit('mixer'); render();
};

function isUsed(i) {
  if (i === 0) return true;
  const t = S.p.mixer.tracks[i];
  return S.p.channels.some(c => c.mix === i) || t.fx.some(Boolean) || t.name !== 'Insert ' + i || Object.keys(t.routes).some(d => d !== '0') ||
    S.p.mixer.tracks.some(o => o.routes[i] != null) || i <= 8;
}

function buildStrip(i) {
  const t = S.p.mixer.tracks[i];
  const meter = ui.meter();
  const db = h('div.strip-db', U.fmtDb(U.faderToGain(t.vol)));
  const fader = ui.fader({
    value: t.vol, label: trackName(i) + ' volume',
    onInput: v => { t.vol = v; db.textContent = U.fmtDb(U.faderToGain(v)); DAW.audio.graph && DAW.audio.graph.setParam('mx:' + i + ':vol', v); S.emit('track-light', i); },
    onChange: () => { S.commit('Fader'); S.emit('track', i); },
  });
  const pan = ui.knob({ def: { id: 'pan', label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan' }, value: t.pan, size: 34, path: 'mx:' + i + ':pan',
    onInput: v => { t.pan = v; DAW.audio.graph && DAW.audio.graph.setParam('mx:' + i + ':pan', v); }, onChange: () => { S.commit('Pan'); S.emit('track', i); } });
  pan.classList.add('mini');
  const name = h('button.strip-name', { style: { '--sc': trackColor(i) }, 'aria-label': 'Select ' + t.name }, h('span', t.name));
  U.drag(name, {
    up: (e, st) => { if (!st.held) { S.ui.track = i; markSel(); renderDetail(); } },
    hold: () => { DAW.haptic(15); trackMenu(i); }, holdMs: DAW.settings.get('longPressMs'),
  });
  const mBtn = h('button.sbtn.m' + (t.mute ? '.on' : ''), { 'aria-label': 'Mute', onclick: () => { t.mute = !t.mute; S.commit('Mute'); S.emit('track', i); mBtn.classList.toggle('on', t.mute); } }, 'M');
  const sBtn = h('button.sbtn.s' + (t.solo ? '.on' : ''), { 'aria-label': 'Solo', onclick: () => { t.solo = !t.solo; S.commit('Solo'); S.emit('track', i); sBtn.classList.toggle('on', t.solo); } }, 'S');
  const fxDots = h('div.strip-fx', t.fx.slice(0, DAW.settings.get('mxSlotsShown')).map(f => h('i' + (f ? (f.on ? '.on' : '.off') : ''))));
  const el = h('div.strip' + (i === 0 ? '.master' : '') + (S.ui.track === i ? '.sel' : ''), { dataset: { idx: i } },
    name, h('div.strip-num', i === 0 ? 'MASTER' : String(i)), fxDots, h('div.strip-pan', pan),
    h('div.strip-main', fader, meter), db, h('div.strip-btns', mBtn, sBtn));
  strips.set(i, { el, meter, fader, db, pan, mBtn, sBtn, fxDots });
  return el;
}

function markSel() { strips.forEach((s, i) => s.el.classList.toggle('sel', i === S.ui.track)); }

function trackMenu(i) {
  const t = S.p.mixer.tracks[i];
  ui.menu([
    { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await ui.prompt('Rename track', t.name); if (n) { t.name = n; S.commit('Rename track'); render(); } } },
    { label: 'Colour', icon: 'paint', onClick: async () => { const c = await ui.pickColor(t.col, true); if (c != null) { t.col = c || null; S.commit('Track colour'); render(); } } },
    { label: 'Clear effects', icon: 'eraser', onClick: () => { t.fx.fill(null); S.commit('Clear effects'); S.emit('fx', i); render(); } },
    i > 0 ? { label: 'Copy effects to next track', icon: 'copy', disabled: i + 1 >= S.p.mixer.tracks.length, onClick: () => { const d = S.p.mixer.tracks[i + 1]; d.fx = t.fx.map(f => (f ? Object.assign(U.deep(f), { id: S.id() }) : null)); S.commit('Copy effects'); S.emit('fx', i + 1); render(); } } : null,
    i > 0 ? { label: 'Reset track', icon: 'undo', danger: true, onClick: () => { S.p.mixer.tracks[i] = S.newTrack(i); S.commit('Reset track'); S.emit('track', i); S.emit('fx', i); render(); } } : null,
  ], { title: t.name });
}

function render() {
  if (!root) return;
  const scroll = stripsEl.scrollLeft;
  U.clear(stripsEl); strips.clear();
  stripsEl.style.setProperty('--strip-w', DAW.settings.get('mxStripW') / 15 + 'rem');
  S.p.mixer.tracks.forEach((t, i) => {
    if (i > 0 && !DAW.settings.get('mxShowEmpty') && !isUsed(i)) return;
    stripsEl.appendChild(buildStrip(i));
  });
  stripsEl.appendChild(h('button.strip', { style: { alignItems: 'center', justifyContent: 'center', color: 'var(--acc)', width: '4rem', background: 'transparent', borderStyle: 'dashed' }, onclick: ui.addInsert, 'aria-label': 'Add insert' }, U.icon('plus', 26)));
  stripsEl.scrollLeft = scroll;
  renderDetail();
}

/* ---------- detail panel ---------- */
function renderDetail() {
  const i = S.ui.track, t = S.p.mixer.tracks[i];
  if (!t) { S.ui.track = 0; return renderDetail(); }
  U.clear(detailEl);
  const tabs = [['fx', 'Effects'], ['eq', 'EQ'], ['route', 'Routing'], ['track', 'Track']];
  detailEl.appendChild(h('div.mx-detail-head', h('b', { style: { marginRight: '.4rem', whiteSpace: 'nowrap' } }, (i === 0 ? 'Master' : i + ' · ' + t.name)),
    tabs.map(([id, l]) => h('button.tab' + (id === tabName ? '.on' : ''), { onclick: () => { tabName = id; renderDetail(); } }, l))));
  const body = h('div.mx-detail-body');
  detailEl.appendChild(body);
  if (tabName === 'fx') {
    const grid = h('div.fx-slots');
    t.fx.forEach((f, s) => {
      if (s >= DAW.settings.get('mxSlotsShown') && !f) return;
      if (!f) {
        grid.appendChild(h('button.fx-slot.empty', { onclick: () => pickFx(i, s) }, h('span.fs-n', s + 1), h('span.fs-name', 'Empty slot'), U.icon('plus', 18)));
        return;
      }
      const T = FX.types[f.type];
      const led = h('button.led' + (f.on ? '.on' : ''), { 'aria-label': 'Bypass ' + T.label, 'aria-pressed': String(f.on), onclick: () => { f.on = !f.on; S.commit('Bypass'); S.emit('fx', i); led.classList.toggle('on', f.on); slot.classList.toggle('off', !f.on); strips.get(i) && refreshDots(i); } }, U.icon('bolt', 18));
      const nameB = h('button.fs-name', { onclick: () => ui.openFx(i, s) }, T.label);
      const slot = h('div.fx-slot' + (f.on ? '' : '.off'), h('span.fs-n', s + 1), nameB, led,
        h('button.led', { 'aria-label': 'Slot options', onclick: () => slotMenu(i, s) }, U.icon('dots', 18)));
      grid.appendChild(slot);
    });
    body.appendChild(grid);
  } else if (tabName === 'eq') {
    const e = t.eq, touch = () => S.emit('track', i), cm = l => () => S.commit(l);
    const k = (id, label, min, max, def, o) => ui.knob({ def: Object.assign({ id, label, min, max, def }, o), value: e[id], path: null, onInput: v => { e[id] = v; touch(); }, onChange: cm('EQ') });
    body.appendChild(ui.toggle('Track EQ enabled', e.on, v => { e.on = v; S.commit('EQ'); touch(); }));
    body.appendChild(h('div.pgrid',
      k('lg', 'Low gain', -18, 18, 0, { unit: 'dB' }), k('lf', 'Low freq', 30, 400, 90, { curve: 'log', unit: 'Hz' }),
      k('mg', 'Mid gain', -18, 18, 0, { unit: 'dB' }), k('mf', 'Mid freq', 200, 6000, 1000, { curve: 'log', unit: 'Hz' }), k('mq', 'Mid Q', 0.2, 8, 1, { curve: 'log' }),
      k('hg', 'High gain', -18, 18, 0, { unit: 'dB' }), k('hf', 'High freq', 2000, 16000, 8000, { curve: 'log', unit: 'Hz' })));
  } else if (tabName === 'route') {
    body.appendChild(h('div.sec-title', i === 0 ? 'Master output' : 'Send ' + t.name + ' to'));
    if (i === 0) body.appendChild(h('p.dim', 'The master track goes to the speakers. Turn on “Master safety limiter” in Settings → Audio to protect your ears.'));
    else {
      const wrap = h('div.route-list');
      S.p.mixer.tracks.forEach((o, d) => {
        if (d === i) return;
        if (d > 0 && !isUsed(d) && !(d in t.routes)) return;
        const on = d in t.routes, blocked = !on && wouldCycle(i, d);
        wrap.appendChild(h('button.chip' + (on ? '.on' : ''), { disabled: blocked, style: blocked ? { opacity: .35 } : null, onclick: () => {
          if (on) delete t.routes[d]; else t.routes[d] = d === 0 ? 1 : 0.5;
          S.commit('Routing'); S.emit('track', i); renderDetail();
        } }, d === 0 ? 'Master' : d + ' ' + o.name));
      });
      body.appendChild(wrap);
      body.appendChild(h('div.sec-title', 'Send levels'));
      const grid = h('div.pgrid');
      Object.keys(t.routes).forEach(d => {
        d = Number(d);
        grid.appendChild(ui.knob({ def: { id: 'send' + d, label: d === 0 ? 'Master' : d + ' ' + trackName(d), min: 0, max: 1.5, def: d === 0 ? 1 : 0.5, fmt: v => U.fmtDb(v) }, value: t.routes[d], path: 'mx:' + i + ':send:' + d,
          onInput: v => { t.routes[d] = v; DAW.audio.graph && DAW.audio.graph.setParam('mx:' + i + ':send:' + d, v); }, onChange: () => { S.commit('Send level'); S.emit('track', i); } }));
      });
      body.appendChild(grid);
    }
  } else {
    const touch = () => S.emit('track', i);
    body.appendChild(h('div.pgrid',
      ui.knob({ def: { id: 'sep', label: 'Stereo width', min: -1, max: 1, def: 0, fmt: v => (v < 0 ? 'narrow ' : 'wide ') + Math.round(Math.abs(v) * 100) + '%' }, value: t.sep, onInput: v => { t.sep = v; touch(); }, onChange: () => S.commit('Stereo width') }),
      ui.knob({ def: { id: 'delay', label: 'Track delay', min: 0, max: 500, def: 0, unit: 'ms' }, value: t.delay, onInput: v => { t.delay = v; touch(); }, onChange: () => S.commit('Track delay') }),
      ui.toggle('Invert phase', t.inv, v => { t.inv = v; S.commit('Phase'); touch(); }),
      ui.toggle('Swap left / right', t.swap, v => { t.swap = v; S.commit('Swap'); touch(); })));
  }
}
function refreshDots(i) {
  const s = strips.get(i), t = S.p.mixer.tracks[i];
  if (s) s.fxDots.replaceChildren(...t.fx.slice(0, DAW.settings.get('mxSlotsShown')).map(f => h('i' + (f ? (f.on ? '.on' : '.off') : ''))));
}

function pickFx(i, slot) {
  const body = h('div.menu-list');
  const s = ui.sheet({ title: 'Add effect to slot ' + (slot + 1), content: body, full: true });
  FX.cats.forEach(cat => {
    const types = FX.order.filter(t => FX.types[t].cat === cat);
    if (!types.length) return;
    body.appendChild(h('div.br-cat', cat));
    types.forEach(t => body.appendChild(h('button.br-item', { onclick: () => {
      S.p.mixer.tracks[i].fx[slot] = S.newFx(t); S.commit('Add ' + FX.types[t].label); S.emit('fx', i);
      s.close(); renderDetail(); refreshDots(i);
    } }, h('span.bi-ic', U.icon('fx', 18)), h('span.bi-t', h('b', FX.types[t].label), h('small', FX.types[t].params.length + ' parameters')))));
  });
}
function slotMenu(i, slot) {
  const t = S.p.mixer.tracks[i], f = t.fx[slot], T = FX.types[f.type];
  const swap = (a, b) => { [t.fx[a], t.fx[b]] = [t.fx[b], t.fx[a]]; S.commit('Move effect'); S.emit('fx', i); renderDetail(); refreshDots(i); };
  ui.menu([
    { label: 'Open editor', icon: 'gear', onClick: () => ui.openFx(i, slot) },
    { label: 'Replace…', icon: 'swap', onClick: () => pickFx(i, slot) },
    { label: 'Move up', icon: 'up', disabled: slot === 0, onClick: () => swap(slot, slot - 1) },
    { label: 'Move down', icon: 'down', disabled: slot >= t.fx.length - 1, onClick: () => swap(slot, slot + 1) },
    { label: 'Duplicate to next free slot', icon: 'copy', onClick: () => { const n = t.fx.findIndex(x => !x); if (n < 0) { ui.toast('No free slot'); return; } t.fx[n] = Object.assign(U.deep(f), { id: S.id() }); S.commit('Duplicate effect'); S.emit('fx', i); renderDetail(); } },
    { label: 'Remove', icon: 'trash', danger: true, onClick: () => { t.fx[slot] = null; S.commit('Remove effect'); S.emit('fx', i); renderDetail(); refreshDots(i); } },
  ], { title: T.label });
}

/* ---------- effect editor ---------- */
ui.openFx = (i, slot) => {
  const t = S.p.mixer.tracks[i], f = t.fx[slot];
  if (!f) return;
  const T = FX.types[f.type];
  const body = h('div');
  const s = ui.sheet({ title: T.label + ' · ' + (i === 0 ? 'Master' : t.name) + ' · slot ' + (slot + 1), content: body, full: true, onClose: () => { stopViz(); } });
  const touch = () => S.emit('fx', i);
  let stopViz = () => {};
  body.appendChild(h('div.row', { style: { marginBottom: '.4rem' } },
    ui.toggle('Enabled', f.on, v => { f.on = v; S.commit('Bypass'); touch(); }),
    ui.knob({ def: { id: 'mix', label: 'Dry / wet', min: 0, max: 1, def: T.mixDef, unit: '%' }, value: f.mix, path: 'fxmix:' + i + ':' + slot, onInput: v => { f.mix = v; touch(); }, onChange: () => S.commit('Mix') }),
    h('button.btn.small', { onclick: () => { Object.keys(f.p).forEach(k => { const d = T.params.find(x => x.id === k); f.p[k] = d.def; }); f.mix = T.mixDef; S.commit('Reset effect'); touch(); s.close(); ui.openFx(i, slot); } }, U.icon('undo', 16), 'Reset all')));
  let defs = T.params;
  if (f.type === 'eq') {
    const eqUi = eqEditor(i, slot, f);
    body.appendChild(eqUi.el); stopViz = eqUi.stop;
    defs = T.params.filter(d => d.id === 'out');
  } else if (f.type === 'comp' || f.type === 'limiter') {
    const bar = h('div', { style: { height: '.5rem', background: 'var(--bg0)', borderRadius: '4px', overflow: 'hidden', margin: '.4rem 0 .8rem' } }, h('div', { style: { height: '100%', background: 'var(--acc)', width: '0%', transformOrigin: 'left' } }));
    body.appendChild(h('div.tl', 'Gain reduction')); body.appendChild(bar);
    let run = true;
    const loop = () => {
      if (!run) return;
      const g = DAW.audio.graph, sl = g && g.tracks.get(i) && g.tracks.get(i).slots[slot];
      const gr = sl && sl.inst.comp ? -sl.inst.comp.reduction : 0;
      bar.firstChild.style.width = U.clamp(gr / 24, 0, 1) * 100 + '%';
      requestAnimationFrame(loop);
    };
    loop(); stopViz = () => { run = false; };
  } else if (f.type === 'analyzer') {
    const v = analyzerView(i, slot, f); body.appendChild(v.el); stopViz = v.stop;
  } else if (f.type === 'shaper') {
    const v = shaperView(f, i, touch); body.appendChild(v);
    defs = T.params.filter(d => !/^s\d+$/.test(d.id));
  }
  body.appendChild(ui.paramGrid(defs, f.p, (id, v, commit) => { touch(); if (commit) S.commit('Edit ' + T.label); }, d => (d.type === 'knob' ? 'fx:' + i + ':' + slot + ':' + d.id : null)));
};

/* interactive EQ response graph */
function eqEditor(i, slot, f) {
  const cv = h('canvas.eq-view');
  const wrap = h('div', cv);
  let sel = 3, run = true;
  const fmin = 20, fmax = 20000, X = (fr, w) => Math.log(fr / fmin) / Math.log(fmax / fmin) * w, Fx = (x, w) => fmin * Math.pow(fmax / fmin, x / w);
  const Y = (db, hh) => hh / 2 - db / 18 * (hh / 2 - 10);
  const knobs = h('div.pgrid');
  const drawKnobs = () => {
    U.clear(knobs);
    ['f', 'g', 'q'].forEach(p => {
      const d = FX.types.eq.params.find(x => x.id === p + sel);
      knobs.appendChild(ui.knob({ def: Object.assign({}, d, { label: d.label }), value: f.p[d.id], path: 'fx:' + i + ':' + slot + ':' + d.id, onInput: v => { f.p[d.id] = v; S.emit('fx', i); }, onChange: () => S.commit('EQ edit') }));
    });
  };
  const chips = h('div.row', { style: { margin: '.4rem 0' } }, FX.EQ_BANDS.map((_, b) => h('button.chip', { dataset: { b }, onclick: () => { sel = b; mark(); drawKnobs(); } }, 'Band ' + (b + 1))));
  const mark = () => U.$$('.chip', chips).forEach(c => c.classList.toggle('on', Number(c.dataset.b) === sel));
  mark(); drawKnobs();
  wrap.append(chips, knobs);
  const draw = () => {
    if (!run) return;
    const w = cv.clientWidth, hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) { requestAnimationFrame(draw); return; }
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    g.strokeStyle = '#262d3b'; g.lineWidth = 1; g.fillStyle = '#646e84'; g.font = '10px sans-serif';
    [100, 1000, 10000].forEach(fr => { const x = X(fr, w); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); g.fillText(fr >= 1000 ? fr / 1000 + 'k' : fr, x + 3, hh - 4); });
    [-12, -6, 0, 6, 12].forEach(db => { const y = Y(db, hh); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.fillText(db + '', 3, y - 2); });
    const gr = DAW.audio.graph, sl = gr && gr.tracks.get(i) && gr.tracks.get(i).slots[slot], inst = sl && sl.inst;
    if (inst && inst.analyser) {
      const an = inst.analyser, buf = new Uint8Array(an.frequencyBinCount), sr = an.context.sampleRate;
      an.getByteFrequencyData(buf);
      g.fillStyle = 'rgba(55,214,197,.22)'; g.beginPath(); g.moveTo(0, hh);
      for (let x = 0; x < w; x += 2) { const fr = Fx(x, w), bin = Math.min(buf.length - 1, Math.round(fr / (sr / 2) * buf.length)); g.lineTo(x, hh - buf[bin] / 255 * (hh - 14)); }
      g.lineTo(w, hh); g.fill();
    }
    if (inst && inst.bands) {
      const N = Math.floor(w / 2), fr = new Float32Array(N), mag = new Float32Array(N), ph = new Float32Array(N), tot = new Float32Array(N).fill(1);
      for (let x = 0; x < N; x++) fr[x] = Fx(x * 2, w);
      inst.bands.forEach(b => { b.getFrequencyResponse(fr, mag, ph); for (let x = 0; x < N; x++) tot[x] *= mag[x]; });
      g.strokeStyle = '#ff8a3d'; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x < N; x++) { const db = 20 * Math.log10(Math.max(tot[x], 1e-4)), y = Y(U.clamp(db, -24, 24), hh); if (x) g.lineTo(x * 2, y); else g.moveTo(0, y); }
      g.stroke();
    }
    FX.EQ_BANDS.forEach((_, b) => {
      const x = X(f.p['f' + b], w), y = Y(f.p['g' + b], hh);
      g.fillStyle = b === sel ? '#ff8a3d' : '#dde2ee'; g.beginPath(); g.arc(x, y, b === sel ? 9 : 7, 0, 7); g.fill();
      g.fillStyle = '#10131a'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center'; g.fillText(b + 1, x, y + 3.5); g.textAlign = 'left';
    });
    requestAnimationFrame(draw);
  };
  let dragB = -1;
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bd = 34;
    FX.EQ_BANDS.forEach((_, b) => { const d = Math.hypot(X(f.p['f' + b], r.width) - x, Y(f.p['g' + b], r.height) - y); if (d < bd) { bd = d; best = b; } });
    if (best >= 0) { dragB = best; sel = best; mark(); drawKnobs(); cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', e => {
    if (dragB < 0) return;
    const r = cv.getBoundingClientRect(), x = U.clamp(e.clientX - r.left, 0, r.width), y = U.clamp(e.clientY - r.top, 0, r.height);
    f.p['f' + dragB] = U.clamp(Fx(x, r.width), 20, 20000);
    f.p['g' + dragB] = U.clamp((r.height / 2 - y) / (r.height / 2 - 10) * 18, -18, 18);
    S.emit('fx', i); drawKnobs();
  });
  const up = () => { if (dragB >= 0) { dragB = -1; S.commit('EQ edit'); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => { e.preventDefault(); const d = FX.types.eq.params.find(x => x.id === 'q' + sel); f.p['q' + sel] = U.clamp(f.p['q' + sel] * (e.deltaY > 0 ? 0.92 : 1.08), d.min, d.max); S.emit('fx', i); drawKnobs(); }, { passive: false });
  DAW.audio.ensure().then(() => requestAnimationFrame(draw));
  return { el: wrap, stop: () => { run = false; } };
}

function analyzerView(i, slot, f) {
  const cv = h('canvas.eq-view');
  let run = true;
  const draw = () => {
    if (!run) return;
    const w = cv.clientWidth, hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const gr = DAW.audio.graph, sl = gr && gr.tracks.get(i) && gr.tracks.get(i).slots[slot], an = sl && sl.inst.analyser;
    if (an) {
      g.strokeStyle = '#37d6c5'; g.fillStyle = 'rgba(55,214,197,.25)'; g.lineWidth = 2;
      if (f.p.mode === 'scope') {
        const b = new Float32Array(an.fftSize); an.getFloatTimeDomainData(b);
        g.beginPath(); for (let x = 0; x < w; x++) { const v = b[Math.floor(x / w * b.length)]; const y = hh / 2 - v * hh / 2; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      } else {
        const b = new Uint8Array(an.frequencyBinCount); an.getByteFrequencyData(b);
        const sr = an.context.sampleRate;
        if (f.p.mode === 'bars') {
          const nb = 32;
          for (let k = 0; k < nb; k++) { const fa = 30 * Math.pow(18000 / 30, k / nb), fb = 30 * Math.pow(18000 / 30, (k + 1) / nb); let m = 0; for (let j = Math.floor(fa / (sr / 2) * b.length); j <= Math.ceil(fb / (sr / 2) * b.length); j++) m = Math.max(m, b[j] || 0); g.fillStyle = '#37d6c5'; g.fillRect(k * w / nb + 1, hh - m / 255 * hh, w / nb - 2, m / 255 * hh); }
        } else {
          g.beginPath(); g.moveTo(0, hh);
          for (let x = 0; x < w; x += 2) { const fr = 20 * Math.pow(1000, x / w), bin = Math.min(b.length - 1, Math.round(fr / (sr / 2) * b.length)); g.lineTo(x, hh - b[bin] / 255 * hh); }
          g.lineTo(w, hh); g.fill(); g.stroke();
        }
      }
    }
    requestAnimationFrame(draw);
  };
  DAW.audio.ensure().then(() => requestAnimationFrame(draw));
  return { el: cv, stop: () => { run = false; } };
}

function shaperView(f, i, touch) {
  const cv = h('canvas.eq-view', { style: { height: '9rem' } });
  const n = 16;
  const draw = () => {
    const w = cv.clientWidth, hh = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) { setTimeout(draw, 30); return; }
    cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hh);
    const bw = w / n;
    for (let k = 0; k < n; k++) {
      const v = f.p['s' + (k + 1)];
      g.fillStyle = k % 4 === 0 ? '#ff8a3d' : '#d77a40'; g.globalAlpha = 0.9;
      g.fillRect(k * bw + 2, hh - v * (hh - 4) - 2, bw - 4, v * (hh - 4));
      g.globalAlpha = 1;
    }
  };
  const set = e => {
    const r = cv.getBoundingClientRect(), k = U.clamp(Math.floor((e.clientX - r.left) / r.width * n), 0, n - 1);
    f.p['s' + (k + 1)] = U.clamp(1 - (e.clientY - r.top) / r.height, 0, 1); draw(); touch();
  };
  let down = false;
  cv.addEventListener('pointerdown', e => { down = true; cv.setPointerCapture(e.pointerId); set(e); });
  cv.addEventListener('pointermove', e => { if (down) set(e); });
  const up = () => { if (down) { down = false; S.commit('Volume shaper'); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  setTimeout(draw, 30);
  return h('div', h('div.tl', 'Draw the 16 steps — 100% = full volume, 0% = silence'), cv);
}

view.show = () => { render(); };
view.tick = () => {};
view.build = () => {
  root = U.$('#v-mixer');
  stripsEl = h('div.mx-strips');
  detailEl = h('div.mx-detail');
  root.append(h('div.mx', stripsEl, detailEl));
  const rerender = () => { if (ui.cur === 'mixer') render(); };
  ['project', 'restore', 'mixer', 'channels'].forEach(e => S.on(e, rerender));
  S.on('fx', i => { if (ui.cur === 'mixer') { refreshDots(i); if (S.ui.track === i && tabName === 'fx') renderDetail(); } });
  S.on('track', i => {
    const s = strips.get(i), t = S.p.mixer.tracks[i];
    if (!s || !t) return;
    s.fader.set(t.vol); s.db.textContent = U.fmtDb(U.faderToGain(t.vol)); s.pan.set(t.pan);
    s.mBtn.classList.toggle('on', t.mute); s.sBtn.classList.toggle('on', t.solo);
  });
  /* meters */
  ui.meterLoop([dt => {
    if (ui.cur !== 'mixer' || !DAW.audio.graph) return;
    const g = DAW.audio.graph, lo = stripsEl.scrollLeft - 80, hi = lo + stripsEl.clientWidth + 160;
    strips.forEach((s, i) => {
      if (s.el.offsetLeft + s.el.offsetWidth < lo || s.el.offsetLeft > hi) return;
      const tn = g.tracks.get(i); if (!tn) return;
      const [l, r] = tn.peak();
      s.meter.update(l, r, dt);
    });
  }]);
};
})();
