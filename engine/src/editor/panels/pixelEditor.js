// Pixel art editor: draw pictures and simple animations.
import { h, clear, toast } from '../dom.js';

const PALETTE = [
  '#000000', '#1b2a1b', '#5f574f', '#c2c3c7', '#ffffff', '#7e2553', '#ff004d', '#ff77a8',
  '#ab5236', '#ffa300', '#ffec27', '#ffccaa', '#008751', '#00e436', '#a6e36d', '#1d2b53',
  '#29adff', '#83769c', '#6b4226', '#8b5a2b', '#3fa34d', '#ffd21f', '#a066d3', '#5b2a86',
];
const TOOLS = [['pencil', '✏️', 'Pencil (P)'], ['eraser', '🧽', 'Eraser (E)'], ['fill', '🪣', 'Fill (F)'], ['picker', '💧', 'Pick colour (I)']];
const MAX_SIZE = 256;

function hexToRgba(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}
function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export class PixelEditorPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.assetId = undefined;
    this.tool = 'pencil';
    this.color = '#ff004d';
    this.frames = [];
    this.frame = 0;
    this.w = 16;
    this.h = 16;
    this.fps = 8;
    this.dirty = false;
    this.undoStack = [];
    this.build();
  }

  build() {
    this.nameInput = h('input', { type: 'text', class: 'px-name', 'aria-label': 'Picture name', 'data-ai': 'pixel-name', oninput: () => { this.dirty = true; this.updateSaveBtn(); } });
    this.sizeSel = h('select', { 'aria-label': 'Size', 'data-ai': 'pixel-size', onchange: (e) => this.resize(parseInt(e.target.value, 10)) },
      [8, 16, 24, 32, 48, 64].map((n) => h('option', { value: n }, `${n}×${n}`)));
    this.saveBtn = h('button', { class: 'btn btn-primary btn-small', 'data-ai': 'pixel-save', onclick: () => this.save() }, '💾 Save picture');
    this.toolBtns = {};
    const tools = h('div', { class: 'px-tools' }, TOOLS.map(([id, icon, title]) => {
      const b = h('button', { class: 'vp-tool', title, 'aria-label': title, 'data-ai': `pixel-tool:${id}`, onclick: () => this.setTool(id) }, icon);
      this.toolBtns[id] = b;
      return b;
    }));
    this.colorInput = h('input', { type: 'color', value: this.color, 'aria-label': 'Custom colour', 'data-ai': 'pixel-color', oninput: (e) => this.setColor(e.target.value) });
    this.paletteEl = h('div', { class: 'px-palette' }, PALETTE.map((c) => h('button', { class: 'px-swatch', style: { background: c }, title: c, 'aria-label': `Colour ${c}`, 'data-ai': `pixel-swatch:${c}`, onclick: () => this.setColor(c) })));
    this.canvas = h('canvas', { class: 'px-canvas', 'data-ai': 'pixel-canvas', 'data-ai-label': 'the drawing grid', tabindex: '0' });
    this.ctx = this.canvas.getContext('2d');
    this.framesEl = h('div', { class: 'px-frames' });
    this.fpsInput = h('input', { type: 'number', min: '1', max: '30', value: '8', 'aria-label': 'Frames per second', class: 'px-fps', onchange: (e) => { this.fps = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 8)); this.dirty = true; this.updateSaveBtn(); } });
    this.previewImg = h('canvas', { class: 'px-preview', title: 'Animation preview' });
    this.stageEl = h('div', { class: 'px-stage' }, this.canvas);
    this.el.append(
      h('div', { class: 'px-toolbar' }, h('span', null, '🎨'), this.nameInput, this.sizeSel, h('span', { class: 'flex' }), this.saveBtn),
      h('div', { class: 'px-main' },
        h('div', { class: 'px-side' }, tools, h('div', { class: 'px-current' }, this.colorInput), this.paletteEl,
          h('button', { class: 'btn btn-small', onclick: () => this.undo(), title: 'Undo drawing (Ctrl+Z)' }, '↶ Undo'),
          h('button', { class: 'btn btn-small', onclick: () => this.clearFrame() }, 'Clear')),
        this.stageEl,
        h('div', { class: 'px-anim' }, h('div', { class: 'muted small' }, 'Frames'), this.framesEl,
          h('div', { class: 'px-frame-btns' },
            h('button', { class: 'btn btn-small', 'data-ai': 'pixel-add-frame', onclick: () => this.addFrame() }, '＋ Frame'),
            h('button', { class: 'btn btn-small', onclick: () => this.deleteFrame() }, '－')),
          h('label', { class: 'small' }, 'Speed (fps) ', this.fpsInput),
          this.previewImg)),
    );
    this.bindCanvas();
    new ResizeObserver(() => this.draw()).observe(this.stageEl);
    setInterval(() => this.drawPreview(), 120);
  }

  // ------------------------------------------------------------ loading

  render() {
    const tab = this.store.ui.centerTab || '';
    if (!tab.startsWith('pixel:')) return;
    const id = tab.slice(6);
    const target = id === 'new' ? null : id;
    if (target === this.assetId) return;
    this.load(target);
  }

  async load(assetId) {
    this.assetId = assetId;
    this.undoStack = [];
    this.frame = 0;
    if (!assetId) {
      this.w = 16; this.h = 16; this.fps = 8;
      this.frames = [new Uint8ClampedArray(16 * 16 * 4)];
      this.nameInput.value = this.store.uniqueAssetName('picture');
      this.dirty = true;
    } else {
      const a = this.store.project.assets[assetId];
      if (!a || a.kind !== 'image') return;
      this.nameInput.value = a.name;
      this.fps = a.fps || 8;
      const imgs = await Promise.all(a.frames.map((src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; })));
      const first = imgs.find(Boolean);
      if (!first) return;
      if (first.naturalWidth > MAX_SIZE || first.naturalHeight > MAX_SIZE) {
        toast(`"${a.name}" is ${first.naturalWidth}×${first.naturalHeight}. The pixel editor works with pictures up to ${MAX_SIZE}×${MAX_SIZE}.`, 'warn', 5000);
        this.store.setCenterTab('scene');
        return;
      }
      this.w = first.naturalWidth; this.h = first.naturalHeight;
      this.frames = imgs.map((im) => {
        const c = document.createElement('canvas');
        c.width = this.w; c.height = this.h;
        const cx = c.getContext('2d');
        if (im) cx.drawImage(im, 0, 0);
        return cx.getImageData(0, 0, this.w, this.h).data;
      });
      this.dirty = false;
    }
    this.fpsInput.value = String(this.fps);
    if (![...this.sizeSel.options].some((o) => +o.value === this.w)) this.sizeSel.appendChild(h('option', { value: this.w }, `${this.w}×${this.h}`));
    this.sizeSel.value = String(this.w);
    this.sizeSel.disabled = !!assetId && this.w !== this.h;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  // Loads pixels directly (used by the AI when it draws a picture).
  loadPixels(w, hgt, frames, name, fps = 8) {
    this.assetId = null;
    this.w = w; this.h = hgt; this.fps = fps;
    this.frames = frames.map((f) => new Uint8ClampedArray(f));
    this.frame = 0;
    this.nameInput.value = name;
    this.fpsInput.value = String(fps);
    this.dirty = true;
    this.renderFrames();
    this.draw();
  }

  // ------------------------------------------------------------ editing

  setTool(t) {
    this.tool = t;
    for (const [id, b] of Object.entries(this.toolBtns)) b.classList.toggle('active', id === t);
  }

  setColor(c) {
    this.color = c;
    this.colorInput.value = c;
    for (const s of this.paletteEl.children) s.classList.toggle('active', s.title === c);
    if (this.tool === 'eraser' || this.tool === 'picker') this.setTool('pencil');
  }

  pushUndo() {
    this.undoStack.push({ frame: this.frame, data: new Uint8ClampedArray(this.frames[this.frame]) });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }

  undo() {
    const u = this.undoStack.pop();
    if (!u || !this.frames[u.frame]) return;
    this.frames[u.frame] = u.data;
    this.frame = u.frame;
    this.dirty = true;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  resize(n) {
    if (this.assetId && !confirm('Changing the size clears this picture. Continue?')) { this.sizeSel.value = String(this.w); return; }
    this.w = n; this.h = n;
    this.frames = this.frames.map(() => new Uint8ClampedArray(n * n * 4));
    this.dirty = true;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  clearFrame() {
    this.pushUndo();
    this.frames[this.frame] = new Uint8ClampedArray(this.w * this.h * 4);
    this.dirty = true;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  addFrame() {
    this.frames.splice(this.frame + 1, 0, new Uint8ClampedArray(this.frames[this.frame]));
    this.frame++;
    this.dirty = true;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  deleteFrame() {
    if (this.frames.length <= 1) return;
    this.frames.splice(this.frame, 1);
    this.frame = Math.max(0, this.frame - 1);
    this.dirty = true;
    this.updateSaveBtn();
    this.renderFrames();
    this.draw();
  }

  setPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const d = this.frames[this.frame];
    const i = (y * this.w + x) * 4;
    d[i] = rgba[0]; d[i + 1] = rgba[1]; d[i + 2] = rgba[2]; d[i + 3] = rgba[3];
  }

  getPixel(x, y) {
    const d = this.frames[this.frame];
    const i = (y * this.w + x) * 4;
    return [d[i], d[i + 1], d[i + 2], d[i + 3]];
  }

  fill(x, y, rgba) {
    const target = this.getPixel(x, y);
    if (target.every((v, i) => v === rgba[i])) return;
    const stack = [[x, y]];
    const same = (p) => p.every((v, i) => v === target[i]);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h || !same(this.getPixel(cx, cy))) continue;
      this.setPixel(cx, cy, rgba);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  cellFromEvent(e) {
    const r = this.canvas.getBoundingClientRect();
    const s = this.cellSize;
    return [Math.floor((e.clientX - r.left - this.ox) / s), Math.floor((e.clientY - r.top - this.oy) / s)];
  }

  bindCanvas() {
    let drawing = false;
    const act = (e, first) => {
      const [x, y] = this.cellFromEvent(e);
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
      const erase = this.tool === 'eraser' || e.buttons === 2;
      if (this.tool === 'picker') {
        const p = this.getPixel(x, y);
        if (p[3]) this.setColor(rgbaToHex(p[0], p[1], p[2]));
        return;
      }
      if (first) this.pushUndo();
      if (this.tool === 'fill' && !erase) { if (first) this.fill(x, y, hexToRgba(this.color)); }
      else this.setPixel(x, y, erase ? [0, 0, 0, 0] : hexToRgba(this.color));
      this.dirty = true;
      this.updateSaveBtn();
      this.draw();
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => { this.canvas.setPointerCapture(e.pointerId); drawing = true; act(e, true); });
    this.canvas.addEventListener('pointermove', (e) => { if (drawing) act(e, false); });
    this.canvas.addEventListener('pointerup', () => { if (drawing) { drawing = false; this.renderFrames(); } });
    this.canvas.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.undo(); return; }
      const map = { p: 'pencil', e: 'eraser', f: 'fill', i: 'picker' };
      if (map[k]) this.setTool(map[k]);
    });
    this.setTool('pencil');
  }

  // ------------------------------------------------------------ drawing

  frameCanvas(i) {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.frames[i]), this.w, this.h), 0, 0);
    return c;
  }

  draw() {
    if (!this.frames.length) return;
    const r = this.stageEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    const s = Math.max(2, Math.floor(Math.min((r.width - 20) / this.w, (r.height - 20) / this.h)));
    this.cellSize = s;
    this.ox = Math.floor((r.width - s * this.w) / 2);
    this.oy = Math.floor((r.height - s * this.h) / 2);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#3a3f4b' : '#2f343e';
        ctx.fillRect(this.ox + x * s, this.oy + y * s, s, s);
      }
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.frameCanvas(this.frame), this.ox, this.oy, s * this.w, s * this.h);
    if (s >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= this.w; x++) { ctx.moveTo(this.ox + x * s + 0.5, this.oy); ctx.lineTo(this.ox + x * s + 0.5, this.oy + s * this.h); }
      for (let y = 0; y <= this.h; y++) { ctx.moveTo(this.ox, this.oy + y * s + 0.5); ctx.lineTo(this.ox + s * this.w, this.oy + y * s + 0.5); }
      ctx.stroke();
    }
  }

  // Screen position of a pixel (used by the AI's cursor).
  pixelClientPos(x, y) {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + this.ox + (x + 0.5) * this.cellSize, y: r.top + this.oy + (y + 0.5) * this.cellSize };
  }

  renderFrames() {
    clear(this.framesEl);
    this.frames.forEach((_, i) => {
      const c = this.frameCanvas(i);
      c.className = `px-frame ${i === this.frame ? 'active' : ''}`;
      c.title = `Frame ${i + 1}`;
      c.addEventListener('click', () => { this.frame = i; this.renderFrames(); this.draw(); });
      this.framesEl.appendChild(c);
    });
  }

  drawPreview() {
    if (this.el.hidden || !this.frames.length || this.frames.length < 2) { this.previewImg.hidden = true; return; }
    this.previewImg.hidden = false;
    const i = Math.floor((performance.now() / 1000) * this.fps) % this.frames.length;
    const c = this.previewImg;
    c.width = this.w; c.height = this.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(this.frames[i]), this.w, this.h), 0, 0);
  }

  updateSaveBtn() {
    this.saveBtn.textContent = this.dirty ? '💾 Save picture' : '✓ Saved';
    this.saveBtn.classList.toggle('btn-primary', this.dirty);
  }

  // ------------------------------------------------------------ saving

  dataUrls() {
    return this.frames.map((_, i) => this.frameCanvas(i).toDataURL('image/png'));
  }

  save() {
    const name = this.nameInput.value.trim().replace(/\s+/g, '_') || 'picture';
    const frames = this.dataUrls();
    try {
      if (this.assetId) {
        const a = this.store.project.assets[this.assetId];
        const changes = { frames, fps: this.fps };
        if (name !== a.name) changes.name = name;
        this.store.updateAsset(this.assetId, changes);
      } else {
        const id = this.store.addAsset({ name, kind: 'image', frames, fps: this.fps });
        this.assetId = id;
        this.editor.openTabs = this.editor.openTabs.map((t) => (t === 'pixel:new' ? `pixel:${id}` : t));
        this.store.setCenterTab(`pixel:${id}`);
      }
      this.dirty = false;
      this.updateSaveBtn();
      toast(`Saved picture "${name}"`);
      return this.assetId;
    } catch (e) {
      toast(e.message, 'warn');
      return null;
    }
  }
}
