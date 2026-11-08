// Bottom panel: messages from the game (log/print) and errors.
import { h, clear } from '../dom.js';

export class OutputPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.lines = [];
    this.list = h('div', { class: 'output-list', role: 'log', 'aria-live': 'polite', 'data-ai': 'output-list' });
    this.count = h('span', { class: 'output-count' });
    el.append(
      h('div', { class: 'panel-header' },
        h('h3', { title: 'Messages from log() / print() and any errors' }, 'Output ', this.count),
        h('button', { class: 'btn btn-small', onclick: () => { this.clear(); } }, 'Clear')),
      this.list,
    );
    this.dirty = true;
  }

  clear() {
    this.lines = [];
    this.dirty = true;
    this.render();
  }

  log(text, object) {
    this.lines.push({ kind: 'log', text, object, time: Date.now() });
    if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
    this.dirty = true;
    this.render();
  }

  error(info) {
    this.lines.push({ kind: 'error', info, time: Date.now() });
    this.dirty = true;
    this.render();
  }

  info(text) {
    this.lines.push({ kind: 'info', text, time: Date.now() });
    this.dirty = true;
    this.render();
  }

  // Plain text of recent output (given to the AI helper).
  recentText(n = 40) {
    return this.lines.slice(-n).map((l) => {
      if (l.kind === 'error') return `ERROR in ${l.info.script}${l.info.line ? ` line ${l.info.line}` : ''} (object "${l.info.objectName}"): ${l.info.message}`;
      return `${l.object ? `[${l.object}] ` : ''}${l.text}`;
    }).join('\n');
  }

  errors() {
    return this.lines.filter((l) => l.kind === 'error').map((l) => l.info);
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    clear(this.list);
    const errs = this.lines.filter((l) => l.kind === 'error').length;
    this.count.textContent = errs ? `(${errs} error${errs > 1 ? 's' : ''})` : '';
    if (!this.lines.length) {
      this.list.appendChild(h('p', { class: 'empty-hint' }, 'Press ▶ Play. Anything your scripts log() shows up here.'));
      return;
    }
    for (const l of this.lines) {
      if (l.kind === 'error') {
        const i = l.info;
        this.list.appendChild(h('div', { class: 'out-line out-error' },
          h('span', null, `⚠ ${i.message}`),
          h('span', { class: 'out-where' }, ` - ${i.script}${i.line ? `, line ${i.line}` : ''}, on "${i.objectName}"`),
          i.scriptId ? h('button', { class: 'btn btn-small', onclick: () => this.editor.openScript(i.scriptId, i.line) }, 'Show me') : null,
          h('button', { class: 'btn btn-small btn-ai', 'data-ai': 'fix-with-ai', onclick: () => this.editor.ai.askToFix(i) }, '🤖 Fix with AI')));
      } else {
        this.list.appendChild(h('div', { class: `out-line out-${l.kind}` }, l.object ? h('span', { class: 'out-obj' }, `[${l.object}] `) : null, l.text));
      }
    }
    this.list.scrollTop = this.list.scrollHeight;
  }
}
