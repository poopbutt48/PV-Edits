// Code editor for scripts (CodeMirror), with Sprout-aware autocomplete,
// syntax checking and error highlighting.
import { EditorView, basicSetup } from 'codemirror';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';
import { h, clear } from '../dom.js';
import { API_GROUPS, SCRIPT_EVENTS } from '../../runtime/apiDocs.js';
import { SCRIPT_GLOBALS } from '../../runtime/scripting.js';
import { walkNodes } from '../store.js';
import { openHelpDialog } from './help.js';

// ------------------------------------------------------------ autocomplete

function buildCompletions() {
  const members = {};
  for (const g of API_GROUPS) {
    for (const [names, doc] of g.items) {
      for (let n of names.split(/,\s*|\s\/\s/)) {
        n = n.trim();
        const m = /^(me|game|input)\.([\w.]+)(\(.*\))?/.exec(n);
        if (!m) continue;
        const list = members[m[1]] || (members[m[1]] = []);
        const label = m[2];
        if (!list.some((o) => o.label === label)) list.push({ label, type: m[3] ? 'method' : 'property', info: doc, apply: m[3] ? `${label}()` : label });
      }
    }
  }
  const globals = SCRIPT_GLOBALS.map((g) => {
    const item = API_GROUPS.flatMap((x) => x.items).find(([n]) => n.startsWith(g + '(') || n.startsWith(g + ' ') || n === g || n.startsWith(g + '.'));
    return { label: g, type: ['me', 'game', 'input'].includes(g) ? 'variable' : 'function', info: item ? item[1] : '' };
  });
  for (const e of SCRIPT_EVENTS) {
    const name = e.name.replace(/\(.*/, '');
    globals.push({ label: `function ${name}`, type: 'keyword', info: e.doc, apply: `function ${e.name} {\n  \n}` });
  }
  return { members, globals };
}

const COMPLETIONS = buildCompletions();

function sproutCompletions(context) {
  const member = context.matchBefore(/\b(me|game|input)\.[\w]*$/);
  if (member) {
    const dot = member.text.indexOf('.');
    const obj = member.text.slice(0, dot);
    return { from: member.from + dot + 1, options: COMPLETIONS.members[obj] || [], validFor: /^\w*$/ };
  }
  const word = context.matchBefore(/\w+$/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return { from: word.from, options: COMPLETIONS.globals, validFor: /^\w*$/ };
}

// ------------------------------------------------------------ error line highlight

const setErrorLine = StateEffect.define();
const errorLineField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (!e.value) deco = Decoration.none;
        else {
          const line = tr.state.doc.line(Math.min(Math.max(1, e.value), tr.state.doc.lines));
          deco = Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(line.from)]);
        }
      }
    }
    if (tr.docChanged) deco = Decoration.none;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function findSyntaxError(state) {
  const tree = ensureSyntaxTree(state, state.doc.length, 200) || syntaxTree(state);
  let pos = null;
  tree.iterate({ enter: (n) => { if (pos === null && n.type.isError) { pos = n.from; return false; } return pos === null; } });
  if (pos === null) return null;
  const line = state.doc.lineAt(pos);
  return { line: line.number, text: line.text.trim() };
}

// ------------------------------------------------------------ panel

export class ScriptEditorPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.store = editor.store;
    this.el = el;
    this.scriptId = null;
    this.states = new Map();
    this.applying = false;
    this.pushTimer = 0;
    this.title = h('span', { class: 'se-title' });
    this.users = h('span', { class: 'se-users muted' });
    this.status = h('div', { class: 'se-status', 'data-ai': 'script-status' });
    this.host = h('div', { class: 'se-host', 'data-ai': 'code-editor', 'data-ai-label': 'the code editor' });
    el.append(
      h('div', { class: 'se-toolbar' }, this.title, this.users, h('span', { class: 'flex' }),
        h('button', { class: 'btn btn-small', onclick: () => openHelpDialog(this.editor) }, '❔ Script help'),
        h('button', { class: 'btn btn-small btn-primary', onclick: () => this.editor.play() }, '▶ Play')),
      this.host,
      this.status,
    );
    this.view = new EditorView({ parent: this.host, state: this.makeState('') });
  }

  makeState(code) {
    return EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        javascript(),
        javascriptLanguage.data.of({ autocomplete: sproutCompletions }),
        oneDark,
        errorLineField,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => { if (u.docChanged && !this.applying) this.onUserEdit(); }),
        EditorView.theme({ '&': { height: '100%', fontSize: '14px' }, '.cm-scroller': { fontFamily: '"Cascadia Code", Consolas, "Courier New", monospace' } }),
      ],
    });
  }

  onUserEdit() {
    clearTimeout(this.pushTimer);
    const id = this.scriptId;
    this.pushTimer = setTimeout(() => this.pushNow(id), 300);
    this.updateStatus();
  }

  pushNow(id = this.scriptId) {
    clearTimeout(this.pushTimer);
    if (!id || id !== this.scriptId) return;
    const code = this.view.state.doc.toString();
    const s = this.store.project.scripts[id];
    if (s && s.code !== code) this.store.setScriptCode(id, code, { merge: true });
  }

  render() {
    const tab = this.store.ui.centerTab || '';
    if (!tab.startsWith('script:')) return;
    const id = tab.slice(7);
    const script = this.store.project.scripts[id];
    if (!script) return;
    if (id !== this.scriptId) {
      if (this.scriptId) { this.pushNow(this.scriptId); this.states.set(this.scriptId, this.view.state); }
      this.scriptId = id;
      const saved = this.states.get(id);
      this.applying = true;
      this.view.setState(saved && saved.doc.toString() === script.code ? saved : this.makeState(script.code));
      this.applying = false;
    } else if (this.view.state.doc.toString() !== script.code && !this.view.hasFocus) {
      this.setDoc(script.code);
    }
    this.title.textContent = `📜 ${script.name}`;
    const users = [];
    for (const scene of this.store.scenes) walkNodes(scene.root, (n) => { if (n.script === id) users.push(`${n.name}${scene.root === n ? '' : ` (${scene.name})`}`); });
    this.users.textContent = users.length ? `used by ${users.slice(0, 3).join(', ')}${users.length > 3 ? '…' : ''}` : 'not attached to any object';
    this.updateStatus();
  }

  setDoc(code) {
    this.applying = true;
    const sel = this.view.state.selection.main.head;
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: code }, selection: { anchor: Math.min(sel, code.length) } });
    this.applying = false;
  }

  updateStatus() {
    const err = findSyntaxError(this.view.state);
    clear(this.status);
    if (err) {
      this.status.className = 'se-status bad';
      this.status.append(`⚠ Something looks wrong on line ${err.line}: `, h('code', null, err.text.slice(0, 60)),
        h('button', { class: 'btn btn-small', onclick: () => this.goToLine(err.line) }, 'Go there'),
        h('button', { class: 'btn btn-small btn-ai', onclick: () => this.editor.ai.askToFix({ script: this.store.project.scripts[this.scriptId]?.name, scriptId: this.scriptId, line: err.line, message: 'Syntax error (a typo, or a missing bracket, comma or quote).', objectName: '' }) }, '🤖 Fix with AI'));
    } else {
      this.status.className = 'se-status ok';
      this.status.textContent = '✓ No typos found. Changes save automatically.';
    }
  }

  goToLine(line, highlight = true) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.min(Math.max(1, line || 1), doc.lines));
    this.view.dispatch({ selection: { anchor: l.from }, effects: [EditorView.scrollIntoView(l.from, { y: 'center' }), setErrorLine.of(highlight ? l.number : null)] });
    this.view.focus();
  }

  // ------------------------------------------------------------ used by the AI's cursor

  // Clientside rectangle of a line (so the AI cursor can point at it).
  lineRect(line) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.min(Math.max(1, line), doc.lines));
    const c = this.view.coordsAtPos(l.from);
    const r = this.host.getBoundingClientRect();
    if (!c) return { left: r.left + 40, top: r.top + 10, width: r.width - 60, height: 20 };
    return { left: c.left, top: c.top, width: Math.max(40, r.right - c.left - 20), height: c.bottom - c.top };
  }

  // Types code in a line at a time so you can watch it being written.
  async animateWrite(code, { msPerLine = 60, from = 0, to = null, check = null } = {}) {
    const start = from;
    const end = to === null ? this.view.state.doc.length : to;
    const lines = code.split('\n');
    this.applying = true;
    try {
      this.view.dispatch({ changes: { from: start, to: end, insert: '' } });
      let pos = start;
      for (let i = 0; i < lines.length; i++) {
        if (check) check();
        const text = (i ? '\n' : '') + lines[i];
        this.view.dispatch({ changes: { from: pos, insert: text }, selection: { anchor: pos + text.length }, effects: EditorView.scrollIntoView(pos + text.length, { y: 'nearest' }) });
        pos += text.length;
        if (msPerLine > 0) await new Promise((r) => setTimeout(r, msPerLine));
      }
    } finally {
      this.applying = false;
    }
  }

  // Highlights a range (used before the AI replaces some code).
  selectRange(from, to) {
    this.view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) });
  }
}
