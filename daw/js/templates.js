'use strict';
/* Beatforge — starter projects. */
(() => {
const DAW = window.DAW;
const C = DAW.C;
const T = DAW.templates = {};

const kit = S => ({
  kick: S.addChannel('sampler', { name: 'Kick', sample: 'f:kick808' }),
  clap: S.addChannel('sampler', { name: 'Clap', sample: 'f:clap1' }),
  hat: S.addChannel('sampler', { name: 'Hat', sample: 'f:hatC1' }),
  snare: S.addChannel('sampler', { name: 'Snare', sample: 'f:snare1' }),
});
const steps = (S, pat, ch, list, vel) => list.forEach(i => S.toggleStep(pat, ch.id, i, typeof vel === 'function' ? vel(i) : vel));
const note = (S, pat, ch, step, k, len, vel) => S.addNote(pat, ch.id, { t: Math.round(step * C.STEP), d: Math.round(len * C.STEP), k, v: vel || 100 });
const synth = (S, name, preset, extra) => S.addChannel('synth', { name, p: Object.assign({}, DAW.inst.synthPresets[preset], extra || {}) });
const place = (S, track, pat, bar, bars) => {
  const tpb = S.ticksPerBar();
  S.addClip({ type: 'pat', track, t: bar * tpb, d: bars * tpb, ref: pat.id, off: 0 });
};
const nameTrack = (S, n, name, col) => { const t = S.p.playlist.tracks[n]; t.name = name; t.col = col; };

T.empty = S => {
  kit(S);
  const p = S.addPattern('Pattern 1');
  p.bars = 1;
  S.ui.pat = p.id;
};

T.house = S => {
  S.p.tempo = 124; S.p.meta.name = 'House sketch'; S.p.meta.genre = 'House';
  const k = kit(S);
  const oh = S.addChannel('sampler', { name: 'Open hat', sample: 'f:hatO1' });
  const bass = synth(S, 'Bass', 'Sub bass');
  const chords = synth(S, 'Chords', 'Warm pad');
  const lead = synth(S, 'Pluck', 'Pluck arp');
  const drums = S.addPattern('Drums');
  steps(S, drums, k.kick, [0, 4, 8, 12], 118);
  steps(S, drums, k.clap, [4, 12], 105);
  steps(S, drums, k.hat, [2, 6, 10, 14], 92);
  steps(S, drums, k.hat, [0, 1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15], 48);
  steps(S, drums, oh, [6, 14], 80);
  const bs = S.addPattern('Bassline');
  [[2, 33], [6, 33], [10, 36], [14, 31]].forEach(([s, kk]) => note(S, bs, bass, s, kk, 1.5, 105));
  [[0, 33], [4, 33], [8, 36], [12, 31]].forEach(([s, kk]) => note(S, bs, bass, s, kk - 12, 0.5, 85));
  const ch = S.addPattern('Chords');
  ch.bars = 4;
  [[0, [57, 60, 64]], [16, [53, 57, 60]], [32, [48, 52, 55]], [48, [55, 59, 62]]].forEach(([s, ks]) => ks.forEach(kk => note(S, ch, chords, s, kk, 15, 82)));
  const ld = S.addPattern('Pluck');
  ld.bars = 2;
  [[0, 69], [3, 72], [6, 76], [8, 72], [11, 69], [14, 67], [16, 65], [19, 69], [22, 72], [24, 69], [27, 65], [30, 67]].forEach(([s, kk]) => note(S, ld, lead, s, kk, 1, 96));
  place(S, 0, drums, 0, 8); place(S, 1, bs, 2, 6); place(S, 2, ch, 0, 8); place(S, 3, ld, 4, 4);
  nameTrack(S, 0, 'Drums', C.COLORS[1]); nameTrack(S, 1, 'Bass', C.COLORS[8]); nameTrack(S, 2, 'Chords', C.COLORS[4]); nameTrack(S, 3, 'Lead', C.COLORS[10]);
  S.ui.pat = drums.id;
  const tr = S.p.mixer.tracks[chords.mix];
  tr.fx[0] = S.newFx('chorus'); tr.fx[1] = S.newFx('reverb');
  const bt = S.p.mixer.tracks[bass.mix];
  bt.fx[0] = S.newFx('shaper');
  S.p.mixer.tracks[lead.mix].fx[0] = S.newFx('delay');
};

T.trap = S => {
  S.p.tempo = 140; S.p.meta.name = 'Trap sketch'; S.p.meta.genre = 'Trap';
  const kick = S.addChannel('sampler', { name: 'Kick', sample: 'f:kickPunch' });
  const snare = S.addChannel('sampler', { name: 'Snare', sample: 'f:snareSnap' });
  const clap = S.addChannel('sampler', { name: 'Clap', sample: 'f:clap808' });
  const hat = S.addChannel('sampler', { name: 'Hat', sample: 'f:hatC2' });
  const ohat = S.addChannel('sampler', { name: 'Open hat', sample: 'f:hatO2' });
  const b808 = S.addChannel('sampler', { name: '808', sample: 'f:sub808', p: { root: 36, useEnv: true, a: 2, d: 1500, s: 0.5, r: 120, pEnv: 0 }, });
  const bell = synth(S, 'Bell', 'FM bell');
  const pat = S.addPattern('Trap beat'); pat.bars = 2;
  steps(S, pat, kick, [0, 7, 10, 16, 23, 26], 120);
  steps(S, pat, snare, [8, 24], 112);
  steps(S, pat, clap, [8, 24], 96);
  const h = []; for (let i = 0; i < 32; i++) h.push(i);
  steps(S, pat, hat, h.filter(i => i % 2 === 0), i => 70 + (i % 4 === 0 ? 30 : 0));
  [14, 15, 30, 31].forEach(i => S.addNote(pat, hat.id, { t: i * C.STEP, d: 12, k: 60, v: 70 }) && S.addNote(pat, hat.id, { t: i * C.STEP + 12, d: 12, k: 60, v: 55 }));
  steps(S, pat, ohat, [12, 28], 85);
  [[0, 36, 6], [7, 36, 3], [10, 39, 6], [16, 34, 6], [23, 34, 3], [26, 31, 6]].forEach(([s, k, l]) => note(S, pat, b808, s, k, l, 112));
  [[0, 72], [4, 75], [8, 79], [12, 75], [16, 70], [20, 74], [24, 77], [28, 74]].forEach(([s, k]) => note(S, pat, bell, s, k, 3, 78));
  place(S, 0, pat, 0, 8);
  nameTrack(S, 0, 'Beat', C.COLORS[1]);
  S.ui.pat = pat.id;
};

T.lofi = S => {
  S.p.tempo = 78; S.p.swing = 0.35; S.p.meta.name = 'Lo-fi sketch'; S.p.meta.genre = 'Lo-fi';
  const kick = S.addChannel('sampler', { name: 'Kick', sample: 'f:kickTight' });
  const snare = S.addChannel('sampler', { name: 'Snare', sample: 'f:rim' });
  const hat = S.addChannel('sampler', { name: 'Hat', sample: 'f:hatC1', p: { cut: 9000, fType: 'lowpass' } });
  const keys = synth(S, 'Keys', 'Electric piano');
  const bass = synth(S, 'Bass', 'Sub bass');
  const pat = S.addPattern('Lo-fi loop'); pat.bars = 2;
  steps(S, pat, kick, [0, 7, 16, 22, 26], 108);
  steps(S, pat, snare, [8, 24], 90);
  steps(S, pat, hat, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30], i => (i % 4 === 0 ? 85 : 55));
  [[0, [57, 60, 64, 67]], [8, [53, 57, 60, 64]], [16, [50, 53, 57, 60]], [24, [55, 59, 62, 65]]].forEach(([s, ks]) => ks.forEach((kk, i) => note(S, pat, keys, s + (i * 0.1), kk, 7, 70 + i * 4)));
  [[0, 33], [8, 29], [16, 26], [24, 31]].forEach(([s, kk]) => note(S, pat, bass, s, kk, 6, 100));
  place(S, 0, pat, 0, 8);
  S.p.mixer.tracks[keys.mix].fx[0] = S.newFx('tape');
  S.p.mixer.tracks[keys.mix].fx[1] = S.newFx('reverb');
  S.ui.pat = pat.id;
};

DAW.templateList = [
  { id: 'empty', name: 'Empty project', desc: 'Kick, clap, hat and snare on an empty pattern.' },
  { id: 'house', name: 'House sketch', desc: '124 BPM · drums, bass, pad and pluck arranged over 8 bars.' },
  { id: 'trap', name: 'Trap sketch', desc: '140 BPM · hat rolls, 808 and bell.' },
  { id: 'lofi', name: 'Lo-fi sketch', desc: '78 BPM · swing, keys and tape effect.' },
];
})();
