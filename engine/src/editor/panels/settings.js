// Project settings window: screen size, colours, controls and the AI helper.
import { h, clear, openDialog, toast } from '../dom.js';
import { SETTING_DEFS } from '../store.js';

export function openSettingsDialog(editor, initialTab = 'project') {
  const store = editor.store;
  let tab = initialTab;
  return openDialog({
    title: 'Settings',
    ai: 'settings-dialog',
    wide: true,
    build: () => {
      const body = h('div', { class: 'settings-body' });
      const tabs = h('div', { class: 'settings-tabs', role: 'tablist' });
      const show = (t) => {
        tab = t;
        for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === t);
        clear(body);
        if (t === 'project') body.append(projectTab(store));
        else if (t === 'controls') body.append(controlsTab(store));
        else body.append(editor.ai.buildSettings());
      };
      for (const [id, label] of [['project', '🎮 Game'], ['controls', '🕹️ Controls'], ['ai', '🤖 AI helper']]) {
        tabs.appendChild(h('button', { class: 'settings-tab', 'data-tab': id, 'data-ai': `settings-tab:${id}`, role: 'tab', onclick: () => show(id) }, label));
      }
      show(tab);
      return h('div', { class: 'dialog-body' }, tabs, body);
    },
  });
}

function projectTab(store) {
  const s = store.project.settings;
  const wrap = h('div', { class: 'settings-grid' });
  const nameInput = h('input', { type: 'text', value: store.project.name, 'data-ai': 'setting:name', onchange: (e) => store.setProjectName(e.target.value) });
  wrap.appendChild(h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Project name'), h('div', { class: 'field-control' }, nameInput)));
  for (const d of SETTING_DEFS) {
    const set = (v) => { try { store.setSetting(d.key, v); } catch (e) { toast(e.message, 'warn'); } };
    let control;
    if (d.type === 'number') control = h('input', { type: 'number', value: String(s[d.key]), 'data-ai': `setting:${d.key}`, onchange: (e) => set(e.target.value) });
    else if (d.type === 'bool') control = h('input', { type: 'checkbox', checked: !!s[d.key], 'data-ai': `setting:${d.key}`, onchange: (e) => set(e.target.checked) });
    else if (d.type === 'color') control = h('input', { type: 'color', value: s[d.key], 'data-ai': `setting:${d.key}`, onchange: (e) => set(e.target.value) });
    else if (d.type === 'enum') control = h('select', { 'data-ai': `setting:${d.key}`, onchange: (e) => set(e.target.value) }, d.options.map(([v, l]) => h('option', { value: v, selected: s[d.key] === v }, l)));
    else if (d.type === 'scene') control = h('select', { 'data-ai': `setting:${d.key}`, onchange: (e) => set(e.target.value) }, store.scenes.map((sc) => h('option', { value: sc.id, selected: s.startScene === sc.id }, sc.name)));
    wrap.appendChild(h('div', { class: 'field-row' },
      h('label', { class: 'field-label', title: d.help }, d.label),
      h('div', { class: 'field-control' }, control, h('div', { class: 'field-help' }, d.help))));
  }
  return wrap;
}

const KEY_NAMES = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: 'Enter', ShiftLeft: 'Shift', ControlLeft: 'Ctrl' };
function keyLabel(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function controlsTab(store) {
  const wrap = h('div', { class: 'controls-tab' });
  const render = () => {
    clear(wrap);
    wrap.appendChild(h('p', { class: 'muted' }, 'Actions are names your scripts use, like input.isDown("jump"). Each action can have several keys. On phones, the on-screen buttons press left, right, up, down, jump and action.'));
    for (const [action, keys] of Object.entries(store.project.input)) {
      const row = h('div', { class: 'action-row', 'data-ai': `action:${action}` },
        h('span', { class: 'action-name' }, action),
        h('div', { class: 'key-chips' }, keys.map((k) => h('span', { class: 'key-chip' }, keyLabel(k),
          h('button', { class: 'chip-x', 'aria-label': `Remove ${k}`, onclick: () => { store.setInputAction(action, keys.filter((x) => x !== k)); render(); } }, '×')))),
        h('button', { class: 'btn btn-small', onclick: (e) => captureKey(e.target, (code) => { if (!keys.includes(code)) store.setInputAction(action, [...keys, code]); render(); }) }, '＋ key'),
        h('button', { class: 'icon-btn', title: 'Remove action', 'aria-label': `Remove action ${action}`, onclick: () => { store.removeInputAction(action); render(); } }, '🗑'));
      wrap.appendChild(row);
    }
    const nameInput = h('input', { type: 'text', placeholder: 'new action, e.g. shoot', 'aria-label': 'New action name' });
    wrap.appendChild(h('form', { class: 'action-add', onsubmit: (e) => {
      e.preventDefault();
      try { store.setInputAction(nameInput.value.trim(), []); render(); } catch (err) { toast(err.message, 'warn'); }
    } }, nameInput, h('button', { class: 'btn btn-small', type: 'submit' }, 'Add action')));
  };
  render();
  return wrap;
}

function captureKey(button, done) {
  const old = button.textContent;
  button.textContent = 'Press a key…';
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.removeEventListener('keydown', onKey, true);
    button.textContent = old;
    if (e.code !== 'Escape') done(e.code);
  };
  document.addEventListener('keydown', onKey, true);
}
