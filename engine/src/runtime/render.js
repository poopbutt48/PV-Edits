// Draws objects onto a canvas. Used both by the running game and by the
// editor's Scene view, so what you see while editing matches the game.

export const FONTS = {
  sans: 'system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"Courier New", Consolas, monospace',
  round: '"Comic Sans MS", "Chalkboard SE", "Comic Neue", system-ui, sans-serif',
};

export function fontFor(obj) {
  return `bold ${Math.max(1, obj.size || 24)}px ${FONTS[obj.font] || FONTS.sans}`;
}

let measureCtx = null;
function measureText(obj) {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
    measureCtx = c.getContext('2d');
  }
  measureCtx.font = fontFor(obj);
  const lines = String(obj.text ?? '').split('\n');
  let w = 0;
  for (const l of lines) w = Math.max(w, measureCtx.measureText(l).width);
  return { w, h: lines.length * (obj.size || 24) * 1.2, lines };
}

// Size of an object as drawn, before scaling.
export function visualSize(obj, images) {
  switch (obj.type) {
    case 'Sprite': {
      const img = images.frame(obj.image, 0);
      const iw = img && img.naturalWidth ? img.naturalWidth : 32;
      const ih = img && img.naturalHeight ? img.naturalHeight : 32;
      return { w: obj.width || iw, h: obj.height || ih };
    }
    case 'Shape':
      return { w: obj.width, h: obj.height };
    case 'Text': {
      const m = measureText(obj);
      return { w: m.w, h: m.h };
    }
    default:
      return { w: 0, h: 0 };
  }
}

// Where a Text object's box starts, relative to its position.
export function textOffsetX(obj, w) {
  if (obj.align === 'center') return -w / 2;
  if (obj.align === 'right') return -w;
  return 0;
}

function sortedChildren(obj) {
  const kids = obj.children || [];
  if (kids.length < 2) return kids;
  return kids.map((c, i) => [c, i]).sort((a, b) => (a[0].layer || 0) - (b[0].layer || 0) || a[1] - b[1]).map((p) => p[0]);
}

// Draws one object and everything inside it.
export function drawTree(ctx, obj, opts) {
  if (!obj || obj.visible === false) return;
  if (obj.type === 'Text' && obj.onScreen && !opts.editor) return; // drawn later, on top of the screen
  ctx.save();
  ctx.translate(obj.x || 0, obj.y || 0);
  if (obj.type !== 'TileMap' && obj.type !== 'Camera' && obj.type !== 'SceneCopy') {
    if (obj.rotation) ctx.rotate((obj.rotation * Math.PI) / 180);
    const sx = obj.scaleX ?? 1;
    const sy = obj.scaleY ?? 1;
    if (sx !== 1 || sy !== 1) ctx.scale(sx, sy);
  }
  const blink = obj._flashUntil && opts.time < obj._flashUntil && Math.floor(opts.time * 16) % 2 === 0;
  if (!blink) drawSelf(ctx, obj, opts);
  for (const child of sortedChildren(obj)) drawTree(ctx, child, opts);
  if (obj.type === 'SceneCopy' && opts.drawSceneCopy) opts.drawSceneCopy(ctx, obj);
  ctx.restore();
}

function drawSelf(ctx, obj, opts) {
  const images = opts.images;
  switch (obj.type) {
    case 'Sprite': {
      const frames = images.frames(obj.image);
      const { w, h } = visualSize(obj, images);
      ctx.globalAlpha *= obj.opacity ?? 1;
      if (!frames || !frames.length) {
        if (opts.editor) {
          ctx.fillStyle = 'rgba(160,160,255,0.35)';
          ctx.fillRect(-w / 2, -h / 2, w, h);
          ctx.strokeStyle = '#8888ff';
          ctx.strokeRect(-w / 2, -h / 2, w, h);
          ctx.fillStyle = '#fff';
          ctx.font = '10px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('no picture', 0, 4);
        }
        return;
      }
      const idx = Math.abs(Math.floor(obj.frame || 0)) % frames.length;
      const img = frames[idx];
      if (!img || !img.complete) return;
      ctx.save();
      ctx.scale(obj.flipX ? -1 : 1, obj.flipY ? -1 : 1);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }
    case 'Shape': {
      ctx.globalAlpha *= obj.opacity ?? 1;
      ctx.fillStyle = obj.color || '#4caf50';
      if (obj.shape === 'circle') {
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.abs(obj.width / 2), Math.abs(obj.height / 2), 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-obj.width / 2, -obj.height / 2, obj.width, obj.height);
      }
      return;
    }
    case 'Text':
      drawText(ctx, obj);
      return;
    case 'TileMap':
      drawTiles(ctx, obj, opts);
      return;
    case 'Camera':
      if (opts.editor && opts.showHelpers) {
        const w = opts.gameWidth / (obj.zoom || 1);
        const h = opts.gameHeight / (obj.zoom || 1);
        ctx.strokeStyle = 'rgba(255,200,0,0.8)';
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2 / (opts.viewScale || 1);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
        ctx.setLineDash([]);
        ctx.font = `${14 / (opts.viewScale || 1)}px sans-serif`;
        ctx.fillStyle = 'rgba(255,200,0,0.9)';
        ctx.fillText('🎥 Camera', -w / 2 + 4, -h / 2 - 6);
      }
      return;
    default:
      return;
  }
}

export function drawText(ctx, obj) {
  const m = measureText(obj);
  ctx.font = fontFor(obj);
  ctx.textBaseline = 'top';
  ctx.textAlign = obj.align === 'center' ? 'center' : obj.align === 'right' ? 'right' : 'left';
  const lh = (obj.size || 24) * 1.2;
  m.lines.forEach((line, i) => {
    if (obj.outline) {
      ctx.lineWidth = Math.max(2, (obj.size || 24) / 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, i * lh);
    }
    ctx.fillStyle = obj.color || '#fff';
    ctx.fillText(line, 0, i * lh);
  });
}

export function parseCell(key) {
  const i = key.indexOf(',');
  return [parseInt(key.slice(0, i), 10), parseInt(key.slice(i + 1), 10)];
}

function drawTiles(ctx, obj, opts) {
  const ts = obj.tileSize || 32;
  const tiles = obj.tiles || [];
  const cells = obj.cells || {};
  const view = opts.view; // optional {x0,y0,x1,y1} in this map's space for culling
  for (const key in cells) {
    const [cx, cy] = parseCell(key);
    const px = cx * ts;
    const py = cy * ts;
    if (view && (px + ts < view.x0 - obj.x || px > view.x1 - obj.x || py + ts < view.y0 - obj.y || py > view.y1 - obj.y)) continue;
    const tile = tiles[cells[key]];
    if (!tile) continue;
    const img = tile.image ? opts.images.frame(tile.image, 0) : null;
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, px, py, ts, ts);
    else {
      ctx.fillStyle = tile.color || '#8d6e63';
      ctx.fillRect(px, py, ts, ts);
    }
  }
}

// Draws "Stick to screen" text on top of everything, in screen space.
export function drawOnScreen(ctx, root, opts) {
  const walk = (obj, parentVisible) => {
    const vis = parentVisible && obj.visible !== false;
    if (vis && obj.type === 'Text' && obj.onScreen) {
      if (!(obj._flashUntil && opts.time < obj._flashUntil && Math.floor(opts.time * 16) % 2 === 0)) {
        ctx.save();
        ctx.translate(obj.x || 0, obj.y || 0);
        if (obj.rotation) ctx.rotate((obj.rotation * Math.PI) / 180);
        ctx.scale(obj.scaleX ?? 1, obj.scaleY ?? 1);
        drawText(ctx, obj);
        ctx.restore();
      }
    }
    for (const c of obj.children || []) walk(c, vis);
  };
  walk(root, true);
}

// Loads pictures from the project and finds them by id or by name.
export class ImageStore {
  constructor(onLoad) {
    this.cache = new Map(); // asset id -> { src: [urls], frames: [img], fps }
    this.byName = new Map();
    this.onLoad = onLoad || null;
  }

  sync(assets) {
    this.byName.clear();
    const seen = new Set();
    for (const a of Object.values(assets || {})) {
      if (a.kind !== 'image') continue;
      seen.add(a.id);
      this.byName.set(a.name, a.id);
      const entry = this.cache.get(a.id);
      if (entry && entry.src.length === a.frames.length && entry.src.every((s, i) => s === a.frames[i])) {
        entry.fps = a.fps;
        continue;
      }
      const frames = a.frames.map((src) => {
        const img = new Image();
        img.onload = () => this.onLoad && this.onLoad();
        img.src = src;
        return img;
      });
      this.cache.set(a.id, { src: a.frames.slice(), frames, fps: a.fps || 8 });
    }
    for (const id of [...this.cache.keys()]) if (!seen.has(id)) this.cache.delete(id);
  }

  resolve(ref) {
    if (!ref) return null;
    if (this.cache.has(ref)) return ref;
    return this.byName.get(ref) || null;
  }

  frames(ref) {
    const id = this.resolve(ref);
    return id ? this.cache.get(id).frames : null;
  }

  frame(ref, i) {
    const f = this.frames(ref);
    return f && f.length ? f[i % f.length] : null;
  }

  async ready() {
    const all = [];
    for (const e of this.cache.values()) {
      for (const img of e.frames) {
        if (!img.complete) all.push(new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }));
      }
    }
    await Promise.all(all);
  }
}
