// The AI helper's own cursor. It moves to real buttons and fields,
// highlights them, clicks and types - so people can watch and learn.
// Every action is also recorded so it can be summarised and replayed.

const SPEEDS = { slow: 1.8, normal: 1, fast: 0.45, instant: 0 };

const CURSOR_SVG = `<svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
<path d="M4 2 L4 22 L9.5 16.8 L13.4 25.5 L17 23.9 L13.2 15.4 L20.5 15.2 Z" fill="#8b5cf6" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>
</svg>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CancelledError extends Error {
  constructor() { super('Stopped'); this.cancelled = true; }
}

export class GhostCursor {
  constructor(editor) {
    this.editor = editor;
    this.speed = 'normal';
    this.cancelled = false;
    this.recording = null; // array that collects actions
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.layer = document.createElement('div');
    this.layer.className = 'ghost-layer';
    this.layer.innerHTML = `<div class="ghost-highlight" hidden></div><div class="ghost-cursor" hidden>${CURSOR_SVG}<div class="ghost-label"></div></div>`;
    document.body.appendChild(this.layer);
    this.cursorEl = this.layer.querySelector('.ghost-cursor');
    this.labelEl = this.layer.querySelector('.ghost-label');
    this.hlEl = this.layer.querySelector('.ghost-highlight');
  }

  get k() { return SPEEDS[this.speed] ?? 1; }

  destroy() { this.layer.remove(); }

  show() {
    this.cursorEl.hidden = false;
    this.place(this.x, this.y);
  }

  hide() {
    this.cursorEl.hidden = true;
    this.hlEl.hidden = true;
    this.labelEl.textContent = '';
  }

  check() {
    if (this.cancelled) throw new CancelledError();
  }

  async wait(ms) {
    this.check();
    if (this.k > 0) await sleep(ms * this.k);
    this.check();
  }

  place(x, y) {
    this.x = x;
    this.y = y;
    this.cursorEl.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
  }

  say(text) {
    this.labelEl.textContent = text || '';
    this.labelEl.hidden = !text;
  }

  record(action) {
    if (this.recording) this.recording.push(action);
  }

  // ------------------------------------------------------------ finding things

  resolve(target) {
    if (!target) throw new Error('No target given.');
    if (target instanceof Element) return target;
    if (typeof target === 'string') {
      const el = document.querySelector(`[data-ai="${CSS.escape(target)}"]`);
      if (!el) throw new Error(`Could not find "${target}" on screen.`);
      return el;
    }
    return target; // a rectangle {left, top, width, height}
  }

  rectOf(t) {
    if (t instanceof Element) return t.getBoundingClientRect();
    return { left: t.left, top: t.top, width: t.width, height: t.height, right: t.left + t.width, bottom: t.top + t.height };
  }

  labelOf(el, fallback) {
    if (!(el instanceof Element)) return fallback || 'there';
    const l = el.getAttribute('data-ai-label') || el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.value || fallback || '';
    return l.replace(/\s+/g, ' ').trim().slice(0, 40);
  }

  // Makes sure an element can be seen: switches the phone tab, opens the
  // right centre tab, expands folded sections and scrolls it into view.
  async reveal(el) {
    if (!(el instanceof Element)) return;
    const ed = this.editor;
    const panel = el.closest('[data-panel]');
    if (panel && el.closest('.app') && !ed.panelVisible(panel.dataset.panel) && !el.closest('.dialog')) {
      const name = panel.dataset.panel;
      if (document.querySelector(`[data-ai="mobile-tab:${name}"]`) && getComputedStyle(ed.mobileNav).display !== 'none') {
        await this.click(`mobile-tab:${name}`, null, { record: true });
      } else if (name === 'ai') {
        ed.toggleAI(true);
      }
    }
    const view = el.closest('.center-view');
    if (view && view.hidden) {
      const kind = view.dataset.view;
      const tab = kind === 'scene' ? 'scene' : ed.store.ui.centerTab;
      if (kind === 'scene') await this.click('center-tab:scene', 'Scene tab', { record: true });
      else if (tab) ed.store.setCenterTab(tab);
      ed.renderNow();
    }
    let d = el.closest('details');
    while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); }
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.width === 0) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await sleep(0);
  }

  // ------------------------------------------------------------ moving

  async moveTo(x, y, label) {
    this.check();
    this.show();
    if (label !== undefined) this.say(label);
    const dx = x - this.x;
    const dy = y - this.y;
    const dist = Math.hypot(dx, dy);
    const k = this.k;
    if (k === 0 || dist < 2) { this.place(x, y); return; }
    const duration = Math.min(900, 180 + dist * 0.55) * k;
    const sx = this.x;
    const sy = this.y;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        if (this.cancelled) { resolve(); return; }
        const t = Math.min(1, (now - t0) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        // A slight curve makes the movement look more natural.
        const arc = Math.sin(Math.PI * t) * Math.min(40, dist * 0.08);
        this.place(sx + dx * e - (dy / (dist || 1)) * arc, sy + dy * e + (dx / (dist || 1)) * arc);
        if (t < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    this.check();
  }

  highlight(rect) {
    const pad = 4;
    Object.assign(this.hlEl.style, {
      left: `${rect.left - pad}px`, top: `${rect.top - pad}px`, width: `${rect.width + pad * 2}px`, height: `${rect.height + pad * 2}px`,
    });
    this.hlEl.hidden = false;
    this.hlEl.classList.remove('pulse');
    void this.hlEl.offsetWidth;
    this.hlEl.classList.add('pulse');
  }

  unhighlight() { this.hlEl.hidden = true; }

  ripple(x, y) {
    if (this.k === 0) return;
    const r = document.createElement('div');
    r.className = 'ghost-ripple';
    r.style.left = `${x}px`;
    r.style.top = `${y}px`;
    this.layer.appendChild(r);
    setTimeout(() => r.remove(), 600);
  }

  async goTo(target, label) {
    const t = this.resolve(target);
    await this.reveal(t);
    const r = this.rectOf(t);
    const x = r.left + Math.min(r.width / 2, 60);
    const y = r.top + r.height / 2;
    await this.moveTo(x, y, label);
    this.highlight(r);
    return { el: t, x, y, rect: r };
  }

  // ------------------------------------------------------------ actions

  async point(target, message, ms = 1600) {
    const { el } = await this.goTo(target, message);
    this.record({ kind: 'point', label: message || this.labelOf(el) });
    await this.wait(ms + Math.min(2500, (message || '').length * 25));
    this.unhighlight();
  }

  async click(target, label, { record = true, right = false } = {}) {
    const t = this.resolve(target);
    const name = label || this.labelOf(t);
    const { el, x, y } = await this.goTo(t, name);
    await this.wait(220);
    this.ripple(x, y);
    if (record) this.record({ kind: 'click', label: name });
    if (el instanceof Element) {
      if (right) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
      else el.click();
    }
    await sleep(0); // let click handlers that use promises finish
    this.editor.renderNow();
    await this.wait(260);
    this.unhighlight();
    return el;
  }

  async type(target, text, label) {
    const t = this.resolve(target);
    const name = label || this.labelOf(t);
    const { el } = await this.goTo(t, name);
    await this.wait(150);
    el.focus({ preventScroll: true });
    const value = String(text);
    if (this.k === 0 || value.length > 60) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (this.k > 0) await this.wait(250);
    } else {
      el.value = '';
      for (let i = 1; i <= value.length; i++) {
        el.value = value.slice(0, i);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(Math.max(12, 45 * this.k));
        this.check();
      }
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    this.record({ kind: 'type', label: name, value });
    this.editor.renderNow();
    await this.wait(200);
    this.unhighlight();
  }

  async choose(target, value, valueLabel, label) {
    const t = this.resolve(target);
    const name = label || this.labelOf(t);
    const { el } = await this.goTo(t, name);
    await this.wait(200);
    if (![...el.options].some((o) => o.value === String(value))) throw new Error(`"${value}" is not one of the choices for ${name}.`);
    el.value = String(value);
    const shown = valueLabel || (el.options[el.selectedIndex]?.textContent || String(value)).split(' - ')[0];
    this.say(`${name}: ${shown}`);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    this.record({ kind: 'choose', label: name, value: shown });
    this.editor.renderNow();
    await this.wait(380);
    this.unhighlight();
  }

  async setChecked(target, checked, label) {
    const t = this.resolve(target);
    const name = label || this.labelOf(t);
    if (t.checked === !!checked) return;
    await this.goTo(t, name);
    await this.wait(200);
    this.ripple(this.x, this.y);
    t.click();
    this.record({ kind: 'check', label: name, value: !!checked });
    this.editor.renderNow();
    await this.wait(260);
    this.unhighlight();
  }

  async setColor(target, color, label) {
    const t = this.resolve(target);
    const name = label || this.labelOf(t);
    await this.goTo(t, name);
    await this.wait(200);
    t.value = color;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
    this.record({ kind: 'choose', label: name, value: color });
    this.editor.renderNow();
    await this.wait(250);
    this.unhighlight();
  }

  // Drags from one place to another (visual only - the caller performs the change).
  async drag(fromTarget, toTarget, label) {
    const a = await this.goTo(fromTarget, label);
    await this.wait(200);
    this.cursorEl.classList.add('dragging');
    const r = this.rectOf(this.resolve(toTarget));
    await this.moveTo(r.left + Math.min(r.width / 2, 60), r.top + r.height / 2, label);
    this.highlight(r);
    this.cursorEl.classList.remove('dragging');
    this.record({ kind: 'drag', label });
    await this.wait(250);
    this.unhighlight();
    return a;
  }

  // Works through a list of items (tiles, pixel rows...) one by one.
  // `fn(item, i)` does the work and returns the screen point to show the cursor at.
  async sweep(items, fn, { totalMs = 2200, label } = {}) {
    if (label) this.say(label);
    this.unhighlight();
    this.show();
    const per = this.k === 0 ? 0 : Math.max(4, Math.min(70, totalMs / Math.max(1, items.length))) * this.k;
    this.cursorEl.classList.add('dragging');
    try {
      for (let i = 0; i < items.length; i++) {
        this.check();
        const p = fn(items[i], i);
        if (per > 0 && p) {
          this.place(p.x, p.y);
          if (i % 4 === 0) this.ripple(p.x, p.y);
          await sleep(per);
        }
      }
    } finally {
      this.cursorEl.classList.remove('dragging');
    }
  }
}
