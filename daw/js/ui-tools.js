'use strict';
/* Beatforge — export/import dialogs, microphone recording, idea generator, settings, help. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C, seq = DAW.seq, st = DAW.settings;

const fileName = ext => (S.p.meta.name || 'Beatforge').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') + ext;

/* ---------- export ---------- */
ui.exportDialog = () => {
  const o = { mode: S.p.mode, stems: false };
  const body = h('div.dialog');
  const status = h('p.dim', '');
  const go = h('button.btn.primary', { onclick: async () => {
    go.disabled = true; status.textContent = 'Rendering… this can take a little while on long projects.';
    try {
      await DAW.audio.ensure(); seq.halt(false);
      const opts = { mode: o.mode, sampleRate: st.get('rRate'), tail: st.get('rTail'), limiter: st.get('rLimit') };
      if (o.stems) {
        const used = Array.from(new Set(S.p.channels.map(c => c.mix))).filter(i => i > 0);
        for (const i of used) {
          status.textContent = 'Rendering ' + S.p.mixer.tracks[i].name + '…';
          const buf = await DAW.render(Object.assign({ soloTrack: i }, opts));
          DAW.wav.download(buf, fileName('_' + S.p.mixer.tracks[i].name.replace(/\W+/g, '') + '.wav'));
          await new Promise(r => setTimeout(r, 400));
        }
        status.textContent = 'Stems exported (' + used.length + ' files).';
      } else {
        const buf = await DAW.render(opts);
        DAW.wav.download(buf, fileName('.wav'));
        status.textContent = 'Done — ' + buf.duration.toFixed(1) + ' s exported.';
      }
    } catch (e) { status.textContent = 'Export failed: ' + e.message; }
    go.disabled = false;
  } }, U.icon('download', 18), 'Render & download');
  body.append(
    ui.select('Render', [{ v: 'song', l: 'Song (playlist)' }, { v: 'pattern', l: 'Current pattern only' }], o.mode, v => { o.mode = v; }),
    ui.toggle('Export each mixer track as a separate stem', false, v => { o.stems = v; }),
    h('p.dim', 'Format: ' + (st.get('rBits') === 32 ? '32-bit float' : st.get('rBits') + '-bit') + ' · ' + st.get('rRate') + ' Hz · tail ' + st.get('rTail') + ' s. Change these in Settings → Export.'),
    go, status);
  ui.sheet({ title: 'Export audio', content: body });
};
ui.exportMidi = () => {
  ui.menu([
    { label: 'Current pattern', icon: 'note', onClick: () => U.saveBlob(new Blob([DAW.midi.exportSMF('pattern')], { type: 'audio/midi' }), fileName('_pattern.mid')) },
    { label: 'Whole song (playlist)', icon: 'playlist', onClick: () => U.saveBlob(new Blob([DAW.midi.exportSMF('song')], { type: 'audio/midi' }), fileName('.mid')) },
  ], { title: 'Export MIDI' });
};
ui.exportProject = async () => { U.saveBlob(await DAW.bundle.export(), fileName('.beatforge.json')); ui.toast('Project exported with its samples'); };
ui.importProjectFile = async f => {
  try { await DAW.bundle.import(await U.readText(f)); await DAW.samples.preload(S.p); ui.show('rack'); ui.toast('Opened ' + S.p.meta.name); } catch (e) { ui.toast('Not a Beatforge project file'); }
};
ui.importProject = async () => { const [f] = await U.pickFiles('.json,application/json'); if (f) ui.importProjectFile(f); };
ui.importMidiFile = async f => {
  try { const r = DAW.midi.importSMF(await U.readAB(f), f.name.replace(/\.[^.]+$/, '')); S.commit('Import MIDI'); ui.toast('Imported ' + r.channels + ' track(s) into a new pattern'); S.emit('channels'); S.emit('pattern'); } catch (e) { ui.toast('Could not read MIDI file: ' + e.message); }
};
ui.importMidi = async () => { const [f] = await U.pickFiles('.mid,.midi,audio/midi'); if (f) ui.importMidiFile(f); };

/* ---------- microphone recording ---------- */
ui.recordAudio = async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { ui.toast('Microphone recording is not available in this browser'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); } catch (e) { ui.toast('Microphone permission was denied'); return; }
  await DAW.audio.ensure();
  const ctx = DAW.audio.ctx, srcN = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser(); an.fftSize = 512; srcN.connect(an);
  const lvl = h('div', { style: { height: '100%', width: '0%', background: 'linear-gradient(90deg,#2bd48a,#ffd24d 75%,#ff4d5e)', borderRadius: '4px' } });
  const meter = h('div', { style: { flex: 1, height: '.9rem', background: 'var(--bg0)', borderRadius: '4px', overflow: 'hidden' } }, lvl);
  const status = h('p.dim', 'Ready'), buf = new Float32Array(512);
  let rec = null, chunks = [], run = true;
  const loop = () => { if (!run) return; an.getFloatTimeDomainData(buf); let pk = 0; for (const v of buf) pk = Math.max(pk, Math.abs(v)); lvl.style.width = Math.min(100, pk * 110) + '%'; requestAnimationFrame(loop); };
  loop();
  const startB = h('button.btn.primary', { onclick: () => {
    if (rec) { rec.stop(); return; }
    rec = new MediaRecorder(stream); chunks = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = async () => {
      startB.disabled = true; status.textContent = 'Processing…';
      const blob = new Blob(chunks, { type: rec.mimeType });
      try {
        const id = await DAW.samples.importBytes(await blob.arrayBuffer(), 'Recording ' + new Date().toLocaleTimeString(), 'Recorded');
        ui.addAudioClip(id); status.textContent = 'Saved to Browser → Samples → Imported and placed in the playlist.'; S.emit('samples');
      } catch (e) { status.textContent = 'Could not decode the recording.'; }
      rec = null; startB.disabled = false; startB.lastChild.textContent = 'Record again';
    };
    if (seq.recording === false && !seq.playing && S.p.mode === 'song') { /* record on its own; don't start transport */ }
    rec.start(); startB.lastChild.textContent = 'Stop'; startB.classList.add('danger'); status.textContent = 'Recording…';
  } }, U.icon('rec', 18), 'Record');
  const s = ui.sheet({ title: 'Record from microphone', content: h('div.dialog', h('div.row', { style: { flexWrap: 'nowrap' } }, h('span.tl', 'Input level'), meter), startB, status), cls: 'small', onClose: () => { run = false; if (rec && rec.state !== 'inactive') { rec.onstop = null; rec.stop(); } stream.getTracks().forEach(t => t.stop()); srcN.disconnect(); } });
  void s;
};

/* ---------- idea generator ---------- */
ui.generator = () => {
  const o = { kind: 'melody', bars: 2, density: 0.55, seedless: true };
  const body = h('div.dialog');
  const go = h('button.btn.primary', { onclick: () => { generate(o); s.close(); } }, U.icon('wand', 18), 'Generate into current channel');
  body.append(
    ui.select('What to generate', [{ v: 'melody', l: 'Melody' }, { v: 'chords', l: 'Chord progression' }, { v: 'bass', l: 'Bass line' }, { v: 'drums', l: 'Drum pattern (all sampler channels)' }], o.kind, v => { o.kind = v; }),
    ui.select('Bars', [1, 2, 4, 8].map(v => ({ v, l: String(v) })), o.bars, v => { o.bars = Number(v); }),
    ui.knob({ def: { id: 'dens', label: 'Density', min: 0.1, max: 1, def: 0.55, unit: '%' }, value: o.density, onInput: v => { o.density = v; } }),
    h('p.dim', 'Uses the scale set in the piano roll (Scale button). Existing notes in this channel for the pattern are replaced. Undo brings them back.'),
    go);
  const s = ui.sheet({ title: 'Idea generator', content: body, cls: 'small' });
};
function generate(o) {
  const pat = S.curPat(), ch = S.curCh(), root = st.get('prScaleRoot'), scale = C.SCALES[st.get('prScaleName')] || C.SCALES.Major;
  const tpb = S.ticksPerBar(), n = o.bars * tpb;
  pat.bars = Math.max(pat.bars, o.bars);
  const deg = (d, oct) => 60 + root - 12 + oct * 12 + scale[((d % scale.length) + scale.length) % scale.length] + 12 * Math.floor(d / scale.length);
  const add = (c, t, d, k, v) => S.addNote(pat, c.id, { t: Math.round(t), d: Math.round(d), k: U.clamp(k, 0, 127), v: v || 100 });
  if (o.kind === 'drums') {
    S.p.channels.filter(c => c.type === 'sampler' || c.type === 'drum').forEach((c, i) => {
      pat.notes[c.id] = [];
      const name = c.name.toLowerCase(), steps = n / C.STEP;
      for (let s = 0; s < steps; s++) {
        const b = s % 16;
        let p = 0;
        if (/kick|808/.test(name)) p = b % 4 === 0 ? 0.95 : (b === 10 || b === 7 ? 0.4 * o.density : 0.05);
        else if (/snare|clap|rim/.test(name)) p = b === 4 || b === 12 ? 0.95 : 0.06 * o.density;
        else if (/open/.test(name)) p = b % 8 === 6 ? 0.7 : 0;
        else if (/hat/.test(name)) p = (b % 2 === 0 ? 0.9 : 0.35) * o.density + 0.1;
        else p = 0.15 * o.density * (i % 3 === 0 ? 1 : 0.6);
        if (Math.random() < p) S.toggleStep(pat, c.id, s, Math.round(70 + Math.random() * 50));
      }
    });
  } else if (ch) {
    pat.notes[ch.id] = [];
    const progs = [[0, 4, 5, 3], [5, 3, 0, 4], [0, 5, 3, 4], [1, 4, 0, 0], [0, 3, 4, 3]];
    const prog = U.pick(progs);
    if (o.kind === 'chords') {
      for (let b = 0; b < o.bars; b++) { const d = prog[b % prog.length]; [0, 2, 4, o.density > 0.7 ? 6 : null].forEach(x => { if (x != null) add(ch, b * tpb, tpb * 0.96, deg(d + x, 0), 82); }); }
    } else if (o.kind === 'bass') {
      for (let s = 0; s < n / C.STEP; s++) {
        const bar = Math.floor(s / 16), d = prog[bar % prog.length];
        if (s % 16 === 0 || Math.random() < o.density * 0.35) add(ch, s * C.STEP, C.STEP * (Math.random() < 0.4 ? 2 : 1), deg(d, -1) + (Math.random() < 0.15 ? 12 : 0), s % 16 === 0 ? 112 : 92);
      }
    } else {
      let d = U.pick([0, 2, 4]);
      for (let s = 0; s < n / C.STEP;) {
        const len = U.pick([1, 1, 2, 2, 3, 4]);
        if (Math.random() < o.density) { d += U.pick([-2, -1, -1, 0, 1, 1, 2]); d = U.clamp(d, -3, 9); add(ch, s * C.STEP, len * C.STEP * 0.9, deg(d, 1), 80 + Math.round(Math.random() * 35)); }
        s += len;
      }
    }
  }
  S.commit('Generate ' + o.kind); S.emit('notes', pat.id); S.emit('pattern');
}

/* ---------- settings ---------- */
ui.openSettings = () => {
  const body = h('div');
  const s = ui.sheet({ title: 'Settings', content: body, full: true });
  const draw = () => {
    U.clear(body);
    st.schema.forEach(g => {
      const grp = h('div.set-grp', h('h3', U.icon(g.icon, 16), g.group));
      g.items.forEach(it => {
        const row = h('div.set-row', h('div.sr-t', it.label, it.help ? h('small', it.help) : null));
        const v = st.get(it.id);
        if (it.type === 'toggle') { const sw = h('button.switch' + (v ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!v), 'aria-label': it.label, onclick: () => { const nv = !st.get(it.id); st.set(it.id, nv); sw.classList.toggle('on', nv); sw.setAttribute('aria-checked', String(nv)); } }); row.appendChild(sw); row.style.cursor = 'pointer'; row.addEventListener('click', e => { if (e.target !== sw) sw.click(); }); }
        else if (it.type === 'select') { const opts = typeof it.opts === 'function' ? it.opts() : it.opts; row.appendChild(h('select.fld', { 'aria-label': it.label, onchange: e => { const op = opts.find(x => String(x.v) === e.target.value); st.set(it.id, op.v); } }, opts.map(op => h('option', { value: String(op.v), selected: String(op.v) === String(v) }, op.l)))); }
        else if (it.type === 'range') { const lab = h('span.tl', { style: { minWidth: '3rem', textAlign: 'right' } }, it.fmt ? it.fmt(v) : v); row.appendChild(h('div.row', { style: { flexWrap: 'nowrap', gap: '.4rem' } }, h('input', { type: 'range', min: it.min, max: it.max, step: it.step, value: v, 'aria-label': it.label, oninput: e => { const nv = Number(e.target.value); st.set(it.id, nv); lab.textContent = it.fmt ? it.fmt(nv) : nv; } }), lab)); }
        else if (it.type === 'color') row.appendChild(h('div.set-colors', it.opts.map(c => h('button' + (c === v ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => { st.set(it.id, c); draw(); } }))));
        grp.appendChild(row);
      });
      body.appendChild(grp);
    });
    body.appendChild(h('div.row',
      h('button.btn', { onclick: async () => { await DAW.audio.restart(); ui.toast('Audio engine restarted'); } }, U.icon('bolt', 18), 'Restart audio'),
      h('button.btn', { onclick: async () => { if (await ui.confirm('Reset every setting to its default?', 'Reset', true)) { st.reset(); draw(); } } }, U.icon('undo', 18), 'Reset settings')));
    body.appendChild(h('p.dim', { style: { marginTop: '1rem' } }, 'Beatforge ' + (DAW.version || '') + ' · settings are stored on this device only.'));
  };
  draw();
  void s;
};

ui.helpSheet = () => {
  const body = h('div.dialog');
  const item = (t, d) => h('div', h('b', t), h('p', d));
  body.append(
    item('Rack', 'Tap a step to toggle it. Hold a step, then drag across others to paint. Hold a lit step to edit its velocity, pan, pitch and more. Hold a channel name for its menu.'),
    item('Knobs', 'Drag up/down. Double-tap to reset. Hold for typed values, copy/paste and “Create automation clip”.'),
    item('Piano roll', 'Tap empty space to add a note, then drag sideways to set its length. Drag a note to move it, drag its right edge to resize. Hold a note for its properties. Pinch with two fingers to zoom, drag with two fingers to scroll.'),
    item('Playlist', 'Pick a pattern, then tap to place it. Drag clips to move, drag the right edge to resize. Hold a clip for its menu. Drag on the ruler to set a loop region; hold the ruler to add markers.'),
    item('Mixer', 'Tap a strip name to select it; hold for its menu. Add effects in the Effects tab. Routing lets any insert feed another.'),
    item('Keyboard', 'Use the orange key button for the on-screen piano. A USB/Bluetooth MIDI keyboard works in Chrome. On a computer keyboard: A W S E D F T G Y H U J K O L P for notes, Z/X for octaves, Space to play.'),
    item('Back button', 'Close sheets with the swipe handle, the × button or the Android back gesture.'));
  ui.sheet({ title: 'Gestures & shortcuts', content: body, full: true });
};
ui.aboutSheet = () => {
  const body = h('div.dialog',
    h('p', 'Beatforge is a touch-first music studio that runs in the browser and installs as an Android app. Everything — synths, effects, mixer and rendering — runs locally on your device with the Web Audio API.'),
    h('p.dim', 'It is an independent project with its own code, sounds and design. It is not affiliated with, endorsed by or derived from any commercial digital audio workstation.'),
    h('p.dim', 'See FEATURES.md in the repository for the list of what is implemented and what is not yet.'));
  ui.sheet({ title: 'About Beatforge', content: body, cls: 'small' });
};
})();
