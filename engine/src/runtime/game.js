// The game runtime: loads a scene, runs scripts, moves characters,
// detects touches, follows the camera and draws everything.

import { defaultProps, cloneValue } from './nodeTypes.js';
import { Input, createTouchControls } from './input.js';
import { AudioSystem } from './audio.js';
import { compileScript, ScriptError, lineFromError, friendlyMessage } from './scripting.js';
import { drawTree, drawOnScreen, ImageStore, visualSize, textOffsetX, parseCell } from './render.js';

const FIXED_DT = 1 / 60;
const MAX_FALL_SPEED = 1800;
let uidCounter = 1;

// ---------------------------------------------------------------- objects

export class GameObject {
  constructor(game, data) {
    Object.defineProperty(this, '_game', { value: game, enumerable: false });
    this._uid = uidCounter++;
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    Object.assign(this, defaultProps(data.type), cloneValue(data.props || {}));
    this.children = [];
    this.parent = null;
    this.velocity = { x: 0, y: 0 };
    this.vars = {};
    this.frame = 0;
    this._animTime = 0;
    this._lastImage = this.image;
    this._hooks = null;
    this._file = null;
    this._floor = false;
    this._wall = false;
    this._ceiling = false;
    this._destroyed = false;
    this._flashUntil = 0;
    this._m = [1, 0, 0, 1, 0, 0];
  }

  isOnFloor() { return this._floor; }
  isOnWall() { return this._wall; }
  isOnCeiling() { return this._ceiling; }

  get left() { return this._game.hitbox(this).x0; }
  get right() { return this._game.hitbox(this).x1; }
  get top() { return this._game.hitbox(this).y0; }
  get bottom() { return this._game.hitbox(this).y1; }
  get worldX() { return this._m[4]; }
  get worldY() { return this._m[5]; }

  touching(nameOrObj) {
    for (const o of this._game.touchingOf(this)) {
      if (typeof nameOrObj === 'string' ? o.name === nameOrObj : o === nameOrObj) return true;
    }
    return false;
  }

  distanceTo(other) {
    if (!other) return Infinity;
    return Math.hypot(other._m[4] - this._m[4], other._m[5] - this._m[5]);
  }

  moveToward(x, y, step) {
    const dx = x - this.x;
    const dy = y - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= step || d === 0) { this.x = x; this.y = y; return true; }
    this.x += (dx / d) * step;
    this.y += (dy / d) * step;
    return false;
  }

  find(name) {
    for (const c of this.children) {
      if (c.name === name && !c._destroyed) return c;
      const f = c.find(name);
      if (f) return f;
    }
    return null;
  }

  destroy() { this._game.destroyObject(this); }

  flash(seconds = 0.6) { this._flashUntil = this._game.time + seconds; }

  toString() { return `[${this.type} "${this.name}"]`; }
}

// ---------------------------------------------------------------- matrices

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
  if (o.type === 'TileMap' || o.type === 'Camera') return [1, 0, 0, 1, x, y];
  const r = ((o.rotation || 0) * Math.PI) / 180;
  const sx = o.scaleX ?? 1;
  const sy = o.scaleY ?? 1;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c * sx, s * sx, -s * sy, c * sy, x, y];
}

// ---------------------------------------------------------------- game

export class Game {
  constructor(project, container, options = {}) {
    this.project = project;
    this.container = container;
    this.options = options;
    this.settings = Object.assign(
      { width: 960, height: 540, background: '#6ec6ff', pixelArt: true, gravity: 1400, touchControls: 'auto', touchLayout: 'platformer' },
      project.settings || {},
    );
    this.width = this.settings.width;
    this.height = this.settings.height;
    this.images = new ImageStore();
    this.audio = options.audio || new AudioSystem();
    this.input = new Input(project.input);
    this.inputApi = this.input.api();
    this.vars = {};
    this.time = 0;
    this.root = null;
    this.paused = false;
    this.errorPaused = false;
    this.running = false;
    this.timers = [];
    this.pendingScene = null;
    this.camera = null;
    this.cam = { x: this.width / 2, y: this.height / 2, zoom: 1, shake: 0, shakeTime: 0 };
    this.touchPairs = new Map(); // key -> [a, b]
    this.compiled = new Map(); // script id -> compiled script
    this.levelBounds = null;
    this.frameCount = 0;
    this._raf = 0;
    this._acc = 0;
    this._last = 0;
    this._toDestroy = [];
    this.gameApi = this.makeGameApi();
  }

  // -------------------------------------------------------------- setup

  async start(sceneRef) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sprout-game-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none;';
    this.canvas.tabIndex = 0;
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.input.attach(globalThis, this.canvas, (cx, cy) => this.screenToWorld(cx, cy));
    const touch = this.settings.touchControls;
    const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    if (touch === 'always' || (touch === 'auto' && isTouch)) {
      this.touchUi = createTouchControls(this.container, this.input, this.settings.touchLayout);
    }
    this.images.sync(this.project.assets);
    await Promise.all([this.images.ready(), this.audio.loadAssets(this.project.assets)]);
    this.startSceneId = this.findScene(sceneRef || this.settings.startScene)?.id || Object.keys(this.project.scenes)[0];
    this.loadScene(this.startSceneId);
    this.running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame((t) => this.frame(t));
    try { this.canvas.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
    return this;
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this.input.detach();
    this.audio.stopAll();
    if (this.touchUi) this.touchUi.remove();
    if (this.canvas) this.canvas.remove();
  }

  findScene(ref) {
    if (!ref) return null;
    const scenes = this.project.scenes;
    if (scenes[ref]) return scenes[ref];
    return Object.values(scenes).find((s) => s.name === ref) || null;
  }

  // -------------------------------------------------------------- scenes

  loadScene(sceneId) {
    const scene = this.findScene(sceneId);
    if (!scene) throw new Error(`There is no scene called "${sceneId}".`);
    for (const t of this.timers) t.dead = true;
    this.timers = [];
    this.touchPairs.clear();
    this.time = 0;
    this.currentScene = scene;
    this.root = this.instantiate(scene.root, null, 0);
    this.updateMatrices(this.root, [1, 0, 0, 1, 0, 0]);
    this.camera = this.findFirst(this.root, (o) => o.type === 'Camera');
    this.refreshBodies();
    this.computeLevelBounds();
    this.snapCamera();
    this.startTree(this.root);
  }

  instantiate(data, parent, depth, overrideName, overridePos) {
    if (depth > 30) throw new Error('Scene copies are nested too deeply. Does a scene contain a copy of itself?');
    let obj;
    if (data.type === 'SceneCopy') {
      const scene = this.findScene(data.props && data.props.scene);
      if (!scene) {
        obj = new GameObject(this, { id: data.id, name: data.name, type: 'Group', props: { x: data.props?.x || 0, y: data.props?.y || 0 } });
      } else {
        obj = this.instantiate(scene.root, parent, depth + 1, data.name, { x: data.props?.x || 0, y: data.props?.y || 0 });
        if (data.scriptVars) obj._scriptVarsOverride = Object.assign({}, obj._scriptVarsOverride, data.scriptVars);
        return obj;
      }
    } else {
      obj = new GameObject(this, data);
      obj._scriptId = data.script || null;
      obj._scriptVarsOverride = data.scriptVars || null;
    }
    if (overrideName) obj.name = overrideName;
    if (overridePos) { obj.x = overridePos.x; obj.y = overridePos.y; }
    obj.parent = parent;
    for (const c of data.children || []) obj.children.push(this.instantiate(c, obj, depth + 1));
    return obj;
  }

  startTree(root) {
    const list = [];
    this.walk(root, (o) => list.push(o));
    for (const o of list) this.attachScript(o);
    for (const o of list) if (o._hooks && o._hooks.start && !o._destroyed) this.callHook(o, 'start');
  }

  attachScript(o) {
    if (!o._scriptId) return;
    const script = this.project.scripts && this.project.scripts[o._scriptId];
    if (!script) return;
    let compiled = this.compiled.get(script.id);
    try {
      o._scriptName = script.name;
      o._scriptRealId = script.id;
      if (!compiled) {
        compiled = compileScript(script);
        this.compiled.set(script.id, compiled);
      }
      o._file = compiled.file;
      o._hooks = compiled.instantiate(this.makeScriptApi(o));
      if (o._scriptVarsOverride) {
        for (const [k, v] of Object.entries(o._scriptVarsOverride)) o._hooks.__set(k, v);
      }
    } catch (err) {
      o._hooks = null;
      this.reportError(err, o, 'setup', script);
    }
  }

  // -------------------------------------------------------------- script API

  makeScriptApi(o) {
    const game = this;
    const log = (...args) => game.log(args.map(fmt).join(' '), o);
    return {
      me: o,
      game: this.gameApi,
      input: this.inputApi,
      playSound: (name, volume) => this.audio.play(String(name), volume ?? 1),
      playMusic: (name, volume) => this.audio.playMusic(String(name), volume),
      stopMusic: () => this.audio.stopMusic(),
      after: (sec, fn) => this.addTimer(o, sec, fn, false),
      every: (sec, fn) => this.addTimer(o, sec, fn, true),
      random: (a = 0, b = 1) => a + Math.random() * (b - a),
      randomInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
      chance: (p) => Math.random() < p,
      clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
      lerp: (a, b, t) => a + (b - a) * t,
      log,
      print: log,
    };
  }

  makeGameApi() {
    const game = this;
    return {
      find: (name) => game.findFirst(game.root, (o) => o.name === name && !o._destroyed),
      findAll: (name) => { const out = []; game.walk(game.root, (o) => { if (o.name === name && !o._destroyed) out.push(o); }); return out; },
      spawn: (sceneName, x = 0, y = 0) => game.spawn(sceneName, x, y),
      changeScene: (name) => { if (!game.findScene(name)) throw new Error(`There is no scene called "${name}".`); game.pendingScene = name; },
      restart: () => { game.vars = {}; game.gameApi.vars = game.vars; game.pendingScene = game.currentScene.id; },
      vars: game.vars,
      get time() { return game.time; },
      get width() { return game.width; },
      get height() { return game.height; },
      get camera() { return game.camera; },
      isSolidAt: (x, y) => game.isSolidAt(x, y),
      shake: (strength = 8, seconds = 0.3) => { game.cam.shake = strength; game.cam.shakeTime = seconds; game.cam.shakeTotal = seconds; },
      pause: () => { game.paused = true; },
      resume: () => { if (!game.errorPaused) game.paused = false; },
    };
  }

  spawn(sceneName, x, y) {
    const scene = this.findScene(sceneName);
    if (!scene) throw new Error(`game.spawn could not find a scene called "${sceneName}".`);
    const obj = this.instantiate(scene.root, this.root, 0, null, { x, y });
    this.root.children.push(obj);
    this.updateMatrices(obj, this.root._m);
    this.startTree(obj);
    return obj;
  }

  addTimer(o, sec, fn, repeat) {
    if (typeof fn !== 'function') throw new Error(`${repeat ? 'every' : 'after'}() needs a function, like ${repeat ? 'every' : 'after'}(1, () => { ... })`);
    const t = { obj: o, at: this.time + Math.max(0, sec), interval: Math.max(0.01, sec), fn, repeat, dead: false };
    this.timers.push(t);
    return { cancel() { t.dead = true; } };
  }

  log(text, o) {
    if (this.options.onLog) this.options.onLog({ text, object: o ? o.name : null });
    else console.log('[game]', text);
  }

  // -------------------------------------------------------------- errors

  callHook(o, name, ...args) {
    const fn = o._hooks && o._hooks[name];
    if (!fn) return;
    try {
      fn.apply(o, args);
    } catch (err) {
      this.reportError(err, o, name);
    }
  }

  reportError(err, o, phase, script) {
    const scriptName = (script && script.name) || o._scriptName || 'script';
    const scriptId = (script && script.id) || o._scriptRealId || o._scriptId;
    let info;
    if (err instanceof ScriptError) info = { ...err.info, objectName: o.name, message: err.message };
    else {
      const pos = o._file ? lineFromError(err, o._file) : null;
      info = { script: scriptName, scriptId, line: pos ? pos.line : null, column: pos ? pos.column : null, objectName: o.name, phase, message: friendlyMessage(err), raw: String(err && err.message) };
    }
    this.paused = true;
    this.errorPaused = true;
    if (this.options.onError) this.options.onError(info);
    else console.error('[game error]', info);
  }

  // -------------------------------------------------------------- loop

  frame(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame((t) => this.frame(t));
    let elapsed = (now - this._last) / 1000;
    this._last = now;
    if (elapsed > 0.25) elapsed = 0.25;
    if (!this.paused) {
      this._acc += elapsed;
      let steps = 0;
      while (this._acc >= FIXED_DT && steps < 5) {
        this.step(FIXED_DT);
        this._acc -= FIXED_DT;
        steps++;
        if (this.paused) break;
      }
      if (steps === 5) this._acc = 0;
    } else {
      this.handleClicks(); // allow onClick while paused (e.g. menus)
    }
    this.render();
  }

  step(dt) {
    this.frameCount++;
    this.input.beginStep();
    this.time += dt;
    const all = [];
    this.walk(this.root, (o) => { if (!o._destroyed) all.push(o); });

    for (const o of all) if (o._hooks && o._hooks.update && !o._destroyed) { this.callHook(o, 'update', dt); if (this.paused) return; }
    this.runTimers();
    if (this.paused) return;
    this.handleClicks();

    this.updateMatrices(this.root, [1, 0, 0, 1, 0, 0]);
    this.refreshBodies(all);
    for (const o of all) if (o.body === 'character' && !o._destroyed) this.moveCharacter(o, dt);
    this.updateMatrices(this.root, [1, 0, 0, 1, 0, 0]);
    this.detectTouches(all);
    if (this.paused) return;
    this.animate(all, dt);
    this.flushDestroyed();
    this.updateCamera(dt);
    if (this.pendingScene) {
      const s = this.pendingScene;
      this.pendingScene = null;
      this.loadScene(s);
    }
  }

  refreshBodies(all) {
    if (!all) { all = []; this.walk(this.root, (o) => all.push(o)); }
    this.solids = all.filter((o) => (o.body === 'solid' || o.body === 'platform') && !o._destroyed);
    this.tilemaps = all.filter((o) => o.type === 'TileMap' && !o._destroyed);
  }

  runTimers() {
    const due = this.timers.filter((t) => !t.dead && t.at <= this.time && !t.obj._destroyed);
    for (const t of due) {
      if (t.repeat) t.at += t.interval;
      else t.dead = true;
      try { t.fn.call(t.obj); } catch (err) { this.reportError(err, t.obj, 'timer'); return; }
    }
    this.timers = this.timers.filter((t) => !t.dead && !t.obj._destroyed);
  }

  handleClicks() {
    const clicks = this.input.takeClicks();
    if (!clicks.length || !this.root) return;
    for (const c of clicks) {
      const hits = [];
      this.walk(this.root, (o) => {
        if (o._destroyed || !o._hooks || !o._hooks.onClick || o.visible === false) return;
        const b = this.visualBox(o);
        const p = o.type === 'Text' && o.onScreen ? this.lastScreenPoint : c;
        if (p && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) hits.push(o);
      });
      const top = hits.sort((a, b) => (b.layer || 0) - (a.layer || 0))[0];
      if (top) this.callHook(top, 'onClick');
    }
  }

  animate(all, dt) {
    for (const o of all) {
      if (o.type !== 'Sprite') continue;
      if (o.image !== o._lastImage) { o._lastImage = o.image; o._animTime = 0; o.frame = 0; }
      const frames = this.images.frames(o.image);
      if (!frames || frames.length < 2 || !o.animSpeed) continue;
      o._animTime += dt;
      o.frame = Math.floor(o._animTime * o.animSpeed) % frames.length;
    }
  }

  // -------------------------------------------------------------- tree helpers

  walk(o, fn) {
    if (!o) return;
    fn(o);
    for (const c of o.children) this.walk(c, fn);
  }

  findFirst(o, pred) {
    if (!o) return null;
    if (pred(o)) return o;
    for (const c of o.children) {
      const f = this.findFirst(c, pred);
      if (f) return f;
    }
    return null;
  }

  updateMatrices(o, parentM) {
    o._m = mul(parentM, localMatrix(o));
    for (const c of o.children) this.updateMatrices(c, o._m);
  }

  destroyObject(o) {
    if (o._destroyed) return;
    this.walk(o, (d) => { d._destroyed = true; });
    this._toDestroy.push(o);
  }

  flushDestroyed() {
    if (!this._toDestroy.length) return;
    const list = this._toDestroy;
    this._toDestroy = [];
    for (const o of list) {
      this.walk(o, (d) => { if (d._hooks && d._hooks.onDestroy) this.callHook(d, 'onDestroy'); });
      if (o.parent) o.parent.children = o.parent.children.filter((c) => c !== o);
      if (o === this.root) this.root.children = [];
    }
    for (const [k, pair] of this.touchPairs) if (pair[0]._destroyed || pair[1]._destroyed) this.touchPairs.delete(k);
  }

  // -------------------------------------------------------------- physics

  hitbox(o) {
    const m = o._m;
    const sx = Math.hypot(m[0], m[1]);
    const sy = Math.hypot(m[2], m[3]);
    let w = o.hitboxWidth;
    let h = o.hitboxHeight;
    if (!w || !h) {
      const v = visualSize(o, this.images);
      w = w || v.w;
      h = h || v.h;
    }
    w *= sx;
    h *= sy;
    const cx = m[4] + (o.hitboxX || 0) * sx;
    const cy = m[5] + (o.hitboxY || 0) * sy;
    if (o.type === 'Text') {
      const v = visualSize(o, this.images);
      const x0 = m[4] + textOffsetX(o, v.w) * sx;
      return { x0, y0: m[5], x1: x0 + v.w * sx, y1: m[5] + v.h * sy };
    }
    return { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
  }

  visualBox(o) {
    const saveW = o.hitboxWidth;
    const saveH = o.hitboxHeight;
    const saveX = o.hitboxX;
    const saveY = o.hitboxY;
    o.hitboxWidth = 0; o.hitboxHeight = 0; o.hitboxX = 0; o.hitboxY = 0;
    const b = this.hitbox(o);
    o.hitboxWidth = saveW; o.hitboxHeight = saveH; o.hitboxX = saveX; o.hitboxY = saveY;
    return b;
  }

  moveCharacter(o, dt) {
    if (o.gravity) o.velocity.y = Math.min(o.velocity.y + this.settings.gravity * dt, MAX_FALL_SPEED);
    o._floor = false;
    o._wall = false;
    o._ceiling = false;
    this.moveAxis(o, o.velocity.x * dt, 0);
    this.moveAxis(o, 0, o.velocity.y * dt);
  }

  moveAxis(o, dx, dy) {
    const dist = Math.abs(dx) + Math.abs(dy);
    if (!dist) return;
    const steps = Math.max(1, Math.ceil(dist / 6));
    const sx = dx / steps;
    const sy = dy / steps;
    for (let i = 0; i < steps; i++) {
      const before = this.hitbox(o);
      this.shift(o, sx, sy);
      const box = this.hitbox(o);
      const fix = this.blockingCorrection(o, box, before, sx, sy);
      if (fix !== 0) {
        if (sx) { this.shift(o, fix, 0); o._wall = true; o.velocity.x = 0; }
        else {
          this.shift(o, 0, fix);
          if (sy > 0) o._floor = true; else o._ceiling = true;
          o.velocity.y = 0;
        }
        return;
      }
    }
  }

  // Moves an object by a world-space amount, converting to its parent's space.
  shift(o, gdx, gdy) {
    const p = o.parent ? o.parent._m : [1, 0, 0, 1, 0, 0];
    const det = p[0] * p[3] - p[2] * p[1] || 1;
    const lx = (p[3] * gdx - p[2] * gdy) / det;
    const ly = (-p[1] * gdx + p[0] * gdy) / det;
    o.x += lx;
    o.y += ly;
    o._m[4] += gdx;
    o._m[5] += gdy;
  }

  blockingCorrection(o, box, before, sx, sy) {
    let best = 0;
    const consider = (b, platform) => {
      if (box.x1 <= b.x0 || box.x0 >= b.x1 || box.y1 <= b.y0 || box.y0 >= b.y1) return;
      if (platform && !(sy > 0 && before.y1 <= b.y0 + 0.01)) return;
      let c;
      if (sx > 0) c = b.x0 - box.x1;
      else if (sx < 0) c = b.x1 - box.x0;
      else if (sy > 0) c = b.y0 - box.y1;
      else c = b.y1 - box.y0;
      if (Math.abs(c) > Math.abs(best)) best = c;
    };
    for (const s of this.solids) {
      if (s === o || s._destroyed || isAncestor(s, o)) continue;
      consider(this.hitbox(s), s.body === 'platform');
    }
    for (const tm of this.tilemaps) {
      const ts = tm.tileSize || 32;
      const ox = tm._m[4];
      const oy = tm._m[5];
      const cx0 = Math.floor((box.x0 - ox) / ts);
      const cx1 = Math.floor((box.x1 - ox - 1e-6) / ts);
      const cy0 = Math.floor((box.y0 - oy) / ts);
      const cy1 = Math.floor((box.y1 - oy - 1e-6) / ts);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ti = tm.cells[cx + ',' + cy];
          if (ti === undefined) continue;
          const tile = tm.tiles[ti];
          if (!tile || (!tile.solid && !tile.platform)) continue;
          consider({ x0: ox + cx * ts, y0: oy + cy * ts, x1: ox + (cx + 1) * ts, y1: oy + (cy + 1) * ts }, !!tile.platform);
        }
      }
    }
    return best;
  }

  // Is there a solid tile, platform or solid object at this point in the world?
  isSolidAt(x, y) {
    for (const tm of this.tilemaps || []) {
      const ts = tm.tileSize || 32;
      const ti = tm.cells[Math.floor((x - tm._m[4]) / ts) + ',' + Math.floor((y - tm._m[5]) / ts)];
      if (ti === undefined) continue;
      const tile = tm.tiles[ti];
      if (tile && (tile.solid || tile.platform)) return true;
    }
    for (const s of this.solids || []) {
      if (s._destroyed) continue;
      const b = this.hitbox(s);
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return true;
    }
    return false;
  }

  touchingOf(o) {
    const out = [];
    for (const [a, b] of this.touchPairs.values()) {
      if (a === o) out.push(b);
      else if (b === o) out.push(a);
    }
    return out;
  }

  detectTouches(all) {
    const bodies = all.filter((o) => o.body && o.body !== 'none' && !o._destroyed);
    const boxes = bodies.map((o) => this.hitbox(o));
    const now = new Map();
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const ba = boxes[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const interesting = a.body === 'trigger' || b.body === 'trigger' || (a.body === 'character' && b.body === 'character');
        if (!interesting) continue;
        const bb = boxes[j];
        if (ba.x1 <= bb.x0 || ba.x0 >= bb.x1 || ba.y1 <= bb.y0 || ba.y0 >= bb.y1) continue;
        const key = a._uid < b._uid ? a._uid + '|' + b._uid : b._uid + '|' + a._uid;
        now.set(key, [a, b]);
      }
    }
    const started = [];
    const ended = [];
    for (const [k, pair] of now) if (!this.touchPairs.has(k)) started.push(pair);
    for (const [k, pair] of this.touchPairs) if (!now.has(k)) ended.push(pair);
    this.touchPairs = now;
    for (const [a, b] of started) {
      if (!a._destroyed && !b._destroyed) this.callHook(a, 'onTouch', b);
      if (this.paused) return;
      if (!a._destroyed && !b._destroyed) this.callHook(b, 'onTouch', a);
      if (this.paused) return;
    }
    for (const [a, b] of ended) {
      if (!a._destroyed) this.callHook(a, 'onTouchEnd', b);
      if (!b._destroyed) this.callHook(b, 'onTouchEnd', a);
    }
  }

  // -------------------------------------------------------------- camera

  computeLevelBounds() {
    let b = null;
    this.walk(this.root, (o) => {
      if (o.type !== 'TileMap') return;
      const ts = o.tileSize || 32;
      for (const key in o.cells) {
        const [cx, cy] = parseCell(key);
        const x0 = o._m[4] + cx * ts;
        const y0 = o._m[5] + cy * ts;
        if (!b) b = { x0, y0, x1: x0 + ts, y1: y0 + ts };
        else {
          b.x0 = Math.min(b.x0, x0); b.y0 = Math.min(b.y0, y0);
          b.x1 = Math.max(b.x1, x0 + ts); b.y1 = Math.max(b.y1, y0 + ts);
        }
      }
    });
    this.levelBounds = b;
  }

  cameraTarget() {
    const c = this.camera;
    if (!c || c._destroyed) return { x: this.width / 2, y: this.height / 2, zoom: 1 };
    let x = c._m[4];
    let y = c._m[5];
    if (c.follow) {
      const t = this.gameApi.find(c.follow);
      if (t) { x = t._m[4]; y = t._m[5]; }
    }
    const zoom = c.zoom || 1;
    if (c.stayInLevel && this.levelBounds) {
      const b = this.levelBounds;
      const hw = this.width / 2 / zoom;
      const hh = this.height / 2 / zoom;
      // Narrow level: centre it. Short level: line the bottom of the view up with the ground.
      x = b.x1 - b.x0 <= hw * 2 ? (b.x0 + b.x1) / 2 : Math.min(Math.max(x, b.x0 + hw), b.x1 - hw);
      y = b.y1 - b.y0 <= hh * 2 ? b.y1 - hh : Math.min(Math.max(y, b.y0 + hh), b.y1 - hh);
    }
    return { x, y, zoom };
  }

  snapCamera() {
    const t = this.cameraTarget();
    this.cam.x = t.x; this.cam.y = t.y; this.cam.zoom = t.zoom;
  }

  updateCamera(dt) {
    const t = this.cameraTarget();
    const s = this.camera ? this.camera.smoothing || 0 : 0;
    const k = s <= 0 ? 1 : 1 - Math.exp(-dt / (s * 0.5));
    this.cam.x += (t.x - this.cam.x) * k;
    this.cam.y += (t.y - this.cam.y) * k;
    this.cam.zoom = t.zoom;
    if (this.cam.shakeTime > 0) this.cam.shakeTime -= dt;
  }

  // -------------------------------------------------------------- drawing

  layout() {
    const dpr = globalThis.devicePixelRatio || 1;
    const cw = this.container.clientWidth || this.width;
    const ch = this.container.clientHeight || this.height;
    if (this.canvas.width !== Math.round(cw * dpr) || this.canvas.height !== Math.round(ch * dpr)) {
      this.canvas.width = Math.round(cw * dpr);
      this.canvas.height = Math.round(ch * dpr);
    }
    const scale = Math.min(cw / this.width, ch / this.height);
    const ox = (cw - this.width * scale) / 2;
    const oy = (ch - this.height * scale) / 2;
    this.view = { dpr, scale, ox, oy, cw, ch };
    return this.view;
  }

  screenToWorld(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = this.view || this.layout();
    const sx = (clientX - r.left - v.ox) / v.scale;
    const sy = (clientY - r.top - v.oy) / v.scale;
    this.lastScreenPoint = { x: sx, y: sy };
    const z = this.cam.zoom || 1;
    return { x: (sx - this.width / 2) / z + this.cam.x, y: (sy - this.height / 2) / z + this.cam.y };
  }

  render() {
    const ctx = this.ctx;
    const v = this.layout();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(v.dpr * v.scale, 0, 0, v.dpr * v.scale, v.dpr * v.ox, v.dpr * v.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();
    ctx.fillStyle = this.settings.background;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = !this.settings.pixelArt;
    let shx = 0;
    let shy = 0;
    if (this.cam.shakeTime > 0) {
      const amt = this.cam.shake * (this.cam.shakeTime / (this.cam.shakeTotal || 1));
      shx = (Math.random() * 2 - 1) * amt;
      shy = (Math.random() * 2 - 1) * amt;
    }
    const z = this.cam.zoom || 1;
    ctx.save();
    ctx.translate(this.width / 2 + shx, this.height / 2 + shy);
    ctx.scale(z, z);
    ctx.translate(-this.cam.x, -this.cam.y);
    const hw = this.width / 2 / z;
    const hh = this.height / 2 / z;
    const opts = { images: this.images, time: this.time, editor: false, view: { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh } };
    if (this.root) drawTree(ctx, this.root, opts);
    ctx.restore();
    if (this.root) drawOnScreen(ctx, this.root, opts);
    ctx.restore();
  }
}

function isAncestor(maybeParent, o) {
  let p = o.parent;
  while (p) { if (p === maybeParent) return true; p = p.parent; }
  return false;
}

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof GameObject) return v.toString();
  try { return JSON.stringify(v, (k, val) => (val instanceof GameObject && k ? val.toString() : val)); } catch (_) { return String(v); }
}
