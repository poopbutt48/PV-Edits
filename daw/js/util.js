'use strict';
/* Beatforge — shared helpers, constants and music theory tables. */
(() => {
const DAW = window.DAW = window.DAW || {};

const C = DAW.C = {
  PPQ: 96,
  STEP: 24,               // ticks per 1/16 note
  MAX_INSERTS: 125,
  FX_SLOTS: 10,
  MAX_PL_TRACKS: 500,
  MAX_PATTERNS: 999,
  NOTE_NAMES: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'],
  BLACK: [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0],
  COLORS: ['#ff6b6b', '#ff9f43', '#feca57', '#a3e635', '#2ed573', '#1dd1a1', '#48dbfb', '#54a0ff',
           '#6c7bff', '#a78bfa', '#d17bff', '#ff6bd6', '#ff7aa2', '#c8d6e5', '#8395a7', '#e17055'],
  SCALES: {
    'Chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    'Major': [0, 2, 4, 5, 7, 9, 11],
    'Minor': [0, 2, 3, 5, 7, 8, 10],
    'Harmonic minor': [0, 2, 3, 5, 7, 8, 11],
    'Melodic minor': [0, 2, 3, 5, 7, 9, 11],
    'Dorian': [0, 2, 3, 5, 7, 9, 10],
    'Phrygian': [0, 1, 3, 5, 7, 8, 10],
    'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Mixolydian': [0, 2, 4, 5, 7, 9, 10],
    'Locrian': [0, 1, 3, 5, 6, 8, 10],
    'Major pentatonic': [0, 2, 4, 7, 9],
    'Minor pentatonic': [0, 3, 5, 7, 10],
    'Blues': [0, 3, 5, 6, 7, 10],
    'Whole tone': [0, 2, 4, 6, 8, 10],
    'Diminished (W-H)': [0, 2, 3, 5, 6, 8, 9, 11],
    'Hungarian minor': [0, 2, 3, 6, 7, 8, 11],
    'Double harmonic': [0, 1, 4, 5, 7, 8, 11],
    'Phrygian dominant': [0, 1, 4, 5, 7, 8, 10],
    'Hirajoshi': [0, 2, 3, 7, 8],
    'In-sen': [0, 1, 5, 7, 10],
  },
  CHORDS: {
    'Major': [0, 4, 7], 'Minor': [0, 3, 7], 'Diminished': [0, 3, 6], 'Augmented': [0, 4, 8],
    'Sus2': [0, 2, 7], 'Sus4': [0, 5, 7], 'Power (5)': [0, 7, 12],
    'Major 6': [0, 4, 7, 9], 'Minor 6': [0, 3, 7, 9],
    'Dominant 7': [0, 4, 7, 10], 'Major 7': [0, 4, 7, 11], 'Minor 7': [0, 3, 7, 10],
    'Diminished 7': [0, 3, 6, 9], 'Half-dim 7': [0, 3, 6, 10], 'Minor-major 7': [0, 3, 7, 11],
    'Add9': [0, 4, 7, 14], 'Minor add9': [0, 3, 7, 14],
    'Major 9': [0, 4, 7, 11, 14], 'Minor 9': [0, 3, 7, 10, 14], 'Dominant 9': [0, 4, 7, 10, 14],
    'Dominant 11': [0, 4, 7, 10, 14, 17], 'Minor 11': [0, 3, 7, 10, 14, 17],
    'Dominant 13': [0, 4, 7, 10, 14, 21], 'Octave': [0, 12], 'Fifth + octave': [0, 7, 12, 19],
  },
  SNAPS: [
    { id: 'none', label: 'None', ticks: 0 },
    { id: 'cell', label: 'Cell (auto)', ticks: -1 },
    { id: '1/6s', label: '1/6 step', ticks: 4 },
    { id: '1/4s', label: '1/4 step', ticks: 6 },
    { id: '1/3s', label: '1/3 step', ticks: 8 },
    { id: '1/2s', label: '1/2 step', ticks: 12 },
    { id: 'step', label: 'Step', ticks: 24 },
    { id: '1/3b', label: '1/3 beat', ticks: 32 },
    { id: '1/2b', label: '1/2 beat', ticks: 48 },
    { id: 'beat', label: 'Beat', ticks: 96 },
    { id: 'bar', label: 'Bar', ticks: -2 },
  ],
};

const U = DAW.util = {};

U.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
U.lerp = (a, b, t) => a + (b - a) * t;
U.mtof = k => 440 * Math.pow(2, (k - 69) / 12);
U.noteName = k => C.NOTE_NAMES[((k % 12) + 12) % 12] + Math.floor(k / 12);
U.isBlack = k => C.BLACK[((k % 12) + 12) % 12] === 1;
U.dbToGain = db => Math.pow(10, db / 20);
U.gainToDb = g => (g <= 1e-5 ? -Infinity : 20 * Math.log10(g));
// Fader taper: position 0..1 -> linear gain, 0.8 = unity (0 dB), 1.0 = about +3.9 dB.
U.faderToGain = f => { const x = f / 0.8; return f <= 0 ? 0 : x * x; };
U.gainToFader = g => (g <= 0 ? 0 : Math.sqrt(g) * 0.8);
U.fmtDb = g => { const d = U.gainToDb(g); return d === -Infinity ? '-inf' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' dB'; };
U.noop = () => {};
U.rnd = (a, b) => a + Math.random() * (b - a);
U.pick = arr => arr[Math.floor(Math.random() * arr.length)];

U.debounce = (fn, ms) => {
  let t = 0;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.flush = (...a) => { clearTimeout(t); fn(...a); };
  f.cancel = () => clearTimeout(t);
  return f;
};

U.rafOnce = fn => {
  let q = 0;
  return () => { if (q) return; q = requestAnimationFrame(() => { q = 0; fn(); }); };
};

U.Emitter = class {
  constructor() { this._l = {}; }
  on(evt, fn) {
    (this._l[evt] = this._l[evt] || []).push(fn);
    return () => this.off(evt, fn);
  }
  off(evt, fn) { const a = this._l[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(evt, ...args) {
    const a = this._l[evt];
    if (a) for (const fn of a.slice()) { try { fn(...args); } catch (e) { console.error('[event ' + evt + ']', e); } }
  }
};

/* ---- DOM ---- */
const SVGNS = 'http://www.w3.org/2000/svg';
U.h = function h(tag, props, ...kids) {
  const m = /^([\w:-]*)((?:[.#][\w-]+)*)$/.exec(tag);
  let name = (m && m[1]) || 'div';
  let svg = false;
  if (name.startsWith('svg:')) { svg = true; name = name.slice(4); }
  const el = svg ? document.createElementNS(SVGNS, name) : document.createElement(name);
  if (m && m[2]) {
    const re = /([.#])([\w-]+)/g; let x; const cls = [];
    while ((x = re.exec(m[2]))) { if (x[1] === '.') cls.push(x[2]); else el.id = x[2]; }
    if (cls.length) el.setAttribute('class', cls.join(' '));
  }
  let value;
  if (props && props.constructor === Object) {
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.setAttribute('class', ((el.getAttribute('class') || '') + ' ' + v).trim());
      else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else for (const sk in v) { if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') value = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (!svg && (k === 'textContent' || k === 'innerHTML' || k === 'disabled' || k === 'checked' || k === 'hidden' || k === 'type' || k === 'min' || k === 'max' || k === 'step' || k === 'title' || k === 'placeholder' || k === 'accept' || k === 'multiple' || k === 'selected')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  } else if (props != null) {
    kids.unshift(props);
  }
  const add = k => {
    if (k == null || k === false) return;
    if (Array.isArray(k)) k.forEach(add);
    else el.appendChild(k.nodeType ? k : document.createTextNode(String(k)));
  };
  kids.forEach(add);
  if (value !== undefined) el.value = value;
  return el;
};
U.$ = (sel, root) => (root || document).querySelector(sel);
U.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
U.clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/* ---- icons: 24x24 grid, stroke style unless fill:1 ---- */
const ICONS = {
  play: { d: 'M8 5v14l11-7z', fill: 1 },
  pause: { d: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z', fill: 1 },
  stop: { d: 'M6.5 6.5h11v11h-11z', fill: 1 },
  rec: { d: 'M12 6a6 6 0 1 0 0 12a6 6 0 0 0 0-12z', fill: 1 },
  prev: { d: 'M6 5h2.5v14H6zM19 5v14L9.5 12z', fill: 1 },
  loop: { d: 'M4 12a4 4 0 0 1 4-4h10M15.5 4.5L19 8l-3.5 3.5M20 12a4 4 0 0 1-4 4H6M8.5 12.5L5 16l3.5 3.5' },
  metro: { d: 'M9 3h6l3.5 18h-13zM12 16l4-9' },
  menu: { d: 'M4 6h16M4 12h16M4 18h16' },
  plus: { d: 'M12 5v14M5 12h14' },
  minus: { d: 'M5 12h14' },
  x: { d: 'M6 6l12 12M18 6L6 18' },
  check: { d: 'M5 12.5l4.5 4.5L19 7.5' },
  chevR: { d: 'M9 5l7 7-7 7' }, chevL: { d: 'M15 5l-7 7 7 7' },
  chevD: { d: 'M5 9l7 7 7-7' }, chevU: { d: 'M5 15l7-7 7 7' },
  rack: { d: 'M4 6h3v3H4zM9.5 6h3v3h-3zM15 6h3v3h-3zM4 11h3v3H4zM9.5 11h3v3h-3zM15 11h3v3h-3zM4 16h3v3H4zM9.5 16h3v3h-3zM15 16h3v3h-3z' },
  playlist: { d: 'M4 6h9M8 11h12M4 16h7M13.5 16H20', w: 3 },
  piano: { d: 'M4 4h16v16H4zM9.33 4v16M14.66 4v16M8 4h2.7v9H8zM13.3 4H16v9h-2.7z' },
  mixer: { d: 'M6 4v16M12 4v16M18 4v16M4 14h4M10 8h4M16 15h4', w: 2.2 },
  folder: { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  gear: { d: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1' },
  undo: { d: 'M8 7L3 12l5 5M3 12h11a6 6 0 0 1 0 8h-3' },
  redo: { d: 'M16 7l5 5-5 5M21 12H10a6 6 0 0 0 0 8h3' },
  pencil: { d: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4' },
  select: { d: 'M4 4h16v16H4z', dash: 1 },
  eraser: { d: 'M8 20h12M4.5 14.5L13 6l5 5-6.5 7.5H8z' },
  slice: { d: 'M6 4.5a2 2 0 1 0 0.01 0zM6 14.5a2 2 0 1 0 0.01 0zM7.5 7.5L20 20M7.5 16.5L20 4' },
  mute: { d: 'M4 9v6h4l5 4V5L8 9zM17 9l4 6M21 9l-4 6' },
  speaker: { d: 'M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12' },
  zoom: { d: 'M10.5 4a6.5 6.5 0 1 0 0.01 0zM16 16l5 5M8 10.5h5M10.5 8v5' },
  hand: { d: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4a1.5 1.5 0 0 1 3 0v7M14 11V5.5a1.5 1.5 0 0 1 3 0V13c0 5-3 7-6 7s-5-2-6-5l-1-3 2.4-1z' },
  snap: { d: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 7h4M14 7h4' },
  note: { d: 'M9 17V5l11-2v12M9 17a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 15a3 3 0 1 1-6 0a3 3 0 0 1 6 0z' },
  save: { d: 'M5 4h12l3 3v13H5zM8 4v5h8V4M8 20v-6h8v6' },
  download: { d: 'M12 4v11M7 11l5 5 5-5M5 20h14' },
  upload: { d: 'M12 16V5M7 9l5-5 5 5M5 20h14' },
  mic: { d: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4' },
  keys: { d: 'M3 7h18v10H3zM6.5 10.5h.01M9.5 10.5h.01M12.5 10.5h.01M15.5 10.5h.01M17.5 10.5h.01M7 14h10', w: 2 },
  wave: { d: 'M3 12h2l2-6 3 12 3-9 2 6 2-3h4' },
  trash: { d: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6' },
  copy: { d: 'M8 8h11v12H8zM5 16V4h11' },
  paste: { d: 'M8 5H5v15h6M9 3h6v4H9zM13 11h7v9h-7z' },
  dots: { d: 'M12 5.5v.01M12 12v.01M12 18.5v.01', w: 3.6 },
  link: { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' },
  fx: { d: 'M5 17V9M9 17V5M13 17v-6M17 17V7M3 20.5h18', w: 2.2 },
  bolt: { d: 'M13 3L5 14h6l-1 7 8-11h-6z' },
  info: { d: 'M12 11v6M12 7.5v.01M12 3a9 9 0 1 0 0.01 0z' },
  dice: { d: 'M5 5h14v14H5zM9 9v.01M15 9v.01M9 15v.01M15 15v.01M12 12v.01', w: 2 },
  wand: { d: 'M5 19L15 9M14 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM18 12l.7 1.5 1.5.7-1.5.7-.7 1.5-.7-1.5-1.5-.7 1.5-.7z' },
  lock: { d: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
  eye: { d: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9.5a2.5 2.5 0 1 0 0.01 0z' },
  star: { d: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6L12 16.6 6.5 19.6l1.2-6L3.2 9.4l6.1-.8z' },
  up: { d: 'M12 19V5M6 11l6-6 6 6' }, down: { d: 'M12 5v14M6 13l6 6 6-6' },
  left: { d: 'M19 12H5M11 6l-6 6 6 6' }, right: { d: 'M5 12h14M13 6l6 6-6 6' },
  expand: { d: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5' },
  clock: { d: 'M12 4a8 8 0 1 0 0.01 0zM12 8v4l3 2' },
  file: { d: 'M6 3h8l4 4v14H6zM14 3v4h4' },
  knob: { d: 'M12 4a8 8 0 1 0 0.01 0zM12 12l3.5-5' },
  headphones: { d: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H5a1 1 0 0 1-1-1zM20 15h-3v5h2a1 1 0 0 0 1-1z' },
  scale: { d: 'M4 20V10h3v10zM10.5 20V6h3v14zM17 20V13h3v7z' },
  swap: { d: 'M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4' },
  phase: { d: 'M12 4a8 8 0 1 0 0.01 0zM12 4v16M5 19L19 5' },
  route: { d: 'M5 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3h4M17 15l3 3-3 3', w: 2 },
  paint: { d: 'M5 19l4-1 9-9-3-3-9 9zM15 6l3 3', w: 2 },
  stamp: { d: 'M8 11V8a4 4 0 0 1 8 0v3M5 15h14v3H5zM7 11h10l-1 4H8z' },
  tempo: { d: 'M12 3l5 18H7zM12 16V8M9 3h6', w: 1.8 },
  cpu: { d: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4' },
  graph: { d: 'M4 20V6M4 20h16M8 17v-5M12 17V8M16 17v-8', w: 2.2 },
  rewind: { d: 'M11 6v12L3 12zM21 6v12l-8-6z', fill: 1 },
  ff: { d: 'M13 6v12l8-6zM3 6v12l8-6z', fill: 1 },
};
U.ICONS = ICONS;
U.icon = (name, size) => {
  const ic = ICONS[name] || ICONS.dots;
  const s = size || 22;
  const attrs = { viewBox: '0 0 24 24', width: s, height: s, class: 'ico', 'aria-hidden': 'true' };
  const p = ic.fill
    ? { d: ic.d, fill: 'currentColor' }
    : { d: ic.d, fill: 'none', stroke: 'currentColor', 'stroke-width': ic.w || 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  if (ic.dash) p['stroke-dasharray'] = '3 3';
  return U.h('svg:svg', attrs, U.h('svg:path', p));
};

/* ---- colour ---- */
U.hex2rgb = hex => {
  let s = hex.replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
U.rgba = (hex, a) => { const [r, g, b] = U.hex2rgb(hex); return `rgba(${r},${g},${b},${a})`; };
U.mix = (hex, other, t) => {
  const a = U.hex2rgb(hex), b = U.hex2rgb(other);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
U.lighten = (hex, t) => U.mix(hex, '#ffffff', t);
U.darken = (hex, t) => U.mix(hex, '#000000', t);

/* ---- parameter value mapping (knob/slider) ---- */
// def: {min,max,curve:'lin'|'log'|'pow',step,unit,labels:[...]}
U.toNorm = (d, v) => {
  const a = d.min, b = d.max;
  if (b === a) return 0;
  let n;
  if (d.curve === 'log') n = Math.log(Math.max(v, 1e-6) / a) / Math.log(b / a);
  else if (d.curve === 'pow') n = Math.pow(U.clamp((v - a) / (b - a), 0, 1), 1 / (d.pow || 2));
  else n = (v - a) / (b - a);
  return U.clamp(n, 0, 1);
};
U.fromNorm = (d, n) => {
  n = U.clamp(n, 0, 1);
  const a = d.min, b = d.max;
  let v;
  if (d.curve === 'log') v = a * Math.pow(b / a, n);
  else if (d.curve === 'pow') v = a + Math.pow(n, d.pow || 2) * (b - a);
  else v = a + n * (b - a);
  if (d.step) v = Math.round((v - a) / d.step) * d.step + a;
  return U.clamp(v, a, b);
};
U.fmtVal = (d, v) => {
  if (d.fmt) return d.fmt(v);
  const u = d.unit || '';
  const ad = Math.abs(v);
  switch (u) {
    case 'Hz': return ad >= 10000 ? (v / 1000).toFixed(1) + ' kHz' : ad >= 1000 ? (v / 1000).toFixed(2) + ' kHz' : v.toFixed(ad < 100 ? 1 : 0) + ' Hz';
    case 'ms': return ad >= 1000 ? (v / 1000).toFixed(2) + ' s' : v.toFixed(ad < 10 ? 1 : 0) + ' ms';
    case 's': return v.toFixed(2) + ' s';
    case 'dB': return (v > 0 ? '+' : '') + v.toFixed(1) + ' dB';
    case '%': return Math.round(v * 100) + '%';
    case 'st': return (v > 0 ? '+' : '') + (Number.isInteger(v) ? v : v.toFixed(1)) + ' st';
    case 'ct': return (v > 0 ? '+' : '') + Math.round(v) + ' ct';
    case ':1': return v.toFixed(1) + ':1';
    case 'x': return v.toFixed(2) + '×';
    case 'deg': return Math.round(v) + '°';
    case 'bpm': return v.toFixed(2);
    case 'int': return String(Math.round(v));
    case 'pan': return v === 0 ? 'Center' : (v < 0 ? Math.round(-v * 100) + '% L' : Math.round(v * 100) + '% R');
    default: return Number.isInteger(v) ? String(v) : (ad < 10 ? v.toFixed(2) : v.toFixed(1));
  }
};

/* ---- time display ---- */
U.ticksToBBT = (ticks, tpb) => {
  const bar = Math.floor(ticks / tpb) + 1;
  const rem = ticks % tpb;
  const beat = Math.floor(rem / C.PPQ) + 1;
  const tk = Math.floor(rem % C.PPQ);
  return [bar, beat, tk];
};
U.pad = (n, w) => String(Math.floor(n)).padStart(w, '0');
U.fmtBBT = (ticks, tpb) => { const [a, b, c] = U.ticksToBBT(ticks, tpb); return U.pad(a, 3) + ':' + U.pad(b, 2) + ':' + U.pad(c, 2); };
U.fmtMSC = sec => {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), cs = Math.floor((sec * 100) % 100);
  return U.pad(m, 2) + ':' + U.pad(s, 2) + ':' + U.pad(cs, 2);
};

/* ---- pointer drag helper ---- */
U.drag = (el, o) => {
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const st = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId, moved: false, held: false, target: e.target };
    if (o.down && o.down(e, st) === false) return;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    let holdT = 0;
    if (o.hold) holdT = setTimeout(() => { if (!st.moved) { st.held = true; o.hold(e, st); } }, o.holdMs || 520);
    const mv = ev => {
      if (ev.pointerId !== st.id) return;
      st.x = ev.clientX; st.y = ev.clientY; st.dx = st.x - st.x0; st.dy = st.y - st.y0;
      if (!st.moved && Math.hypot(st.dx, st.dy) > (o.threshold == null ? 5 : o.threshold)) { st.moved = true; clearTimeout(holdT); }
      if (o.move) o.move(ev, st);
    };
    const end = ev => {
      if (ev.pointerId !== st.id) return;
      clearTimeout(holdT);
      el.removeEventListener('pointermove', mv);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      try { el.releasePointerCapture(st.id); } catch (_) { /* ignore */ }
      if (o.up) o.up(ev, st);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  });
};

/* ---- files ---- */
U.saveBlob = (blob, name) => {
  const a = U.h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
};
U.pickFiles = (accept, multiple) => new Promise(res => {
  const i = U.h('input', { type: 'file', accept: accept || '', multiple: !!multiple, style: 'position:fixed;left:-999px' });
  i.addEventListener('change', () => { res(Array.from(i.files || [])); i.remove(); });
  i.addEventListener('cancel', () => { res([]); i.remove(); });
  document.body.appendChild(i);
  i.click();
});
U.readAB = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
U.readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });
U.b64 = ab => {
  const b = new Uint8Array(ab); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
U.unb64 = s => { const bin = atob(s); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b.buffer; };

U.deep = o => JSON.parse(JSON.stringify(o));

/* seeded RNG for repeatable generative content */
U.rng = seed => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
})();
