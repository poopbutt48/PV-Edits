// Built-in pixel art so beginners have pictures to use straight away.
// Every picture here is drawn by code (no image files), and can be edited
// in the Pixel Art editor like any other picture.

const PALETTE = {
  '.': null,
  o: '#1b2a1b', // outline
  l: '#7ed957', // leaf light
  L: '#3fa34d', // leaf dark
  s: '#4a7c3a', // stem
  B: '#a6e36d', // body
  w: '#ffffff',
  k: '#14141f',
  p: '#ff9eb1',
  m: '#7a2e3a',
  f: '#6b4226',
};

const HERO_TOP = [
  '.....l....l.....',
  '....lLl..lLl....',
  '.....lLllLl.....',
  '.......ss.......',
  '.....oooooo.....',
  '....oBBBBBBo....',
  '...oBBBBBBBBo...',
  '...oBwkBBwkBo...',
  '...oBkkBBkkBo...',
  '...oBBBBBBBBo...',
  '...oBpBBBBpBo...',
  '....oBBmmBBo....',
  '.....oBBBBo.....',
  '......oooo......',
];
const HERO_FEET = [
  ['.....ff..ff.....', '....fff..fff....'],
  ['....ff....ff....', '...fff....fff...'],
  ['......ffff......', '.....ff..ff.....'],
];

function rowsToPixels(rows, palette) {
  const h = rows.length;
  const w = rows[0].length;
  for (const r of rows) if (r.length !== w) throw new Error(`Pixel row has wrong length: "${r}"`);
  return { w, h, get: (x, y) => palette[rows[y][x]] ?? null };
}

function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function draw(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
    }
  }
  return c.toDataURL('image/png');
}

function fromRows(rows, palette = PALETTE) {
  const p = rowsToPixels(rows, palette);
  return draw(p.w, p.h, p.get);
}

function hero(frame) {
  return fromRows([...HERO_TOP, ...HERO_FEET[frame]]);
}

function coin(phase) {
  // A spinning coin: the ellipse gets thinner each frame.
  const rx = [6.5, 4.5, 1.6, 4.5][phase];
  return draw(16, 16, (x, y) => {
    const dx = (x + 0.5 - 8) / rx;
    const dy = (y + 0.5 - 8) / 6.5;
    const d = dx * dx + dy * dy;
    if (d > 1) return null;
    if (d > 0.72) return '#b8860b';
    if (phase === 0 && x === 6 && y > 4 && y < 11) return '#fff8c4';
    return dx < -0.2 && phase !== 2 ? '#ffe45c' : '#ffd21f';
  });
}

function slime(frame) {
  const squash = frame === 1 ? 1 : 0;
  return draw(16, 16, (x, y) => {
    const top = 5 + squash;
    if (y < top) return null;
    const cx = 7.5;
    const halfW = y < top + 3 ? 3 + (y - top) * 1.6 : 7.5 + squash * 0.5;
    if (Math.abs(x - cx) > halfW) return null;
    if (y === 15) return '#5b2a86';
    const edge = Math.abs(x - cx) > halfW - 1 || y === top;
    if (edge) return '#5b2a86';
    if ((x === 5 || x === 10) && (y === top + 4 || y === top + 5)) return y === top + 4 ? '#ffffff' : '#14141f';
    if (y === top + 1 && x === 6) return '#e3c8ff';
    return '#a066d3';
  });
}

function grass() {
  return draw(16, 16, (x, y) => {
    const blade = 3 + (seeded(x * 7 + 1) > 0.5 ? 1 : 0);
    if (y < blade) return y === 0 ? '#9be36a' : '#5cbf3a';
    if (y === blade) return '#3e8f2b';
    return seeded(x * 31 + y * 17) > 0.85 ? '#6d4325' : '#8b5a2b';
  });
}

function dirt() {
  return draw(16, 16, (x, y) => (seeded(x * 13 + y * 29 + 3) > 0.85 ? '#6d4325' : seeded(x * 5 + y * 3) > 0.93 ? '#a87444' : '#8b5a2b'));
}

function brick() {
  return draw(16, 16, (x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 ? 4 : 0;
    if (y % 4 === 3 || (x + off) % 8 === 7) return '#5a2f22';
    return seeded(x * 3 + y * 11) > 0.9 ? '#c0654a' : '#a4513a';
  });
}

function stone() {
  return draw(16, 16, (x, y) => {
    if (x === 0 || y === 0) return '#b9bec7';
    if (x === 15 || y === 15) return '#5b616b';
    return seeded(x * 19 + y * 7) > 0.88 ? '#7c838e' : '#959ba5';
  });
}

function plank() {
  return draw(16, 16, (x, y) => {
    if (y > 5) return null;
    if (y === 0) return '#e2b26b';
    if (y === 5) return '#7a4f22';
    if (x === 7 && y > 0 && y < 5) return '#7a4f22';
    return '#c08a45';
  });
}

function spikes() {
  return draw(16, 16, (x, y) => {
    const local = x % 8;
    const height = 8 - Math.abs(local - 3.5) * 2;
    if (y >= 16 - height * 1.0 - 0) {
      if (y > 13) return '#4a4f57';
      return local < 4 ? '#e6e9ee' : '#a9afb8';
    }
    return null;
  });
}

function flag() {
  return draw(16, 32, (x, y) => {
    if (x === 3 && y >= 2) return '#d7d7d7';
    if (x === 4 && y >= 2) return '#8f8f8f';
    if (y <= 2 && x >= 2 && x <= 5 && y >= 0) return '#ffd21f';
    if (x >= 5 && x <= 14 && y >= 3 && y <= 11) {
      const wave = Math.round(Math.sin(x * 0.7) * 1);
      if (y - wave < 3 || y - wave > 11) return null;
      return (x + y) % 4 < 2 ? '#ff4d6d' : '#ffffff';
    }
    if (y >= 30 && x >= 1 && x <= 6) return '#5b616b';
    return null;
  });
}

function cloud() {
  return draw(32, 16, (x, y) => {
    const blobs = [[9, 10, 6], [16, 7, 7], [23, 10, 6], [16, 11, 6]];
    let inside = false;
    let shade = false;
    for (const [cx, cy, r] of blobs) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d < r) { inside = true; if (y > cy + 2) shade = true; }
    }
    if (!inside || y > 15) return null;
    return shade ? '#dbe9f6' : '#ffffff';
  });
}

function heart() {
  return fromRows([
    '................',
    '..rrr.....rrr...',
    '.rRRRr...rRRRr..',
    'rRwRRRr.rRRRRRr.',
    'rRwRRRRrRRRRRRr.',
    'rRRRRRRRRRRRRRr.',
    'rRRRRRRRRRRRRRr.',
    '.rRRRRRRRRRRRr..',
    '..rRRRRRRRRRr...',
    '...rRRRRRRRr....',
    '....rRRRRRr.....',
    '.....rRRRr......',
    '......rRr.......',
    '.......r........',
    '................',
    '................',
  ], { '.': null, r: '#7a0f1f', R: '#ff3b5c', w: '#ffd6de' });
}

// Returns the starter pictures as asset records (without ids).
export function starterArt() {
  return [
    { name: 'hero', kind: 'image', frames: [hero(0)], fps: 8, builtin: true },
    { name: 'hero_walk', kind: 'image', frames: [hero(0), hero(1), hero(0), hero(2)], fps: 10, builtin: true },
    { name: 'coin', kind: 'image', frames: [coin(0), coin(1), coin(2), coin(3)], fps: 8, builtin: true },
    { name: 'slime', kind: 'image', frames: [slime(0), slime(1)], fps: 3, builtin: true },
    { name: 'grass', kind: 'image', frames: [grass()], fps: 8, builtin: true },
    { name: 'dirt', kind: 'image', frames: [dirt()], fps: 8, builtin: true },
    { name: 'brick', kind: 'image', frames: [brick()], fps: 8, builtin: true },
    { name: 'stone', kind: 'image', frames: [stone()], fps: 8, builtin: true },
    { name: 'plank', kind: 'image', frames: [plank()], fps: 8, builtin: true },
    { name: 'spikes', kind: 'image', frames: [spikes()], fps: 8, builtin: true },
    { name: 'flag', kind: 'image', frames: [flag()], fps: 8, builtin: true },
    { name: 'cloud', kind: 'image', frames: [cloud()], fps: 8, builtin: true },
    { name: 'heart', kind: 'image', frames: [heart()], fps: 8, builtin: true },
  ];
}

// Builds a picture from rows of letters and a colour for each letter.
// The AI helper uses this to draw new pixel art.
export function pixelArtFromRows(rows, palette) {
  const pal = { '.': null, ' ': null };
  for (const [k, v] of Object.entries(palette || {})) {
    if (k.length !== 1) throw new Error(`Palette keys must be single characters, got "${k}".`);
    pal[k] = v === null || v === 'transparent' ? null : v;
  }
  const width = Math.max(...rows.map((r) => r.length));
  const padded = rows.map((r) => r.padEnd(width, '.'));
  for (const r of padded) {
    for (const ch of r) if (!(ch in pal)) throw new Error(`The letter "${ch}" is used in the picture but has no colour in the palette.`);
  }
  return fromRows(padded, pal);
}
