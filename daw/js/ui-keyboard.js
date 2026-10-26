'use strict';
/* Beatforge — on-screen piano, computer-keyboard piano and Web MIDI input. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq, st = DAW.settings;

const K = ui.kb = { open: false, base: 48, octs: 2, hold: false, chord: null, held: new Map(), sustain: false };
ui.kbdOpen = false;

const targetCh = () => S.curCh();
function down(id, k, vel) {
  const c = targetCh(); if (!c) return;
  const ks = K.chord ? C.CHORDS[K.chord].map(i => k + i).filter(x => x <= 127) : [k];
  const entries = [];
  ks.forEach(kk => {
    DAW.audio.noteOn(c.id, kk, vel).then(hd => { entry.hds.push(hd); if (entry.released && hd) hd.off(); });
    seq.recNoteOn(c.id, kk, vel);
    entries.push(kk);
  });
  const entry = { c: c.id, ks: entries, hds: [], released: false };
  K.held.set(id, entry);
  S.emit('kb-down', k);
}
function up(id) {
  const e = K.held.get(id); if (!e) return;
  K.held.delete(id);
  if (K.sustain) { (K.sus = K.sus || []).push(e); return; }
  release(e);
}
function release(e) { e.released = true; e.hds.forEach(hd => hd && hd.off()); e.ks.forEach(kk => seq.recNoteOff(e.c, kk)); S.emit('kb-up'); }
K.releaseAll = () => { Array.from(K.held.keys()).forEach(up); (K.sus || []).forEach(release); K.sus = []; };
K.setSustain = on => { K.sustain = on; if (!on) { (K.sus || []).forEach(release); K.sus = []; } };
const curve = v => { const c = st.get('midiVelCurve'); if (c === 'fixed') return 100; const n = v / 127; return Math.max(1, Math.round(127 * (c === 'soft' ? Math.sqrt(n) : c === 'hard' ? n * n : n))); };

/* ---------- on-screen keyboard ---------- */
let el, cv, chipCh;
function layout() {
  const w = cv.clientWidth, hh = cv.clientHeight;
  const whites = []; for (let k = K.base; whites.length < 7 * K.octs + 1; k++) if (!U.isBlack(k)) whites.push(k);
  const ww = w / whites.length;
  return { w, hh, whites, ww, bh: hh * 0.62, bw: ww * 0.62 };
}
function keyAtPoint(x, y) {
  const L = layout();
  const xi = Math.floor(x / L.ww), wk = L.whites[xi];
  if (wk == null) return null;
  // check black neighbours first
  if (y < L.bh) {
    for (const k of [wk - 1, wk + 1]) {
      if (k >= 0 && k < 128 && U.isBlack(k)) {
        const wi = L.whites.indexOf(k === wk - 1 ? wk : wk), bx = k === wk - 1 ? xi * L.ww - L.bw / 2 : (xi + 1) * L.ww - L.bw / 2;
        void wi;
        if (x >= bx && x <= bx + L.bw) return k;
      }
    }
  }
  const vel = st.get('kbVelFromY') ? Math.round(U.clamp(30 + (y / L.hh) * 110, 30, 127)) : 100;
  return { k: wk, vel };
}
function draw() {
  if (!K.open) return;
  const dpr = window.devicePixelRatio || 1, L = layout();
  if (!L.w) { requestAnimationFrame(draw); return; }
  if (cv.width !== Math.round(L.w * dpr)) { cv.width = Math.round(L.w * dpr); cv.height = Math.round(L.hh * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, L.w, L.hh);
  const held = new Set(); K.held.forEach(e => e.ks.forEach(k => held.add(k)));
  const lab = st.get('kbLabels'), scaleHL = st.get('prScaleHL');
  const root = st.get('prScaleRoot'), sc = C.SCALES[st.get('prScaleName')] || [];
  L.whites.forEach((k, i) => {
    const x = i * L.ww, on = held.has(k);
    g.fillStyle = on ? '#ff8a3d' : '#e8ecf4'; g.fillRect(x + 1, 0, L.ww - 2, L.hh - 1);
    if (scaleHL && !on) { const inS = sc.includes((((k - root) % 12) + 12) % 12); if (!inS) { g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 1, 0, L.ww - 2, L.hh - 1); } }
    if (lab === 'all' || (lab === 'c' && k % 12 === 0)) { g.fillStyle = '#4a5266'; g.font = '600 11px sans-serif'; g.textAlign = 'center'; g.fillText(U.noteName(k), x + L.ww / 2, L.hh - 8); }
  });
  L.whites.forEach((k, i) => {
    if (k + 1 < 128 && U.isBlack(k + 1) && i < L.whites.length - 1) {
      const x = (i + 1) * L.ww - L.bw / 2, on = held.has(k + 1);
      g.fillStyle = on ? '#ff8a3d' : '#161a22'; g.fillRect(x, 0, L.bw, L.bh);
      g.fillStyle = on ? '#ffb06f' : '#2a3141'; g.fillRect(x + 2, 0, L.bw - 4, L.bh - 6);
    }
  });
  requestAnimationFrame(draw);
}
ui.toggleKeyboard = () => {
  K.open = !K.open; ui.kbdOpen = K.open;
  el.hidden = !K.open;
  U.$('#fab-keys').classList.toggle('on', K.open);
  if (K.open) { requestAnimationFrame(draw); DAW.audio.ensure(); } else K.releaseAll();
};

ui.buildKeyboard = () => {
  chipCh = h('button.chip', { onclick: () => { ui.show('piano'); } }, '');
  const chordChip = h('button.chip', { onclick: () => ui.menu([{ label: 'Single notes', checked: !K.chord, onClick: () => { K.chord = null; chordChip.classList.remove('on'); chordChip.lastChild.textContent = 'Chords'; } }, ...Object.keys(C.CHORDS).map(n => ({ label: n, checked: K.chord === n, onClick: () => { K.chord = n; chordChip.classList.add('on'); chordChip.lastChild.textContent = n; } }))], { title: 'One-finger chords' }) }, U.icon('note', 16), 'Chords');
  const octChip = h('button.chip', { onclick: () => { K.octs = K.octs === 2 ? 3 : K.octs === 3 ? 1 : 2; octChip.textContent = K.octs + ' oct'; } }, K.octs + ' oct');
  const refresh = () => { const c = targetCh(); chipCh.replaceChildren(h('i', { style: { width: '.7rem', height: '.7rem', borderRadius: '3px', background: c ? c.color : '#555', display: 'block' } }), c ? c.name : 'No channel'); };
  cv = h('canvas');
  el = h('div.kbd', { hidden: true },
    h('div.kbd-bar', ui.ibtn('chevL', 'Octave down', () => { K.base = Math.max(0, K.base - 12); }), h('span.tl', 'Octave'), ui.ibtn('chevR', 'Octave up', () => { K.base = Math.min(96, K.base + 12); }),
      chipCh,
      chordChip,
      h('button.chip', { onclick: e => { K.hold = !K.hold; e.currentTarget.classList.toggle('on', K.hold); K.setSustain(K.hold); } }, 'Hold'),
      octChip,
      h('div.spacer'), ui.ibtn('x', 'Close keyboard', () => ui.toggleKeyboard())),
    h('div.kbd-keys', cv));
  document.body.appendChild(el);
  S.on('select', refresh); S.on('channels', refresh); S.on('project', refresh); refresh();
  const ptrKeys = new Map();
  cv.addEventListener('pointerdown', e => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect(), hit = keyAtPoint(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    const k = typeof hit === 'number' ? hit : hit.k, vel = typeof hit === 'number' ? 100 : hit.vel;
    ptrKeys.set(e.pointerId, k); down('p' + e.pointerId, k, vel); DAW.haptic(4);
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrKeys.has(e.pointerId)) return;
    const r = cv.getBoundingClientRect(), hit = keyAtPoint(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    const k = typeof hit === 'number' ? hit : hit.k;
    if (k !== ptrKeys.get(e.pointerId)) { up('p' + e.pointerId); ptrKeys.set(e.pointerId, k); down('p' + e.pointerId, k, typeof hit === 'number' ? 100 : hit.vel); }
  });
  const end = e => { if (ptrKeys.has(e.pointerId)) { ptrKeys.delete(e.pointerId); up('p' + e.pointerId); } };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  /* typing keyboard */
  const MAP = 'awsedftgyhujkolp;\''.split('');
  const OFFS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  let tOct = 60;
  window.addEventListener('keydown', e => {
    if (!st.get('typingKeys') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (document.querySelector('.sheet-back')) return;
    const k = e.key.toLowerCase();
    if (k === 'z') { tOct = Math.max(12, tOct - 12); return; }
    if (k === 'x') { tOct = Math.min(96, tOct + 12); return; }
    const i = MAP.indexOf(k); if (i < 0) return;
    e.preventDefault();
    down('kb' + k, tOct + OFFS[i] + st.get('midiTranspose') * 0, 100);
  });
  window.addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (MAP.includes(k)) up('kb' + k); });
  window.addEventListener('blur', () => K.releaseAll());
};

/* ---------- Web MIDI ---------- */
let midiOff = [];
try { midiOff = JSON.parse(localStorage.getItem('beatforge.midi.off') || '[]'); } catch (_) { /* storage blocked */ }
const midi = ui.midi = { access: null, inputs: [], off: new Set(midiOff) };
function onMsg(e) {
  if (!st.get('midiEnabled')) return;
  const [s, a, b] = e.data, cmd = s & 0xf0;
  const tr = st.get('midiTranspose');
  if (cmd === 0x90 && b > 0) down('m' + a, U.clamp(a + tr, 0, 127), curve(b));
  else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) up('m' + a);
  else if (cmd === 0xb0 && a === 64) K.setSustain(b >= 64);
  else if (cmd === 0xb0 && a === 123) K.releaseAll();
  else if (cmd === 0xe0) { const c = targetCh(); if (c) DAW.audio.setBend(c.id, ((b << 7 | a) - 8192) / 8192); }
}
midi.connect = async () => {
  if (!navigator.requestMIDIAccess || !st.get('midiEnabled')) return false;
  try {
    midi.access = midi.access || await navigator.requestMIDIAccess();
    const refresh = () => {
      midi.inputs = Array.from(midi.access.inputs.values());
      midi.inputs.forEach(i => { i.onmidimessage = midi.off.has(i.id) ? null : onMsg; });
    };
    midi.access.onstatechange = () => { refresh(); S.emit('midi'); };
    refresh(); S.emit('midi');
    return true;
  } catch (_) { return false; }
};
ui.midiSheet = async () => {
  const body = h('div.menu-list');
  const s = ui.sheet({ title: 'MIDI devices', content: body });
  const draw = () => {
    U.clear(body);
    if (!navigator.requestMIDIAccess) { body.appendChild(ui.empty('keys', 'Web MIDI is not available', 'Use Chrome on Android with a USB or Bluetooth MIDI keyboard.')); return; }
    if (!midi.inputs.length) body.appendChild(ui.empty('keys', 'No MIDI inputs found', 'Plug in a USB MIDI keyboard (OTG) or pair a Bluetooth MIDI device, then tap Scan.'));
    midi.inputs.forEach(i => body.appendChild(ui.toggle(i.name + (i.manufacturer ? ' · ' + i.manufacturer : ''), !midi.off.has(i.id), v => {
      if (v) midi.off.delete(i.id); else midi.off.add(i.id);
      try { localStorage.setItem('beatforge.midi.off', JSON.stringify(Array.from(midi.off))); } catch (_) { /* ignore */ }
      i.onmidimessage = v ? onMsg : null;
    })));
    body.appendChild(h('button.btn', { style: { width: '100%', marginTop: '.6rem' }, onclick: async () => { const ok = await midi.connect(); if (!ok) ui.toast('MIDI access was not granted'); draw(); } }, U.icon('keys', 18), 'Scan for devices'));
    body.appendChild(h('p.dim', 'Notes play and record on the selected channel. Sustain pedal (CC 64) is supported.'));
  };
  draw();
};
})();
