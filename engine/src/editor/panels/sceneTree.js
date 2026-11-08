// Left panel: the list of scenes, and the objects in the open scene.
import { h, clear, promptDialog, confirmDialog, toast, openDialog } from '../dom.js';
import { NODE_TYPES } from '../../runtime/nodeTypes.js';

export class SceneTreePanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.collapsed = new Set();
    this.dragId = null;
    this.build();
  }

  build() {
    this.sceneList = h('div', { class: 'scene-list', 'data-ai': 'scene-list' });
    this.treeList = h('div', { class: 'tree', role: 'tree', 'data-ai': 'object-tree' });
    this.el.append(
      h('div', { class: 'panel-header' },
        h('h3', { title: 'Scenes are levels, menus, or reusable objects like a Coin.' }, 'Scenes'),
        h('button', { class: 'icon-btn', title: 'New scene', 'aria-label': 'New scene', 'data-ai': 'add-scene-btn', onclick: () => this.newScene() }, '＋')),
      this.sceneList,
      h('div', { class: 'panel-header' },
        h('h3', { title: 'Everything in the open scene. Objects can sit inside other objects.' }, 'Objects'),
        h('div', { class: 'header-actions' },
          h('button', { class: 'btn btn-small btn-primary', title: 'Add an object to this scene', 'data-ai': 'add-object-btn', 'data-ai-label': '+ Add object', onclick: () => this.editor.openAddObject(this.addParent()) }, '＋ Add'),
          h('button', { class: 'icon-btn', title: 'Duplicate (Ctrl+D)', 'aria-label': 'Duplicate', 'data-ai': 'duplicate-object-btn', onclick: () => this.editor.duplicateSelected() }, '⧉'),
          h('button', { class: 'icon-btn', title: 'Delete (Del)', 'aria-label': 'Delete', 'data-ai': 'delete-object-btn', onclick: () => this.editor.deleteSelected() }, '🗑'))),
      this.treeList,
    );
  }

  // New objects go inside the selected Group (or scene top). Otherwise they go
  // at the top of the scene, so they don't end up hidden inside a Sprite.
  addParent() {
    const sel = this.store.selected();
    const scene = this.store.scene();
    if (sel && (sel.type === 'Group' || (scene && sel.id === scene.root.id))) return sel.id;
    return scene ? scene.root.id : null;
  }

  newScene() {
    return new Promise((resolve) => {
      openDialog({
        title: 'New scene',
        ai: 'new-scene-dialog',
        onClose: (r) => resolve(r || null),
        build: (close) => {
          const nameInput = h('input', { type: 'text', value: this.store.uniqueSceneName('New Scene'), 'data-ai': 'new-scene-input', 'aria-label': 'Scene name' });
          const typeSelect = h('select', { 'data-ai': 'new-scene-type', 'aria-label': 'Top object' },
            ['Group', 'Sprite', 'Shape', 'Text'].map((t) => h('option', { value: t }, `${NODE_TYPES[t].icon} ${NODE_TYPES[t].label}${t === 'Group' ? ' - for levels and menus' : t === 'Sprite' ? ' - for reusable things like a Coin or Bullet' : ''}`)));
          return h('form', { class: 'dialog-body', onsubmit: (e) => {
            e.preventDefault();
            try { close(this.store.addScene({ name: nameInput.value.trim(), rootType: typeSelect.value })); } catch (err) { toast(err.message, 'warn'); }
          } },
          h('p', { class: 'muted' }, 'A scene can be a level, a menu, or one reusable thing (like a Coin) that you place copies of with Scene Copy.'),
          h('label', { class: 'field-label' }, 'Scene name'), nameInput,
          h('label', { class: 'field-label' }, 'Top object'), typeSelect,
          h('div', { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn', onclick: () => close(null) }, 'Cancel'),
            h('button', { type: 'submit', class: 'btn btn-primary', 'data-ai': 'new-scene-ok' }, 'Create')));
        },
      });
    });
  }

  render() {
    const ui = this.store.ui;
    const start = this.store.project.settings.startScene;
    clear(this.sceneList);
    for (const s of this.store.scenes) {
      const isStart = s.id === start;
      const chip = h('button', {
        class: `scene-chip ${s.id === ui.sceneId ? 'active' : ''}`,
        'data-ai': `scene-tab:${s.id}`,
        'data-ai-label': `scene "${s.name}"`,
        title: isStart ? `${s.name} (the game starts here)` : s.name,
        onclick: () => this.store.openScene(s.id),
        ondblclick: () => this.renameScene(s),
        oncontextmenu: (e) => { e.preventDefault(); this.sceneMenu(s, e); },
      }, isStart ? '⭐ ' : '', NODE_TYPES[s.root.type]?.icon || '📁', ' ', s.name);
      this.sceneList.appendChild(chip);
    }
    clear(this.treeList);
    const scene = this.store.scene();
    if (!scene) {
      this.treeList.appendChild(h('p', { class: 'empty-hint' }, 'No scenes yet. Press ＋ next to Scenes.'));
      return;
    }
    this.renderNode(scene.root, 0, true);
    if (!scene.root.children.length) {
      this.treeList.appendChild(h('p', { class: 'empty-hint' }, 'This scene is empty. Press ＋ Add to put something in it, or ask the AI helper.'));
    }
  }

  renderNode(node, depth, isRoot) {
    const ui = this.store.ui;
    const type = NODE_TYPES[node.type];
    const hasKids = node.children.length > 0;
    const collapsed = this.collapsed.has(node.id);
    let extra = '';
    if (node.type === 'SceneCopy') {
      const s = this.store.project.scenes[node.props.scene];
      extra = s && s.name !== node.name ? ` → ${s.name}` : '';
    }
    const row = h('div', {
      class: `tree-row ${ui.selectedId === node.id ? 'selected' : ''} ${node.props.visible === false ? 'hidden-obj' : ''}`,
      role: 'treeitem',
      'aria-selected': String(ui.selectedId === node.id),
      'data-ai': `tree-node:${node.id}`,
      'data-ai-label': `"${node.name}" in the object list`,
      draggable: isRoot ? 'false' : 'true',
      style: { paddingLeft: `${8 + depth * 16}px` },
      onclick: () => this.store.select(node.id),
      ondblclick: () => this.editor.viewport.focusNode(node.id),
      oncontextmenu: (e) => { e.preventDefault(); this.store.select(node.id); this.nodeMenu(node, e, isRoot); },
      ondragstart: (e) => { this.dragId = node.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); },
      ondragover: (e) => { if (this.dragId && this.dragId !== node.id) { e.preventDefault(); row.classList.add('drop-target'); } },
      ondragleave: () => row.classList.remove('drop-target'),
      ondrop: (e) => {
        e.preventDefault();
        row.classList.remove('drop-target');
        const id = this.dragId;
        this.dragId = null;
        if (!id || id === node.id) return;
        try { this.store.moveNode(id, node.id); toast(`Moved inside "${node.name}"`); } catch (err) { toast(err.message, 'warn'); }
      },
    },
    h('button', {
      class: 'tree-twisty', 'aria-label': collapsed ? 'Expand' : 'Collapse', tabindex: '-1',
      style: { visibility: hasKids ? 'visible' : 'hidden' },
      onclick: (e) => { e.stopPropagation(); if (collapsed) this.collapsed.delete(node.id); else this.collapsed.add(node.id); this.render(); },
    }, collapsed ? '▸' : '▾'),
    h('span', { class: 'tree-icon', title: type ? type.label : node.type }, type ? type.icon : '?'),
    h('span', { class: 'tree-name' }, node.name, extra ? h('span', { class: 'tree-extra' }, extra) : null),
    node.script ? h('button', {
      class: 'tree-badge', title: 'Open script', 'data-ai': `tree-script:${node.id}`, 'aria-label': `Open script of ${node.name}`,
      onclick: (e) => { e.stopPropagation(); this.editor.openScript(node.script); },
    }, '📜') : null,
    h('button', {
      class: 'tree-eye', title: node.props.visible === false ? 'Show' : 'Hide', 'aria-label': 'Toggle visible',
      onclick: (e) => { e.stopPropagation(); if ('visible' in node.props) this.store.setProps(node.id, { visible: node.props.visible === false }); },
    }, node.props.visible === false ? '🙈' : '👁'));
    this.treeList.appendChild(row);
    if (!collapsed) for (const c of node.children) this.renderNode(c, depth + 1, false);
  }

  async renameScene(scene) {
    const name = await promptDialog({ title: 'Rename scene', label: 'Scene name', value: scene.name, okText: 'Rename', ai: 'rename-scene' });
    if (!name || name === scene.name) return;
    try { this.store.renameScene(scene.id, name); } catch (e) { toast(e.message, 'warn'); }
  }

  sceneMenu(scene, e) {
    showContextMenu(e, [
      ['▶ Play this scene', () => this.editor.play(scene.id), 'ctx-play-scene'],
      ['⭐ Start the game here', () => this.store.setSetting('startScene', scene.id), 'ctx-start-scene'],
      ['✏️ Rename', () => this.renameScene(scene)],
      ['🗑 Delete scene', async () => {
        const ok = await confirmDialog({ title: 'Delete scene', message: `Delete the scene "${scene.name}"? You can undo this.`, okText: 'Delete', danger: true, ai: 'delete-scene' });
        if (ok) { try { this.store.deleteScene(scene.id); } catch (err) { toast(err.message, 'warn'); } }
      }],
    ]);
  }

  nodeMenu(node, e, isRoot) {
    const items = [
      ['＋ Add object inside', () => this.editor.openAddObject(node.id), 'ctx-add-inside'],
      ['✏️ Rename', async () => {
        const name = await promptDialog({ title: 'Rename', label: 'New name', value: node.name, okText: 'Rename', ai: 'rename-object' });
        if (name) { try { this.store.renameNode(node.id, name); } catch (err) { toast(err.message, 'warn'); } }
      }],
      [node.script ? '📜 Open script' : '📜 Add script', () => (node.script ? this.editor.openScript(node.script) : this.editor.addScriptTo(node.id))],
      ['🎯 Show in Scene view', () => this.editor.viewport.focusNode(node.id)],
    ];
    if (!isRoot) {
      items.push(['⧉ Duplicate', () => this.editor.duplicateSelected()]);
      const r = this.store.findNode(node.id);
      if (r && r.parent) {
        const grand = this.store.findNode(r.parent.id);
        if (grand && grand.parent) items.push(['⬆ Move out of group', () => this.store.moveNode(node.id, grand.parent.id)]);
      }
      items.push(['🗑 Delete', () => this.editor.deleteSelected()]);
    }
    showContextMenu(e, items);
  }
}

export function showContextMenu(e, items) {
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
  const menu = h('div', { class: 'context-menu', role: 'menu' },
    items.map(([label, fn, ai]) => h('button', { class: 'menu-item', role: 'menuitem', 'data-ai': ai, onclick: () => { menu.remove(); fn(); } }, label)));
  document.body.appendChild(menu);
  const x = Math.min(e.clientX, window.innerWidth - 220);
  const y = Math.min(e.clientY, window.innerHeight - items.length * 36 - 12);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const off = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}
