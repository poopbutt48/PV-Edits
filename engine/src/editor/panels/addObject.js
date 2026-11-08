// The "Add object" window: pick a kind of object and give it a name.
import { h, openDialog, toast } from '../dom.js';
import { NODE_TYPES, NODE_TYPE_ORDER } from '../../runtime/nodeTypes.js';

export function openAddObjectDialog(editor, parentId) {
  const store = editor.store;
  let chosen = 'Sprite';
  let sceneChoice = '';
  return openDialog({
    title: 'Add an object',
    ai: 'add-object-dialog',
    wide: true,
    build: (close) => {
      const nameInput = h('input', { type: 'text', value: '', placeholder: 'Sprite', 'data-ai': 'add-object-name', 'aria-label': 'Name' });
      const parentNode = parentId ? store.node(parentId) : null;
      const scene = store.scene();
      const where = parentNode && parentNode.id !== scene.root.id ? `inside "${parentNode.name}"` : `in the scene "${scene.name}"`;
      const sceneSelect = h('select', { 'data-ai': 'add-object-scene', 'aria-label': 'Scene to copy', onchange: (e) => { sceneChoice = e.target.value; if (!nameInput.value || nameInput.dataset.auto) { const s = store.project.scenes[sceneChoice]; nameInput.value = s ? s.name : ''; nameInput.dataset.auto = '1'; } } },
        h('option', { value: '' }, '(choose a scene to copy)'),
        store.scenes.filter((s) => s.id !== scene.id).map((s) => h('option', { value: s.id }, s.name)));
      const sceneRow = h('div', { class: 'field-row', hidden: true }, h('label', { class: 'field-label' }, 'Copy of'), sceneSelect);
      const cards = h('div', { class: 'type-grid', role: 'radiogroup' });
      const select = (type) => {
        chosen = type;
        for (const c of cards.children) c.classList.toggle('active', c.dataset.type === type);
        nameInput.placeholder = NODE_TYPES[type].label;
        sceneRow.hidden = type !== 'SceneCopy';
      };
      for (const type of NODE_TYPE_ORDER) {
        const t = NODE_TYPES[type];
        cards.appendChild(h('button', {
          class: 'type-card', type: 'button', role: 'radio', 'data-type': type, 'data-ai': `node-type:${type}`, 'data-ai-label': t.label,
          onclick: () => select(type), ondblclick: () => { select(type); create(); },
        }, h('span', { class: 'type-icon' }, t.icon), h('span', { class: 'type-name' }, t.label), h('span', { class: 'type-summary' }, t.summary)));
      }
      const create = () => {
        const s = store.project.settings;
        const props = {};
        if (chosen === 'SceneCopy') {
          if (!sceneChoice) { toast('Choose which scene to copy.', 'warn'); return; }
          props.scene = sceneChoice;
        }
        // Put new objects in the middle of what you're looking at.
        const vp = editor.viewport;
        if (chosen !== 'TileMap' && vp.cam && (!parentNode || parentNode.id === scene.root.id)) {
          props.x = Math.round(vp.cam.x);
          props.y = Math.round(vp.cam.y);
        } else if (chosen === 'Camera') { props.x = s.width / 2; props.y = s.height / 2; }
        if (chosen === 'TileMap') props.tiles = [{ name: 'Ground', color: '#8d6e63', solid: true }];
        if (chosen === 'Sprite') { props.width = 32; props.height = 32; }
        try {
          const id = store.addNode({ sceneId: scene.id, parentId: parentNode ? parentNode.id : null, type: chosen, name: nameInput.value.trim() || undefined, props });
          close(id);
          if (chosen === 'TileMap') editor.viewport.setTool('paint', 0);
        } catch (e) {
          toast(e.message, 'warn');
        }
      };
      select(chosen);
      return h('form', { class: 'dialog-body', onsubmit: (e) => { e.preventDefault(); create(); } },
        h('p', { class: 'muted' }, `What would you like to add ${where}?`),
        cards,
        sceneRow,
        h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Name'), nameInput),
        h('div', { class: 'dialog-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
          h('button', { type: 'submit', class: 'btn btn-primary', 'data-ai': 'add-object-create' }, 'Create')));
    },
  });
}
