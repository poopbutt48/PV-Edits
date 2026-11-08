// Keyboard, mouse and touch input, turned into named "actions" like
// "left" and "jump" so games work the same on a PC keyboard and a phone.

export const DEFAULT_INPUT = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
  action: ['KeyX', 'KeyJ', 'Enter'],
};

const GAME_KEYS = new Set(['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export class Input {
  constructor(actions) {
    this.actions = actions && Object.keys(actions).length ? actions : DEFAULT_INPUT;
    this.keys = new Set();
    this.tapped = new Set(); // keys pressed since the last step (so very quick taps still count)
    this.virtual = new Set(); // actions held by on-screen touch buttons
    this.virtualTapped = new Set();
    this.prev = new Set();
    this.current = new Set();
    this.mouseX = 0;
    this.mouseY = 0;
    this.mouseDown = false;
    this._clickQueue = [];
    this._listeners = [];
  }

  attach(target, canvas, toWorld) {
    const on = (el, ev, fn, opts) => {
      el.addEventListener(ev, fn, opts);
      this._listeners.push(() => el.removeEventListener(ev, fn, opts));
    };
    on(target, 'keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.dataset.gameInput) return;
      this.keys.add(e.code);
      this.tapped.add(e.code);
      if (GAME_KEYS.has(e.code)) e.preventDefault();
    });
    on(target, 'keyup', (e) => this.keys.delete(e.code));
    on(globalThis, 'blur', () => { this.keys.clear(); this.virtual.clear(); });
    const pointer = (e) => {
      const p = toWorld(e.clientX, e.clientY);
      this.mouseX = p.x;
      this.mouseY = p.y;
    };
    on(canvas, 'pointermove', pointer);
    on(canvas, 'pointerdown', (e) => {
      pointer(e);
      this.mouseDown = true;
      this._clickQueue.push({ x: this.mouseX, y: this.mouseY });
    });
    on(globalThis, 'pointerup', () => { this.mouseDown = false; });
  }

  detach() {
    for (const off of this._listeners) off();
    this._listeners = [];
  }

  // Called once per game step, before scripts run.
  beginStep() {
    this.prev = this.current;
    this.current = new Set();
    for (const [name, codes] of Object.entries(this.actions)) {
      if (this.virtual.has(name) || this.virtualTapped.has(name) || codes.some((c) => this.keys.has(c) || this.tapped.has(c))) this.current.add(name);
    }
    this.tapped.clear();
    this.virtualTapped.clear();
  }

  takeClicks() {
    const c = this._clickQueue;
    this._clickQueue = [];
    return c;
  }

  checkAction(name) {
    if (!this.actions[name]) {
      throw new Error(`There is no input action called "${name}". Actions: ${Object.keys(this.actions).join(', ')}. Add more in Project Settings.`);
    }
  }

  // The object scripts see as `input`.
  api() {
    const self = this;
    return {
      isDown(name) { self.checkAction(name); return self.current.has(name); },
      justPressed(name) { self.checkAction(name); return self.current.has(name) && !self.prev.has(name); },
      justReleased(name) { self.checkAction(name); return !self.current.has(name) && self.prev.has(name); },
      axis(neg, pos) { return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0); },
      isKeyDown(code) { return self.keys.has(code) || self.tapped.has(code); },
      get mouseX() { return self.mouseX; },
      get mouseY() { return self.mouseY; },
      get mouseDown() { return self.mouseDown; },
    };
  }
}

// On-screen buttons for phones and tablets.
export function createTouchControls(container, input, layout) {
  const wrap = document.createElement('div');
  wrap.className = 'sprout-touch';
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none;touch-action:none;';
  const btn = (label, action, css) => {
    const b = document.createElement('div');
    b.textContent = label;
    b.dataset.action = action;
    b.style.cssText = `position:absolute;${css};width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,0.22);border:2px solid rgba(255,255,255,0.5);color:#fff;font:bold 24px sans-serif;display:flex;align-items:center;justify-content:center;pointer-events:auto;touch-action:none;`;
    const down = (e) => { e.preventDefault(); input.virtual.add(action); input.virtualTapped.add(action); b.style.background = 'rgba(255,255,255,0.45)'; };
    const up = (e) => { e.preventDefault(); input.virtual.delete(action); b.style.background = 'rgba(255,255,255,0.22)'; };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    wrap.appendChild(b);
  };
  if (layout === 'dpad') {
    btn('▲', 'up', 'left:84px;bottom:140px');
    btn('◀', 'left', 'left:16px;bottom:76px');
    btn('▶', 'right', 'left:152px;bottom:76px');
    btn('▼', 'down', 'left:84px;bottom:12px');
    btn('●', 'action', 'right:20px;bottom:40px');
  } else {
    btn('◀', 'left', 'left:16px;bottom:24px');
    btn('▶', 'right', 'left:96px;bottom:24px');
    btn('●', 'action', 'right:100px;bottom:24px');
    btn('⤒', 'jump', 'right:20px;bottom:56px');
  }
  container.appendChild(wrap);
  return wrap;
}
