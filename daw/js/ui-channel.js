'use strict';
/* Beatforge — channel settings sheet (generated from the instrument's parameter schema). */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state, ui = DAW.ui, C = DAW.C;

const volDef = { id: 'vol', label: 'Volume', min: 0, max: 1, def: 0.8, fmt: v => U.fmtDb(U.faderToGain(v)) };
const panDef = { id: 'pan', label: 'Pan', min: -1, max: 1, def: 0, unit: 'pan' };
const pitchDef = { id: 'pitch', label: 'Pitch', min: -24, max: 24, def: 0, step: 1, unit: 'st' };

function waveView(ch) {
  const cv = h('canvas.wave', { style: { width: '100%', height: '6rem', background: 'var(--bg0)', borderRadius: 'var(--r)', display: 'block' } });
  const draw = () => {
    const id = ch.sample;
    const w = cv.clientWidth || 300, hh = cv.clientHeight || 90, dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr; cv.height = hh * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.clearRect(0, 0, w, hh);
    const pk = id ? DAW.samples.peaks(id, Math.max(8, Math.floor(w))) : null;
    if (!pk) { g.fillStyle = '#646e84'; g.font = '13px sans-serif'; g.fillText('No sample loaded', 12, hh / 2); return; }
    g.fillStyle = U.rgba(ch.color, 0.9);
    const n = pk.length / 2;
    for (let i = 0; i < n; i++) { const x = i * w / n, y0 = (1 - pk[i * 2 + 1]) * hh / 2, y1 = (1 - pk[i * 2]) * hh / 2; g.fillRect(x, y0, Math.max(1, w / n), Math.max(1, y1 - y0)); }
    const p = ch.p;
    if (ch.type === 'sampler') {
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.fillRect(0, 0, p.start * w, hh); g.fillRect(p.end * w, 0, w - p.end * w, hh);
      if (p.loop) { g.fillStyle = 'rgba(55,214,197,.18)'; g.fillRect(p.loopStart * w, 0, (p.loopEnd - p.loopStart) * w, hh); }
    }
  };
  cv.redraw = draw;
  setTimeout(draw, 30);
  return cv;
}

ui.sliceToChannels = ch => {
  const body = h('div.dialog'), o = { n: 8, steps: true };
  body.append(ui.select('Number of slices', [2, 4, 8, 16].map(v => ({ v, l: String(v) })), o.n, v => { o.n = Number(v); }),
    ui.toggle('Place one step per slice in the current pattern', true, v => { o.steps = v; }),
    h('p.dim', 'Creates one sampler channel per slice, each playing its own part of the sample.'),
    h('button.btn.primary', { onclick: () => {
      const pat = S.curPat(), spb = S.stepsPerBar() * pat.bars;
      for (let i = 0; i < o.n; i++) {
        const c2 = S.addChannel('sampler', { name: ch.name + ' ' + (i + 1), sample: ch.sample, mix: ch.mix, p: Object.assign({}, ch.p, { start: i / o.n, end: (i + 1) / o.n }) });
        if (o.steps) S.toggleStep(pat, c2.id, Math.floor(i * spb / o.n), 100);
      }
      S.commit('Slice sample'); s2.close(); ui.show('rack');
    } }, U.icon('slice', 18), 'Create slices'));
  const s2 = ui.sheet({ title: 'Slice ' + ch.name, content: body, cls: 'small' });
};

ui.openChannel = (id, tabName) => {
  const ch = S.getCh(id);
  if (!ch) return;
  const T = DAW.inst.types[ch.type];
  S.ui.ch = id;
  const body = h('div');
  const s = ui.sheet({ title: ch.name + ' · ' + T.label, content: body, full: true, onClose: () => S.emit('channels') });
  const touch = () => S.emit('channel', ch.id);
  const commit = label => () => S.commit(label);

  /* header controls */
  const top = h('div.row', { style: { alignItems: 'flex-start', marginBottom: '.5rem' } },
    ui.knob({ def: volDef, value: ch.vol, path: 'ch:' + ch.id + ':vol', onInput: v => { ch.vol = v; touch(); }, onChange: commit('Channel volume') }),
    ui.knob({ def: panDef, value: ch.pan, path: 'ch:' + ch.id + ':pan', onInput: v => { ch.pan = v; touch(); }, onChange: commit('Channel pan') }),
    T.noPlay && ch.type !== 'audio' ? null : ui.knob({ def: pitchDef, value: ch.pitch, onInput: v => { ch.pitch = v; }, onChange: commit('Channel pitch') }),
    h('div.select', h('span.tl', 'Mixer track'), h('button.samplebtn', { onclick: async () => { const t = await ui.pickTrack(ch.mix); if (t != null) { ch.mix = t; S.commit('Route channel'); touch(); lab.textContent = t === 0 ? 'Master' : 'Insert ' + t; } } }, U.icon('route', 18), h('span.sb-name', ''))));
  const lab = top.querySelector('.sb-name'); lab.textContent = ch.mix === 0 ? 'Master' : 'Insert ' + ch.mix;
  body.appendChild(top);
  body.appendChild(h('div.row', { style: { marginBottom: '.6rem' } },
    ui.toggle('Mute', ch.mute, v => { ch.mute = v; S.commit('Mute'); touch(); S.emit('channels'); }),
    ui.toggle('Solo', ch.solo, v => { ch.solo = v; S.commit('Solo'); S.p.channels.forEach(c => S.emit('channel', c.id)); S.emit('channels'); }),
    h('button.btn.small', { onclick: async () => { const n = await ui.prompt('Rename channel', ch.name); if (n) { ch.name = n; s.setTitle(n + ' · ' + T.label); S.commit('Rename'); } } }, U.icon('pencil', 16), 'Rename'),
    h('button.btn.small', { onclick: async () => { const c = await ui.pickColor(ch.color); if (c) { ch.color = c; S.commit('Colour'); if (wave) wave.redraw(); } } }, U.icon('paint', 16), 'Colour')));

  let wave = null;
  if (T.usesSample) {
    wave = waveView(ch);
    body.appendChild(h('div', { style: { marginBottom: '.6rem' } }, wave,
      h('div.row', { style: { marginTop: '.4rem' } },
        ui.sampleBtn('Sample', ch.sample, async id => { ch.sample = id; await DAW.samples.preload(S.p); if (ch.name === T.label) ch.name = DAW.samples.name(id); S.commit('Change sample'); wave.redraw(); touch(); }),
        h('button.btn.small', { onclick: () => DAW.audio.auditionBuffer(ch.sample) }, U.icon('play', 16), 'Play sample'),
        h('button.btn.small', { onclick: () => { ui.sliceToChannels && ui.sliceToChannels(ch); } }, U.icon('slice', 16), 'Slice…'))));
  }
  if (ch.type === 'synth' || ch.type === 'fm') {
    const presets = ch.type === 'synth' ? DAW.inst.synthPresets : DAW.inst.fmPresets;
    body.appendChild(ui.select('Preset', [{ v: '', l: 'Load a preset…' }, ...Object.keys(presets).map(n => ({ v: n, l: n }))], '', n => {
      if (!n) return;
      Object.assign(ch.p, DAW.inst.types[ch.type].defaults(), presets[n]);
      S.commit('Load preset ' + n); ui.openChannel(ch.id, tab); s.close();
    }));
  }
  if (ch.type === 'layer') {
    const others = S.p.channels.filter(c => c.id !== ch.id && DAW.inst.types[c.type].play);
    body.appendChild(h('div.sec-title', 'Channels triggered by this layer'));
    const list = h('div.menu-list');
    others.forEach(o => list.appendChild(ui.toggle(o.name, ch.children.includes(o.id), v => {
      ch.children = ch.children.filter(x => x !== o.id); if (v) ch.children.push(o.id); S.commit('Layer children');
    })));
    if (!others.length) list.appendChild(ui.empty('link', 'Nothing to layer', 'Add other channels first.'));
    body.appendChild(list);
  }
  if (ch.type === 'auto') body.appendChild(h('p.dim', 'Automation clips are created from a knob: press and hold it, then choose “Create automation clip”.'));

  /* tabs from schema + common */
  const groups = [...(T.groups || []), ...(T.noPlay ? [] : DAW.inst.common)];
  let tab = tabName || (groups[0] && groups[0].name);
  if (groups.length) {
    const tabs = h('div.tabs'), pane = h('div');
    const showTab = name => {
      tab = name;
      U.$$('.tab', tabs).forEach(b => b.classList.toggle('on', b.textContent === name));
      U.clear(pane);
      const g = groups.find(x => x.name === name);
      pane.appendChild(ui.paramGrid(g.params, ch.p, (pid, v, commit2) => {
        touch();
        if (wave && (pid === 'start' || pid === 'end' || pid === 'loopStart' || pid === 'loopEnd' || pid === 'reverse')) wave.redraw();
        if (commit2) S.commit('Edit ' + g.name);
      }, d => (d.type === 'knob' ? 'ch:' + ch.id + ':p:' + d.id : null)));
      if (g.name === 'Arpeggiator') pane.appendChild(h('p.dim', 'The arpeggiator re-plays notes that start together as a pattern at the chosen rate.'));
    };
    groups.forEach(g => tabs.appendChild(h('button.tab' + (g.name === tab ? '.on' : ''), { onclick: () => showTab(g.name) }, g.name)));
    body.appendChild(tabs); body.appendChild(pane);
    showTab(tab);
  }

  /* test keys */
  if (!T.noPlay || ch.type === 'layer') {
    const keys = h('div.row', { style: { marginTop: '1rem' } }, h('span.tl', 'Test:'));
    [48, 55, 60, 64, 67, 72].forEach(k => {
      const b = h('button.btn.small', U.noteName(k));
      let hd = null;
      b.addEventListener('pointerdown', async e => { e.preventDefault(); hd = await DAW.audio.noteOn(ch.id, k, 100); });
      const up = () => { if (hd) { hd.off(); hd = null; } };
      b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      keys.appendChild(b);
    });
    body.appendChild(keys);
  }
};
})();
