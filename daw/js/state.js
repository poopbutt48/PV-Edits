'use strict';
/* Beatforge — project model, undo/redo and persistence. */
(() => {
const DAW = window.DAW;
const U = DAW.util, C = DAW.C;

const S = DAW.state = new U.Emitter();
C.STEP_KEY = 60;

const rawEmit = S.emit.bind(S);
S.building = false;
S.emit = (...a) => { if (!S.building) rawEmit(...a); };
S.p = null;
S.ui = { view: 'rack', pat: 1, ch: null, track: 1, tool: 'draw' };
S.dirty = false;

/* ---------- factories ---------- */
S.id = () => S.p.nextId++;

function newTrack(n) {
  return {
    name: n === 0 ? 'Master' : 'Insert ' + n, col: null, vol: 0.8, pan: 0, sep: 0, mute: false, solo: false,
    inv: false, swap: false, delay: 0, arm: false,
    fx: new Array(C.FX_SLOTS).fill(null),
    eq: { on: true, lg: 0, lf: 90, mg: 0, mf: 1000, mq: 1, hg: 0, hf: 8000 },
    routes: n === 0 ? {} : { 0: 1 },
  };
}
S.newTrack = newTrack;

S.newFx = type => {
  const t = DAW.fx.types[type];
  const p = {};
  t.params.forEach(d => { p[d.id] = d.def; });
  return { id: S.id(), type, on: true, mix: t.mixDef == null ? 1 : t.mixDef, p };
};

function blankProject() {
  const p = {
    v: 1,
    meta: { name: 'Untitled', author: '', genre: '', comments: '', created: Date.now(), modified: Date.now() },
    tempo: 130, num: 4, den: 4, swing: 0, masterPitch: 0, mode: 'pattern', nextId: 100,
    channels: [], patterns: [],
    playlist: { tracks: [], clips: [], markers: [], loopOn: false, loopStart: 0, loopEnd: 384 * 4 },
    mixer: { tracks: [] },
    automation: [],
  };
  for (let i = 0; i <= 16; i++) p.mixer.tracks.push(newTrack(i));
  for (let i = 1; i <= Math.max(24, DAW.settings.get('plTrackCount')); i++) p.playlist.tracks.push({ name: 'Track ' + i, col: null, mute: false, solo: false });
  return p;
}

S.ticksPerBar = () => Math.round(S.p.num * 4 * C.PPQ / S.p.den);
S.stepsPerBar = () => S.ticksPerBar() / C.STEP;
S.secPerTick = () => 60 / (S.p.tempo * C.PPQ);

/* ---------- channels ---------- */
S.getCh = id => S.p.channels.find(c => c.id === id);
S.getPat = id => S.p.patterns.find(p => p.id === id);
S.curPat = () => S.getPat(S.ui.pat) || S.p.patterns[0];
S.curCh = () => S.getCh(S.ui.ch) || S.p.channels[0];

S.addChannel = (type, o = {}) => {
  const T = DAW.inst.types[type];
  const used = new Set(S.p.channels.map(c => c.color));
  const color = o.color || C.COLORS.find(c => !used.has(c)) || C.COLORS[S.p.channels.length % C.COLORS.length];
  const ch = {
    id: S.id(), type, name: o.name || T.label, color, mute: false, solo: false,
    vol: o.vol != null ? o.vol : 0.8, pan: 0, pitch: 0, mix: 0,
    p: Object.assign(DAW.inst.commonDefaults(), T.defaults(), o.p || {}),
    sample: o.sample || null, children: [], target: null,
  };
  if (o.mix != null) ch.mix = o.mix;
  else if (DAW.settings.get('autoRoute') && type !== 'auto') {
    const usedMix = new Set(S.p.channels.map(c => c.mix));
    for (let i = 1; i < S.p.mixer.tracks.length; i++) if (!usedMix.has(i)) { ch.mix = i; break; }
    if (ch.mix) {
      const tr = S.p.mixer.tracks[ch.mix];
      if (/^Insert \d+$/.test(tr.name)) tr.name = ch.name;
      tr.col = ch.color;
    }
  }
  const at = o.index != null ? o.index : S.p.channels.length;
  S.p.channels.splice(at, 0, ch);
  S.ui.ch = ch.id;
  S.emit('channels');
  return ch;
};

S.removeChannel = id => {
  S.p.channels = S.p.channels.filter(c => c.id !== id);
  S.p.channels.forEach(c => { c.children = c.children.filter(x => x !== id); });
  S.p.patterns.forEach(pt => { delete pt.notes[id]; });
  S.p.playlist.clips = S.p.playlist.clips.filter(c => !(c.type === 'aud' && c.ref === id));
  if (S.ui.ch === id) S.ui.ch = S.p.channels.length ? S.p.channels[0].id : null;
  S.emit('channels');
};

S.cloneChannel = id => {
  const src = S.getCh(id);
  const c = U.deep(src);
  c.id = S.id(); c.name = src.name + ' 2';
  const at = S.p.channels.indexOf(src) + 1;
  S.p.channels.splice(at, 0, c);
  S.p.patterns.forEach(pt => { if (pt.notes[id]) pt.notes[c.id] = pt.notes[id].map(n => Object.assign({}, n, { id: S.id() })); });
  S.ui.ch = c.id;
  S.emit('channels');
  return c;
};

S.moveChannel = (id, dir) => {
  const a = S.p.channels, i = a.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= a.length) return;
  [a[i], a[j]] = [a[j], a[i]];
  S.emit('channels');
};

/* ---------- patterns & notes ---------- */
S.addPattern = (name, o = {}) => {
  const n = S.p.patterns.length + 1;
  const used = Math.max(0, ...S.p.patterns.map(p => p.id));
  const pat = { id: used + 1, name: name || 'Pattern ' + n, color: o.color || C.COLORS[(n * 5) % C.COLORS.length], bars: o.bars || 1, notes: {} };
  S.p.patterns.push(pat);
  S.ui.pat = pat.id;
  S.emit('pattern');
  return pat;
};
S.clonePattern = id => {
  const src = S.getPat(id);
  const pat = S.addPattern(src.name + ' copy', { color: src.color, bars: src.bars });
  for (const k in src.notes) pat.notes[k] = src.notes[k].map(n => Object.assign({}, n, { id: S.id() }));
  S.emit('pattern');
  return pat;
};
S.removePattern = id => {
  if (S.p.patterns.length <= 1) return false;
  S.p.patterns = S.p.patterns.filter(p => p.id !== id);
  S.p.playlist.clips = S.p.playlist.clips.filter(c => !(c.type === 'pat' && c.ref === id));
  if (S.ui.pat === id) S.ui.pat = S.p.patterns[0].id;
  S.emit('pattern');
  return true;
};
S.notesOf = (pat, chId, create) => {
  let a = pat.notes[chId];
  if (!a && create) a = pat.notes[chId] = [];
  return a || [];
};
S.patLenTicks = pat => {
  let bars = pat.bars || 1;
  const tpb = S.ticksPerBar();
  for (const k in pat.notes) for (const n of pat.notes[k]) bars = Math.max(bars, Math.ceil((n.t + 1) / tpb));
  return bars * tpb;
};
S.addNote = (pat, chId, n) => {
  n.id = S.id();
  S.notesOf(pat, chId, true).push(n);
  return n;
};
S.stepOn = (pat, chId, step) => S.notesOf(pat, chId).filter(n => Math.floor(n.t / C.STEP) === step);
S.toggleStep = (pat, chId, step, vel) => {
  const hit = S.stepOn(pat, chId, step);
  if (hit.length) {
    pat.notes[chId] = pat.notes[chId].filter(n => !hit.includes(n));
    return false;
  }
  S.addNote(pat, chId, { t: step * C.STEP, d: C.STEP, k: C.STEP_KEY, v: vel || 100 });
  const need = Math.ceil((step + 1) / S.stepsPerBar());
  if (need > pat.bars) pat.bars = need;
  return true;
};

/* ---------- playlist ---------- */
S.addClip = c => { c.id = S.id(); S.p.playlist.clips.push(c); S.emit('playlist'); return c; };
S.songEnd = () => {
  let e = 0;
  for (const c of S.p.playlist.clips) e = Math.max(e, c.t + c.d);
  return e;
};

/* ---------- history ---------- */
const PARTS = ['channels', 'patterns', 'playlist', 'mixer', 'automation'];
const CORE = ['meta', 'tempo', 'num', 'den', 'swing', 'masterPitch', 'mode', 'nextId'];
let hist = [], hi = -1;

function snapshot(prev) {
  const snap = {};
  for (const k of PARTS) {
    const s = JSON.stringify(S.p[k]);
    snap[k] = prev && prev[k] === s ? prev[k] : s;
  }
  const core = {}; CORE.forEach(k => { core[k] = S.p[k]; });
  const cs = JSON.stringify(core);
  snap.core = prev && prev.core === cs ? prev.core : cs;
  return snap;
}
S.resetHistory = () => { hist = [snapshot()]; hi = 0; S.emit('history'); };
S.commit = label => {
  const prev = hist[hi];
  const snap = snapshot(prev);
  const same = prev && Object.keys(snap).every(k => snap[k] === prev[k]);
  S.dirty = true;
  S.p.meta.modified = Date.now();
  if (same) { S.emit('dirty'); return; }
  snap.label = label || 'Edit';
  hist = hist.slice(0, hi + 1);
  hist.push(snap);
  if (hist.length > 150) hist.shift();
  hi = hist.length - 1;
  S.emit('history');
  S.emit('dirty');
};
S.canUndo = () => hi > 0;
S.canRedo = () => hi < hist.length - 1;
function restore(i) {
  hi = i;
  const snap = hist[hi];
  PARTS.forEach(k => { S.p[k] = JSON.parse(snap[k]); });
  Object.assign(S.p, JSON.parse(snap.core));
  if (!S.getPat(S.ui.pat)) S.ui.pat = S.p.patterns[0].id;
  if (!S.getCh(S.ui.ch)) S.ui.ch = S.p.channels.length ? S.p.channels[0].id : null;
  S.dirty = true;
  S.emit('restore');
  S.emit('history');
  S.emit('dirty');
}
S.undo = () => { if (S.canUndo()) restore(hi - 1); };
S.redo = () => { if (S.canRedo()) restore(hi + 1); };
S.undoLabel = () => (S.canUndo() ? hist[hi].label : '');
S.redoLabel = () => (S.canRedo() ? hist[hi + 1].label : '');

/* ---------- project lifecycle ---------- */
S.setProject = (p, keepId) => {
  S.p = p;
  S.projectId = keepId || ('p' + Date.now().toString(36));
  S.ui.pat = p.patterns.length ? p.patterns[0].id : 1;
  S.ui.ch = p.channels.length ? p.channels[0].id : null;
  S.ui.track = 1;
  S.dirty = false;
  S.resetHistory();
  S.emit('project');
};
S.newProject = (template) => {
  const p = blankProject();
  S.p = p;
  S.building = true;
  try {
    if (template && DAW.templates && DAW.templates[template]) DAW.templates[template](S);
    else DAW.templates.empty(S);
  } finally { S.building = false; }
  const proj = S.p;
  S.setProject(proj);
  return proj;
};
S.migrate = p => {
  const b = blankProject();
  for (const k in b) if (!(k in p)) p[k] = b[k];
  while (p.mixer.tracks.length < 17) p.mixer.tracks.push(newTrack(p.mixer.tracks.length));
  p.mixer.tracks.forEach((t, i) => {
    t.fx = (t.fx || []).slice(0, C.FX_SLOTS);
    while (t.fx.length < C.FX_SLOTS) t.fx.push(null);
    if (!t.routes) t.routes = i === 0 ? {} : { 0: 1 };
    if (!t.eq) t.eq = newTrack(i).eq;
  });
  p.channels.forEach(c => {
    const T = DAW.inst.types[c.type];
    if (T) c.p = Object.assign(DAW.inst.commonDefaults(), T.defaults(), c.p || {});
    c.children = c.children || [];
  });
  return p;
};

/* ---------- persistence ---------- */
S.serialize = () => JSON.stringify(S.p);
S.saveLocal = async (name) => {
  if (name) S.p.meta.name = name;
  S.p.meta.modified = Date.now();
  await DAW.db.put('projects', S.projectId, { id: S.projectId, name: S.p.meta.name, modified: S.p.meta.modified, json: S.serialize() });
  await DAW.db.put('kv', 'last', S.projectId);
  S.dirty = false;
  S.emit('saved');
};
S.listLocal = async () => (await DAW.db.all('projects')).map(x => x.val).sort((a, b) => b.modified - a.modified);
S.loadLocal = async id => {
  const r = await DAW.db.get('projects', id);
  if (!r) return false;
  S.setProject(S.migrate(JSON.parse(r.json)), id);
  await DAW.db.put('kv', 'last', id);
  return true;
};
S.deleteLocal = async id => { await DAW.db.del('projects', id); };
S.loadLast = async () => {
  const id = await DAW.db.get('kv', 'last');
  return id ? S.loadLocal(id) : false;
};
S.importJSON = text => {
  const p = S.migrate(JSON.parse(text));
  S.setProject(p);
};

})();
