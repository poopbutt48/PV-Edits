// Right panel: shows and edits the settings of the selected object.
import { h, clear, toast } from '../dom.js';
import { NODE_TYPES, propDefs } from '../../runtime/nodeTypes.js';
import { findScriptSettings } from '../../runtime/scripting.js';
import { walkNodes } from '../store.js';

export class InspectorPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.fields = new Map();
    this.structureKey = null;
    this.openHelp = new Set();
    this.body = h('div', { class: 'inspector-body' });
    el.append(h('div', { class: 'panel-header' }, h('h3', { title: 'Settings of the selected object' }, 'Inspector')), this.body);
  }

  render() {
    const node = this.store.selected();
    const key = this.computeKey(node);
    if (key !== this.structureKey) {
      this.structureKey = key;
      this.rebuild(node);
    } else {
      this.refresh(node);
    }
  }

  computeKey(node) {
    if (!node) return `none:${this.store.ui.sceneId}`;
    const defs = propDefs(node.type).filter((d) => !d.hidden && (!d.showIf || d.showIf(node.props))).map((d) => d.key).join(',');
    const sid = node.type === 'SceneCopy' ? this.store.project.scenes[node.props.scene]?.root.script : node.script;
    const script = sid ? this.store.project.scripts[sid] : null;
    const vars = script ? findScriptSettings(script.code).map((s) => s.name + s.type).join(',') : '';
    const assets = Object.values(this.store.project.assets).map((a) => a.id + a.name).join(',');
    const scenes = this.store.scenes.map((s) => s.id + s.name).join(',');
    const tiles = node.type === 'TileMap' ? node.props.tiles.length : 0;
    const overrides = Object.keys(node.scriptVars || {}).join(',');
    return [node.id, node.type, defs, node.script || '', script ? script.name : '', vars, overrides, assets, scenes, tiles, [...this.openHelp].join(',')].join('|');
  }

  // Updates values without rebuilding, so typing is never interrupted.
  refresh(node) {
    if (!node) return;
    const active = document.activeElement;
    for (const [k, f] of this.fields) {
      if (f.el.contains(active)) continue;
      f.update(node);
    }
  }

  rebuild(node) {
    this.fields.clear();
    clear(this.body);
    if (!node) {
      const scene = this.store.scene();
      this.body.append(h('div', { class: 'inspector-empty' },
        h('p', null, scene ? `Scene: ${scene.name}` : 'No scene open.'),
        h('p', { class: 'muted' }, 'Click an object in the Objects list or in the Scene view to see and change its settings here.'),
        h('p', { class: 'muted' }, 'Tip: ask the AI helper things like "add a coin I can collect" and watch how it does it.')));
      return;
    }
    const type = NODE_TYPES[node.type];
    const r = this.store.findNode(node.id);
    const nameInput = h('input', {
      type: 'text', class: 'name-input', value: node.name, 'data-ai': 'inspector-name', 'aria-label': 'Object name',
      onchange: (e) => { try { this.store.renameNode(node.id, e.target.value); } catch (err) { toast(err.message, 'warn'); e.target.value = node.name; } },
      onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    });
    this.fields.set('__name', { el: nameInput, update: (n) => { nameInput.value = n.name; } });
    this.body.append(h('div', { class: 'insp-title' },
      h('span', { class: 'insp-icon' }, type.icon),
      h('div', { class: 'insp-title-text' }, nameInput, h('div', { class: 'insp-type', title: type.summary }, `${type.label}${r && !r.parent ? ' · top of scene' : ''}`))),
    h('p', { class: 'insp-summary' }, type.summary));

    const groups = new Map();
    for (const d of propDefs(node.type)) {
      if (d.hidden || (d.showIf && !d.showIf(node.props))) continue;
      if (!groups.has(d.group)) groups.set(d.group, []);
      groups.get(d.group).push(d);
    }
    for (const [group, defs] of groups) {
      const section = h('details', { class: 'insp-section', open: true }, h('summary', null, group));
      for (const d of defs) section.appendChild(this.fieldRow(node, d));
      this.body.appendChild(section);
    }
    this.body.appendChild(this.scriptSection(node));
  }

  helpButton(id, text) {
    const open = this.openHelp.has(id);
    return [
      h('button', { class: 'help-btn', title: text, 'aria-label': 'What is this?', 'aria-expanded': String(open), onclick: () => { if (open) this.openHelp.delete(id); else this.openHelp.add(id); this.structureKey = null; this.render(); } }, '?'),
      open ? h('div', { class: 'field-help' }, text) : null,
    ];
  }

  fieldRow(node, d) {
    const id = node.id;
    const set = (value, merge = false) => {
      try { this.store.setProps(id, { [d.key]: value }, { merge }); } catch (err) { toast(err.message, 'warn'); this.structureKey = null; this.render(); }
    };
    let control;
    let update;
    const ai = `prop:${d.key}`;
    switch (d.type) {
      case 'number': {
        control = h('input', {
          type: 'number', step: String(d.step || 1), value: String(node.props[d.key]), 'data-ai': ai, 'data-ai-label': d.label,
          min: d.min, max: d.max,
          onchange: (e) => { if (e.target.value !== '') set(e.target.value); },
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        });
        update = (n) => { control.value = String(round(n.props[d.key])); };
        break;
      }
      case 'bool':
        control = h('input', { type: 'checkbox', checked: !!node.props[d.key], 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.checked) });
        update = (n) => { control.checked = !!n.props[d.key]; };
        break;
      case 'enum':
        control = h('select', { 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) },
          d.options.map(([v, label]) => h('option', { value: v, selected: node.props[d.key] === v }, label)));
        update = (n) => { control.value = n.props[d.key]; };
        break;
      case 'color': {
        const picker = h('input', { type: 'color', value: node.props[d.key].slice(0, 7), 'aria-label': d.label, oninput: (e) => { text.value = e.target.value; set(e.target.value, true); } });
        const text = h('input', { type: 'text', class: 'color-text', value: node.props[d.key], 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) });
        control = h('div', { class: 'color-field' }, picker, text);
        update = (n) => { picker.value = n.props[d.key].slice(0, 7); text.value = n.props[d.key]; };
        break;
      }
      case 'text':
        control = d.multiline
          ? h('textarea', { rows: 2, 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) }, node.props[d.key])
          : h('input', { type: 'text', value: node.props[d.key], 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) });
        update = (n) => { control.value = n.props[d.key]; };
        break;
      case 'image': {
        const images = Object.values(this.store.project.assets).filter((a) => a.kind === 'image');
        const select = h('select', { 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) },
          h('option', { value: '' }, '(no picture)'),
          images.map((a) => h('option', { value: a.id, selected: node.props.image === a.id }, a.name)));
        const preview = h('img', { class: 'img-preview', alt: '' });
        const edit = h('button', { class: 'icon-btn', title: 'Edit this picture', 'aria-label': 'Edit picture', onclick: () => { if (node.props.image) this.editor.openPixelEditor(node.props.image); else this.editor.openPixelEditor(null); } }, '🎨');
        control = h('div', { class: 'image-field' }, preview, select, edit);
        update = (n) => {
          select.value = n.props.image || '';
          const a = this.store.project.assets[n.props.image];
          preview.src = a ? a.frames[0] : '';
          preview.style.visibility = a ? 'visible' : 'hidden';
        };
        update(node);
        break;
      }
      case 'scene': {
        const current = this.store.findNode(id)?.scene.id;
        control = h('div', { class: 'scene-field' },
          h('select', { 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) },
            h('option', { value: '' }, '(choose a scene)'),
            this.store.scenes.filter((s) => s.id !== current).map((s) => h('option', { value: s.id, selected: node.props.scene === s.id }, s.name))),
          h('button', { class: 'btn btn-small', title: 'Open the original scene to change every copy', onclick: () => { if (node.props.scene) this.store.openScene(node.props.scene); } }, 'Open original'));
        update = (n) => { control.querySelector('select').value = n.props.scene || ''; };
        break;
      }
      case 'nodeName': {
        const listId = `names-${d.key}`;
        const names = new Set();
        const scene = this.store.scene();
        if (scene) walkNodes(scene.root, (n) => names.add(n.name));
        control = h('div', null,
          h('input', { type: 'text', list: listId, value: node.props[d.key], placeholder: 'e.g. Player', 'data-ai': ai, 'data-ai-label': d.label, onchange: (e) => set(e.target.value) }),
          h('datalist', { id: listId }, [...names].map((n) => h('option', { value: n }))));
        update = (n) => { control.querySelector('input').value = n.props[d.key]; };
        break;
      }
      case 'tiles':
        return this.tilesEditor(node);
      default:
        control = h('span', null, String(node.props[d.key]));
        update = () => {};
    }
    const row = h('div', { class: `field-row field-${d.type}` },
      h('label', { class: 'field-label', title: d.help }, d.label, ...this.helpButton(`${node.type}.${d.key}`, d.help)),
      h('div', { class: 'field-control' }, control));
    this.fields.set(d.key, { el: row, update });
    return row;
  }

  tilesEditor(node) {
    const id = node.id;
    const images = Object.values(this.store.project.assets).filter((a) => a.kind === 'image');
    const wrap = h('div', { class: 'tiles-editor' });
    const rows = h('div', { class: 'tile-rows' });
    const renderRows = (n) => {
      clear(rows);
      n.props.tiles.forEach((t, i) => {
        const a = this.store.project.assets[t.image];
        const upd = (changes) => { try { this.store.updateTileType(id, i, changes); } catch (e) { toast(e.message, 'warn'); } };
        rows.appendChild(h('div', { class: 'tile-row', 'data-ai': `tile-row:${i}` },
          h('button', {
            class: 'tile-swatch', title: 'Paint with this tile', 'data-ai': `tile-paint:${i}`, 'data-ai-label': `paint with ${t.name}`,
            style: { background: a ? `center/contain no-repeat url(${a.frames[0]}), ${t.color}` : t.color },
            onclick: () => this.editor.viewport.setTool('paint', i),
          }),
          h('div', { class: 'tile-fields' },
            h('input', { type: 'text', value: t.name, 'aria-label': 'Tile name', 'data-ai': `tile:${i}:name`, onchange: (e) => upd({ name: e.target.value }) }),
            h('select', { 'aria-label': 'Tile picture', 'data-ai': `tile:${i}:image`, onchange: (e) => upd({ image: e.target.value }) },
              h('option', { value: '' }, '(colour only)'),
              images.map((im) => h('option', { value: im.id, selected: t.image === im.id }, im.name))),
            h('div', { class: 'tile-flags' },
              h('input', { type: 'color', value: t.color.slice(0, 7), title: 'Colour (used when there is no picture)', 'aria-label': 'Tile colour', 'data-ai': `tile:${i}:color`, onchange: (e) => upd({ color: e.target.value }) }),
              h('label', { title: 'Characters cannot walk through solid tiles.' }, h('input', { type: 'checkbox', checked: t.solid && !t.platform, 'data-ai': `tile:${i}:solid`, onchange: (e) => upd({ solid: e.target.checked, platform: e.target.checked ? false : t.platform }) }), ' Solid'),
              h('label', { title: 'Platforms can be jumped through from below and stood on.' }, h('input', { type: 'checkbox', checked: t.platform, 'data-ai': `tile:${i}:platform`, onchange: (e) => upd({ platform: e.target.checked }) }), ' Platform'))),
          h('button', { class: 'icon-btn', title: 'Remove tile type', 'aria-label': 'Remove tile type', onclick: () => this.store.removeTileType(id, i) }, '✕')));
      });
    };
    renderRows(node);
    wrap.append(
      h('p', { class: 'muted small' }, 'Pick a tile, then choose 🖌 Paint in the Scene view and drag to paint. Right-click or 🧽 erases.'),
      rows,
      h('button', {
        class: 'btn btn-small', 'data-ai': 'add-tile-btn', onclick: () => {
          const colors = ['#8d6e63', '#78909c', '#ffb74d', '#81c784', '#64b5f6', '#e57373'];
          this.store.addTileType(id, { name: `Tile ${node.props.tiles.length + 1}`, color: colors[node.props.tiles.length % colors.length], solid: true });
        },
      }, '＋ Add tile type'));
    this.fields.set('tiles', { el: wrap, update: (n) => renderRows(n) });
    return wrap;
  }

  scriptSection(node) {
    const section = h('details', { class: 'insp-section', open: true }, h('summary', null, 'Script'));
    const isCopy = node.type === 'SceneCopy';
    const original = isCopy ? this.store.project.scenes[node.props.scene] : null;
    const scriptId = isCopy ? original && original.root.script : node.script;
    const script = scriptId ? this.store.project.scripts[scriptId] : null;
    if (isCopy) {
      section.appendChild(h('p', { class: 'muted small' }, script
        ? `Uses ${script.name} from the scene "${original.name}". Settings below change only this copy.`
        : 'Copies use the script of their original scene (it has none yet).'));
      if (script) this.scriptSettings(section, node, script);
      return section;
    }
    if (!script) {
      section.append(
        h('p', { class: 'muted small' }, 'Scripts make objects do things: move, jump, collect, win…'),
        h('button', { class: 'btn btn-primary btn-small', 'data-ai': 'add-script-btn', onclick: () => this.editor.addScriptTo(node.id) }, '📜 Add script'));
      return section;
    }
    section.append(h('div', { class: 'script-line' },
      h('span', { class: 'script-name' }, `📜 ${script.name}`),
      h('button', { class: 'btn btn-small btn-primary', 'data-ai': 'edit-script-btn', onclick: () => this.editor.openScript(script.id) }, 'Edit'),
      h('button', { class: 'btn btn-small', 'data-ai': 'remove-script-btn', title: 'Detach the script from this object (the script itself is kept)', onclick: () => this.store.detachScript(node.id) }, 'Remove')));
    this.scriptSettings(section, node, script);
    return section;
  }

  scriptSettings(section, node, script) {
    const settings = findScriptSettings(script.code);
    if (settings.length) {
      section.appendChild(h('p', { class: 'muted small' }, 'Script settings - change them for just this object:'));
      for (const s of settings) {
        const current = node.scriptVars && s.name in node.scriptVars ? node.scriptVars[s.name] : s.value;
        const changed = node.scriptVars && s.name in node.scriptVars;
        const set = (v) => this.store.setScriptVar(node.id, s.name, v);
        let control;
        if (s.type === 'bool') control = h('input', { type: 'checkbox', checked: !!current, 'data-ai': `var:${s.name}`, onchange: (e) => set(e.target.checked) });
        else if (s.type === 'number') control = h('input', { type: 'number', value: String(current), 'data-ai': `var:${s.name}`, onchange: (e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) set(n); } });
        else control = h('input', { type: 'text', value: String(current), 'data-ai': `var:${s.name}`, onchange: (e) => set(e.target.value) });
        const row = h('div', { class: 'field-row' },
          h('label', { class: 'field-label', title: s.comment || s.name }, s.name, s.comment ? h('span', { class: 'var-comment' }, ` - ${s.comment}`) : null),
          h('div', { class: 'field-control' }, control,
            changed ? h('button', { class: 'icon-btn', title: `Reset to ${s.value}`, 'aria-label': 'Reset', onclick: () => set(null) }, '↺') : null));
        this.fields.set(`var:${s.name}`, { el: row, update: (n) => {
          const v = n.scriptVars && s.name in n.scriptVars ? n.scriptVars[s.name] : s.value;
          if (s.type === 'bool') control.checked = !!v; else control.value = String(v);
        } });
        section.appendChild(row);
      }
    }
    return section;
  }
}

function round(v) {
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
}
