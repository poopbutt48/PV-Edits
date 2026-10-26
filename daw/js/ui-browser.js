'use strict';
/* Beatforge — browser panel and sample picker. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui;

const view = {};
ui.registerView('browser', view);

ui.importAudio = async (cat) => {
  const files = await U.pickFiles('audio/*,.wav,.mp3,.ogg,.flac,.m4a', true);
  let ok = 0;
  for (const f of files) {
    try { await DAW.samples.importFile(f, cat || 'Imported'); ok++; } catch (e) { ui.toast('Could not decode ' + f.name); }
  }
  if (ok) { ui.toast('Imported ' + ok + ' file' + (ok > 1 ? 's' : '')); S.emit('samples'); }
  return ok;
};

function sampleItem(info, o) {
  const row = h('div.br-item', { role: 'button', tabindex: 0 },
    h('button.bi-ic', { 'aria-label': 'Preview ' + info.name, onclick: e => { e.stopPropagation(); DAW.audio.auditionBuffer(info.id); } }, U.icon('play', 16)),
    h('span.bi-t', h('b', info.name), h('small', info.cat + (info.user ? ' · yours' : ''))),
    o.action ? h('button.ibtn', { 'aria-label': o.actionLabel, onclick: e => { e.stopPropagation(); o.action(info); } }, U.icon(o.actionIcon || 'plus', 20)) : null);
  U.drag(row, {
    up: (e, st) => { if (!st.moved && !st.held && !e.target.closest('button')) o.onTap(info); },
    hold: () => { DAW.haptic(15); if (o.onHold) o.onHold(info); },
    holdMs: DAW.settings.get('longPressMs'),
    threshold: 10,
  });
  return row;
}

function sampleList(o) {
  const wrap = h('div.br');
  let cat = 'All', q = '';
  const search = h('input.text.br-search', { placeholder: 'Search samples', type: 'search', 'aria-label': 'Search samples' });
  const tabs = h('div.br-tabs');
  const list = h('div.br-list');
  const draw = () => {
    U.clear(tabs); U.clear(list);
    const cats = ['All', ...DAW.samples.cats(), 'Imported'];
    cats.forEach(c => tabs.appendChild(h('button.chip' + (c === cat ? '.on' : ''), { onclick: () => { cat = c; draw(); } }, c)));
    const all = [...DAW.samples.factory, ...DAW.samples.userList()];
    const items = all.filter(s => (cat === 'All' || s.cat === cat || (cat === 'Imported' && s.user)) && (!q || s.name.toLowerCase().includes(q)));
    if (!items.length) list.appendChild(ui.empty('folder', cat === 'Imported' ? 'No imported samples yet' : 'No matches', cat === 'Imported' ? 'Import WAV, MP3, OGG or FLAC files.' : 'Try a different search.'));
    let last = '';
    items.forEach(s => {
      if (cat === 'All' && s.cat !== last) { list.appendChild(h('div.br-cat', s.cat)); last = s.cat; }
      list.appendChild(sampleItem(s, o));
    });
    list.appendChild(h('div', { style: { padding: '.8rem .4rem' } }, h('button.btn', { style: { width: '100%' }, onclick: async () => { if (await ui.importAudio()) draw(); } }, U.icon('upload', 18), 'Import audio files…')));
  };
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  wrap.append(search, tabs, list);
  draw();
  wrap.redraw = draw;
  return wrap;
}

ui.pickSample = () => new Promise(res => {
  let out = null;
  const list = sampleList({ onTap: i => { out = i.id; s.close(); }, action: i => { out = i.id; s.close(); }, actionIcon: 'check', actionLabel: 'Use this sample' });
  list.style.height = '60vh';
  const s = ui.sheet({ title: 'Choose a sample', content: list, full: true, onClose: () => { DAW.audio.stopAudition(); res(out); } });
  s.body.style.padding = '0';
});

/* ---------- browser view ---------- */
let root, bodyEl, tab = 'samples';

function sampleActions(info) {
  ui.menu([
    { label: 'Add to rack as sampler', icon: 'rack', onClick: async () => { await ui.addChannel('sampler', { sample: info.id }); ui.toast('Added ' + info.name); } },
    { label: 'Add as audio clip to playlist', icon: 'playlist', onClick: () => ui.addAudioClip && ui.addAudioClip(info.id) },
    { label: 'Use as convolution impulse on selected track', icon: 'fx', onClick: () => { const tr = S.p.mixer.tracks[S.ui.track]; const i = tr.fx.findIndex(f => !f); if (i < 0) { ui.toast('No free effect slot'); return; } const f = S.newFx('convolver'); f.p.ir = info.id; f.mix = 0.3; tr.fx[i] = f; S.commit('Add convolver'); S.emit('fx', S.ui.track); ui.toast('Added convolution reverb'); } },
    info.user ? { label: 'Delete from library', icon: 'trash', danger: true, onClick: async () => { await DAW.samples.remove(info.id); S.emit('samples'); drawBody(); } } : null,
  ], { title: info.name });
}

function drawBody() {
  U.clear(bodyEl);
  if (tab === 'samples') {
    bodyEl.appendChild(sampleList({ onTap: i => DAW.audio.auditionBuffer(i.id), onHold: sampleActions, action: async i => { await ui.addChannel('sampler', { sample: i.id }); ui.toast('Added ' + i.name + ' to the rack'); }, actionLabel: 'Add to rack' }));
  } else if (tab === 'presets') {
    const list = h('div.br-list');
    const grp = (title, presets, type) => {
      list.appendChild(h('div.br-cat', title));
      Object.keys(presets).forEach(n => list.appendChild(h('button.br-item', { onclick: async () => { const ch = await ui.addChannel(type, { preset: n }); if (ch) { ui.toast('Added ' + n); DAW.audio.noteOn(ch.id, 60, 100).then(x => x && setTimeout(() => x.off(), 500)); } } }, h('span.bi-ic', U.icon('keys', 18)), h('span.bi-t', h('b', n), h('small', title)), U.icon('plus', 20))));
    };
    grp('Synth presets', DAW.inst.synthPresets, 'synth');
    grp('FM presets', DAW.inst.fmPresets, 'fm');
    bodyEl.appendChild(list);
  } else if (tab === 'effects') {
    const list = h('div.br-list');
    DAW.fx.cats.forEach(cat => {
      const types = DAW.fx.order.filter(t => DAW.fx.types[t].cat === cat);
      if (!types.length) return;
      list.appendChild(h('div.br-cat', cat));
      types.forEach(t => list.appendChild(h('button.br-item', { onclick: () => {
        const tr = S.p.mixer.tracks[S.ui.track], i = tr.fx.findIndex(f => !f);
        if (i < 0) { ui.toast('No free slot on ' + tr.name); return; }
        tr.fx[i] = S.newFx(t); S.commit('Add effect'); S.emit('fx', S.ui.track);
        ui.toast('Added ' + DAW.fx.types[t].label + ' to ' + tr.name);
      } }, h('span.bi-ic', U.icon('fx', 18)), h('span.bi-t', h('b', DAW.fx.types[t].label), h('small', DAW.fx.types[t].params.length + ' parameters · adds to selected track')), U.icon('plus', 20))));
    });
    bodyEl.appendChild(list);
  } else if (tab === 'projects') {
    const list = h('div.br-list');
    list.appendChild(h('div.br-cat', 'Templates'));
    DAW.templateList.forEach(t => list.appendChild(h('button.br-item', { onclick: async () => { if (S.dirty && !(await ui.confirm('Discard unsaved changes?', 'Discard', true))) return; DAW.seq.stop(); S.newProject(t.id); await DAW.samples.preload(S.p); ui.show('rack'); } }, h('span.bi-ic', U.icon('file', 18)), h('span.bi-t', h('b', t.name), h('small', t.desc)))));
    list.appendChild(h('div.br-cat', 'Saved on this device'));
    const saved = h('div');
    list.appendChild(saved);
    S.listLocal().then(items => {
      if (!items.length) saved.appendChild(ui.empty('folder', 'Nothing saved yet', 'Use Menu → File → Save.'));
      items.forEach(r => saved.appendChild(h('button.br-item', { onclick: async () => { if (S.dirty && !(await ui.confirm('Discard unsaved changes?', 'Discard', true))) return; DAW.seq.stop(); await S.loadLocal(r.id); await DAW.samples.preload(S.p); ui.show('rack'); } }, h('span.bi-ic', U.icon('file', 18)), h('span.bi-t', h('b', r.name), h('small', new Date(r.modified).toLocaleString())))));
    });
    bodyEl.appendChild(list);
  }
}

view.show = () => drawBody();
view.build = () => {
  root = U.$('#v-browser');
  const tabs = h('div.br-tabs');
  const defs = [['samples', 'Samples', 'wave'], ['presets', 'Presets', 'keys'], ['effects', 'Effects', 'fx'], ['projects', 'Projects', 'file']];
  const redrawTabs = () => { U.clear(tabs); defs.forEach(([id, label, icon]) => tabs.appendChild(h('button.chip' + (id === tab ? '.on' : ''), { onclick: () => { tab = id; redrawTabs(); drawBody(); } }, U.icon(icon, 16), label))); };
  redrawTabs();
  bodyEl = h('div.br');
  root.append(tabs, bodyEl);
  S.on('samples', () => { if (ui.cur === 'browser') drawBody(); });
};
})();
