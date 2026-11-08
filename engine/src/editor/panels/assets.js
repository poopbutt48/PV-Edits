// Bottom-left panel: pictures and sounds in the project.
import { h, clear, toast, promptDialog, confirmDialog } from '../dom.js';
import { pickFiles, readFileAsDataUrl } from '../persistence.js';
import { AudioSystem, BUILTIN_SOUNDS } from '../../runtime/audio.js';
import { showContextMenu } from './sceneTree.js';

export class AssetsPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.audio = new AudioSystem();
    this.key = '';
    this.grid = h('div', { class: 'asset-grid', 'data-ai': 'asset-grid' });
    this.sounds = h('div', { class: 'sound-list' });
    el.append(
      h('div', { class: 'panel-header' },
        h('h3', { title: 'Pictures and sounds you can use in your game' }, 'Assets'),
        h('div', { class: 'header-actions' },
          h('button', { class: 'btn btn-small', title: 'Draw a new picture', 'data-ai': 'new-pixel-btn', onclick: () => this.editor.openPixelEditor(null) }, '🎨 Draw'),
          h('button', { class: 'btn btn-small', title: 'Import PNG/JPG pictures or MP3/WAV/OGG sounds', 'data-ai': 'import-asset-btn', onclick: () => this.importFiles() }, '＋ Import'))),
      h('div', { class: 'assets-scroll' }, this.grid, h('h4', { class: 'subhead' }, 'Sounds'), this.sounds),
    );
  }

  async importFiles() {
    const files = await pickFiles('image/png,image/jpeg,image/gif,image/webp,audio/*');
    let n = 0;
    for (const f of files) {
      try {
        const data = await readFileAsDataUrl(f);
        const name = f.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').toLowerCase();
        if (f.type.startsWith('image/')) {
          if (f.size > 4 * 1024 * 1024) { toast(`${f.name} is too big (over 4 MB). Try a smaller picture.`, 'warn'); continue; }
          this.store.addAsset({ name, kind: 'image', frames: [data], fps: 8 });
          n++;
        } else if (f.type.startsWith('audio/')) {
          if (f.size > 8 * 1024 * 1024) { toast(`${f.name} is too big (over 8 MB).`, 'warn'); continue; }
          this.store.addAsset({ name, kind: 'sound', data });
          n++;
        }
      } catch (e) {
        toast(`Could not import ${f.name}: ${e.message}`, 'error');
      }
    }
    if (n) toast(`Imported ${n} file${n > 1 ? 's' : ''}`);
  }

  render() {
    const assets = Object.values(this.store.project.assets);
    const key = assets.map((a) => a.id + a.name + (a.frames ? a.frames[0].length : 0)).join('|');
    if (key === this.key) return;
    this.key = key;
    clear(this.grid);
    const images = assets.filter((a) => a.kind === 'image').sort((a, b) => a.name.localeCompare(b.name));
    for (const a of images) {
      this.grid.appendChild(h('button', {
        class: 'asset-tile',
        title: `${a.name}${a.frames.length > 1 ? ` (${a.frames.length} frames)` : ''}. Drag into the Scene view, or double-click to edit.`,
        draggable: 'true',
        'data-ai': `asset:${a.id}`,
        'data-ai-label': `the "${a.name}" picture`,
        ondragstart: (e) => { e.dataTransfer.setData('application/x-sprout-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; },
        ondblclick: () => this.editor.openPixelEditor(a.id),
        oncontextmenu: (e) => { e.preventDefault(); this.menu(a, e); },
        onclick: (e) => { if (e.detail === 1 && window.matchMedia('(pointer: coarse)').matches) this.menu(a, e); },
      }, h('img', { src: a.frames[0], alt: '' }), h('span', null, a.name)));
    }
    if (!images.length) this.grid.appendChild(h('p', { class: 'empty-hint' }, 'No pictures yet. Press 🎨 Draw or ＋ Import.'));
    clear(this.sounds);
    for (const name of BUILTIN_SOUNDS) {
      this.sounds.appendChild(h('button', { class: 'sound-chip', title: `Built-in sound. In a script: playSound("${name}")`, onclick: () => this.audio.play(name) }, '▶ ', name));
    }
    for (const a of assets.filter((x) => x.kind === 'sound')) {
      this.sounds.appendChild(h('button', {
        class: 'sound-chip imported', title: `Imported sound. In a script: playSound("${a.name}")`, 'data-ai': `asset:${a.id}`,
        onclick: async () => { await this.audio.loadAssets({ [a.id]: a }); this.audio.play(a.name); },
        oncontextmenu: (e) => { e.preventDefault(); this.menu(a, e); },
      }, '▶ ', a.name));
    }
  }

  menu(a, e) {
    const items = [];
    if (a.kind === 'image') {
      items.push(['🎨 Edit picture', () => this.editor.openPixelEditor(a.id)]);
      items.push(['➕ Add to scene as a Sprite', () => {
        const scene = this.store.scene();
        if (!scene) return;
        const s = this.store.project.settings;
        this.store.addNode({ sceneId: scene.id, type: 'Sprite', name: a.name.charAt(0).toUpperCase() + a.name.slice(1), props: { image: a.id, x: Math.round(s.width / 2), y: Math.round(s.height / 2), width: 32, height: 32 } });
      }]);
    }
    items.push(['✏️ Rename', async () => {
      const name = await promptDialog({ title: 'Rename asset', label: 'Name (scripts use this name)', value: a.name, ai: 'rename-asset' });
      if (name && name !== a.name) { try { this.store.updateAsset(a.id, { name: name.replace(/\s+/g, '_') }); } catch (err) { toast(err.message, 'warn'); } }
    }]);
    items.push(['🗑 Delete', async () => {
      if (await confirmDialog({ title: 'Delete asset', message: `Delete "${a.name}"? Objects using it will show nothing. You can undo this.`, okText: 'Delete', danger: true })) this.store.deleteAsset(a.id);
    }]);
    showContextMenu(e, items);
  }
}
