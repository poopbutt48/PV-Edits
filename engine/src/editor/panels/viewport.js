// The Scene view: see your level, click objects to select them, drag to
// move them, and paint tiles. Works with mouse, keyboard and touch.
import { h, clear, toast, rafThrottle } from '../dom.js';
import { drawTree, ImageStore, visualSize, textOffsetX, parseCell } from '../../runtime/render.js';
import { NODE_TYPES } from '../../runtime/nodeTypes.js';
import { walkNodes } from '../store.js';

const TOOLS = [
  ['select', '↖', 'Select & move (V)', 'v'],
  ['pan', '✋', 'Move the view (H)', 'h'],
  ['paint', '🖌', 'Paint tiles (B)', 'b'],
  ['erase', '🧽', 'Erase tiles (E)', 'e'],
];

function mul(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function localMatrix(o) {
  const x = o.x || 0;
  const y = o.y || 0;
  if (o.type === 'TileMap' || o.type === 'Camera' || o.type === 'SceneCopy') return [1, 0, 0, 1, x, y];
  const r = ((o.rotation || 0) * Math.PI) / 180;
  const sx = o.scaleX ?? 1;
  const sy = o.scaleY ?? 1;
  return [Math.cos(r) * sx, Math.sin(r) * sx, -Math.sin(r) * sy, Math.cos(r) * sy, x, y];
}
function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

export class ViewportPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.tool = 'select';
    this.brush = 0;
    this.showGrid = true;
    this.snap = false;
    this.cam = null; // { x, y, zoom }
    this.pointers = new Map();
    this.drag = null;
    this.hoverCell = null;
    this.images = new ImageStore(() => this.render());
    editor.images = this.images;
    this.draw = rafThrottle(() => this.drawNow());
    this.build();
  }

  build() {
    this.toolButtons = {};
    const toolbar = h('div', { class: 'vp-toolbar', role: 'toolbar', 'aria-label': 'Scene tools' });
    for (const [id, icon, title] of TOOLS) {
      const b = h('button', { class: 'vp-tool', title, 'aria-label': title, 'data-ai': `tool:${id}`, 'data-ai-label': `${title.replace(/ \(.\)$/, '')} tool`, onclick: () => this.setTool(id) }, icon);
      this.toolButtons[id] = b;
      toolbar.appendChild(b);
    }
    this.gridBtn = h('button', { class: 'vp-toggle', title: 'Show grid (G)', 'aria-pressed': 'true', onclick: () => { this.showGrid = !this.showGrid; this.render(); } }, '▦ Grid');
    this.snapBtn = h('button', { class: 'vp-toggle', title: 'Snap objects to the grid while dragging', 'aria-pressed': 'false', 'data-ai': 'snap-toggle', onclick: () => { this.snap = !this.snap; this.render(); } }, '🧲 Snap');
    this.zoomLabel = h('span', { class: 'vp-zoom' }, '100%');
    toolbar.append(
      h('span', { class: 'vp-sep' }), this.gridBtn, this.snapBtn, h('span', { class: 'vp-sep' }),
      h('button', { class: 'vp-tool', title: 'Zoom out', 'aria-label': 'Zoom out', onclick: () => this.zoomBy(1 / 1.25) }, '−'),
      this.zoomLabel,
      h('button', { class: 'vp-tool', title: 'Zoom in', 'aria-label': 'Zoom in', onclick: () => this.zoomBy(1.25) }, '+'),
      h('button', { class: 'vp-tool', title: 'Fit the game screen in view', 'aria-label': 'Fit view', 'data-ai': 'fit-view', onclick: () => this.fitGameScreen() }, '⌖'));
    this.canvas = h('canvas', { class: 'vp-canvas', tabindex: '0', 'data-ai': 'scene-canvas', 'data-ai-label': 'the Scene view', 'aria-label': 'Scene view' });
    this.palette = h('div', { class: 'tile-palette', hidden: true, 'data-ai': 'tile-palette' });
    this.hint = h('div', { class: 'vp-hint' });
    this.stage = h('div', { class: 'vp-stage' }, this.canvas, this.hint);
    this.el.append(toolbar, this.stage, this.palette);
    this.ctx = this.canvas.getContext('2d');
    new ResizeObserver(() => this.resize()).observe(this.stage);
    this.bindPointer();
    this.stage.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('application/x-sprout-asset')) e.preventDefault(); });
    this.stage.addEventListener('drop', (e) => this.onDrop(e));
  }

  // ------------------------------------------------------------ public helpers

  setTool(tool, brush) {
    this.tool = tool;
    if (brush !== undefined) this.brush = brush;
    if ((tool === 'paint' || tool === 'erase') && !this.activeTileMap()) {
      const tm = this.findTileMap();
      if (tm) this.store.select(tm.id);
      else toast('Add a Tile Map object first, then paint tiles onto it.', 'warn');
    }
    if (this.editor.store.ui.centerTab !== 'scene') this.store.setCenterTab('scene');
    this.render();
  }

  activeTileMap() {
    const n = this.store.selected();
    return n && n.type === 'TileMap' ? n : null;
  }

  findTileMap() {
    const scene = this.store.scene();
    let found = null;
    if (scene) walkNodes(scene.root, (n) => { if (!found && n.type === 'TileMap') found = n; });
    return found;
  }

  resize() {
    const r = this.stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.size = { w: r.width, h: r.height, dpr };
    if (!this.cam) this.fitGameScreen(false);
    this.drawNow();
  }

  fitGameScreen(redraw = true) {
    const s = this.store.project.settings;
    const w = this.size ? this.size.w : 800;
    const hh = this.size ? this.size.h : 450;
    const zoom = Math.min(w / (s.width + 80), hh / (s.height + 80));
    this.cam = { x: s.width / 2, y: s.height / 2, zoom: Math.max(0.1, zoom) };
    if (redraw) this.render();
  }

  zoomBy(f, cx, cy) {
    if (!this.cam) return;
    const before = cx !== undefined ? this.clientToWorld(cx, cy) : null;
    this.cam.zoom = Math.min(16, Math.max(0.05, this.cam.zoom * f));
    if (before) {
      const after = this.clientToWorld(cx, cy);
      this.cam.x += before.x - after.x;
      this.cam.y += before.y - after.y;
    }
    this.render();
  }

  focusNode(id) {
    const v = this.findView(id);
    if (!v) return;
    this.store.select(id);
    const b = this.worldBounds(v);
    this.cam.x = (b.x0 + b.x1) / 2;
    this.cam.y = (b.y0 + b.y1) / 2;
    if (this.editor.store.ui.centerTab !== 'scene') this.store.setCenterTab('scene');
    this.render();
  }

  clientToWorld(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left - r.width / 2) / this.cam.zoom + this.cam.x, y: (cy - r.top - r.height / 2) / this.cam.zoom + this.cam.y };
  }

  worldToClient(wx, wy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2 + (wx - this.cam.x) * this.cam.zoom, y: r.top + r.height / 2 + (wy - this.cam.y) * this.cam.zoom };
  }

  // Screen rectangle of an object (used by the AI's cursor to point at it).
  clientRectOfNode(id) {
    const v = this.findView(id);
    if (!v) return null;
    const b = this.worldBounds(v);
    const a = this.worldToClient(b.x0, b.y0);
    const c = this.worldToClient(b.x1, b.y1);
    return { left: a.x, top: a.y, width: Math.max(8, c.x - a.x), height: Math.max(8, c.y - a.y) };
  }

  // Keeps a world point visible (the AI uses this before painting).
  ensureVisible(wx, wy, margin = 40) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.worldToClient(wx, wy);
    if (p.x < r.left + margin || p.x > r.right - margin || p.y < r.top + margin || p.y > r.bottom - margin) {
      this.cam.x = wx;
      this.cam.y = wy;
      this.drawNow();
    }
  }

  cellAt(tm, wx, wy) {
    const v = this.findView(tm.id);
    const ox = v ? v._m[4] : tm.props.x;
    const oy = v ? v._m[5] : tm.props.y;
    const ts = tm.props.tileSize || 32;
    return [Math.floor((wx - ox) / ts), Math.floor((wy - oy) / ts)];
  }

  cellCenter(tm, cx, cy) {
    const v = this.findView(tm.id);
    const ox = v ? v._m[4] : tm.props.x;
    const oy = v ? v._m[5] : tm.props.y;
    const ts = tm.props.tileSize || 32;
    return { x: ox + (cx + 0.5) * ts, y: oy + (cy + 0.5) * ts };
  }

  // ------------------------------------------------------------ view tree

  buildViews() {
    const scene = this.store.scene();
    this.views = new Map();
    this.flat = [];
    if (!scene) { this.rootView = null; return; }
    const build = (node, parentM, depth, selectId, inCopy) => {
      if (depth > 20) return null;
      const v = { ...node.props, type: node.type, name: node.name, children: [], _id: node.id, _selectId: selectId || node.id, _inCopy: inCopy };
      v._m = mul(parentM, localMatrix(v));
      if (!inCopy) this.views.set(node.id, v);
      if (node.type === 'SceneCopy') {
        const s = this.store.project.scenes[node.props.scene];
        if (s) {
          const child = build({ ...s.root, props: { ...s.root.props, x: 0, y: 0 } }, v._m, depth + 1, selectId || node.id, true);
          if (child) v.children.push(child);
        }
      } else {
        for (const c of node.children) {
          const cv = build(c, v._m, depth + 1, selectId, inCopy);
          if (cv) v.children.push(cv);
        }
      }
      return v;
    };
    this.rootView = build(scene.root, [1, 0, 0, 1, 0, 0], 0, null, false);
    // Flat list in drawing order, for clicking.
    const walk = (v, visible) => {
      const vis = visible && v.visible !== false;
      if (vis) this.flat.push(v);
      const kids = v.children.map((c, i) => [c, i]).sort((a, b) => (a[0].layer || 0) - (b[0].layer || 0) || a[1] - b[1]).map((p) => p[0]);
      for (const c of kids) walk(c, vis);
    };
    walk(this.rootView, true);
  }

  findView(id) {
    if (!this.views) this.buildViews();
    return this.views.get(id) || null;
  }

  worldBounds(v) {
    if (v.type === 'TileMap') {
      let b = null;
      const ts = v.tileSize || 32;
      for (const key in v.cells) {
        const [cx, cy] = parseCell(key);
        const x0 = v._m[4] + cx * ts;
        const y0 = v._m[5] + cy * ts;
        if (!b) b = { x0, y0, x1: x0 + ts, y1: y0 + ts };
        else { b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0); b.x1 = Math.max(b.x1, x0 + ts); b.y1 = Math.max(b.y1, y0 + ts); }
      }
      return b || { x0: v._m[4], y0: v._m[5], x1: v._m[4] + ts, y1: v._m[5] + ts };
    }
    if (v.type === 'SceneCopy' || v.type === 'Group') {
      let b = null;
      const add = (c) => {
        const cb = this.worldBounds(c);
        if (!b) b = { ...cb };
        else { b.x0 = Math.min(b.x0, cb.x0); b.y0 = Math.min(b.y0, cb.y0); b.x1 = Math.max(b.x1, cb.x1); b.y1 = Math.max(b.y1, cb.y1); }
      };
      v.children.forEach(add);
      return b || { x0: v._m[4] - 12, y0: v._m[5] - 12, x1: v._m[4] + 12, y1: v._m[5] + 12 };
    }
    if (v.type === 'Camera') {
      const s = this.store.project.settings;
      const z = v.zoom || 1;
      return { x0: v._m[4] - s.width / 2 / z, y0: v._m[5] - s.height / 2 / z, x1: v._m[4] + s.width / 2 / z, y1: v._m[5] + s.height / 2 / z };
    }
    const size = visualSize(v, this.images);
    let x0 = -size.w / 2;
    let y0 = -size.h / 2;
    if (v.type === 'Text') { x0 = textOffsetX(v, size.w); y0 = 0; }
    const pts = [apply(v._m, x0, y0), apply(v._m, x0 + size.w, y0), apply(v._m, x0, y0 + size.h), apply(v._m, x0 + size.w, y0 + size.h)];
    return { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
  }

  hitTest(wx, wy) {
    if (!this.flat) return null;
    for (let i = this.flat.length - 1; i >= 0; i--) {
      const v = this.flat[i];
      if (v.type === 'Group' || v.type === 'SceneCopy') continue;
      if (v.type === 'Camera') continue;
      if (v.type === 'TileMap') {
        const ts = v.tileSize || 32;
        const key = `${Math.floor((wx - v._m[4]) / ts)},${Math.floor((wy - v._m[5]) / ts)}`;
        if (v.cells[key] !== undefined) return v;
        continue;
      }
      const b = this.worldBounds(v);
      if (wx >= b.x0 && wx <= b.x1 && wy >= b.y0 && wy <= b.y1) return v;
    }
    return null;
  }

  // ------------------------------------------------------------ input

  bindPointer() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.shiftKey) {
        // Shift + scroll moves the view sideways.
        this.cam.x += (e.deltaY || e.deltaX) / this.cam.zoom;
        this.draw();
      } else {
        this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      }
    }, { passive: false });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.hoverCell = null; this.draw(); });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.closest('.cm-editor')) this.spaceDown = true; });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.spaceDown = false; });
  }

  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Two fingers: pinch to zoom and pan.
      const [a, b] = [...this.pointers.values()];
      this.drag = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    const w = this.clientToWorld(e.clientX, e.clientY);
    const panNow = this.tool === 'pan' || e.button === 1 || this.spaceDown;
    if (panNow) { this.drag = { kind: 'pan', x: e.clientX, y: e.clientY }; return; }
    if (this.tool === 'paint' || this.tool === 'erase') {
      const tm = this.activeTileMap();
      if (!tm) { this.setTool('paint'); return; }
      const erase = this.tool === 'erase' || e.button === 2;
      this.drag = { kind: 'paint', erase, stroke: Math.random() };
      this.paintAt(tm, w.x, w.y, erase);
      return;
    }
    const hit = this.hitTest(w.x, w.y);
    if (!hit) {
      if (e.pointerType === 'touch') this.drag = { kind: 'pan', x: e.clientX, y: e.clientY };
      else this.drag = { kind: 'maybe-deselect', x: e.clientX, y: e.clientY };
      return;
    }
    const id = hit._selectId;
    if (this.store.ui.selectedId !== id) this.store.select(id);
    const node = this.store.node(id);
    const r = this.store.findNode(id);
    if (!node || !r.parent || node.type === 'TileMap') {
      this.drag = { kind: 'pan', x: e.clientX, y: e.clientY, soft: true };
      return;
    }
    const parentView = this.findView(r.parent.id);
    this.drag = { kind: 'move', id, start: w, startX: node.props.x, startY: node.props.y, parentM: parentView ? parentView._m : [1, 0, 0, 1, 0, 0], moved: false };
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = this.clientToWorld(e.clientX, e.clientY);
    const tm = this.activeTileMap();
    if ((this.tool === 'paint' || this.tool === 'erase') && tm) {
      const cell = this.cellAt(tm, w.x, w.y);
      if (!this.hoverCell || this.hoverCell[0] !== cell[0] || this.hoverCell[1] !== cell[1]) { this.hoverCell = cell; this.draw(); }
    }
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.cam.x -= (mid.x - d.mid.x) / this.cam.zoom;
      this.cam.y -= (mid.y - d.mid.y) / this.cam.zoom;
      this.zoomBy(dist / (d.dist || dist), mid.x, mid.y);
      d.dist = dist;
      d.mid = mid;
    } else if (d.kind === 'pan') {
      this.cam.x -= (e.clientX - d.x) / this.cam.zoom;
      this.cam.y -= (e.clientY - d.y) / this.cam.zoom;
      d.x = e.clientX;
      d.y = e.clientY;
      this.draw();
    } else if (d.kind === 'paint') {
      if (tm) this.paintAt(tm, w.x, w.y, d.erase, d.stroke);
    } else if (d.kind === 'move') {
      const gdx = w.x - d.start.x;
      const gdy = w.y - d.start.y;
      if (!d.moved && Math.hypot(gdx, gdy) * this.cam.zoom < 3) return;
      d.moved = true;
      const p = d.parentM;
      const det = p[0] * p[3] - p[2] * p[1] || 1;
      let nx = d.startX + (p[3] * gdx - p[2] * gdy) / det;
      let ny = d.startY + (-p[1] * gdx + p[0] * gdy) / det;
      if (this.snap) { const g = 16; nx = Math.round(nx / g) * g; ny = Math.round(ny / g) * g; }
      this.store.setProps(d.id, { x: Math.round(nx), y: Math.round(ny) }, { merge: true });
    } else if (d.kind === 'maybe-deselect') {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) this.drag = { kind: 'pan', x: e.clientX, y: e.clientY };
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (d && d.kind === 'maybe-deselect') this.store.select(null);
    if (this.pointers.size < 2 && d && d.kind === 'pinch') { this.drag = null; return; }
    if (this.pointers.size === 0) this.drag = null;
  }

  paintAt(tm, wx, wy, erase, stroke) {
    const [cx, cy] = this.cellAt(tm, wx, wy);
    const key = `${cx},${cy}`;
    const cur = tm.props.cells[key];
    if (erase ? cur === undefined : cur === this.brush) return;
    if (!erase && !tm.props.tiles[this.brush]) { toast('This Tile Map has no tile types yet. Add one in the Inspector.', 'warn'); this.drag = null; return; }
    this.store.paintTiles(tm.id, [[cx, cy]], erase ? null : this.brush, { merge: stroke !== undefined });
  }

  handleKey(e) {
    const k = e.key.toLowerCase();
    const tool = TOOLS.find((t) => t[3] === k);
    if (tool && !e.ctrlKey && !e.metaKey) { this.setTool(tool[0]); return; }
    if (k === 'g') { this.showGrid = !this.showGrid; this.render(); return; }
    if (k === 'f' && this.store.ui.selectedId) { this.focusNode(this.store.ui.selectedId); return; }
    const sel = this.store.selected();
    if (sel && e.key.startsWith('Arrow') && 'x' in sel.props) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.store.setProps(sel.id, { x: sel.props.x + dx, y: sel.props.y + dy }, { merge: true });
    }
  }

  onDrop(e) {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-sprout-asset');
    const a = this.store.project.assets[assetId];
    if (!a || a.kind !== 'image') return;
    const w = this.clientToWorld(e.clientX, e.clientY);
    const scene = this.store.scene();
    if (!scene) return;
    this.store.addNode({ sceneId: scene.id, type: 'Sprite', name: a.name.charAt(0).toUpperCase() + a.name.slice(1), props: { image: a.id, x: Math.round(w.x), y: Math.round(w.y), width: 32, height: 32 } });
    toast(`Added a Sprite showing "${a.name}"`);
  }

  // ------------------------------------------------------------ drawing

  render() {
    this.images.sync(this.store.project.assets);
    this.views = null;
    this.draw();
    this.updateChrome();
  }

  updateChrome() {
    for (const [id, b] of Object.entries(this.toolButtons)) b.classList.toggle('active', this.tool === id);
    this.gridBtn.setAttribute('aria-pressed', String(this.showGrid));
    this.gridBtn.classList.toggle('active', this.showGrid);
    this.snapBtn.setAttribute('aria-pressed', String(this.snap));
    this.snapBtn.classList.toggle('active', this.snap);
    if (this.cam) this.zoomLabel.textContent = `${Math.round(this.cam.zoom * 100)}%`;
    const tm = this.activeTileMap();
    const painting = (this.tool === 'paint' || this.tool === 'erase');
    this.palette.hidden = !tm;
    if (tm) {
      clear(this.palette);
      this.palette.appendChild(h('span', { class: 'palette-label' }, `🧱 ${tm.name}:`));
      tm.props.tiles.forEach((t, i) => {
        const a = this.store.project.assets[t.image];
        this.palette.appendChild(h('button', {
          class: `palette-tile ${painting && this.tool === 'paint' && this.brush === i ? 'active' : ''}`,
          title: `${t.name}${t.platform ? ' (platform)' : t.solid ? ' (solid)' : ''}`,
          'data-ai': `tile-brush:${i}`, 'data-ai-label': `the "${t.name}" tile`,
          onclick: () => this.setTool('paint', i),
        }, h('span', { class: 'palette-swatch', style: { background: a ? `center/contain no-repeat url(${a.frames[0]}), ${t.color}` : t.color } }), t.name));
      });
      if (!tm.props.tiles.length) this.palette.appendChild(h('span', { class: 'muted' }, 'No tile types yet - add one in the Inspector.'));
    }
    let hint = '';
    if (painting && tm) hint = this.tool === 'paint' ? 'Drag to paint. Right-click to erase.' : 'Drag to erase tiles.';
    else if (this.tool === 'pan') hint = 'Drag to move around. Scroll or pinch to zoom.';
    this.hint.textContent = hint;
    this.hint.hidden = !hint;
  }

  drawNow() {
    if (!this.size || !this.cam) return;
    if (!this.views) this.buildViews();
    const { w, h: hh, dpr } = this.size;
    const ctx = this.ctx;
    const s = this.store.project.settings;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, w, hh);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, w, hh);
    const z = this.cam.zoom;
    ctx.save();
    ctx.translate(w / 2, hh / 2);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);
    // The game screen area
    ctx.fillStyle = s.background;
    ctx.fillRect(0, 0, s.width, s.height);
    if (this.showGrid) this.drawGrid(ctx, w, hh);
    ctx.imageSmoothingEnabled = !s.pixelArt;
    if (this.rootView) {
      drawTree(ctx, this.rootView, {
        images: this.images, time: 0, editor: true, showHelpers: true, viewScale: z, gameWidth: s.width, gameHeight: s.height,
      });
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5 / z;
    ctx.setLineDash([6 / z, 4 / z]);
    ctx.strokeRect(0, 0, s.width, s.height);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${12 / z}px system-ui, sans-serif`;
    ctx.fillText('Game screen', 4 / z, s.height + 14 / z);
    this.drawSelection(ctx);
    this.drawHoverCell(ctx);
    ctx.restore();
    if (!this.store.scene()) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, w, hh);
      ctx.fillStyle = '#fff';
      ctx.font = '16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No scene open - create one with ＋ next to Scenes', w / 2, hh / 2);
      ctx.textAlign = 'left';
    }
  }

  drawGrid(ctx, w, hh) {
    const tm = this.activeTileMap() || this.findTileMap();
    const g = tm ? tm.props.tileSize || 32 : 32;
    const z = this.cam.zoom;
    if (g * z < 6) return;
    const x0 = this.cam.x - w / 2 / z;
    const y0 = this.cam.y - hh / 2 / z;
    const x1 = this.cam.x + w / 2 / z;
    const y1 = this.cam.y + hh / 2 / z;
    const ox = tm ? tm.props.x % g : 0;
    const oy = tm ? tm.props.y % g : 0;
    ctx.beginPath();
    for (let x = Math.floor((x0 - ox) / g) * g + ox; x <= x1; x += g) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = Math.floor((y0 - oy) / g) * g + oy; y <= y1; y += g) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  }

  drawSelection(ctx) {
    const id = this.store.ui.selectedId;
    if (!id) return;
    const v = this.findView(id);
    if (!v) return;
    const z = this.cam.zoom;
    const b = this.worldBounds(v);
    ctx.strokeStyle = '#ffb300';
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.fillStyle = '#ffb300';
    const label = `${NODE_TYPES[v.type]?.icon || ''} ${v.name}`;
    ctx.font = `${12 / z}px system-ui, sans-serif`;
    ctx.fillText(label, b.x0, b.y0 - 5 / z);
    // Hitbox
    const target = v.type === 'SceneCopy' ? v.children[0] : v;
    if (target && target.body && target.body !== 'none' && target.type !== 'TileMap') {
      const sx = Math.hypot(target._m[0], target._m[1]);
      const sy = Math.hypot(target._m[2], target._m[3]);
      const size = visualSize(target, this.images);
      const hw = (target.hitboxWidth || size.w) * sx;
      const hh = (target.hitboxHeight || size.h) * sy;
      const cx = target._m[4] + (target.hitboxX || 0) * sx;
      const cy = target._m[5] + (target.hitboxY || 0) * sy;
      ctx.strokeStyle = target.body === 'trigger' ? '#40c4ff' : '#69f0ae';
      ctx.setLineDash([4 / z, 3 / z]);
      ctx.strokeRect(cx - hw / 2, cy - hh / 2, hw, hh);
      ctx.setLineDash([]);
    }
  }

  drawHoverCell(ctx) {
    const tm = this.activeTileMap();
    if (!tm || !this.hoverCell || (this.tool !== 'paint' && this.tool !== 'erase')) return;
    const ts = tm.props.tileSize || 32;
    const v = this.findView(tm.id);
    const x = (v ? v._m[4] : 0) + this.hoverCell[0] * ts;
    const y = (v ? v._m[5] : 0) + this.hoverCell[1] * ts;
    ctx.fillStyle = this.tool === 'erase' ? 'rgba(255,80,80,0.35)' : 'rgba(255,255,255,0.3)';
    ctx.fillRect(x, y, ts, ts);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1 / this.cam.zoom;
    ctx.strokeRect(x, y, ts, ts);
  }
}
