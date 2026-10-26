'use strict';
/* Beatforge — touch-first widgets: knob, fader, meter, toggle, sheet, menu, dialogs. */
(() => {
const DAW = window.DAW;
const U = DAW.util, h = U.h, S = DAW.state;
const ui = DAW.ui = DAW.ui || {};

ui.valClip = null; // copied knob value

/* ---------- toast ---------- */
ui.toast = (msg, ms) => {
  let host = U.$('#toasts');
  if (!host) { host = h('div#toasts'); document.body.appendChild(host); }
  const t = h('div.toast', msg);
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms || 2200);
  setTimeout(() => t.remove(), (ms || 2200) + 300);
};

/* ---------- bottom sheet / modal ---------- */
let sheetZ = 0;
ui.sheet = o => {
  const back = h('div.sheet-back', { style: { zIndex: 100 + (++sheetZ) } });
  const body = h('div.sheet-body');
  const head = h('div.sheet-head', h('div.sheet-grab'), h('div.sheet-title', o.title || ''),
    o.actions || null, h('button.ibtn.sheet-x', { 'aria-label': 'Close', onclick: () => api.close() }, U.icon('x', 20)));
  const el = h('div.sheet' + (o.full ? '.full' : '') + (o.cls ? '.' + o.cls : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title || 'Dialog' }, head, body);
  if (o.content) body.appendChild(o.content);
  back.appendChild(el);
  document.body.appendChild(back);
  let closed = false;
  const api = {
    el, body, head,
    setTitle(t) { head.querySelector('.sheet-title').textContent = t; },
    close() {
      if (closed) return; closed = true;
      back.classList.add('out');
      setTimeout(() => back.remove(), 160);
      document.removeEventListener('keydown', onKey);
      if (o.onClose) o.onClose();
    },
  };
  const onKey = e => { if (e.key === 'Escape') api.close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('pointerdown', e => { if (e.target === back) api.close(); });
  // swipe the handle down to dismiss
  U.drag(head, {
    down: e => !e.target.closest('button,input,select,.seg') && undefined,
    move: (e, st) => { if (st.dy > 0) el.style.transform = 'translateY(' + st.dy + 'px)'; },
    up: (e, st) => { if (st.dy > 90) api.close(); else el.style.transform = ''; },
    threshold: 3,
  });
  requestAnimationFrame(() => back.classList.add('in'));
  return api;
};

/* ---------- context menu (action sheet on phones) ---------- */
ui.menu = (items, o) => {
  o = o || {};
  const list = h('div.menu-list');
  const m = ui.sheet({ title: o.title || '', content: list, cls: 'menu' });
  items.forEach(it => {
    if (!it) return;
    if (it.sep) { list.appendChild(h('div.menu-sep', it.label || '')); return; }
    const b = h('button.menu-item' + (it.danger ? '.danger' : '') + (it.checked ? '.checked' : ''), {
      disabled: !!it.disabled,
      onclick: () => { if (!it.keepOpen) m.close(); if (it.onClick) it.onClick(); },
    }, it.icon ? U.icon(it.icon, 18) : h('span.menu-ico'), h('span.menu-label', it.label), it.hint ? h('span.menu-hint', it.hint) : null, it.checked ? U.icon('check', 16) : null);
    list.appendChild(b);
  });
  return m;
};

/* ---------- dialogs ---------- */
ui.confirm = (msg, okLabel, danger) => new Promise(res => {
  const ok = h('button.btn.primary' + (danger ? '.danger' : ''), { onclick: () => { done(true); } }, okLabel || 'OK');
  const cancel = h('button.btn', { onclick: () => done(false) }, 'Cancel');
  const body = h('div.dialog', h('p', msg), h('div.dialog-actions', cancel, ok));
  const s = ui.sheet({ title: 'Confirm', content: body, cls: 'small', onClose: () => res(false) });
  let fin = false;
  const done = v => { if (fin) return; fin = true; res(v); s.close(); };
  setTimeout(() => ok.focus(), 50);
});
ui.prompt = (title, value, o) => new Promise(res => {
  o = o || {};
  const inp = h('input.text', { type: o.number ? 'text' : 'text', value: value == null ? '' : String(value), inputmode: o.number ? 'decimal' : 'text', placeholder: o.placeholder || '', autocomplete: 'off' });
  let fin = false;
  const done = v => { if (fin) return; fin = true; res(v); s.close(); };
  const body = h('div.dialog', o.label ? h('label.dlg-label', o.label) : null, inp, o.help ? h('p.dim', o.help) : null,
    h('div.dialog-actions', h('button.btn', { onclick: () => done(null) }, 'Cancel'), h('button.btn.primary', { onclick: () => done(inp.value) }, o.ok || 'OK')));
  const s = ui.sheet({ title, content: body, cls: 'small', onClose: () => { if (!fin) { fin = true; res(null); } } });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value); });
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
});
ui.promptValue = async (def, cur) => {
  const txt = await ui.prompt('Enter value', def.unit === '%' ? Math.round(cur * 100) : (+cur.toFixed(3)), { number: true, label: (def.label || '') + (def.unit ? ' (' + def.unit + ')' : '') });
  if (txt == null) return null;
  let v = parseFloat(txt.replace(',', '.'));
  if (!isFinite(v)) return null;
  if (/k/i.test(txt) && def.unit === 'Hz') v *= 1000;
  if (def.unit === '%') v /= 100;
  return U.clamp(v, def.min, def.max);
};

/* ---------- knob ---------- */
const polar = (cx, cy, r, deg) => { const a = (deg - 90) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
const arc = (cx, cy, r, a0, a1) => {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const [x0, y0] = polar(cx, cy, r, a0), [x1, y1] = polar(cx, cy, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

ui.knob = o => {
  const d = o.def, size = o.size || 46;
  let val = o.value == null ? d.def : o.value;
  const track = h('svg:path', { class: 'k-track', fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round', d: arc(24, 24, 18, -135, 135) });
  const fill = h('svg:path', { class: 'k-fill', fill: 'none', 'stroke-width': 4, 'stroke-linecap': 'round' });
  const dot = h('svg:line', { class: 'k-dot', 'stroke-width': 3, 'stroke-linecap': 'round' });
  const svg = h('svg:svg', { viewBox: '0 0 48 48', width: size, height: size }, track, fill, dot);
  const vtxt = h('div.kv');
  const root = h('div.knob', { style: o.color ? { '--kc': o.color } : null, role: 'slider', 'aria-label': d.label, tabindex: 0 }, h('div.kl', d.label || ''), svg, vtxt);
  const bip = d.min < 0 && d.max > 0;
  const render = () => {
    const n = U.toNorm(d, val), a = -135 + 270 * n;
    const z = bip ? -135 + 270 * U.toNorm(d, 0) : -135;
    fill.setAttribute('d', arc(24, 24, 18, Math.min(z, a), Math.max(z, a)));
    const [x0, y0] = polar(24, 24, 7, a), [x1, y1] = polar(24, 24, 13, a);
    dot.setAttribute('x1', x0); dot.setAttribute('y1', y0); dot.setAttribute('x2', x1); dot.setAttribute('y2', y1);
    vtxt.textContent = U.fmtVal(d, val);
    root.setAttribute('aria-valuenow', val);
  };
  const setVal = (v, fire) => { val = U.clamp(v, d.min, d.max); render(); if (fire) { o.onInput && o.onInput(val); } };
  let lastTap = 0;
  const menu = () => ui.menu([
    { label: 'Type a value…', icon: 'pencil', onClick: async () => { const v = await ui.promptValue(d, val); if (v != null) { setVal(v, true); o.onChange && o.onChange(val); } } },
    { label: 'Reset to default', icon: 'undo', onClick: () => { setVal(d.def, true); o.onChange && o.onChange(val); } },
    { label: 'Copy value', icon: 'copy', onClick: () => { ui.valClip = val; ui.toast('Copied ' + U.fmtVal(d, val)); } },
    { label: 'Paste value', icon: 'paste', disabled: ui.valClip == null, onClick: () => { setVal(ui.valClip, true); o.onChange && o.onChange(val); } },
    o.path ? { label: 'Create automation clip', icon: 'graph', onClick: () => ui.makeAutomation && ui.makeAutomation(o.path, d, val) } : null,
  ], { title: d.label });
  U.drag(root, {
    down: (e, st) => { st.n0 = U.toNorm(d, val); root.classList.add('active'); e.preventDefault(); },
    move: (e, st) => {
      const sens = DAW.settings.get('knobSens') * (e.shiftKey ? 0.2 : 1);
      setVal(U.fromNorm(d, st.n0 - st.dy / (190 / sens)), true);
    },
    up: (e, st) => {
      root.classList.remove('active');
      if (st.held) return;
      if (st.moved) { o.onChange && o.onChange(val); return; }
      const now = performance.now();
      if (DAW.settings.get('knobDoubleTap') && now - lastTap < 320) { setVal(d.def, true); o.onChange && o.onChange(val); DAW.haptic(12); lastTap = 0; } else lastTap = now;
    },
    hold: () => { DAW.haptic(15); menu(); },
    holdMs: DAW.settings.get('longPressMs'),
  });
  root.addEventListener('wheel', e => { e.preventDefault(); setVal(U.fromNorm(d, U.toNorm(d, val) - Math.sign(e.deltaY) * 0.03), true); o.onChange && o.onChange(val); }, { passive: false });
  root.addEventListener('keydown', e => {
    const dn = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02 }[e.key];
    if (dn) { e.preventDefault(); setVal(U.fromNorm(d, U.toNorm(d, val) + dn), true); o.onChange && o.onChange(val); }
  });
  render();
  root.set = v => setVal(v, false);
  root.get = () => val;
  return root;
};

/* ---------- toggle / segmented / select ---------- */
ui.toggle = (label, value, onChange, o) => {
  const sw = h('button.switch' + (value ? '.on' : ''), { role: 'switch', 'aria-checked': String(!!value), 'aria-label': label });
  const root = h('div.toggle' + ((o && o.cls) || ''), h('span.tl', label), sw);
  let v = !!value;
  const set = nv => { v = nv; sw.classList.toggle('on', v); sw.setAttribute('aria-checked', String(v)); };
  root.addEventListener('click', () => { set(!v); DAW.haptic(6); onChange(v); });
  root.set = set;
  return root;
};
ui.select = (label, options, value, onChange) => {
  const sel = h('select.fld', { 'aria-label': label }, options.map(op => h('option', { value: String(op.v), selected: String(op.v) === String(value) }, op.l)));
  sel.addEventListener('change', () => {
    const op = options.find(x => String(x.v) === sel.value);
    onChange(op ? op.v : sel.value);
  });
  const root = h('label.select', h('span.tl', label), sel);
  root.set = v => { sel.value = String(v); };
  return root;
};
ui.seg = (options, value, onChange) => {
  const root = h('div.seg', { role: 'tablist' });
  const btns = options.map(op => h('button.seg-b' + (op.v === value ? '.on' : ''), { role: 'tab', onclick: () => { set(op.v); onChange(op.v); } }, op.i ? U.icon(op.i, 18) : null, op.l ? h('span', op.l) : null));
  btns.forEach(b => root.appendChild(b));
  const set = v => options.forEach((op, i) => btns[i].classList.toggle('on', op.v === v));
  root.set = set;
  return root;
};
ui.ibtn = (icon, title, onClick, cls) => h('button.ibtn' + (cls ? '.' + cls : ''), { title, 'aria-label': title, onclick: onClick }, U.icon(icon, 22));

ui.sampleBtn = (label, value, onPick) => {
  const name = h('span.sb-name', value ? DAW.samples.name(value) : 'Choose…');
  const b = h('button.samplebtn', { onclick: async () => { const id = await ui.pickSample(); if (id) { name.textContent = DAW.samples.name(id); onPick(id); } } }, U.icon('wave', 18), name);
  return h('div.select', h('span.tl', label), b);
};

/* generic control for any param definition */
ui.control = (d, value, onInput, onChange, path) => {
  if (d.type === 'select') return ui.select(d.label, d.options, value, v => { onInput(v); onChange && onChange(v); });
  if (d.type === 'toggle') return ui.toggle(d.label, value, v => { onInput(v); onChange && onChange(v); });
  if (d.type === 'sample') return ui.sampleBtn(d.label, value, v => { onInput(v); onChange && onChange(v); });
  return ui.knob({ def: d, value, path, onInput, onChange });
};
/** Build a wrapped grid of controls for a list of definitions bound to an object. */
ui.paramGrid = (defs, obj, cb, pathFn) => {
  const grid = h('div.pgrid');
  defs.forEach(d => {
    const c = ui.control(d, obj[d.id], v => { obj[d.id] = v; cb && cb(d.id, v, false); }, v => { cb && cb(d.id, v, true); }, pathFn ? pathFn(d) : null);
    c.dataset.param = d.id;
    grid.appendChild(c);
  });
  return grid;
};

/* ---------- fader & meter ---------- */
ui.fader = o => {
  let val = o.value;
  const fill = h('div.f-fill'), cap = h('div.f-cap'), zero = h('div.f-zero');
  const track = h('div.f-track', zero, fill, cap);
  const root = h('div.fader', { role: 'slider', 'aria-label': o.label || 'Volume', tabindex: 0 }, track);
  const render = () => {
    const pct = U.clamp(val, 0, 1) * 100;
    cap.style.bottom = `calc(${pct}% - 14px)`; fill.style.height = pct + '%';
    root.setAttribute('aria-valuenow', val.toFixed(2));
  };
  let lastTap = 0;
  const at = e => { const r = track.getBoundingClientRect(); return U.clamp(1 - (e.clientY - r.top) / r.height, 0, 1.0) * (1 / 1); };
  U.drag(root, {
    down: (e, st) => { st.off = val - at(e); st.n0 = val; root.classList.add('active'); e.preventDefault(); },
    move: (e, st) => { val = U.clamp(at(e) + st.off, 0, 1); render(); o.onInput && o.onInput(val); },
    up: (e, st) => {
      root.classList.remove('active');
      if (st.moved) { o.onChange && o.onChange(val); return; }
      const now = performance.now();
      if (now - lastTap < 320) { val = 0.8; render(); o.onInput && o.onInput(val); o.onChange && o.onChange(val); lastTap = 0; } else lastTap = now;
    },
    threshold: 3,
  });
  root.addEventListener('keydown', e => {
    const dn = { ArrowUp: 0.02, ArrowDown: -0.02 }[e.key];
    if (dn) { e.preventDefault(); val = U.clamp(val + dn, 0, 1); render(); o.onInput && o.onInput(val); o.onChange && o.onChange(val); }
  });
  zero.style.bottom = '80%';
  render();
  root.set = v => { val = v; render(); };
  return root;
};
const lvl = g => (g <= 0.00002 ? 0 : U.clamp((20 * Math.log10(g) + 54) / 60, 0, 1));
ui.meter = () => {
  const bars = [0, 1].map(() => ({ cover: h('div.m-cover'), peak: h('div.m-peak') }));
  const root = h('div.meter', bars.map(b => h('div.m-bar', b.cover, b.peak)));
  const st = [{ v: 0, p: 0, ph: 0 }, { v: 0, p: 0, ph: 0 }];
  root.update = (l, r, dt) => {
    const decay = { fast: 0.9, medium: 0.7, slow: 0.45 }[DAW.settings.get('mxMeterDecay')] || 0.7;
    const hold = DAW.settings.get('mxPeakHold');
    [l, r].forEach((v, i) => {
      const x = lvl(v), s = st[i];
      s.v = x > s.v ? x : s.v - (s.v - x) * (1 - Math.pow(1 - decay, dt * 60 || 1)) ;
      if (x >= s.p) { s.p = x; s.ph = 40; } else if (s.ph > 0) s.ph -= dt * 60; else s.p = Math.max(0, s.p - 0.01);
      bars[i].cover.style.transform = `scaleY(${(1 - s.v).toFixed(3)})`;
      bars[i].peak.style.bottom = (s.p * 100).toFixed(1) + '%';
      bars[i].peak.style.opacity = hold && s.p > 0.02 ? 1 : 0;
      if (v > 1) root.classList.add('clip');
    });
  };
  root.reset = () => root.classList.remove('clip');
  return root;
};
ui.meterLoop = fns => {
  let last = performance.now(), running = true;
  const f = now => {
    if (!running) return;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    fns.forEach(fn => fn(dt));
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  return () => { running = false; };
};

/* ---------- colour picker ---------- */
ui.pickColor = (cur, allowNone) => new Promise(res => {
  let out = null;
  const grid = h('div.color-grid', DAW.C.COLORS.map(c => h('button.swatch' + (c === cur ? '.on' : ''), { style: { background: c }, 'aria-label': c, onclick: () => { out = c; s.close(); } })));
  if (allowNone) grid.appendChild(h('button.swatch.none', { onclick: () => { out = ''; s.close(); } }, U.icon('x', 16)));
  const s = ui.sheet({ title: 'Colour', content: grid, cls: 'small', onClose: () => res(out) });
});

/* ---------- misc ---------- */
ui.empty = (icon, title, text) => h('div.nada', U.icon(icon, 36), h('b', title), h('span', text));
})();
