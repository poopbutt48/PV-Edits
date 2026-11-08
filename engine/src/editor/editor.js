// The editor window: lays out every panel and holds the commands that
// both the buttons and the AI helper use.

import { h, clear, toast, rafThrottle, debounce, isMobileLayout, confirmDialog, promptDialog } from './dom.js';
import { Store } from './store.js';
import { saveProject, saveTextFile, openTextFile, validateProject, platformName } from './persistence.js';
import { SceneTreePanel } from './panels/sceneTree.js';
import { InspectorPanel } from './panels/inspector.js';
import { ViewportPanel } from './panels/viewport.js';
import { AssetsPanel } from './panels/assets.js';
import { OutputPanel } from './panels/output.js';
import { ScriptEditorPanel } from './panels/scriptEditor.js';
import { PixelEditorPanel } from './panels/pixelEditor.js';
import { PlayView } from './panels/playView.js';
import { openAddObjectDialog } from './panels/addObject.js';
import { openSettingsDialog } from './panels/settings.js';
import { openHelpDialog } from './panels/help.js';
import { buildExportHtml } from './exportGame.js';
import { AIPanel } from '../ai/panel.js';

const MOBILE_TABS = [
  ['viewport', '🎬', 'Scene'],
  ['tree', '🌳', 'Objects'],
  ['inspector', '🔧', 'Inspector'],
  ['assets', '🖼️', 'Assets'],
  ['output', '📋', 'Output'],
  ['ai', '🤖', 'AI'],
];

export class Editor {
  constructor(root, project, { onExit } = {}) {
    this.root = root;
    this.store = new Store(project);
    this.onExit = onExit;
    this.openTabs = []; // extra centre tabs: 'script:<id>' and 'pixel:<id>'
    this.mobilePanel = 'viewport';
    this.aiBusy = false;
    this.saveState = 'saved';
    this.render = rafThrottle(() => this.renderNow());
    this.autosave = debounce(() => this.saveNow(), 900);
    this.store.on('change', (d) => {
      if (!d.uiOnly) {
        this.saveState = 'unsaved';
        this.autosave();
      }
      this.syncTabs();
      this.render();
    });
  }

  // ------------------------------------------------------------ layout

  mount() {
    clear(this.root);
    this.topbar = h('header', { class: 'topbar' });
    this.leftCol = h('section', { class: 'col col-left' });
    this.treeBox = h('div', { class: 'panel panel-tree', 'data-panel': 'tree' });
    this.assetsBox = h('div', { class: 'panel panel-assets', 'data-panel': 'assets' });
    this.leftCol.append(this.treeBox, this.assetsBox);

    this.centerTabs = h('div', { class: 'center-tabs', role: 'tablist' });
    this.centerBody = h('div', { class: 'center-body' });
    this.viewportBox = h('div', { class: 'center-view', 'data-view': 'scene' });
    this.scriptBox = h('div', { class: 'center-view', 'data-view': 'script' });
    this.pixelBox = h('div', { class: 'center-view', 'data-view': 'pixel' });
    this.playBox = h('div', { class: 'play-view', hidden: true });
    this.centerBody.append(this.viewportBox, this.scriptBox, this.pixelBox, this.playBox);
    this.outputBox = h('div', { class: 'panel panel-output', 'data-panel': 'output' });
    this.centerCol = h('section', { class: 'col col-center', 'data-panel': 'viewport' }, this.centerTabs, this.centerBody);

    this.inspectorBox = h('section', { class: 'col col-right panel', 'data-panel': 'inspector' });
    this.aiBox = h('section', { class: 'col col-ai panel', 'data-panel': 'ai' });

    this.mobileNav = h('nav', { class: 'mobile-nav' },
      MOBILE_TABS.map(([id, icon, label]) => h('button', {
        class: 'mobile-tab', 'data-tab': id, 'data-ai': `mobile-tab:${id}`, 'data-ai-label': `${label} tab`,
        onclick: () => this.showMobilePanel(id),
      }, h('span', { class: 'mobile-tab-icon' }, icon), h('span', null, label))));

    this.workspace = h('main', { class: 'workspace' }, this.leftCol, this.centerCol, this.outputBox, this.inspectorBox, this.aiBox);
    this.app = h('div', { class: 'app' }, this.topbar, this.workspace, this.mobileNav);
    this.root.appendChild(this.app);

    this.tree = new SceneTreePanel(this, this.treeBox);
    this.assets = new AssetsPanel(this, this.assetsBox);
    this.inspector = new InspectorPanel(this, this.inspectorBox);
    this.viewport = new ViewportPanel(this, this.viewportBox);
    this.output = new OutputPanel(this, this.outputBox);
    this.scriptEditor = new ScriptEditorPanel(this, this.scriptBox);
    this.pixelEditor = new PixelEditorPanel(this, this.pixelBox);
    this.playView = new PlayView(this, this.playBox);
    this.ai = new AIPanel(this, this.aiBox);

    this.buildTopbar();
    this.bindKeys();
    window.addEventListener('resize', () => this.render());
    this.app.classList.toggle('ai-open', localStorageGet('sprout.aiOpen', '1') === '1');
    this.syncTabs();
    this.renderNow();
    this.applyMobilePanel();
  }

  buildTopbar() {
    const btn = (label, title, onclick, ai, extra = {}) => h('button', { class: 'tb-btn', title, 'aria-label': title, onclick, 'data-ai': ai, ...extra }, label);
    this.playBtn = btn('▶ Play', 'Play the game (F5)', () => this.play(), 'play-btn', { class: 'tb-btn tb-play' });
    this.stopBtn = btn('■ Stop', 'Stop the game (F8)', () => this.stop(), 'stop-btn', { class: 'tb-btn tb-stop', hidden: true });
    this.undoBtn = btn('↶', 'Undo (Ctrl+Z)', () => this.undo(), 'undo-btn');
    this.redoBtn = btn('↷', 'Redo (Ctrl+Y)', () => this.redo(), 'redo-btn');
    this.saveLabel = h('span', { class: 'save-state' });
    this.projectName = h('button', { class: 'project-name', title: 'Rename project', 'data-ai': 'project-name', onclick: async () => {
      const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: this.store.project.name, ai: 'rename-project' });
      if (name) this.store.setProjectName(name);
    } });
    const menu = h('div', { class: 'menu', hidden: true });
    const menuBtn = btn('☰', 'Project menu', () => { menu.hidden = !menu.hidden; }, 'menu-btn');
    const item = (label, fn, ai) => h('button', { class: 'menu-item', 'data-ai': ai, onclick: () => { menu.hidden = true; fn(); } }, label);
    menu.append(
      item('🏠 My projects', () => this.exit(), 'menu-home'),
      item('💾 Save project file…', () => this.exportProjectFile(), 'menu-save-file'),
      item('📂 Open project file…', () => this.importProjectFile(), 'menu-open-file'),
      item('📦 Export game as web page…', () => this.exportGame(), 'menu-export'),
      item('⚙️ Project settings', () => this.openSettings(), 'menu-settings'),
      item('❔ Script help', () => openHelpDialog(this), 'menu-help'),
    );
    document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target) && e.target !== menuBtn) menu.hidden = true; });
    const aiToggle = btn('🤖 AI helper', 'Show or hide the AI helper', () => this.toggleAI(), 'ai-toggle', { class: 'tb-btn tb-ai' });
    clear(this.topbar).append(
      h('div', { class: 'tb-left' }, h('div', { class: 'logo', title: 'Sprout Engine' }, '🌱'), menuBtn, menu, this.projectName, this.saveLabel),
      h('div', { class: 'tb-mid' }, this.undoBtn, this.redoBtn, this.playBtn, this.stopBtn),
      h('div', { class: 'tb-right' },
        btn('⚙️', 'Project settings', () => this.openSettings(), 'settings-btn'),
        btn('❔', 'Script help', () => openHelpDialog(this), 'help-btn'),
        aiToggle),
    );
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (this.aiBusy) return;
      const inField = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable || e.target.closest('.cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5') { e.preventDefault(); this.play(); return; }
      if (e.key === 'F8' || (e.key === 'Escape' && this.playView.game)) { e.preventDefault(); this.stop(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveNow(true); return; }
      if (inField) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); this.redo(); }
      else if (mod && e.key.toLowerCase() === 'd' && this.store.ui.selectedId) { e.preventDefault(); this.duplicateSelected(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && this.store.ui.selectedId) { e.preventDefault(); this.deleteSelected(); }
      else this.viewport.handleKey(e);
    });
  }

  // ------------------------------------------------------------ rendering

  renderNow() {
    const p = this.store.project;
    this.projectName.textContent = p.name;
    this.saveLabel.textContent = this.saveState === 'saved' ? '✓ Saved' : this.saveState === 'saving' ? 'Saving…' : '• Unsaved';
    this.saveLabel.dataset.state = this.saveState;
    this.undoBtn.disabled = !this.store.canUndo();
    this.redoBtn.disabled = !this.store.canRedo();
    this.renderTabs();
    this.tree.render();
    this.assets.render();
    this.inspector.render();
    this.viewport.render();
    this.scriptEditor.render();
    this.pixelEditor.render();
    this.output.render();
    const tab = this.store.ui.centerTab || 'scene';
    this.viewportBox.hidden = !tab.startsWith('scene');
    this.scriptBox.hidden = !tab.startsWith('script:');
    this.pixelBox.hidden = !tab.startsWith('pixel:');
  }

  syncTabs() {
    const tab = this.store.ui.centerTab;
    if (tab && tab !== 'scene' && !this.openTabs.includes(tab)) this.openTabs.push(tab);
    const p = this.store.project;
    this.openTabs = this.openTabs.filter((t) => (t.startsWith('script:') ? !!p.scripts[t.slice(7)] : t === 'pixel:new' || !!p.assets[t.slice(6)]) || t === tab);
  }

  renderTabs() {
    const ui = this.store.ui;
    const scene = this.store.scene();
    const tabs = [['scene', `🎬 ${scene ? scene.name : 'Scene'}`]];
    for (const t of this.openTabs) {
      if (t.startsWith('script:')) {
        const s = this.store.project.scripts[t.slice(7)];
        if (s) tabs.push([t, `📜 ${s.name}`]);
      } else if (t.startsWith('pixel:')) {
        const a = this.store.project.assets[t.slice(6)];
        tabs.push([t, `🎨 ${a ? a.name : 'New picture'}`]);
      }
    }
    clear(this.centerTabs);
    for (const [id, label] of tabs) {
      const active = (ui.centerTab || 'scene') === id;
      const el = h('div', { class: `ctab ${active ? 'active' : ''}`, role: 'tab', 'aria-selected': String(active) },
        h('button', { class: 'ctab-btn', 'data-ai': `center-tab:${id}`, onclick: () => this.store.setCenterTab(id) }, label),
        id !== 'scene' ? h('button', { class: 'ctab-close', title: 'Close tab', 'aria-label': `Close ${label}`, onclick: () => this.closeTab(id) }, '×') : null);
      this.centerTabs.appendChild(el);
    }
  }

  closeTab(id) {
    this.openTabs = this.openTabs.filter((t) => t !== id);
    if (this.store.ui.centerTab === id) this.store.setCenterTab('scene');
    else this.render();
  }

  // ------------------------------------------------------------ mobile layout

  showMobilePanel(id) {
    this.mobilePanel = id;
    this.applyMobilePanel();
    if (id === 'viewport') this.viewport.resize();
  }

  applyMobilePanel() {
    this.app.dataset.mobilePanel = this.mobilePanel;
    for (const b of this.mobileNav.querySelectorAll('.mobile-tab')) b.classList.toggle('active', b.dataset.tab === this.mobilePanel);
  }

  // Is a panel visible right now? (On phones only one panel shows at a time.)
  panelVisible(name) {
    if (!isMobileLayout()) return name !== 'ai' || this.app.classList.contains('ai-open');
    return this.mobilePanel === name;
  }

  toggleAI(force) {
    if (isMobileLayout()) { this.showMobilePanel('ai'); return; }
    const open = force !== undefined ? force : !this.app.classList.contains('ai-open');
    this.app.classList.toggle('ai-open', open);
    localStorageSet('sprout.aiOpen', open ? '1' : '0');
    setTimeout(() => this.viewport.resize(), 50);
  }

  // ------------------------------------------------------------ commands

  undo() {
    const label = this.store.undo();
    if (label) toast(`Undid: ${label}`);
  }

  redo() {
    const label = this.store.redo();
    if (label) toast(`Redid: ${label}`);
  }

  openAddObject(parentId) {
    if (!this.store.scene()) { toast('Create a scene first.', 'warn'); return; }
    return openAddObjectDialog(this, parentId);
  }

  async deleteSelected() {
    const id = this.store.ui.selectedId;
    const r = id && this.store.findNode(id);
    if (!r) return;
    if (!r.parent) { toast('This is the top object of the scene. To remove it, delete the scene.', 'warn'); return; }
    const ok = await confirmDialog({ title: 'Delete object', message: `Delete "${r.node.name}"${r.node.children.length ? ' and everything inside it' : ''}? You can undo this.`, okText: 'Delete', danger: true, ai: 'delete' });
    if (ok) this.store.deleteNode(id);
  }

  duplicateSelected() {
    const id = this.store.ui.selectedId;
    if (!id) return;
    try { this.store.duplicateNode(id); } catch (e) { toast(e.message, 'warn'); }
  }

  addScriptTo(nodeId) {
    const node = this.store.node(nodeId);
    if (!node) return;
    const scriptId = this.store.attachNewScript(nodeId, starterScriptFor(node));
    this.openScript(scriptId);
    return scriptId;
  }

  openScript(scriptId, line) {
    if (!this.store.project.scripts[scriptId]) return;
    const tab = `script:${scriptId}`;
    if (!this.openTabs.includes(tab)) this.openTabs.push(tab);
    this.store.setCenterTab(tab);
    if (isMobileLayout()) this.showMobilePanel('viewport');
    if (line) setTimeout(() => this.scriptEditor.goToLine(line), 30);
  }

  openPixelEditor(assetId) {
    const tab = `pixel:${assetId || 'new'}`;
    if (!this.openTabs.includes(tab)) this.openTabs.push(tab);
    this.store.setCenterTab(tab);
    if (isMobileLayout()) this.showMobilePanel('viewport');
  }

  openSettings(tab) {
    return openSettingsDialog(this, tab);
  }

  async play(sceneId) {
    await this.saveNow();
    this.output.clear();
    this.playBtn.hidden = true;
    this.stopBtn.hidden = false;
    this.app.classList.add('is-playing');
    if (isMobileLayout()) this.showMobilePanel('viewport');
    await this.playView.start(sceneId);
  }

  stop() {
    if (!this.playView.game && this.playBox.hidden) return;
    this.playView.stop();
    this.playBtn.hidden = false;
    this.stopBtn.hidden = true;
    this.app.classList.remove('is-playing');
    this.viewport.resize();
  }

  async saveNow(manual = false) {
    if (this.saveState === 'saved' && !manual) return;
    this.saveState = 'saving';
    this.render();
    try {
      await saveProject(this.store.project);
      this.saveState = 'saved';
      if (manual) toast('Saved');
    } catch (e) {
      this.saveState = 'unsaved';
      toast(`Could not save: ${e.message}`, 'error');
    }
    this.render();
  }

  async exportProjectFile() {
    const p = this.store.project;
    const name = `${p.name.replace(/[^\w -]+/g, '').trim() || 'game'}.sprout`;
    try {
      const r = await saveTextFile(name, JSON.stringify(p), 'project');
      if (r && r.saved) toast(`Saved ${r.path || name}`);
    } catch (e) { toast(`Could not save the file: ${e.message}`, 'error'); }
  }

  async importProjectFile() {
    const f = await openTextFile('.sprout,.json');
    if (!f) return;
    try {
      const p = validateProject(JSON.parse(f.text));
      const ok = await confirmDialog({ title: 'Open project', message: `Open "${p.name}"? Your current project is already saved and stays in My projects.`, okText: 'Open' });
      if (!ok) return;
      await saveProject(p);
      this.exit(p.id);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  buildExport() {
    return buildExportHtml(this.store.project);
  }

  async exportGame() {
    try {
      const html = await buildExportHtml(this.store.project);
      const name = `${this.store.project.name.replace(/[^\w -]+/g, '').trim() || 'game'}.html`;
      const r = await saveTextFile(name, html, 'game');
      if (r && r.saved) toast(`Exported ${r.path || name}. Open it in any web browser to play!`, 'info', 6000);
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'error');
    }
  }

  async exit(openId) {
    this.stop();
    await this.saveNow();
    if (this.ai) this.ai.destroy();
    if (this.onExit) this.onExit(openId);
  }

  platform() {
    return platformName();
  }
}

function starterScriptFor(node) {
  return `// Script for "${node.name}".
// "me" is this object. Press ❔ Script help to see everything you can use.

function start() {
  // Runs once when the game starts.
}

function update(dt) {
  // Runs every frame. dt = seconds since the last frame.
}
`;
}

function localStorageGet(k, d) {
  try { return localStorage.getItem(k) ?? d; } catch (_) { return d; }
}
function localStorageSet(k, v) {
  try { localStorage.setItem(k, v); } catch (_) { /* storage unavailable */ }
}

export { localStorageGet, localStorageSet };
