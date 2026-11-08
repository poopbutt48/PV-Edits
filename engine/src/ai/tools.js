// Everything the AI helper can do in the editor.
//
// Each tool works the real interface with the AI's visible cursor (the same
// buttons a person would press), so people can watch and learn. Tools are
// also re-run, step by step, when someone rewinds and replays the AI's work.

import { NODE_TYPES, propDef, defaultProps, coerceProp } from '../runtime/nodeTypes.js';
import { checkSyntax, findScriptSettings } from '../runtime/scripting.js';
import { BUILTIN_SOUNDS } from '../runtime/audio.js';
import { walkNodes, DEFAULT_SETTINGS } from '../editor/store.js';
import { parseCell } from '../runtime/render.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Tab|Escape|Backspace|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Numpad\w+|F\d{1,2}|Comma|Period|Slash|Semicolon|Quote|Minus|Equal|Bracket(Left|Right)|Backslash|Backquote)$/;

// ------------------------------------------------------------ helpers

function fail(msg) { throw new Error(msg); }

function need(input, key, type) {
  const v = input[key];
  if (v === undefined || v === null || v === '') fail(`Missing "${key}".`);
  if (type === 'string' && typeof v !== 'string') fail(`"${key}" must be text.`);
  if (type === 'number' && typeof v !== 'number') fail(`"${key}" must be a number.`);
  if (type === 'array' && !Array.isArray(v)) fail(`"${key}" must be a list.`);
  if (type === 'object' && (typeof v !== 'object' || Array.isArray(v))) fail(`"${key}" must be an object.`);
  return v;
}

function assetName(store, id) {
  const a = store.project.assets[id];
  return a ? a.name : id;
}

function lineCount(code) { return code.split('\n').length; }

export function projectOverview(editor) {
  const store = editor.store;
  const p = store.project;
  const s = p.settings;
  const L = [];
  const start = p.scenes[s.startScene];
  L.push(`Project "${p.name}": game screen ${s.width}x${s.height}, background ${s.background}, gravity ${s.gravity}, pixelArt ${s.pixelArt}, start scene "${start ? start.name : '(none)'}", on-screen buttons ${s.touchControls}/${s.touchLayout}.`);
  const open = store.scene();
  const sel = store.selected();
  L.push(`Open scene: ${open ? `"${open.name}" [${open.id}]` : 'none'}. Selected object: ${sel ? `"${sel.name}" [${sel.id}]` : 'none'}.`);
  L.push('', 'SCENES (objects listed with their id in [brackets]; only non-default properties shown):');
  for (const scene of store.scenes) {
    L.push(`Scene "${scene.name}" [${scene.id}]${scene.id === s.startScene ? ' (start scene)' : ''}:`);
    describeNode(store, scene.root, 1, L);
  }
  L.push('', 'SCRIPTS:');
  const users = {};
  for (const scene of store.scenes) walkNodes(scene.root, (n) => { if (n.script) (users[n.script] ||= []).push(`"${n.name}" in ${scene.name}`); });
  const scripts = Object.values(p.scripts);
  if (!scripts.length) L.push('(none)');
  for (const sc of scripts) L.push(`- ${sc.name} [${sc.id}] ${lineCount(sc.code)} lines, used by ${users[sc.id] ? users[sc.id].join(', ') : 'nothing'}`);
  L.push('', 'PICTURES (asset name, size, frames):');
  const imgs = Object.values(p.assets).filter((a) => a.kind === 'image');
  L.push(imgs.length ? imgs.map((a) => `${a.name}${a.frames.length > 1 ? ` (${a.frames.length} frames @${a.fps}fps)` : ''}`).join(', ') : '(none)');
  const sounds = Object.values(p.assets).filter((a) => a.kind === 'sound');
  L.push(`SOUNDS: built-in ${BUILTIN_SOUNDS.join(', ')}${sounds.length ? `; imported ${sounds.map((a) => a.name).join(', ')}` : ''}.`);
  L.push(`INPUT ACTIONS: ${Object.entries(p.input).map(([a, k]) => `${a} [${k.join(', ')}]`).join('; ')}.`);
  return L.join('\n');
}

function describeNode(store, n, depth, L) {
  const pad = '  '.repeat(depth);
  const defs = defaultProps(n.type);
  const parts = [];
  const pr = n.props;
  if ('x' in pr) parts.push(`x=${round(pr.x)} y=${round(pr.y)}`);
  for (const [k, v] of Object.entries(pr)) {
    if (k === 'x' || k === 'y' || k === 'cells' || k === 'tiles') continue;
    if (JSON.stringify(v) === JSON.stringify(defs[k])) continue;
    if (k === 'image') parts.push(`image=${assetName(store, v)}`);
    else if (k === 'scene') parts.push(`copy of scene "${store.project.scenes[v]?.name || v}"`);
    else parts.push(`${k}=${typeof v === 'string' ? JSON.stringify(v) : round(v)}`);
  }
  if (n.type === 'TileMap') {
    const keys = Object.keys(pr.cells);
    parts.push(`tile types: ${pr.tiles.map((t, i) => `${i}=${t.name}${t.image ? `(${assetName(store, t.image)})` : ''}${t.platform ? ' platform' : t.solid ? ' solid' : ' decoration'}`).join(', ') || 'none'}`);
    if (keys.length) {
      const xs = keys.map((k) => parseCell(k)[0]);
      const ys = keys.map((k) => parseCell(k)[1]);
      parts.push(`${keys.length} tiles painted in cells x ${Math.min(...xs)}..${Math.max(...xs)}, y ${Math.min(...ys)}..${Math.max(...ys)}`);
    } else parts.push('no tiles painted');
  }
  if (n.script) parts.push(`script=${store.project.scripts[n.script]?.name || '?'} [${n.script}]`);
  if (n.scriptVars && Object.keys(n.scriptVars).length) parts.push(`scriptSettings=${JSON.stringify(n.scriptVars)}`);
  L.push(`${pad}- ${n.type} "${n.name}" [${n.id}] ${parts.join(', ')}`);
  // Group runs of identical scene copies to keep the list short.
  const kids = n.children;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.type === 'SceneCopy' && !c.children.length) {
      let j = i;
      while (j + 1 < kids.length && kids[j + 1].type === 'SceneCopy' && kids[j + 1].props.scene === c.props.scene && kids[j + 1].name === c.name && !kids[j + 1].children.length) j++;
      if (j - i >= 3) {
        const list = kids.slice(i, j + 1).map((k) => `${k.id}@(${round(k.props.x)},${round(k.props.y)})`).join(' ');
        L.push(`${pad}  - ${j - i + 1}x SceneCopy "${c.name}" (copy of scene "${store.project.scenes[c.props.scene]?.name}"): ${list}`);
        i = j;
        continue;
      }
    }
    describeNode(store, c, depth + 1, L);
  }
}

// ------------------------------------------------------------ the tools

export function createTools(editor) {
  const store = editor.store;
  const NODE_TYPE_LIST = Object.keys(NODE_TYPES);

  // --- shared steps

  async function openScene(cur, sceneId) {
    if (!store.project.scenes[sceneId]) fail(`No scene with id "${sceneId}".`);
    if (store.ui.sceneId !== sceneId || store.ui.centerTab !== 'scene') await cur.click(`scene-tab:${sceneId}`);
  }

  async function selectNode(cur, id) {
    const r = store.findNode(id);
    if (!r) fail(`No object with id "${id}". Call get_project_overview to see the ids.`);
    await openScene(cur, r.scene.id);
    if (store.ui.selectedId === id) return r;
    // Unfold groups so the row is visible.
    let p = store.findNode(id).parent;
    while (p) { editor.tree.collapsed.delete(p.id); p = store.findNode(p.id).parent; }
    editor.renderNow();
    await cur.click(`tree-node:${id}`);
    return store.findNode(id);
  }

  function prepareValue(node, key, value) {
    const def = propDef(node.type, key);
    if (!def) fail(`A ${node.type} has no property "${key}". Its properties are: ${Object.keys(defaultProps(node.type)).filter((k) => k !== 'cells').join(', ')}.`);
    if (def.type === 'tiles' || def.type === 'cells') fail(`Use add_tile_type and paint_tiles to change "${key}".`);
    if (def.type === 'image') {
      if (!value) return { def, value: '' };
      const a = store.resolveAsset(value);
      if (!a || a.kind !== 'image') fail(`No picture called "${value}". Pictures: ${Object.values(store.project.assets).filter((x) => x.kind === 'image').map((x) => x.name).join(', ')}.`);
      return { def, value: a.id, shown: a.name };
    }
    if (def.type === 'scene') {
      const s = store.resolveScene(value);
      if (!s) fail(`No scene called "${value}".`);
      return { def, value: s.id, shown: s.name };
    }
    return { def, value: coerceProp(node.type, key, value) };
  }

  async function setPropsVisual(cur, id, props) {
    const order = ['body', 'shape', 'image'];
    const keys = Object.keys(props).sort((a, b) => (order.indexOf(b) + 1) - (order.indexOf(a) + 1));
    const node0 = store.node(id);
    for (const k of keys) prepareValue(node0, k, props[k]); // validate everything first
    if (keys.length) await selectNode(cur, id);
    for (const key of keys) {
      const node = store.node(id);
      const { def, value, shown } = prepareValue(node, key, props[key]);
      if (JSON.stringify(node.props[key]) === JSON.stringify(value)) continue;
      const target = `prop:${key}`;
      if (!document.querySelector(`[data-ai="${CSS.escape(target)}"]`)) {
        // Hidden field (e.g. gravity when the body is not a character): set it directly.
        store.setProps(id, { [key]: value });
        continue;
      }
      if (def.type === 'bool') await cur.setChecked(target, value, def.label);
      else if (def.type === 'enum' || def.type === 'image' || def.type === 'scene') await cur.choose(target, value, shown, def.label);
      else await cur.type(target, String(value), def.label);
      const after = store.node(id).props[key];
      if (JSON.stringify(after) !== JSON.stringify(value)) store.setProps(id, { [key]: value });
    }
  }

  async function openScriptFor(cur, scriptId) {
    const tab = `center-tab:script:${scriptId}`;
    if (store.ui.centerTab === `script:${scriptId}`) return;
    if (document.querySelector(`[data-ai="${CSS.escape(tab)}"]`)) { await cur.click(tab); return; }
    let user = null;
    for (const scene of store.scenes) walkNodes(scene.root, (n) => { if (!user && n.script === scriptId) user = n; });
    if (user) {
      await selectNode(cur, user.id);
      await cur.click('edit-script-btn');
    } else {
      editor.openScript(scriptId);
      editor.renderNow();
    }
  }

  function syntaxReport(code) {
    const err = checkSyntax(code);
    return err ? { syntax_ok: false, syntax_error: err.message } : { syntax_ok: true };
  }

  function sceneCopyOf(id) {
    const r = store.findNode(id);
    return r && r.node.type === 'SceneCopy';
  }

  // --- tool list

  const tools = [
    {
      name: 'get_project_overview',
      readOnly: true,
      description: 'Lists every scene, object (with ids and non-default properties), script, picture, sound, input action and setting in the project. Call this at the start of each request - the user may have changed things since you last looked.',
      input_schema: { type: 'object', properties: {} },
      title: () => '👀 Looked over the project',
      async run() { return projectOverview(editor); },
    },
    {
      name: 'get_object',
      readOnly: true,
      description: 'Full details of one object: all properties, its script, script settings and children.',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' } }, required: ['object_id'] },
      title: () => '👀 Looked at an object',
      async run(input) {
        const r = store.findNode(need(input, 'object_id', 'string'));
        if (!r) fail(`No object with id "${input.object_id}".`);
        const n = r.node;
        const script = n.script ? store.project.scripts[n.script] : null;
        return {
          id: n.id, name: n.name, type: n.type, scene: r.scene.name, parent: r.parent ? `${r.parent.name} [${r.parent.id}]` : null,
          properties: n.type === 'TileMap' ? { ...n.props, cells: `${Object.keys(n.props.cells).length} painted cells` } : n.props,
          script: script ? { id: script.id, name: script.name, settings: findScriptSettings(script.code), overrides: n.scriptVars } : null,
          children: n.children.map((c) => `${c.type} "${c.name}" [${c.id}]`),
        };
      },
    },
    {
      name: 'read_script',
      readOnly: true,
      description: 'Reads a script, with line numbers.',
      input_schema: { type: 'object', properties: { script_id: { type: 'string' } }, required: ['script_id'] },
      title: () => '👀 Read a script',
      async run(input) {
        const s = store.project.scripts[need(input, 'script_id', 'string')];
        if (!s) fail(`No script with id "${input.script_id}".`);
        return `${s.name} [${s.id}]\n` + s.code.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
      },
    },
    {
      name: 'add_object',
      description: `Adds an object to a scene using the "+ Add" button, then sets its properties in the Inspector. Types: ${NODE_TYPE_LIST.join(', ')}. For a SceneCopy pass properties.scene (scene name or id). New objects go at the top level of the scene unless parent_id is given.`,
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: NODE_TYPE_LIST },
          name: { type: 'string', description: 'Name for the object, e.g. "Player". Scripts find objects by name.' },
          scene_id: { type: 'string', description: 'Scene to add to. Defaults to the open scene.' },
          parent_id: { type: 'string', description: 'Optional object to put the new object inside.' },
          properties: { type: 'object', description: 'Property values, e.g. {"x": 300, "y": 200, "image": "coin", "body": "trigger"}. Pictures and scenes can be given by name.' },
        },
        required: ['type', 'name'],
      },
      title: (i) => `＋ Added ${NODE_TYPES[i.type]?.label || i.type} "${i.name}"`,
      async run(input, { cur }) {
        const type = need(input, 'type', 'string');
        if (!NODE_TYPES[type]) fail(`Unknown type "${type}". Types: ${NODE_TYPE_LIST.join(', ')}.`);
        const name = need(input, 'name', 'string');
        const props = { ...(input.properties || {}) };
        const sceneId = input.scene_id || store.ui.sceneId;
        if (!store.project.scenes[sceneId]) fail(input.scene_id ? `No scene with id "${input.scene_id}".` : 'There is no scene yet. Use create_scene first.');
        let copyScene = null;
        if (type === 'SceneCopy') {
          copyScene = store.resolveScene(props.scene);
          if (!copyScene) fail('A SceneCopy needs properties.scene: the name or id of the scene to copy.');
          if (copyScene.id === sceneId) fail('A scene cannot contain a copy of itself.');
          delete props.scene;
        }
        // Validate the rest before touching the interface.
        const probe = { type, props: defaultProps(type) };
        for (const k of Object.keys(props)) prepareValue(probe, k, props[k]);
        await openScene(cur, sceneId);
        const scene = store.scene(sceneId);
        const parentId = input.parent_id || scene.root.id;
        const parent = store.findNode(parentId);
        if (!parent || parent.scene.id !== sceneId) fail(`No object "${parentId}" in that scene.`);
        if (parent.node.type === 'Group' || parentId === scene.root.id) {
          if (editor.tree.addParent() !== parentId) await cur.click(`tree-node:${parentId}`);
          await cur.click('add-object-btn');
        } else {
          await selectNode(cur, parentId);
          await cur.click(`tree-node:${parentId}`, `"${parent.node.name}" (right-click)`, { right: true });
          await cur.click('ctx-add-inside');
        }
        await cur.click(`node-type:${type}`);
        if (copyScene) await cur.choose('add-object-scene', copyScene.id, copyScene.name, 'Copy of');
        await cur.type('add-object-name', name, 'Name');
        await cur.click('add-object-create', 'Create');
        const id = store.ui.selectedId;
        const created = store.node(id);
        if (!created || created.name !== name) fail('Something went wrong creating the object.');
        await setPropsVisual(cur, id, props);
        return { object_id: id, name, type };
      },
    },
    {
      name: 'set_properties',
      description: 'Changes properties of an object through the Inspector, e.g. {"x": 120, "color": "#ff0000", "body": "solid"}. Pictures and scenes can be given by name.',
      input_schema: {
        type: 'object',
        properties: { object_id: { type: 'string' }, properties: { type: 'object' } },
        required: ['object_id', 'properties'],
      },
      title: (i) => `🔧 Changed ${Object.keys(i.properties || {}).join(', ')}`,
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const props = need(input, 'properties', 'object');
        if (!store.node(id)) fail(`No object with id "${id}".`);
        await setPropsVisual(cur, id, props);
        const n = store.node(id);
        return { object_id: id, properties: Object.fromEntries(Object.keys(props).map((k) => [k, n.props[k]])) };
      },
    },
    {
      name: 'rename_object',
      description: 'Renames an object (and its scene, if it is the top object of a scene).',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' }, new_name: { type: 'string' } }, required: ['object_id', 'new_name'] },
      title: (i) => `✏️ Renamed to "${i.new_name}"`,
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const name = need(input, 'new_name', 'string');
        await selectNode(cur, id);
        await cur.type('inspector-name', name, 'Name');
        if (store.node(id).name !== name) store.renameNode(id, name);
        return { object_id: id, name };
      },
    },
    {
      name: 'delete_object',
      description: 'Deletes an object and everything inside it. Only do this when the user wants it.',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' } }, required: ['object_id'] },
      title: () => '🗑 Deleted an object',
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const r = await selectNode(cur, id);
        if (!r.parent) fail('That is the top object of a scene and cannot be deleted.');
        await cur.click('delete-object-btn', 'Delete');
        await cur.click('delete-ok', 'Delete');
        await sleep(0);
        if (store.node(id)) store.deleteNode(id);
        return { deleted: id };
      },
    },
    {
      name: 'duplicate_object',
      description: 'Makes a copy of an object (with everything inside it), optionally renaming and moving the copy.',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' }, new_name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, required: ['object_id'] },
      title: (i) => `⧉ Duplicated${i.new_name ? ` as "${i.new_name}"` : ''}`,
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const r = await selectNode(cur, id);
        if (!r.parent) fail('The top object of a scene cannot be duplicated. Use a SceneCopy instead.');
        await cur.click('duplicate-object-btn', 'Duplicate');
        const copy = store.ui.selectedId;
        if (copy === id) fail('Duplicate failed.');
        if (input.new_name) await cur.type('inspector-name', input.new_name, 'Name');
        const props = {};
        if (typeof input.x === 'number') props.x = input.x;
        if (typeof input.y === 'number') props.y = input.y;
        await setPropsVisual(cur, copy, props);
        return { object_id: copy, name: store.node(copy).name };
      },
    },
    {
      name: 'move_object_into',
      description: 'Moves an object inside another object (in the same scene), like dragging it in the Objects list.',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' }, new_parent_id: { type: 'string' } }, required: ['object_id', 'new_parent_id'] },
      title: () => '↪ Moved an object into another',
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const parent = need(input, 'new_parent_id', 'string');
        const r = store.findNode(id);
        const p = store.findNode(parent);
        if (!r || !p) fail('Object not found.');
        await openScene(cur, r.scene.id);
        await cur.drag(`tree-node:${id}`, `tree-node:${parent}`, `Drag "${r.node.name}" onto "${p.node.name}"`);
        store.moveNode(id, parent);
        return { object_id: id, parent_id: parent };
      },
    },
    {
      name: 'create_scene',
      description: 'Creates a new scene. Use top_type "Group" for levels and menus, or "Sprite"/"Shape"/"Text" for a reusable thing (like a Coin, Enemy or Bullet) that you then place with SceneCopy objects or game.spawn(). root_properties sets the top object\'s properties.',
      input_schema: {
        type: 'object',
        properties: { name: { type: 'string' }, top_type: { type: 'string', enum: ['Group', 'Sprite', 'Shape', 'Text'] }, root_properties: { type: 'object' } },
        required: ['name'],
      },
      title: (i) => `🎬 Created scene "${i.name}"`,
      async run(input, { cur }) {
        const name = need(input, 'name', 'string');
        const type = input.top_type || 'Group';
        if (store.sceneByName(name)) fail(`There is already a scene called "${name}".`);
        const probe = { type, props: defaultProps(type) };
        for (const k of Object.keys(input.root_properties || {})) prepareValue(probe, k, input.root_properties[k]);
        await cur.click('add-scene-btn', '＋ New scene');
        await cur.type('new-scene-input', name, 'Scene name');
        if (type !== 'Group') await cur.choose('new-scene-type', type, NODE_TYPES[type].label, 'Top object');
        await cur.click('new-scene-ok', 'Create');
        const scene = store.sceneByName(name);
        if (!scene) fail('Creating the scene failed.');
        await setPropsVisual(cur, scene.root.id, input.root_properties || {});
        return { scene_id: scene.id, root_object_id: scene.root.id };
      },
    },
    {
      name: 'open_scene',
      description: 'Opens a scene in the editor so the user can see it.',
      input_schema: { type: 'object', properties: { scene_id: { type: 'string' } }, required: ['scene_id'] },
      title: (i) => `🎬 Opened scene "${store.project.scenes[i.scene_id]?.name || ''}"`,
      async run(input, { cur }) {
        await openScene(cur, need(input, 'scene_id', 'string'));
        return { open_scene: store.ui.sceneId };
      },
    },
    {
      name: 'set_start_scene',
      description: 'Makes the game start in this scene when Play is pressed.',
      input_schema: { type: 'object', properties: { scene_id: { type: 'string' } }, required: ['scene_id'] },
      title: () => '⭐ Set the start scene',
      async run(input, { cur }) {
        const id = need(input, 'scene_id', 'string');
        if (!store.project.scenes[id]) fail(`No scene "${id}".`);
        await cur.click(`scene-tab:${id}`, null, { right: true });
        await cur.click('ctx-start-scene');
        if (store.project.settings.startScene !== id) store.setSetting('startScene', id);
        return { start_scene: id };
      },
    },
    {
      name: 'write_script',
      description: 'Writes the whole script of an object (adds a script if it has none, otherwise replaces its code). Use beginner-friendly code with short comments. Returns whether the code has syntax errors.',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' }, code: { type: 'string' } }, required: ['object_id', 'code'] },
      title: (i) => `📜 Wrote a script (${lineCount(i.code || '')} lines)`,
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const code = need(input, 'code', 'string');
        if (sceneCopyOf(id)) fail('SceneCopy objects use the script of their original scene. Write the script on the top object of that scene instead.');
        const r = await selectNode(cur, id);
        if (!r.node.script) await cur.click('add-script-btn', '📜 Add script');
        else await cur.click('edit-script-btn', 'Edit script');
        const scriptId = store.node(id).script;
        editor.renderNow();
        await cur.goTo('code-editor', 'Writing code…');
        await editor.scriptEditor.animateWrite(code, { msPerLine: Math.round(55 * cur.k), check: () => cur.check() });
        editor.scriptEditor.pushNow(scriptId);
        if (store.project.scripts[scriptId].code !== code) store.setScriptCode(scriptId, code);
        cur.record({ kind: 'code', label: `typed ${lineCount(code)} lines of code` });
        cur.unhighlight();
        return { script_id: scriptId, ...syntaxReport(code) };
      },
    },
    {
      name: 'edit_script',
      description: 'Replaces one exact piece of a script with new code (old_text must appear exactly once - copy it from read_script without the line numbers). Better than write_script for small changes.',
      input_schema: { type: 'object', properties: { script_id: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' } }, required: ['script_id', 'old_text', 'new_text'] },
      title: () => '📝 Edited a script',
      async run(input, { cur }) {
        const id = need(input, 'script_id', 'string');
        const oldText = need(input, 'old_text', 'string');
        const newText = input.new_text ?? '';
        const s = store.project.scripts[id];
        if (!s) fail(`No script with id "${id}".`);
        const first = s.code.indexOf(oldText);
        if (first < 0) fail('old_text was not found in the script. Use read_script and copy the text exactly (without line numbers).');
        if (s.code.indexOf(oldText, first + 1) >= 0) fail('old_text appears more than once. Include more surrounding lines so it is unique.');
        await openScriptFor(cur, id);
        editor.renderNow();
        const se = editor.scriptEditor;
        const line = s.code.slice(0, first).split('\n').length;
        se.selectRange(first, first + oldText.length);
        await cur.goTo(se.lineRect(line), 'Changing this part');
        await cur.wait(500);
        await se.animateWrite(newText, { from: first, to: first + oldText.length, msPerLine: Math.round(55 * cur.k), check: () => cur.check() });
        se.pushNow(id);
        const expected = s.code.slice(0, first) + newText + s.code.slice(first + oldText.length);
        if (store.project.scripts[id].code !== expected) store.setScriptCode(id, expected);
        cur.record({ kind: 'code', label: `changed line ${line}` });
        cur.unhighlight();
        return { script_id: id, ...syntaxReport(expected) };
      },
    },
    {
      name: 'set_script_setting',
      description: 'Changes a script setting (a top-level `let name = value;` in the script) for one object only, using the Inspector. Works on SceneCopy objects too (each copy can have different settings).',
      input_schema: { type: 'object', properties: { object_id: { type: 'string' }, name: { type: 'string' }, value: { type: ['number', 'string', 'boolean'] } }, required: ['object_id', 'name', 'value'] },
      title: (i) => `🔧 Set ${i.name}`,
      async run(input, { cur }) {
        const id = need(input, 'object_id', 'string');
        const name = need(input, 'name', 'string');
        const n = store.node(id);
        const sid = n && (n.type === 'SceneCopy' ? store.project.scenes[n.props.scene]?.root.script : n.script);
        if (!sid) fail('That object has no script.');
        const setting = findScriptSettings(store.project.scripts[sid].code).find((x) => x.name === name);
        if (!setting) fail(`The script has no top-level setting "${name}".`);
        await selectNode(cur, id);
        if (setting.type === 'bool') await cur.setChecked(`var:${name}`, !!input.value, name);
        else await cur.type(`var:${name}`, String(input.value), name);
        let v = input.value;
        if (setting.type === 'number') v = Number(v);
        if (store.node(id).scriptVars?.[name] !== v) store.setScriptVar(id, name, v);
        return { object_id: id, [name]: v };
      },
    },
    {
      name: 'add_tile_type',
      description: 'Adds a kind of tile to a Tile Map (e.g. grass, spikes). solid = characters cannot pass; platform = one-way (stand on top, jump through from below). Returns its tile_index for paint_tiles.',
      input_schema: {
        type: 'object',
        properties: { tilemap_id: { type: 'string' }, name: { type: 'string' }, image: { type: 'string', description: 'Picture name (optional)' }, color: { type: 'string', description: 'Used when there is no picture, e.g. #8d6e63' }, solid: { type: 'boolean' }, platform: { type: 'boolean' } },
        required: ['tilemap_id', 'name'],
      },
      title: (i) => `🧱 Added tile type "${i.name}"`,
      async run(input, { cur }) {
        const id = need(input, 'tilemap_id', 'string');
        const n = store.node(id);
        if (!n || n.type !== 'TileMap') fail('tilemap_id must be a Tile Map object.');
        let image = null;
        if (input.image) {
          image = store.resolveAsset(input.image);
          if (!image || image.kind !== 'image') fail(`No picture called "${input.image}".`);
        }
        if (input.color) coerceProp('Shape', 'color', input.color);
        await selectNode(cur, id);
        await cur.click('add-tile-btn', '＋ Add tile type');
        const idx = store.node(id).props.tiles.length - 1;
        await cur.type(`tile:${idx}:name`, input.name, 'Tile name');
        if (image) await cur.choose(`tile:${idx}:image`, image.id, image.name, 'Tile picture');
        if (input.color) await cur.setColor(`tile:${idx}:color`, input.color, 'Tile colour');
        const wantSolid = input.platform ? false : input.solid !== false;
        if (input.platform) await cur.setChecked(`tile:${idx}:platform`, true, 'Platform');
        else if (!wantSolid) await cur.setChecked(`tile:${idx}:solid`, false, 'Solid');
        const t = store.node(id).props.tiles[idx];
        const fix = {};
        if (t.name !== input.name) fix.name = input.name;
        if (image && t.image !== image.id) fix.image = image.id;
        if (input.color && t.color !== coerceProp('Shape', 'color', input.color)) fix.color = input.color;
        if (!!t.platform !== !!input.platform) fix.platform = !!input.platform;
        if (!input.platform && t.solid !== wantSolid) fix.solid = wantSolid;
        if (Object.keys(fix).length) store.updateTileType(id, idx, fix);
        return { tilemap_id: id, tile_index: idx };
      },
    },
    {
      name: 'paint_tiles',
      description: 'Paints (or erases) tiles on a Tile Map using the Paint tool. Cells are grid coordinates: cell [x, y] covers pixels from (mapX + x*tileSize, mapY + y*tileSize). Give single cells and/or rectangles. With a 960x540 screen and 32px tiles, the visible area is cells x 0..29, y 0..16.',
      input_schema: {
        type: 'object',
        properties: {
          tilemap_id: { type: 'string' },
          tile_index: { type: 'integer', description: 'Which tile type to paint (from add_tile_type / the overview).' },
          cells: { type: 'array', items: { type: 'array', items: { type: 'integer' } }, description: 'List of [x, y] cells.' },
          rects: { type: 'array', items: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, width: { type: 'integer' }, height: { type: 'integer' } } }, description: 'Filled rectangles of cells.' },
          erase: { type: 'boolean', description: 'true to erase instead of paint.' },
        },
        required: ['tilemap_id'],
      },
      title: (i) => (i.erase ? '🧽 Erased tiles' : '🖌 Painted tiles'),
      async run(input, { cur }) {
        const id = need(input, 'tilemap_id', 'string');
        const n = store.node(id);
        if (!n || n.type !== 'TileMap') fail('tilemap_id must be a Tile Map object.');
        const erase = !!input.erase;
        const idx = input.tile_index;
        if (!erase && (typeof idx !== 'number' || !n.props.tiles[idx])) fail(`tile_index must be one of 0..${n.props.tiles.length - 1}. Use add_tile_type first if there are none.`);
        const set = new Map();
        for (const c of input.cells || []) {
          if (!Array.isArray(c) || c.length !== 2) fail('Each cell must be [x, y].');
          set.set(`${c[0]},${c[1]}`, [Math.round(c[0]), Math.round(c[1])]);
        }
        for (const r of input.rects || []) {
          const w = Math.max(1, Math.round(r.width || 1));
          const hh = Math.max(1, Math.round(r.height || 1));
          if (w * hh > 5000) fail('That rectangle is too big (over 5000 cells).');
          for (let y = r.y; y < r.y + hh; y++) for (let x = r.x; x < r.x + w; x++) set.set(`${x},${y}`, [x, y]);
        }
        const cells = [...set.values()];
        if (!cells.length) fail('Give some cells or rects to paint.');
        if (cells.length > 6000) fail('Too many cells in one go (max 6000).');
        // Paint in reading order, snaking back and forth like a person would.
        cells.sort((a, b) => a[1] - b[1] || (a[1] % 2 ? b[0] - a[0] : a[0] - b[0]));
        await selectNode(cur, id);
        if (store.ui.centerTab !== 'scene') await cur.click('center-tab:scene', 'Scene tab');
        await cur.click(erase ? 'tool:erase' : 'tool:paint');
        if (!erase) await cur.click(`tile-brush:${idx}`);
        const vp = editor.viewport;
        const tm = () => store.node(id);
        let first = true;
        await cur.sweep(cells, ([x, y]) => {
          const c = vp.cellCenter(tm(), x, y);
          vp.ensureVisible(c.x, c.y, 60);
          store.paintTiles(id, [[x, y]], erase ? null : idx, { merge: !first });
          first = false;
          return vp.worldToClient(c.x, c.y);
        }, { totalMs: Math.min(4000, 300 + cells.length * 40), label: erase ? 'Erasing tiles' : 'Painting tiles' });
        vp.setTool('select');
        cur.record({ kind: 'paint', label: `${erase ? 'erased' : 'painted'} ${cells.length} tile${cells.length > 1 ? 's' : ''}` });
        return { tilemap_id: id, [erase ? 'erased' : 'painted']: cells.length };
      },
    },
    {
      name: 'draw_pixel_art',
      description: 'Draws a new picture in the Pixel Art editor and saves it to Assets. Give a palette mapping single characters to colours ("." is always transparent) and one or more frames (for animation), each frame a list of equal-length text rows. 16x16 is a good size; outline shapes with a dark colour so they read well.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          palette: { type: 'object', description: 'e.g. {"o": "#1b1b1b", "y": "#ffd21f"}' },
          frames: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Frames, each a list of rows like "..oooo..".' },
          fps: { type: 'number', description: 'Animation speed in frames per second (default 8).' },
        },
        required: ['name', 'palette', 'frames'],
      },
      title: (i) => `🎨 Drew a picture "${i.name}"`,
      async run(input, { cur }) {
        const name = need(input, 'name', 'string').trim().replace(/\s+/g, '_');
        const palette = need(input, 'palette', 'object');
        const frames = need(input, 'frames', 'array');
        if (!frames.length || frames.length > 12) fail('Give between 1 and 12 frames.');
        const colors = { '.': null, ' ': null };
        for (const [k, v] of Object.entries(palette)) {
          if (k.length !== 1) fail(`Palette keys must be single characters (got "${k}").`);
          if (v === null || v === 'transparent') { colors[k] = null; continue; }
          colors[k] = coerceProp('Shape', 'color', v);
        }
        const hgt = frames[0].length;
        const w = Math.max(...frames[0].map((r) => r.length));
        if (!hgt || !w || w > 64 || hgt > 64) fail('Pictures must be between 1x1 and 64x64.');
        const data = frames.map((rows, fi) => {
          if (!Array.isArray(rows) || rows.length !== hgt) fail(`Frame ${fi + 1} must have ${hgt} rows like the first frame.`);
          const d = new Uint8ClampedArray(w * hgt * 4);
          rows.forEach((row, y) => {
            [...row.padEnd(w, '.')].forEach((ch, x) => {
              if (!(ch in colors)) fail(`The character "${ch}" (frame ${fi + 1}, row ${y + 1}) has no colour in the palette.`);
              const c = colors[ch];
              if (!c) return;
              const n = parseInt(c.slice(1, 7), 16);
              const i = (y * w + x) * 4;
              d[i] = (n >> 16) & 255; d[i + 1] = (n >> 8) & 255; d[i + 2] = n & 255; d[i + 3] = 255;
            });
          });
          return d;
        });
        await cur.click('new-pixel-btn', '🎨 Draw');
        editor.renderNow();
        const finalName = store.uniqueAssetName(name);
        await cur.type('pixel-name', finalName, 'Picture name');
        const pe = editor.pixelEditor;
        pe.loadPixels(w, hgt, data.map(() => new Uint8ClampedArray(w * hgt * 4)), finalName, input.fps || 8);
        for (let f = 0; f < data.length; f++) {
          pe.frame = f;
          pe.renderFrames();
          const rows = [...Array(hgt).keys()];
          await cur.sweep(rows, (y) => {
            pe.frames[f].set(data[f].subarray(y * w * 4, (y + 1) * w * 4), y * w * 4);
            pe.draw();
            return pe.pixelClientPos(Math.floor(w / 2), y);
          }, { totalMs: 900, label: data.length > 1 ? `Drawing frame ${f + 1}` : 'Drawing' });
        }
        pe.frame = 0;
        pe.renderFrames();
        pe.draw();
        await cur.click('pixel-save', 'Save picture');
        const asset = store.assetByName(finalName);
        if (!asset) fail('Saving the picture failed.');
        cur.record({ kind: 'paint', label: `drew a ${w}x${hgt} picture${data.length > 1 ? ` with ${data.length} frames` : ''}` });
        return { asset_id: asset.id, name: asset.name, width: w, height: hgt, frames: data.length };
      },
    },
    {
      name: 'change_project_settings',
      description: `Changes project settings in the Settings window. Keys: name, ${Object.keys(DEFAULT_SETTINGS).join(', ')}. startScene accepts a scene name or id.`,
      input_schema: { type: 'object', properties: { settings: { type: 'object' } }, required: ['settings'] },
      title: (i) => `⚙️ Changed settings: ${Object.keys(i.settings || {}).join(', ')}`,
      async run(input, { cur }) {
        const settings = need(input, 'settings', 'object');
        for (const k of Object.keys(settings)) if (k !== 'name' && !(k in DEFAULT_SETTINGS)) fail(`Unknown setting "${k}".`);
        await cur.click('settings-btn', '⚙️ Settings');
        for (const [k, v] of Object.entries(settings)) {
          const target = `setting:${k}`;
          if (k === 'name') { await cur.type(target, String(v), 'Project name'); continue; }
          if (k === 'pixelArt') await cur.setChecked(target, !!v, 'Crisp pixel art');
          else if (k === 'background') await cur.setColor(target, coerceProp('Shape', 'color', v), 'Background colour');
          else if (k === 'touchControls' || k === 'touchLayout') await cur.choose(target, v, null, k);
          else if (k === 'startScene') {
            const s = store.resolveScene(v);
            if (!s) fail(`No scene called "${v}".`);
            await cur.choose(target, s.id, s.name, 'Start scene');
          } else await cur.type(target, String(v), k);
        }
        await cur.click('dialog-close', 'Close');
        // Make sure every value landed (e.g. if a field rejected it).
        for (const [k, v] of Object.entries(settings)) {
          if (k === 'name') { if (store.project.name !== v) store.setProjectName(v); continue; }
          const cur2 = store.project.settings[k];
          if (k === 'startScene') { const s = store.resolveScene(v); if (cur2 !== s.id) store.setSetting(k, s.id); continue; }
          if (String(cur2) !== String(k === 'background' ? coerceProp('Shape', 'color', v) : v)) store.setSetting(k, v);
        }
        return { settings: { ...store.project.settings, name: store.project.name } };
      },
    },
    {
      name: 'set_input_action',
      description: 'Sets which keyboard keys trigger an input action (creates the action if new). Keys are KeyboardEvent codes like "KeyA", "ArrowLeft", "Space", "Digit1".',
      input_schema: { type: 'object', properties: { action: { type: 'string' }, keys: { type: 'array', items: { type: 'string' } } }, required: ['action', 'keys'] },
      title: (i) => `🕹️ Set keys for "${i.action}"`,
      async run(input, { cur }) {
        const action = need(input, 'action', 'string');
        const keys = need(input, 'keys', 'array');
        for (const k of keys) if (!KEY_CODE.test(k)) fail(`"${k}" is not a key code. Use codes like KeyA, ArrowLeft, Space, Digit1, Enter.`);
        await cur.click('settings-btn', '⚙️ Settings');
        await cur.click('settings-tab:controls', 'Controls');
        store.setInputAction(action, keys);
        await cur.click('settings-tab:controls', 'Controls', { record: false });
        await cur.point(`action:${action}`, `"${action}" = ${keys.join(', ')}`, 900);
        await cur.click('dialog-close', 'Close');
        return { action, keys };
      },
    },
    {
      name: 'play_game',
      description: 'Plays the game for a few seconds to test it, optionally holding input actions at given times, then stops. Returns errors, log() output, where objects ended up, and optionally a screenshot. Use it after building or changing gameplay.',
      input_schema: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'How long to play, 1-15 (default 3).' },
          scene_id: { type: 'string', description: 'Scene to play (default: the start scene).' },
          inputs: { type: 'array', items: { type: 'object', properties: { action: { type: 'string' }, start: { type: 'number' }, duration: { type: 'number' } } }, description: 'Hold actions, e.g. [{"action": "right", "start": 0.5, "duration": 1}, {"action": "jump", "start": 1, "duration": 0.2}]' },
          screenshot: { type: 'boolean', description: 'Include a picture of the game at the end.' },
        },
      },
      title: (i) => `▶ Played the game for ${Math.min(15, Math.max(1, i.seconds || 3))}s to test it`,
      async run(input, { cur }) {
        const seconds = Math.min(15, Math.max(1, Number(input.seconds) || 3));
        const inputs = input.inputs || [];
        for (const a of inputs) if (!store.project.input[a.action]) fail(`No input action "${a.action}". Actions: ${Object.keys(store.project.input).join(', ')}.`);
        if (input.scene_id) {
          if (!store.project.scenes[input.scene_id]) fail(`No scene "${input.scene_id}".`);
          await cur.click(`scene-tab:${input.scene_id}`, null, { right: true });
          await cur.click('ctx-play-scene', '▶ Play this scene');
        } else {
          await cur.click('play-btn', '▶ Play');
        }
        const t0 = Date.now();
        while (!(editor.playView.game && editor.playView.game.running) && Date.now() - t0 < 6000) await sleep(50);
        const game = editor.playView.game;
        if (!game) {
          await cur.click('stop-btn', '■ Stop');
          return { started: false, errors: editor.output.errors(), log: editor.output.recentText() };
        }
        cur.say(inputs.length ? 'Testing the controls…' : 'Watching the game…');
        const start = performance.now();
        while ((performance.now() - start) / 1000 < seconds) {
          cur.check();
          const t = (performance.now() - start) / 1000;
          for (const a of inputs) {
            const on = t >= (a.start || 0) && t < (a.start || 0) + (a.duration ?? 0.2);
            if (on) game.input.virtual.add(a.action); else game.input.virtual.delete(a.action);
          }
          if (game.errorPaused) break;
          await sleep(30);
        }
        game.input.virtual.clear();
        let shot = null;
        if (input.screenshot) shot = screenshotOf(editor.playView.stage);
        const objects = [];
        game.walk(game.root, (o) => {
          if (objects.length >= 30 || o._destroyed || o === game.root) return;
          if (o.type === 'TileMap' || o.type === 'Camera') return;
          if (o._hooks || o.body === 'character') objects.push(`${o.name}: x=${Math.round(o.worldX)} y=${Math.round(o.worldY)}${o.body === 'character' ? ` onFloor=${o._floor}` : ''}`);
        });
        const result = {
          played_seconds: Math.round(((performance.now() - start) / 1000) * 10) / 10,
          scene: game.currentScene ? game.currentScene.name : null,
          stopped_by_error: !!game.errorPaused,
          errors: editor.output.errors(),
          log: editor.output.recentText(30),
          objects_at_end: objects,
          game_vars: JSON.parse(JSON.stringify(game.vars, (k, v) => (v && typeof v === 'object' && v._game ? undefined : v))),
        };
        await cur.click('stop-btn', '■ Stop');
        if (shot) return { content: [{ type: 'text', text: JSON.stringify(result) }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot } }] };
        return result;
      },
    },
    {
      name: 'point_at',
      description: 'Teaching tool: moves your cursor to part of the editor and shows a short message there, without changing anything. Use it when the user asks where something is or how to do something themselves. Targets: add-object-button, new-scene-button, scene-list, object-list, inspector, assets, draw-button, import-button, output, play-button, stop-button, settings-button, help-button, undo-button, scene-view, select-tool, paint-tool, erase-tool, code-editor, ai-helper, object:<object_id> (row in the Objects list), in-scene:<object_id> (the object in the Scene view), property:<name> (a field in the Inspector for the selected object).',
      input_schema: { type: 'object', properties: { target: { type: 'string' }, message: { type: 'string' } }, required: ['target', 'message'] },
      title: (i) => `👉 Showed: ${i.message.slice(0, 50)}`,
      async run(input, { cur }) {
        const target = need(input, 'target', 'string');
        const message = need(input, 'message', 'string');
        const map = {
          'add-object-button': 'add-object-btn', 'new-scene-button': 'add-scene-btn', 'scene-list': 'scene-list', 'object-list': 'object-tree',
          assets: 'asset-grid', 'draw-button': 'new-pixel-btn', 'import-button': 'import-asset-btn', output: 'output-list',
          'play-button': 'play-btn', 'stop-button': 'stop-btn', 'settings-button': 'settings-btn', 'help-button': 'help-btn', 'undo-button': 'undo-btn',
          'scene-view': 'scene-canvas', 'select-tool': 'tool:select', 'paint-tool': 'tool:paint', 'erase-tool': 'tool:erase', 'code-editor': 'code-editor',
        };
        let t;
        if (map[target]) t = map[target];
        else if (target === 'inspector') t = document.querySelector('[data-panel="inspector"]');
        else if (target === 'ai-helper') t = document.querySelector('[data-panel="ai"]');
        else if (target.startsWith('object:')) { const r = store.findNode(target.slice(7)); if (!r) fail('No such object.'); await openScene(cur, r.scene.id); t = `tree-node:${r.node.id}`; }
        else if (target.startsWith('in-scene:')) {
          const id = target.slice(9);
          const r = store.findNode(id);
          if (!r) fail('No such object.');
          await openScene(cur, r.scene.id);
          editor.viewport.focusNode(id);
          editor.renderNow();
          t = editor.viewport.clientRectOfNode(id);
          if (!t) fail('That object is not visible in the Scene view.');
        } else if (target.startsWith('property:')) t = `prop:${target.slice(9)}`;
        else fail(`Unknown target "${target}".`);
        await cur.point(t, message);
        return { shown: target };
      },
    },
  ];
  return tools;
}

function screenshotOf(stage) {
  const c = stage.querySelector('canvas');
  if (!c) return null;
  const scale = Math.min(1, 800 / c.width);
  const out = document.createElement('canvas');
  out.width = Math.round(c.width * scale);
  out.height = Math.round(c.height * scale);
  out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
  try { return out.toDataURL('image/jpeg', 0.7).split(',')[1]; } catch (_) { return null; }
}

// Tool definitions in the format the Claude API expects.
export function toolSchemas(tools) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
}
