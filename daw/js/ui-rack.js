'use strict';
/* Beatforge — Channel rack: step sequencer, channel menu, add-channel flow, note property editor. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq;

/* ---------- shared: note property editor ---------- */
const NOTE_PROPS = [
  { id: 'v', label: 'Velocity', min: 1, max: 127, def: 100, step: 1, unit: 'int' },
  { id: 'pan', label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan' },
  { id: 'rel', label: 'Release', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'fine', label: 'Fine pitch', min: -100, max: 100, def: 0, step: 1, unit: 'ct' },
  { id: 'mx', label: 'Mod X (cutoff)', min: 0, max: 1, def: 0.5, unit: '%' },
  { id: 'my', label: 'Mod Y (resonance)', min: 0, max: 1, def: 0.5, unit: '%' },
];
ui.NOTE_PROPS = NOTE_PROPS;
ui.noteProps = (notes, onChange, title) => {
  const body = h('div.dialog');
  const first = notes[0];
  const grid = h('div.pgrid');
  NOTE_PROPS.forEach(d => {
    grid.appendChild(ui.knob({
      def: d, value: first[d.id] == null ? d.def : first[d.id],
      onInput: v => notes.forEach(n => { n[d.id] = d.step ? Math.round(v) : v; }),
      onChange: () => { onChange(); },
    }));
  });
  body.appendChild(grid);
  body.appendChild(ui.toggle('Slide into this note', !!first.sl, v => { notes.forEach(n => { n.sl = v ? 1 : 0; }); onChange(); }));
  body.appendChild(h('div.row',
    ui.select('Key', Array.from({ length: 128 }, (_, k) => ({ v: k, l: U.noteName(k) })).reverse(), first.k, v => { const dk = Number(v) - first.k; notes.forEach(n => { n.k = U.clamp(n.k + dk, 0, 127); }); onChange(); }),
  ));
  return ui.sheet({ title: title || (notes.length > 1 ? notes.length + ' notes' : 'Note ' + U.noteName(first.k)), content: body, cls: 'small' });
};

/* ---------- pick mixer track ---------- */
ui.pickTrack = (cur, title) => new Promise(res => {
  const body = h('div.pgrid', { style: { gridTemplateColumns: 'repeat(auto-fill,minmax(4.2rem,1fr))' } });
  let out = null;
  S.p.mixer.tracks.forEach((t, i) => body.appendChild(h('button.chip' + (i === cur ? '.on' : ''), { style: { justifyContent: 'center', height: '2.8rem', borderRadius: '10px', borderLeft: t.col ? '4px solid ' + t.col : '' }, onclick: () => { out = i; s.close(); } }, i === 0 ? 'M' : String(i))));
  const s = ui.sheet({ title: title || 'Mixer track', content: body, onClose: () => res(out) });
});

/* ---------- add channel ---------- */
ui.addChannelSheet = () => {
  const T = DAW.inst.types;
  const opts = [
    ['sampler', 'Sampler', 'Play any sample, chromatically or as a one-shot.', 'wave'],
    ['synth', 'Synth', 'Three oscillators, filter, envelopes, two LFOs. 14 presets.', 'keys'],
    ['fm', 'FM synth', 'Three-operator FM with five algorithms.', 'bolt'],
    ['pluck', 'Pluck', 'Karplus–Strong plucked string.', 'wave'],
    ['drum', 'Drum synth', 'Kick, snare, clap, hats, tom, rim, cowbell, FM perc.', 'knob'],
    ['layer', 'Layer', 'Trigger several channels from one.', 'link'],
    ['audio', 'Audio clip', 'Place a recording or loop in the playlist.', 'mic'],
    ['auto', 'Automation clip', 'Draw movement for any knob.', 'graph'],
  ];
  const body = h('div.menu-list');
  const s = ui.sheet({ title: 'Add channel', content: body });
  opts.forEach(([type, name, desc, icon]) => body.appendChild(h('button.br-item', { onclick: async () => { s.close(); await ui.addChannel(type); } }, h('span.bi-ic', U.icon(icon, 18)), h('span.bi-t', h('b', name), h('small', desc)))));
};
ui.addChannel = async (type, o) => {
  o = o || {};
  if (type === 'sampler' || type === 'audio') {
    const id = o.sample || await ui.pickSample();
    if (!id) return null;
    const ch = S.addChannel(type, { name: DAW.samples.name(id), sample: id });
    S.commit('Add channel'); await DAW.samples.preload(S.p); return ch;
  }
  if (type === 'synth' || type === 'fm') {
    const presets = type === 'synth' ? DAW.inst.synthPresets : DAW.inst.fmPresets;
    const name = o.preset || await new Promise(res => {
      const body = h('div.menu-list'); let out = null;
      Object.keys(presets).forEach(n => body.appendChild(h('button.br-item', { onclick: () => { out = n; s2.close(); } }, h('span.bi-ic', U.icon('keys', 18)), h('span.bi-t', h('b', n)))));
      const s2 = ui.sheet({ title: 'Choose a preset', content: body, onClose: () => res(out) });
    });
    if (!name) return null;
    const ch = S.addChannel(type, { name: name === 'Init saw' || name === 'E-piano' ? DAW.inst.types[type].label : name, p: presets[name] });
    S.commit('Add channel'); return ch;
  }
  if (type === 'auto') {
    ui.toast('Press and hold any knob, then choose "Create automation clip".', 4000);
    return null;
  }
  const ch = S.addChannel(type);
  S.commit('Add channel');
  return ch;
};

/* ---------- channel menu ---------- */
ui.channelMenu = ch => {
  const pat = S.curPat();
  const stepsN = S.stepsPerBar() * pat.bars;
  const T = DAW.inst.types[ch.type];
  ui.menu([
    { label: 'Channel settings', icon: 'gear', onClick: () => ui.openChannel(ch.id) },
    T.melodic || ch.type === 'sampler' || ch.type === 'drum' ? { label: 'Open in piano roll', icon: 'piano', onClick: () => { S.ui.ch = ch.id; S.emit('select'); ui.show('piano'); } } : null,
    { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await ui.prompt('Rename channel', ch.name); if (n) { ch.name = n; S.commit('Rename channel'); S.emit('channels'); } } },
    { label: 'Colour', icon: 'paint', onClick: async () => { const c = await ui.pickColor(ch.color); if (c) { ch.color = c; S.commit('Channel colour'); S.emit('channels'); } } },
    { label: 'Mixer track: ' + (ch.mix === 0 ? 'Master' : ch.mix), icon: 'route', onClick: async () => { const t = await ui.pickTrack(ch.mix, 'Route "' + ch.name + '" to'); if (t != null) { ch.mix = t; S.commit('Route channel'); S.emit('channel', ch.id); S.emit('channels'); } } },
    { sep: true, label: 'Steps' },
    { label: 'Fill every 2nd step', icon: 'rack', onClick: () => { for (let i = 0; i < stepsN; i++) if (S.stepOn(pat, ch.id, i).length === 0 && i % 2 === 0) S.toggleStep(pat, ch.id, i); S.commit('Fill steps'); S.emit('notes', pat.id, ch.id); } },
    { label: 'Fill every 4th step', icon: 'rack', onClick: () => { for (let i = 0; i < stepsN; i++) if (S.stepOn(pat, ch.id, i).length === 0 && i % 4 === 0) S.toggleStep(pat, ch.id, i); S.commit('Fill steps'); S.emit('notes', pat.id, ch.id); } },
    { label: 'Shift steps left', icon: 'left', onClick: () => shift(ch, pat, -1) },
    { label: 'Shift steps right', icon: 'right', onClick: () => shift(ch, pat, 1) },
    { label: 'Clear steps and notes', icon: 'eraser', onClick: () => { delete pat.notes[ch.id]; S.commit('Clear channel'); S.emit('notes', pat.id, ch.id); } },
    { sep: true },
    { label: 'Clone', icon: 'copy', onClick: () => { S.cloneChannel(ch.id); S.commit('Clone channel'); } },
    { label: 'Move up', icon: 'up', onClick: () => { S.moveChannel(ch.id, -1); S.commit('Move channel'); } },
    { label: 'Move down', icon: 'down', onClick: () => { S.moveChannel(ch.id, 1); S.commit('Move channel'); } },
    { label: 'Delete channel', icon: 'trash', danger: true, onClick: async () => { if (!DAW.settings.get('confirmDelete') || await ui.confirm('Delete "' + ch.name + '" and all of its notes?', 'Delete', true)) { S.removeChannel(ch.id); S.commit('Delete channel'); } } },
  ], { title: ch.name });
};
function shift(ch, pat, dir) {
  const L = S.patLenTicks(pat);
  (pat.notes[ch.id] || []).forEach(n => { n.t = ((n.t + dir * C.STEP) % L + L) % L; });
  S.commit('Shift steps'); S.emit('notes', pat.id, ch.id);
}
ui.randomizeSteps = () => {
  const pat = S.curPat(), n = S.stepsPerBar() * pat.bars;
  S.p.channels.forEach((ch, idx) => {
    if (!DAW.inst.types[ch.type].play || DAW.inst.types[ch.type].melodic) return;
    pat.notes[ch.id] = [];
    const dens = [0.28, 0.2, 0.5, 0.18, 0.1][idx % 5];
    for (let i = 0; i < n; i++) if (Math.random() < dens || (idx === 0 && i % 4 === 0)) S.toggleStep(pat, ch.id, i, 70 + Math.floor(Math.random() * 50));
  });
  S.commit('Randomize steps'); S.emit('notes', pat.id);
};

/* ---------- rack view ---------- */
const view = { };
ui.registerView('rack', view);

let root, scrollEl, content, rowsEl, playhead, patBtn;
let paintMode = false;
let holdTimer = 0;

function stepCount() { const pat = S.curPat(); return Math.round(S.stepsPerBar() * pat.bars); }

function previewChannel(ch) {
  if (!DAW.inst.types[ch.type].play && ch.type !== 'layer') return;
  const k = ch.type === 'sampler' ? C.STEP_KEY : 60;
  DAW.audio.noteOn(ch.id, k, 100).then(h2 => { if (h2) setTimeout(() => h2.off(), 260); });
}

function buildRow(ch, pat, n) {
  const T = DAW.inst.types[ch.type];
  const row = h('div.ch-row' + (S.ui.ch === ch.id ? '.sel' : ''), { dataset: { ch: ch.id }, style: { '--cc': ch.color } });
  const name = h('button.ch-name' + (ch.mute ? '.muted' : ''), { 'aria-label': ch.name }, h('i'), h('span', ch.name));
  U.drag(name, {
    up: (e, st) => {
      if (st.held) return;
      S.ui.ch = ch.id; S.emit('select'); previewChannel(ch);
    },
    hold: () => { DAW.haptic(15); ui.channelMenu(ch); },
    holdMs: DAW.settings.get('longPressMs'),
  });
  const head = h('div.ch-head', name, h('div.ch-btns',
    h('button.sbtn.m' + (ch.mute ? '.on' : ''), { 'aria-label': 'Mute', 'aria-pressed': String(ch.mute), onclick: () => { ch.mute = !ch.mute; S.commit('Mute'); S.emit('channel', ch.id); S.emit('channels-light'); render(); } }, 'M'),
    h('button.sbtn.s' + (ch.solo ? '.on' : ''), { 'aria-label': 'Solo', 'aria-pressed': String(ch.solo), onclick: () => { ch.solo = !ch.solo; S.commit('Solo'); S.p.channels.forEach(c => S.emit('channel', c.id)); render(); } }, 'S'),
    h('button.sbtn', { 'aria-label': 'Channel settings', onclick: () => ui.openChannel(ch.id) }, U.icon('gear', 16)),
    T.melodic ? h('button.sbtn', { 'aria-label': 'Piano roll', onclick: () => { S.ui.ch = ch.id; S.emit('select'); ui.show('piano'); } }, U.icon('piano', 16)) : null));
  row.appendChild(head);
  if (T.noPlay) {
    row.appendChild(h('div.steps', { style: { alignItems: 'center', color: 'var(--tx3)', paddingLeft: '.8rem', fontSize: '.82rem' } },
      ch.type === 'audio' ? 'Audio clip — place it in the Playlist' : ch.type === 'layer' ? ch.children.length + ' channel(s) layered — open settings to choose' : 'Automation'));
    return row;
  }
  const steps = h('div.steps', { dataset: { ch: ch.id } });
  const spb = S.stepsPerBar();
  for (let i = 0; i < n; i++) steps.appendChild(h('div.step' + (Math.floor(i / 4) % 2 ? '.g1' : ''), { dataset: { i }, role: 'button', 'aria-label': 'Step ' + (i + 1) }));
  row.appendChild(steps);
  paintRow(steps, ch, pat);
  void spb;
  return row;
}
function paintRow(steps, ch, pat) {
  const on = new Map();
  S.notesOf(pat, ch.id).forEach(nt => { const i = Math.floor(nt.t / C.STEP); const cur = on.get(i); if (!cur || nt.v > cur) on.set(i, nt.v); });
  Array.from(steps.children).forEach((el, i) => {
    const v = on.get(i);
    el.classList.toggle('on', v != null);
    if (v != null) el.style.setProperty('--vel', Math.round(v / 127 * 100) + '%'); else el.style.removeProperty('--vel');
  });
}

function wireSteps() {
  let drag = null;
  const stepAt = (x, y) => { const e = document.elementFromPoint(x, y); const s = e && e.closest('.step'); return s ? { el: s, ch: Number(s.parentElement.dataset.ch), i: Number(s.dataset.i) } : null; };
  const apply = (t, add) => {
    const ch = S.getCh(t.ch), pat = S.curPat();
    const has = S.stepOn(pat, t.ch, t.i).length > 0;
    if (add && !has) { S.toggleStep(pat, t.ch, t.i, DAW.settings.get('prDefVel')); } else if (!add && has) S.toggleStep(pat, t.ch, t.i);
    else return;
    paintRow(t.el.parentElement, ch, pat);
    DAW.haptic(5);
  };
  rowsEl.addEventListener('pointerdown', e => {
    const t = stepAt(e.clientX, e.clientY);
    if (!t) return;
    const pat = S.curPat();
    drag = { t, x: e.clientX, y: e.clientY, id: e.pointerId, paint: e.pointerType === 'mouse' || paintMode, add: S.stepOn(pat, t.ch, t.i).length === 0, moved: false, held: false, last: t, touch: e.pointerType !== 'mouse' };
    if (drag.paint && DAW.settings.get('stepPaint')) { apply(t, drag.add); drag.did = true; try { rowsEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (!drag || drag.moved) return;
      drag.held = true; DAW.haptic(18);
      if (S.stepOn(pat, t.ch, t.i).length === 0 && !drag.paint) { // enter paint mode from a long press on touch
        drag.paint = DAW.settings.get('stepPaint'); drag.did = true; apply(t, true); drag.add = true;
      }
    }, 420);
  });
  rowsEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) drag.moved = true;
    if (drag.paint && drag.moved) {
      const t = stepAt(e.clientX, e.clientY);
      if (t && (t.el !== drag.last.el)) { drag.last = t; apply(t, drag.add); }
    }
  });
  rowsEl.addEventListener('touchmove', e => { if (drag && drag.paint && drag.held) e.preventDefault(); }, { passive: false });
  const end = e => {
    clearTimeout(holdTimer);
    if (!drag || (e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    const pat = S.curPat();
    if (e.type === 'pointercancel') { if (d.did) { S.commit('Paint steps'); S.emit('notes', pat.id, d.t.ch); } return; }
    if (d.did) { S.commit('Paint steps'); S.emit('notes', pat.id, d.t.ch); return; }
    if (d.moved) return;
    const ch = S.getCh(d.t.ch);
    if (d.held) {
      const notes = S.stepOn(pat, d.t.ch, d.t.i);
      if (notes.length) ui.noteProps(notes, () => { S.commit('Edit step'); paintRow(d.t.el.parentElement, ch, pat); S.emit('notes', pat.id, ch.id); }, ch.name + ' · step ' + (d.t.i + 1));
      return;
    }
    S.ui.ch = ch.id;
    apply(d.t, d.add);
    S.commit('Toggle step'); S.emit('notes', pat.id, ch.id);
    if (d.add && DAW.settings.get('prPreview')) previewChannel(ch);
  };
  rowsEl.addEventListener('pointerup', end);
  rowsEl.addEventListener('pointercancel', end);
}

function render() {
  if (!root) return;
  const pat = S.curPat(), n = stepCount(), spb = S.stepsPerBar();
  patBtn.replaceChildren(h('i', { style: { width: '.7rem', height: '.7rem', borderRadius: '3px', background: pat.color, display: 'block' } }), pat.name, U.icon('chevD', 14));
  U.clear(rowsEl);
  const ruler = h('div.ruler-row', h('div.corner'), h('div.rul', Array.from({ length: n }, (_, i) => h('div.rul-c' + (i % 4 === 0 ? '.beat' : ''), { style: { width: 'calc(2.4rem + 3px)' } }, i % spb === 0 ? 'Bar ' + (i / spb + 1) : (i % 4 === 0 ? String(i % spb / 4 + 1) : '')))),
    h('button.chip', { style: { position: 'sticky', right: '.4rem', alignSelf: 'center', marginLeft: '.5rem', height: '1.6rem', flex: 'none' }, onclick: () => { pat.bars++; S.commit('Add bar'); S.emit('pattern'); } }, U.icon('plus', 12), 'bar'));
  rowsEl.appendChild(ruler);
  if (!S.p.channels.length) rowsEl.appendChild(ui.empty('rack', 'No channels', 'Tap “Add channel” to get started.'));
  S.p.channels.forEach(ch => rowsEl.appendChild(buildRow(ch, pat, n)));
  rowsEl.appendChild(h('div.rack-end', h('button.btn.primary', { onclick: ui.addChannelSheet }, U.icon('plus', 18), 'Add channel'),
    pat.bars > 1 ? h('button.btn', { onclick: () => { pat.bars = Math.max(1, pat.bars - 1); S.commit('Remove bar'); S.emit('pattern'); } }, U.icon('minus', 18), 'Remove bar') : null));
}

view.show = () => render();
view.hide = () => {};
view.tick = pos => {
  if (!root) return;
  const first = rowsEl.querySelector('.step');
  if (!first || !seq.playing || pos < 0) { playhead.style.opacity = 0; return; }
  const n = stepCount();
  let sp = pos / C.STEP;
  if (S.p.mode === 'song') { playhead.style.opacity = 0; return; }
  sp = ((sp % n) + n) % n;
  const w = first.offsetWidth + 3, x = first.offsetLeft + sp * w;
  playhead.style.opacity = 1;
  playhead.style.transform = `translateX(${x}px)`;
  if (DAW.settings.get('followPlayhead') !== 'off') {
    const vis = scrollEl.scrollLeft + scrollEl.clientWidth, head = 150;
    if (x > vis - 20 || x < scrollEl.scrollLeft + head) scrollEl.scrollLeft = Math.max(0, x - head - 10);
  }
};

view.build = () => {
  root = U.$('#v-rack');
  patBtn = h('button.chip', { 'aria-label': 'Pattern', onclick: ui.patternPicker });
  const paintBtn = h('button.chip', { 'aria-label': 'Paint mode', onclick: () => { paintMode = !paintMode; paintBtn.classList.toggle('on', paintMode); rowsEl.classList.toggle('paintmode', paintMode); } }, U.icon('paint', 16), 'Paint');
  const sub = h('div.subbar', patBtn,
    h('button.chip', { onclick: () => { S.addPattern(); S.commit('New pattern'); } }, U.icon('plus', 14), 'Pattern'),
    paintBtn,
    h('button.chip', { onclick: ui.addChannelSheet }, U.icon('plus', 14), 'Channel'),
    h('button.chip', { 'aria-label': 'Pattern options', onclick: () => ui.patternMenu(S.curPat(), render) }, U.icon('dots', 16)));
  rowsEl = h('div');
  playhead = h('div.playhead-line');
  content = h('div.rack-content', playhead, rowsEl);
  scrollEl = h('div.rack', content);
  root.append(sub, scrollEl);
  wireSteps();
  const rerender = () => { if (ui.cur === 'rack') render(); };
  ['project', 'restore', 'channels', 'pattern', 'tempo'].forEach(e => S.on(e, rerender));
  S.on('select', () => { U.$$('.ch-row', rowsEl).forEach(r => r.classList.toggle('sel', Number(r.dataset.ch) === S.ui.ch)); });
  S.on('notes', (pid, chId) => {
    if (ui.cur !== 'rack' || pid !== S.ui.pat) return;
    const pat = S.curPat();
    const rows = chId == null ? U.$$('.steps[data-ch]', rowsEl) : U.$$('.steps[data-ch="' + chId + '"]', rowsEl);
    rows.forEach(st => paintRow(st, S.getCh(Number(st.dataset.ch)), pat));
  });
  render();
};
})();
