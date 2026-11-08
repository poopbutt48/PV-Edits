// The project and every change you can make to it.
//
// Every edit - whether you click a button or the AI does it - goes through
// one of the actions below. That gives us undo/redo for free and lets the
// AI's work be rewound and replayed step by step.

import { NODE_TYPES, defaultProps, coerceProp, cloneValue, normalizeTile } from '../runtime/nodeTypes.js';
import { DEFAULT_INPUT } from '../runtime/input.js';

export const DEFAULT_SETTINGS = {
  width: 960,
  height: 540,
  background: '#6ec6ff',
  pixelArt: true,
  gravity: 1400,
  startScene: '',
  touchControls: 'auto',
  touchLayout: 'platformer',
};

export const SETTING_DEFS = [
  { key: 'width', label: 'Game width', type: 'number', help: 'Width of the game screen in pixels.' },
  { key: 'height', label: 'Game height', type: 'number', help: 'Height of the game screen in pixels.' },
  { key: 'background', label: 'Background colour', type: 'color', help: 'Colour behind everything, like the sky.' },
  { key: 'pixelArt', label: 'Crisp pixel art', type: 'bool', help: 'Keeps small pictures sharp instead of blurry when they are scaled up.' },
  { key: 'gravity', label: 'Gravity', type: 'number', help: 'How strongly Characters with gravity fall. 1400 feels like a classic platformer.' },
  { key: 'startScene', label: 'Start scene', type: 'scene', help: 'The scene the game begins with when you press Play.' },
  { key: 'touchControls', label: 'On-screen buttons', type: 'enum', options: [['auto', 'Only on touch screens'], ['always', 'Always'], ['never', 'Never']], help: 'Buttons for phones and tablets.' },
  { key: 'touchLayout', label: 'Button layout', type: 'enum', options: [['platformer', 'Platformer (left, right, jump, action)'], ['dpad', 'Arrow pad (up, down, left, right, action)']], help: 'Which on-screen buttons to show.' },
];

export function newProject(name = 'My Game') {
  return {
    format: 'sprout-project',
    version: 1,
    id: randomId('proj'),
    name,
    created: Date.now(),
    modified: Date.now(),
    settings: { ...DEFAULT_SETTINGS },
    input: cloneValue(DEFAULT_INPUT),
    scenes: {},
    sceneOrder: [],
    scripts: {},
    assets: {},
  };
}

export function randomId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function makeNode(id, type, name, props = {}) {
  if (!NODE_TYPES[type]) throw new Error(`Unknown object type "${type}". Types: ${Object.keys(NODE_TYPES).join(', ')}.`);
  const node = { id, name: name || NODE_TYPES[type].label, type, props: defaultProps(type), script: null, scriptVars: {}, children: [] };
  for (const [k, v] of Object.entries(props || {})) node.props[k] = coerceProp(type, k, v);
  return node;
}

export class Store {
  constructor(project) {
    this.project = project;
    this.ui = { sceneId: project.sceneOrder[0] || null, selectedId: null, centerTab: 'scene' };
    this.history = [];
    this.future = [];
    this.listeners = new Map();
    this.idQueue = null; // used when replaying the AI's steps so ids come out identical
    this.idLog = null; // collects ids created while the AI works
    this._merge = null;
    this.batchDepth = 0;
  }

  // ------------------------------------------------------------ events

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }

  emit(event, detail) {
    for (const fn of this.listeners.get(event) || []) {
      try { fn(detail); } catch (e) { console.error(e); }
    }
  }

  // ------------------------------------------------------------ ids

  newId(prefix) {
    let id;
    if (this.idQueue && this.idQueue.length) id = this.idQueue.shift();
    else id = randomId(prefix);
    if (this.idLog) this.idLog.push(id);
    return id;
  }

  // ------------------------------------------------------------ snapshots & undo

  snapshot() {
    const { assets, ...rest } = this.project;
    return { json: JSON.stringify(rest), assets: { ...assets }, ui: { ...this.ui } };
  }

  restore(snap, { silent = false, keepUi = false } = {}) {
    const p = JSON.parse(snap.json);
    p.assets = { ...snap.assets };
    this.project = p;
    if (!keepUi) this.ui = { ...this.ui, ...snap.ui };
    this.fixUi();
    if (!silent) this.emit('change', { label: 'restore', restored: true });
  }

  fixUi() {
    if (!this.project.scenes[this.ui.sceneId]) this.ui.sceneId = this.project.sceneOrder[0] || null;
    if (this.ui.selectedId && !this.findNode(this.ui.selectedId)) this.ui.selectedId = null;
    const tab = this.ui.centerTab || 'scene';
    if (tab.startsWith('script:') && !this.project.scripts[tab.slice(7)]) this.ui.centerTab = 'scene';
    if (tab.startsWith('pixel:') && tab !== 'pixel:new' && !this.project.assets[tab.slice(6)]) this.ui.centerTab = 'scene';
  }

  // Runs a change as one undoable step.
  transact(label, fn, { merge = null } = {}) {
    if (this.batchDepth > 0) return fn();
    const now = Date.now();
    const canMerge = merge && this._merge && this._merge.key === merge && now - this._merge.time < 2500 && this.history.length;
    const before = canMerge ? null : this.snapshot();
    let result;
    this.batchDepth++;
    try {
      result = fn();
    } catch (err) {
      this.batchDepth--;
      if (before) this.restore(before, { silent: true, keepUi: true });
      throw err;
    }
    this.batchDepth--;
    this.project.modified = now;
    if (before) {
      this.history.push({ label, before });
      if (this.history.length > 200) this.history.shift();
    }
    this._merge = merge ? { key: merge, time: now } : null;
    this.future = [];
    this.emit('change', { label });
    return result;
  }

  // Puts the whole project back to a snapshot, as one undoable change.
  restoreAsChange(snap, label) {
    return this.transact(label, () => {
      const p = JSON.parse(snap.json);
      p.assets = { ...snap.assets };
      this.project = p;
      this.fixUi();
    });
  }

  canUndo() { return this.history.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    const h = this.history.pop();
    if (!h) return null;
    this.future.push({ label: h.label, before: this.snapshot() });
    this.restore(h.before, { silent: true });
    this._merge = null;
    this.emit('change', { label: 'undo ' + h.label, undo: true });
    return h.label;
  }

  redo() {
    const f = this.future.pop();
    if (!f) return null;
    this.history.push({ label: f.label, before: this.snapshot() });
    this.restore(f.before, { silent: true });
    this._merge = null;
    this.emit('change', { label: 'redo ' + f.label, redo: true });
    return f.label;
  }

  // ------------------------------------------------------------ queries

  get scenes() {
    return this.project.sceneOrder.map((id) => this.project.scenes[id]).filter(Boolean);
  }

  scene(id = this.ui.sceneId) {
    return this.project.scenes[id] || null;
  }

  sceneByName(name) {
    return this.scenes.find((s) => s.name === name) || null;
  }

  resolveScene(ref) {
    return this.project.scenes[ref] || this.sceneByName(ref);
  }

  findNode(id) {
    for (const scene of this.scenes) {
      const r = findIn(scene.root, id, null);
      if (r) return { ...r, scene };
    }
    return null;
  }

  node(id) {
    const r = this.findNode(id);
    return r ? r.node : null;
  }

  requireNode(id) {
    const r = this.findNode(id);
    if (!r) throw new Error(`No object with id "${id}". Use get_project_overview to see the current ids.`);
    return r;
  }

  selected() {
    return this.ui.selectedId ? this.node(this.ui.selectedId) : null;
  }

  assetByName(name) {
    return Object.values(this.project.assets).find((a) => a.name === name) || null;
  }

  resolveAsset(ref) {
    return this.project.assets[ref] || this.assetByName(ref);
  }

  // ------------------------------------------------------------ UI-only state (not undoable)

  openScene(id) {
    if (!this.project.scenes[id]) throw new Error(`No scene with id "${id}".`);
    this.ui.sceneId = id;
    if (this.ui.selectedId) {
      const r = this.findNode(this.ui.selectedId);
      if (!r || r.scene.id !== id) this.ui.selectedId = null;
    }
    this.ui.centerTab = 'scene';
    this.emit('change', { label: 'open scene', uiOnly: true });
  }

  select(id) {
    if (id && !this.findNode(id)) throw new Error(`No object with id "${id}".`);
    if (id) {
      const r = this.findNode(id);
      if (r.scene.id !== this.ui.sceneId) this.ui.sceneId = r.scene.id;
    }
    this.ui.selectedId = id || null;
    this.emit('change', { label: 'select', uiOnly: true });
  }

  setCenterTab(tab) {
    this.ui.centerTab = tab;
    this.emit('change', { label: 'tab', uiOnly: true });
  }

  // ------------------------------------------------------------ objects

  addNode({ sceneId, parentId, type, name, props }) {
    return this.transact(`Add ${name || type}`, () => {
      const scene = this.project.scenes[sceneId || this.ui.sceneId];
      if (!scene) throw new Error('Create a scene first.');
      let parent = scene.root;
      if (parentId) {
        const r = this.requireNode(parentId);
        if (r.scene.id !== scene.id) throw new Error('The parent object is in a different scene.');
        parent = r.node;
      }
      if (type === 'SceneCopy' && props && props.scene) {
        const target = this.resolveScene(props.scene);
        if (!target) throw new Error(`No scene called "${props.scene}" to copy.`);
        if (target.id === scene.id) throw new Error('A scene cannot contain a copy of itself.');
        props = { ...props, scene: target.id };
        if (!name) name = target.name;
      }
      const node = makeNode(this.newId('node'), type, name, props);
      parent.children.push(node);
      this.ui.sceneId = scene.id;
      this.ui.selectedId = node.id;
      return node.id;
    });
  }

  deleteNode(id) {
    return this.transact('Delete object', () => {
      const r = this.requireNode(id);
      if (!r.parent) throw new Error('The top object of a scene cannot be deleted. Delete the whole scene instead.');
      r.parent.children.splice(r.index, 1);
      if (this.ui.selectedId === id || !this.findNode(this.ui.selectedId)) this.ui.selectedId = null;
    });
  }

  renameNode(id, name) {
    name = String(name || '').trim();
    if (!name) throw new Error('Names cannot be empty.');
    return this.transact(`Rename to ${name}`, () => {
      const r = this.requireNode(id);
      r.node.name = name;
      if (!r.parent && r.scene.root === r.node) {
        // Renaming the top object of a scene renames the scene too, like Godot.
        if (this.scenes.some((s) => s !== r.scene && s.name === name)) throw new Error(`There is already a scene called "${name}".`);
        r.scene.name = name;
      }
    });
  }

  setProps(id, props, { merge = false } = {}) {
    const keys = Object.keys(props);
    return this.transact(`Change ${keys.join(', ')}`, () => {
      const r = this.requireNode(id);
      for (const [k, v] of Object.entries(props)) {
        let value = v;
        if (k === 'scene' && r.node.type === 'SceneCopy') {
          const target = this.resolveScene(v);
          if (!target) throw new Error(`No scene called "${v}".`);
          if (target.id === r.scene.id) throw new Error('A scene cannot contain a copy of itself.');
          value = target.id;
        }
        if (k === 'image' && v) {
          const a = this.resolveAsset(v);
          if (!a || a.kind !== 'image') throw new Error(`No picture called "${v}" in Assets.`);
          value = a.id;
        }
        r.node.props[k] = coerceProp(r.node.type, k, value);
      }
    }, { merge: merge ? `props:${id}:${keys.join(',')}` : null });
  }

  moveNode(id, newParentId, index = -1) {
    return this.transact('Move object', () => {
      const r = this.requireNode(id);
      if (!r.parent) throw new Error('The top object of a scene cannot be moved.');
      const p = this.requireNode(newParentId);
      if (p.scene.id !== r.scene.id) throw new Error('Objects can only be moved within the same scene.');
      if (findIn(r.node, newParentId, null)) throw new Error('An object cannot be put inside itself.');
      r.parent.children.splice(r.index, 1);
      const kids = p.node.children;
      if (index < 0 || index > kids.length) kids.push(r.node);
      else kids.splice(index, 0, r.node);
    });
  }

  duplicateNode(id, { name, x, y } = {}) {
    return this.transact('Duplicate object', () => {
      const r = this.requireNode(id);
      if (!r.parent) throw new Error('The top object of a scene cannot be duplicated. Use a Scene Copy instead.');
      const copy = cloneValue(r.node);
      const reId = (n) => { n.id = this.newId('node'); n.children.forEach(reId); };
      reId(copy);
      if (name) copy.name = name;
      if (x !== undefined && copy.props.x !== undefined) copy.props.x = coerceProp(copy.type, 'x', x);
      else if (copy.props.x !== undefined) copy.props.x += 32;
      if (y !== undefined && copy.props.y !== undefined) copy.props.y = coerceProp(copy.type, 'y', y);
      r.parent.children.splice(r.index + 1, 0, copy);
      this.ui.selectedId = copy.id;
      return copy.id;
    });
  }

  // ------------------------------------------------------------ scenes

  uniqueSceneName(name) {
    let n = name;
    let i = 2;
    while (this.scenes.some((s) => s.name === n)) n = `${name} ${i++}`;
    return n;
  }

  addScene({ name, rootType = 'Group', rootProps = {} }) {
    return this.transact(`Add scene ${name}`, () => {
      name = String(name || '').trim() || 'New Scene';
      if (this.scenes.some((s) => s.name === name)) throw new Error(`There is already a scene called "${name}".`);
      const id = this.newId('scene');
      const root = makeNode(this.newId('node'), rootType, name, rootProps);
      this.project.scenes[id] = { id, name, root };
      this.project.sceneOrder.push(id);
      if (!this.project.settings.startScene) this.project.settings.startScene = id;
      this.ui.sceneId = id;
      this.ui.selectedId = root.id;
      this.ui.centerTab = 'scene';
      return id;
    });
  }

  renameScene(id, name) {
    const s = this.project.scenes[id];
    if (!s) throw new Error(`No scene with id "${id}".`);
    return this.renameNode(s.root.id, name);
  }

  deleteScene(id) {
    return this.transact('Delete scene', () => {
      if (!this.project.scenes[id]) throw new Error(`No scene with id "${id}".`);
      if (this.project.sceneOrder.length <= 1) throw new Error('A project needs at least one scene.');
      delete this.project.scenes[id];
      this.project.sceneOrder = this.project.sceneOrder.filter((s) => s !== id);
      if (this.project.settings.startScene === id) this.project.settings.startScene = this.project.sceneOrder[0];
      this.fixUi();
    });
  }

  // ------------------------------------------------------------ scripts

  uniqueScriptName(base) {
    const names = new Set(Object.values(this.project.scripts).map((s) => s.name));
    let n = `${base}.js`;
    let i = 2;
    while (names.has(n)) n = `${base}${i++}.js`;
    return n;
  }

  attachNewScript(nodeId, code, name) {
    return this.transact('Add script', () => {
      const r = this.requireNode(nodeId);
      const id = this.newId('script');
      const base = String(name || r.node.name).replace(/\.js$/, '').replace(/[^\w-]+/g, '_').toLowerCase() || 'script';
      this.project.scripts[id] = { id, name: this.uniqueScriptName(base), code: code ?? '' };
      r.node.script = id;
      return id;
    });
  }

  attachExistingScript(nodeId, scriptId) {
    return this.transact('Attach script', () => {
      const r = this.requireNode(nodeId);
      if (!this.project.scripts[scriptId]) throw new Error(`No script with id "${scriptId}".`);
      r.node.script = scriptId;
    });
  }

  detachScript(nodeId) {
    return this.transact('Remove script', () => {
      const r = this.requireNode(nodeId);
      r.node.script = null;
      r.node.scriptVars = {};
    });
  }

  setScriptCode(scriptId, code, { merge = false } = {}) {
    return this.transact('Edit script', () => {
      const s = this.project.scripts[scriptId];
      if (!s) throw new Error(`No script with id "${scriptId}".`);
      s.code = String(code);
    }, { merge: merge ? `script:${scriptId}` : null });
  }

  setScriptVar(nodeId, name, value) {
    return this.transact(`Set ${name}`, () => {
      const r = this.requireNode(nodeId);
      if (!r.node.scriptVars) r.node.scriptVars = {};
      if (value === undefined || value === null) delete r.node.scriptVars[name];
      else r.node.scriptVars[name] = value;
    });
  }

  // ------------------------------------------------------------ tiles

  paintTiles(nodeId, cells, tileIndex, { merge = false } = {}) {
    return this.transact(tileIndex === null ? 'Erase tiles' : 'Paint tiles', () => {
      const r = this.requireNode(nodeId);
      if (r.node.type !== 'TileMap') throw new Error(`"${r.node.name}" is not a Tile Map.`);
      if (tileIndex !== null && !r.node.props.tiles[tileIndex]) throw new Error(`This Tile Map has no tile number ${tileIndex}. It has ${r.node.props.tiles.length} tile types (numbered from 0).`);
      for (const [x, y] of cells) {
        const key = `${Math.round(x)},${Math.round(y)}`;
        if (tileIndex === null) delete r.node.props.cells[key];
        else r.node.props.cells[key] = tileIndex;
      }
    }, { merge: merge ? `paint:${nodeId}` : null });
  }

  addTileType(nodeId, tile) {
    return this.transact('Add tile type', () => {
      const r = this.requireNode(nodeId);
      if (r.node.type !== 'TileMap') throw new Error(`"${r.node.name}" is not a Tile Map.`);
      const t = normalizeTile(tile);
      if (t.image) {
        const a = this.resolveAsset(t.image);
        if (!a || a.kind !== 'image') throw new Error(`No picture called "${t.image}" in Assets.`);
        t.image = a.id;
      }
      r.node.props.tiles.push(t);
      return r.node.props.tiles.length - 1;
    });
  }

  updateTileType(nodeId, index, changes) {
    return this.transact('Change tile type', () => {
      const r = this.requireNode(nodeId);
      const tiles = r.node.props.tiles;
      if (!tiles[index]) throw new Error(`No tile number ${index}.`);
      const next = normalizeTile({ ...tiles[index], ...changes });
      if (changes.image) {
        const a = this.resolveAsset(changes.image);
        if (!a || a.kind !== 'image') throw new Error(`No picture called "${changes.image}" in Assets.`);
        next.image = a.id;
      }
      tiles[index] = next;
    });
  }

  removeTileType(nodeId, index) {
    return this.transact('Remove tile type', () => {
      const r = this.requireNode(nodeId);
      const p = r.node.props;
      if (!p.tiles[index]) throw new Error(`No tile number ${index}.`);
      p.tiles.splice(index, 1);
      const cells = {};
      for (const [k, v] of Object.entries(p.cells)) {
        if (v === index) continue;
        cells[k] = v > index ? v - 1 : v;
      }
      p.cells = cells;
    });
  }

  // ------------------------------------------------------------ assets

  uniqueAssetName(name) {
    const base = String(name || 'asset').trim().replace(/\s+/g, '_') || 'asset';
    let n = base;
    let i = 2;
    while (this.assetByName(n)) n = `${base}_${i++}`;
    return n;
  }

  addAsset(asset) {
    return this.transact(`Add ${asset.kind} ${asset.name}`, () => {
      const id = this.newId('asset');
      const a = { ...asset, id, name: this.uniqueAssetName(asset.name) };
      if (a.kind === 'image') a.fps = a.fps || 8;
      this.project.assets = { ...this.project.assets, [id]: Object.freeze(a) };
      return id;
    });
  }

  updateAsset(id, changes) {
    return this.transact('Edit asset', () => {
      const a = this.project.assets[id];
      if (!a) throw new Error(`No asset with id "${id}".`);
      const next = { ...a, ...changes, id };
      if (changes.name && changes.name !== a.name) {
        if (this.assetByName(changes.name)) throw new Error(`There is already an asset called "${changes.name}".`);
      }
      this.project.assets = { ...this.project.assets, [id]: Object.freeze(next) };
    });
  }

  deleteAsset(id) {
    return this.transact('Delete asset', () => {
      if (!this.project.assets[id]) throw new Error(`No asset with id "${id}".`);
      const rest = { ...this.project.assets };
      delete rest[id];
      this.project.assets = rest;
    });
  }

  // ------------------------------------------------------------ settings

  setSetting(key, value) {
    return this.transact(`Change ${key}`, () => {
      const s = this.project.settings;
      if (!(key in DEFAULT_SETTINGS)) throw new Error(`Unknown setting "${key}". Settings: ${Object.keys(DEFAULT_SETTINGS).join(', ')}.`);
      if (key === 'startScene') {
        const scene = this.resolveScene(value);
        if (!scene) throw new Error(`No scene called "${value}".`);
        s.startScene = scene.id;
        return;
      }
      if (key === 'width' || key === 'height' || key === 'gravity') {
        const n = Number(value);
        if (!Number.isFinite(n) || (key !== 'gravity' && n < 16)) throw new Error(`${key} needs a sensible number.`);
        s[key] = Math.round(n);
        return;
      }
      if (key === 'pixelArt') { s.pixelArt = value === true || value === 'true'; return; }
      if (key === 'touchControls' && !['auto', 'always', 'never'].includes(value)) throw new Error('On-screen buttons must be auto, always or never.');
      if (key === 'touchLayout' && !['platformer', 'dpad'].includes(value)) throw new Error('Button layout must be platformer or dpad.');
      s[key] = value;
    });
  }

  setProjectName(name) {
    return this.transact('Rename project', () => { this.project.name = String(name).trim() || 'My Game'; });
  }

  setInputAction(action, keys) {
    return this.transact(`Change ${action} keys`, () => {
      action = String(action).trim();
      if (!/^[A-Za-z_][\w]*$/.test(action)) throw new Error('Action names can use letters, numbers and _ only.');
      if (!Array.isArray(keys)) throw new Error('keys must be a list of key codes like ["KeyA", "ArrowLeft", "Space"].');
      this.project.input[action] = keys.map(String);
    });
  }

  removeInputAction(action) {
    return this.transact(`Remove ${action}`, () => { delete this.project.input[action]; });
  }
}

function findIn(node, id, parent) {
  if (node.id === id) return { node, parent, index: parent ? parent.children.indexOf(node) : -1 };
  for (const c of node.children) {
    const r = findIn(c, id, node);
    if (r) return r;
  }
  return null;
}

export function walkNodes(node, fn, depth = 0, parent = null) {
  fn(node, depth, parent);
  for (const c of node.children) walkNodes(c, fn, depth + 1, node);
}
