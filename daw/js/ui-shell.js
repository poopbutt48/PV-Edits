'use strict';
/* Beatforge — app shell: top bar, transport, navigation, main menu, project dialogs. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C;
const seq = DAW.seq;

ui.views = {};
ui.order = ['rack', 'playlist', 'piano', 'mixer', 'browser'];
ui.registerView = (id, v) => { ui.views[id] = v; };
ui.cur = 'rack';

const NAV = [
  ['rack', 'rack', 'Rack'], ['playlist', 'playlist', 'Playlist'], ['piano', 'piano', 'Piano roll'], ['mixer', 'mixer', 'Mixer'], ['browser', 'folder', 'Browser'],
];

ui.show = id => {
  if (!ui.views[id]) return;
  if (ui.cur && ui.views[ui.cur] && ui.views[ui.cur].hide) ui.views[ui.cur].hide();
  ui.cur = id; S.ui.view = id;
  U.$$('.view').forEach(v => v.classList.toggle('on', v.id === 'v-' + id));
  U.$$('.nav-b').forEach(b => { const on = b.dataset.view === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  const v = ui.views[id];
  if (v.show) v.show();
  S.emit('view', id);
};

/* ---------- pattern picker ---------- */
ui.patternPicker = () => {
  const list = h('div.menu-list');
  const s = ui.sheet({ title: 'Patterns', content: list, full: false });
  const draw = () => {
    U.clear(list);
    S.p.patterns.forEach(pt => {
      list.appendChild(h('div.br-item', { onclick: () => { S.ui.pat = pt.id; S.emit('pattern'); s.close(); } },
        h('span.bi-ic', { style: { background: pt.color, color: '#111' } }, U.icon('note', 18)),
        h('span.bi-t', h('b', pt.name), h('small', pt.bars + ' bar' + (pt.bars > 1 ? 's' : '') + ' · ' + Object.values(pt.notes).reduce((a, n) => a + n.length, 0) + ' notes')),
        pt.id === S.ui.pat ? U.icon('check', 18) : null,
        h('button.ibtn', { 'aria-label': 'Pattern options', onclick: e => { e.stopPropagation(); ui.patternMenu(pt, () => draw()); } }, U.icon('dots', 20))));
    });
    list.appendChild(h('button.btn.primary', { style: { margin: '.6rem 0 0', width: '100%' }, onclick: () => { S.addPattern(); S.commit('New pattern'); S.emit('pattern'); s.close(); } }, U.icon('plus', 18), 'New pattern'));
  };
  draw();
};
ui.patternMenu = (pt, done) => {
  ui.menu([
    { label: 'Rename', icon: 'pencil', onClick: async () => { const n = await ui.prompt('Rename pattern', pt.name); if (n) { pt.name = n; S.commit('Rename pattern'); S.emit('pattern'); done && done(); } } },
    { label: 'Colour', icon: 'paint', onClick: async () => { const c = await ui.pickColor(pt.color); if (c) { pt.color = c; S.commit('Pattern colour'); S.emit('pattern'); done && done(); } } },
    { label: 'Clone', icon: 'copy', onClick: () => { S.clonePattern(pt.id); S.commit('Clone pattern'); done && done(); } },
    { label: 'Clear all notes', icon: 'eraser', onClick: () => { pt.notes = {}; S.commit('Clear pattern'); S.emit('notes', pt.id); done && done(); } },
    { label: 'Length: ' + pt.bars + ' bar' + (pt.bars > 1 ? 's' : ''), icon: 'clock', onClick: async () => { const n = await ui.prompt('Pattern length in bars', pt.bars, { number: true }); const v = Math.round(parseFloat(n)); if (v >= 1 && v <= 64) { pt.bars = v; S.commit('Pattern length'); S.emit('pattern'); done && done(); } } },
    { label: 'Delete', icon: 'trash', danger: true, onClick: async () => { if (S.p.patterns.length <= 1) { ui.toast('A project needs at least one pattern'); return; } if (!DAW.settings.get('confirmDelete') || await ui.confirm('Delete "' + pt.name + '" and its clips in the playlist?', 'Delete', true)) { S.removePattern(pt.id); S.commit('Delete pattern'); done && done(); } } },
  ], { title: pt.name });
};

/* ---------- project dialogs ---------- */
ui.newProjectSheet = () => {
  const body = h('div.menu-list');
  DAW.templateList.forEach(t => body.appendChild(h('button.br-item', { onclick: () => { s.close(); startNew(t.id); } },
    h('span.bi-ic', U.icon('file', 18)), h('span.bi-t', h('b', t.name), h('small', t.desc)))));
  const s = ui.sheet({ title: 'New project', content: body });
  const startNew = async id => {
    if (S.dirty && !(await ui.confirm('Discard unsaved changes to "' + S.p.meta.name + '"?', 'Discard', true))) return;
    seq.stop();
    S.newProject(id);
    await DAW.samples.preload(S.p);
    ui.show('rack');
  };
};
ui.openProjectSheet = async () => {
  const body = h('div.menu-list');
  const s = ui.sheet({ title: 'Open project', content: body });
  const list = await S.listLocal();
  if (!list.length) body.appendChild(ui.empty('folder', 'No saved projects', 'Use File → Save to keep a project on this device.'));
  list.forEach(r => body.appendChild(h('div.br-item', { onclick: async () => {
    if (S.dirty && !(await ui.confirm('Discard unsaved changes?', 'Discard', true))) return;
    s.close(); seq.stop(); await S.loadLocal(r.id); await DAW.samples.preload(S.p); ui.show('rack');
  } }, h('span.bi-ic', U.icon('file', 18)), h('span.bi-t', h('b', r.name), h('small', new Date(r.modified).toLocaleString())),
  h('button.ibtn', { 'aria-label': 'Delete project', onclick: async e => { e.stopPropagation(); if (await ui.confirm('Delete "' + r.name + '" from this device?', 'Delete', true)) { await S.deleteLocal(r.id); s.close(); ui.openProjectSheet(); } } }, U.icon('trash', 18)))));
};
ui.saveProject = async asNew => {
  let name = S.p.meta.name;
  if (asNew || name === 'Untitled') {
    const n = await ui.prompt(asNew ? 'Save a copy as' : 'Save project', name === 'Untitled' ? '' : name, { placeholder: 'Project name' });
    if (!n) return;
    name = n.trim() || 'Untitled';
    if (asNew) S.projectId = 'p' + Date.now().toString(36);
  }
  await S.saveLocal(name);
  ui.toast('Saved "' + name + '"');
};
ui.projectInfo = () => {
  const p = S.p, m = p.meta, body = h('div.dialog');
  const field = (label, key, multiline) => {
    const i = h(multiline ? 'textarea.text' : 'input.text', { value: m[key] || '', style: multiline ? { height: '5rem', padding: '.5rem .75rem' } : null });
    i.addEventListener('change', () => { m[key] = i.value; S.commit('Project info'); S.emit('dirty'); });
    return h('div', h('label.dlg-label', label), i);
  };
  body.append(field('Title', 'name'), field('Author', 'author'), field('Genre', 'genre'), field('Comments', 'comments', true));
  body.append(h('div.row',
    ui.select('Time signature (beats)', [2, 3, 4, 5, 6, 7, 9, 12].map(v => ({ v, l: String(v) })), p.num, v => { p.num = Number(v); S.commit('Time signature'); S.emit('tempo'); }),
    ui.select('Beat unit', [4, 8, 16].map(v => ({ v, l: '1/' + v })), p.den, v => { p.den = Number(v); S.commit('Time signature'); S.emit('tempo'); })));
  body.append(ui.knob({ def: { id: 'swing', label: 'Global swing', min: 0, max: 1, def: 0, unit: '%' }, value: p.swing, onInput: v => { p.swing = v; }, onChange: () => S.commit('Swing') }));
  body.append(ui.knob({ def: { id: 'mp', label: 'Master pitch', min: -12, max: 12, def: 0, unit: 'st', step: 1 }, value: p.masterPitch, onInput: v => { p.masterPitch = v; S.emit('tempo'); }, onChange: () => S.commit('Master pitch') }));
  body.append(h('p.dim', 'Created ' + new Date(m.created).toLocaleString() + ' · modified ' + new Date(m.modified).toLocaleString()));
  ui.sheet({ title: 'Project info', content: body, full: true, onClose: () => S.emit('project-meta') });
};

/* ---------- tempo ---------- */
let taps = [];
ui.tapTempo = () => {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2200) taps = [];
  taps.push(now);
  if (taps.length > 1) {
    const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
    const avg = iv.reduce((a, b) => a + b, 0) / iv.length;
    ui.setTempo(60000 / avg);
  }
  taps = taps.slice(-8);
};
ui.setTempo = (bpm, commit) => {
  S.p.tempo = U.clamp(Math.round(bpm * 100) / 100, 10, 999);
  S.emit('tempo');
  if (commit) S.commit('Tempo');
};

/* ---------- main menu ---------- */
ui.mainMenu = () => {
  const groups = [
    ['File', 'file', () => [
      { label: 'New project…', icon: 'file', onClick: ui.newProjectSheet },
      { label: 'Open…', icon: 'folder', onClick: ui.openProjectSheet },
      { label: 'Save', icon: 'save', hint: 'Ctrl+S', onClick: () => ui.saveProject(false) },
      { label: 'Save as…', icon: 'save', onClick: () => ui.saveProject(true) },
      { label: 'Project info…', icon: 'info', onClick: ui.projectInfo },
      { sep: true, label: 'Import' },
      { label: 'Audio files…', icon: 'upload', onClick: () => DAW.ui.importAudio && DAW.ui.importAudio() },
      { label: 'MIDI file into new pattern…', icon: 'upload', onClick: () => DAW.ui.importMidi && DAW.ui.importMidi() },
      { label: 'Project file (.json)…', icon: 'upload', onClick: () => DAW.ui.importProject && DAW.ui.importProject() },
      { sep: true, label: 'Export' },
      { label: 'Audio (WAV)…', icon: 'download', onClick: () => DAW.ui.exportDialog && DAW.ui.exportDialog() },
      { label: 'MIDI file…', icon: 'download', onClick: () => DAW.ui.exportMidi && DAW.ui.exportMidi() },
      { label: 'Project file with samples…', icon: 'download', onClick: () => DAW.ui.exportProject && DAW.ui.exportProject() },
    ]],
    ['Edit', 'pencil', () => [
      { label: 'Undo' + (S.canUndo() ? ' · ' + S.undoLabel() : ''), icon: 'undo', disabled: !S.canUndo(), hint: 'Ctrl+Z', onClick: () => S.undo() },
      { label: 'Redo' + (S.canRedo() ? ' · ' + S.redoLabel() : ''), icon: 'redo', disabled: !S.canRedo(), hint: 'Ctrl+Y', onClick: () => S.redo() },
      { sep: true, label: 'Pattern' },
      { label: 'Clear current pattern', icon: 'eraser', onClick: () => { S.curPat().notes = {}; S.commit('Clear pattern'); S.emit('notes', S.ui.pat); } },
      { label: 'Randomize drum steps', icon: 'dice', onClick: () => DAW.ui.randomizeSteps && DAW.ui.randomizeSteps() },
    ]],
    ['Add', 'plus', () => [
      { label: 'Channel…', icon: 'plus', onClick: () => ui.addChannelSheet() },
      { label: 'Pattern', icon: 'note', onClick: () => { S.addPattern(); S.commit('New pattern'); } },
      { label: 'Playlist track', icon: 'playlist', onClick: () => { DAW.ui.addTrack && DAW.ui.addTrack(); } },
      { label: 'Mixer insert', icon: 'mixer', onClick: () => { DAW.ui.addInsert && DAW.ui.addInsert(); } },
      { label: 'Marker at playhead', icon: 'star', onClick: () => { DAW.ui.addMarker && DAW.ui.addMarker(); } },
    ]],
    ['Patterns', 'note', () => [
      { label: 'Pick pattern…', icon: 'note', onClick: ui.patternPicker },
      { label: 'Rename current', icon: 'pencil', onClick: () => ui.patternMenu(S.curPat()) },
      { label: 'Clone current', icon: 'copy', onClick: () => { S.clonePattern(S.ui.pat); S.commit('Clone pattern'); } },
    ]],
    ['View', 'eye', () => [
      ...NAV.map(n => ({ label: n[2], icon: n[1], checked: ui.cur === n[0], onClick: () => ui.show(n[0]) })),
      { sep: true, label: 'Panels' },
      { label: 'On-screen keyboard', icon: 'keys', checked: DAW.ui.kbdOpen, onClick: () => DAW.ui.toggleKeyboard && DAW.ui.toggleKeyboard() },
      { label: 'Full screen', icon: 'expand', onClick: () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } },
    ]],
    ['Options', 'gear', () => [
      { label: 'Settings…', icon: 'gear', onClick: () => DAW.ui.openSettings && DAW.ui.openSettings() },
      { label: 'MIDI devices…', icon: 'keys', onClick: () => DAW.ui.midiSheet && DAW.ui.midiSheet() },
      { label: 'Restart audio engine', icon: 'bolt', onClick: async () => { await DAW.audio.restart(); ui.toast('Audio restarted'); } },
      { label: 'Metronome', icon: 'metro', checked: seq.metronome, onClick: () => ui.toggleMetro() },
      { label: 'Install as app', icon: 'download', disabled: !ui.installPrompt, onClick: () => ui.install() },
    ]],
    ['Tools', 'bolt', () => [
      { label: 'Tap tempo', icon: 'tempo', onClick: () => { ui.tapTempo(); } },
      { label: 'Stop all sound (panic)', icon: 'mute', onClick: () => DAW.audio.graph && DAW.audio.graph.panic() },
      { label: 'Record audio from microphone…', icon: 'mic', onClick: () => DAW.ui.recordAudio && DAW.ui.recordAudio() },
      { label: 'Generate melody / chords / bass…', icon: 'wand', onClick: () => DAW.ui.generator && DAW.ui.generator() },
    ]],
    ['Help', 'info', () => [
      { label: 'Gestures & shortcuts', icon: 'hand', onClick: () => DAW.ui.helpSheet && DAW.ui.helpSheet() },
      { label: 'About Beatforge', icon: 'info', onClick: () => DAW.ui.aboutSheet && DAW.ui.aboutSheet() },
    ]],
  ];
  const body = h('div.menu-list');
  groups.forEach(([name, icon, items]) => body.appendChild(h('button.menu-item', { onclick: () => { s.close(); setTimeout(() => ui.menu(items(), { title: name }), 120); } }, U.icon(icon, 18), h('span.menu-label', name), U.icon('chevR', 16))));
  const s = ui.sheet({ title: 'Menu', content: body, cls: 'menu' });
};

ui.toggleMetro = () => { seq.metronome = !seq.metronome; S.emit('transport'); };
ui.install = async () => {
  if (!ui.installPrompt) return;
  ui.installPrompt.prompt();
  await ui.installPrompt.userChoice;
  ui.installPrompt = null;
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); ui.installPrompt = e; });

/* ---------- build ---------- */
ui.buildShell = () => {
  const app = U.$('#app');
  const el = {};
  el.title = h('button.title', { onclick: ui.projectInfo }, '');
  el.undo = ui.ibtn('undo', 'Undo', () => S.undo());
  el.redo = ui.ibtn('redo', 'Redo', () => S.redo());
  el.metro = ui.ibtn('metro', 'Metronome', ui.toggleMetro);
  el.loop = ui.ibtn('loop', 'Loop', () => {
    if (S.p.mode === 'song') { S.p.playlist.loopOn = !S.p.playlist.loopOn; S.emit('playlist'); S.commit('Loop'); } else { seq.loop = !seq.loop; }
    S.emit('transport');
  });
  el.pill = h('div.pill', { title: 'Active voices', onclick: () => { DAW.audio.graph && DAW.audio.graph.panic(); } }, h('i'), h('span', '0'));
  const row1 = h('div.tb-row.tb-row1', ui.ibtn('menu', 'Main menu', ui.mainMenu), el.title, el.metro, el.loop, el.undo, el.redo, el.pill);

  el.play = h('button.tbtn.play', { 'aria-label': 'Play / pause', onclick: () => seq.toggle() }, U.icon('play', 26));
  el.stop = h('button.tbtn', { 'aria-label': 'Stop', onclick: () => seq.stop() }, U.icon('stop', 22));
  el.rec = h('button.tbtn.rec', { 'aria-label': 'Record', onclick: () => seq.toggleRecord() }, U.icon('rec', 22));
  el.time = h('b', '001:01:00'); el.timeSub = h('small', 'BAR:BEAT:TICK');
  const lcd = h('button.lcd', { 'aria-label': 'Time display (tap to rewind)', onclick: () => { seq.stop(); } }, el.time, el.timeSub);
  el.bpm = h('b', '130.00');
  const bpm = h('div.lcd.bpm', { role: 'spinbutton', 'aria-label': 'Tempo', style: { touchAction: 'none', cursor: 'ns-resize' } }, el.bpm, h('small', 'BPM'));
  let t0 = 130;
  U.drag(bpm, {
    down: () => { t0 = S.p.tempo; },
    move: (e, st) => { ui.setTempo(t0 - st.dy / (e.shiftKey ? 40 : 5)); },
    up: async (e, st) => {
      if (st.moved) { S.commit('Tempo'); return; }
      const v = await ui.prompt('Tempo (BPM)', S.p.tempo, { number: true, ok: 'Set' });
      if (v != null && isFinite(parseFloat(v))) ui.setTempo(parseFloat(v), true);
    },
    hold: () => ui.menu([{ label: 'Tap tempo', icon: 'tempo', keepOpen: true, onClick: ui.tapTempo }, { label: '− 1 BPM', icon: 'minus', keepOpen: true, onClick: () => ui.setTempo(S.p.tempo - 1, true) }, { label: '+ 1 BPM', icon: 'plus', keepOpen: true, onClick: () => ui.setTempo(S.p.tempo + 1, true) }, { label: 'Half time', onClick: () => ui.setTempo(S.p.tempo / 2, true) }, { label: 'Double time', onClick: () => ui.setTempo(S.p.tempo * 2, true) }], { title: 'Tempo' }),
  });
  el.mode = ui.seg([{ v: 'pattern', l: 'PAT' }, { v: 'song', l: 'SONG' }], S.p.mode, v => { seq.halt(false); S.p.mode = v; S.emit('mode'); S.emit('transport'); });
  el.mode.classList.add('compact');
  const row2 = h('div.tb-row.tb-row2', h('div.transport', el.play, el.stop, el.rec), lcd, bpm, h('div.spacer'), el.mode);
  const top = h('header#top', row1, row2);

  const stage = h('main#stage');
  ui.order.forEach(id => stage.appendChild(h('section.view#v-' + id, { 'aria-label': id })));
  const nav = h('nav#nav', { role: 'tablist' }, NAV.map(([id, icon, label]) => h('button.nav-b', { dataset: { view: id }, role: 'tab', onclick: () => ui.show(id) }, U.icon(icon, 22), h('span', label))));
  app.append(top, stage, nav);
  document.body.appendChild(h('button#fab-keys', { 'aria-label': 'On-screen keyboard', onclick: () => DAW.ui.toggleKeyboard && DAW.ui.toggleKeyboard() }, U.icon('keys', 24)));
  ui.el = el;

  const refreshTransport = () => {
    const playing = seq.playing;
    el.play.classList.toggle('on', playing);
    el.play.replaceChildren(U.icon(playing ? 'pause' : 'play', 26));
    el.rec.classList.toggle('on', seq.recording);
    el.metro.classList.toggle('on', seq.metronome);
    const looping = S.p.mode === 'song' ? S.p.playlist.loopOn : seq.loop;
    el.loop.classList.toggle('on', looping);
    el.mode.set(S.p.mode);
    el.bpm.textContent = S.p.tempo.toFixed(2);
  };
  const refreshMeta = () => {
    el.title.replaceChildren(S.p.meta.name, h('span.dirty', S.dirty ? ' •' : ''));
    el.undo.disabled = !S.canUndo(); el.redo.disabled = !S.canRedo();
  };
  ['transport', 'tempo', 'mode', 'project', 'restore', 'playlist'].forEach(e => S.on(e, refreshTransport));
  ['dirty', 'history', 'project', 'restore', 'saved', 'project-meta'].forEach(e => S.on(e, refreshMeta));
  seq.on('transport', refreshTransport);
  refreshTransport(); refreshMeta();

  /* playhead / clock loop */
  let lastV = -1;
  const loop = () => {
    const pos = seq.getPos();
    if (seq.playing || lastV !== pos) {
      lastV = pos;
      const tpb = S.ticksPerBar();
      if (DAW.settings.get('timeFormat') === 'msc') { el.time.textContent = U.fmtMSC(Math.max(0, pos) * S.secPerTick()); el.timeSub.textContent = 'MIN:SEC:CS'; } else {
        el.time.textContent = (pos < 0 ? '-' : '') + U.fmtBBT(Math.abs(pos), tpb); el.timeSub.textContent = pos < 0 ? 'COUNT-IN' : 'BAR:BEAT:TICK';
      }
    }
    const v = ui.views[ui.cur];
    if (v && v.tick) v.tick(pos);
    if (DAW.settings.get('showCpu') && DAW.audio.graph) {
      let n = 0; const now = DAW.audio.ctx.currentTime;
      for (const a of DAW.audio.graph.voices.values()) for (const vv of a) if (vv.end > now) n++;
      el.pill.lastChild.textContent = n + ' v';
      el.pill.classList.toggle('hot', n > 40); el.pill.classList.toggle('over', n > 90);
      el.pill.hidden = false;
    } else el.pill.hidden = !DAW.settings.get('showCpu');
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  document.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (document.querySelector('.sheet-back')) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey) {
      if (k === 'z') { e.preventDefault(); e.shiftKey ? S.redo() : S.undo(); } else if (k === 'y') { e.preventDefault(); S.redo(); } else if (k === 's') { e.preventDefault(); ui.saveProject(false); }
      return;
    }
    if (e.code === 'Space') { e.preventDefault(); seq.toggle(); } else if (k === 'enter') seq.stop();
    else if (k === 'r' && e.shiftKey) seq.toggleRecord();
    else if (e.key >= '1' && e.key <= '5' && !DAW.settings.get('typingKeys')) ui.show(ui.order[Number(e.key) - 1]);
  });
};
})();
