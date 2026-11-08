// Rewind and replay what the AI did, step by step.
//
// Replaying restores the project to how it was before a step and runs the
// same step again with the visible cursor. When you leave replay, your
// project goes back to exactly how it was before you started watching.

import { h, clear, toast } from '../editor/dom.js';
import { CancelledError } from './cursor.js';
import { closeStrayDialogs } from './agent.js';

export class ReplayController {
  constructor(editor, { tools, cursor, setBusy }) {
    this.editor = editor;
    this.store = editor.store;
    this.tools = tools;
    this.cursor = cursor;
    this.setBusy = setBusy;
    this.turn = null;
    this.index = 0;
    this.playing = false;
    this.bar = h('div', { class: 'replay-bar', hidden: true, role: 'region', 'aria-label': 'Replay of the AI helper' });
    document.body.appendChild(this.bar);
  }

  get active() { return !!this.turn; }

  async open(turn) {
    if (this.turn || !turn.steps.length) return;
    this.saved = { snap: this.store.snapshot(), history: this.store.history.slice(), future: this.store.future.slice() };
    this.turn = turn;
    this.index = 0;
    this.setBusy(true, 'replay');
    this.bar.hidden = false;
    this.store.restore(turn.steps[0].before);
    this.editor.renderNow();
    this.render();
    await this.play();
  }

  async play() {
    if (!this.turn || this.playing) return;
    if (this.index >= this.turn.steps.length) await this.jumpTo(0);
    this.playing = true;
    this.render();
    try {
      while (this.playing && this.turn && this.index < this.turn.steps.length) {
        this.inflight = this.runStep(this.index);
        await this.inflight;
        if (!this.playing) break;
        this.index++;
        this.render();
      }
    } catch (err) {
      if (!(err instanceof CancelledError)) toast(`Replay problem: ${err.message}`, 'warn');
    }
    this.playing = false;
    this.cursor.hide();
    this.render();
  }

  async runStep(i) {
    const step = this.turn.steps[i];
    const tool = this.tools.find((t) => t.name === step.tool);
    this.store.restore(step.before);
    this.editor.renderNow();
    this.cursor.cancelled = false;
    this.cursor.recording = null;
    this.store.idQueue = (step.ids || []).slice();
    this.current = i;
    this.render();
    try {
      if (tool && !step.error) await tool.run(step.input, { cur: this.cursor, editor: this.editor, store: this.store, replay: true });
      else if (step.error) toast(`This step failed when the AI did it: ${step.error}`, 'warn', 4000);
    } catch (err) {
      if (err instanceof CancelledError) { closeStrayDialogs(); throw err; }
      closeStrayDialogs();
    } finally {
      this.store.idQueue = null;
    }
    // Make sure the result is exactly what the AI produced.
    if (this.store.snapshot().json !== step.after.json) this.store.restore(step.after);
    this.cursor.unhighlight();
    await new Promise((r) => setTimeout(r, 350));
  }

  async pause() {
    if (!this.playing) return;
    this.playing = false;
    this.cursor.cancelled = true;
    if (this.inflight) { try { await this.inflight; } catch (_) { /* stopped */ } }
    // The interrupted step is shown from its start again.
    if (this.turn && this.turn.steps[this.index]) this.store.restore(this.turn.steps[this.index].before);
    this.render();
  }

  async jumpTo(i) {
    await this.pause();
    if (!this.turn) return;
    this.index = Math.max(0, Math.min(i, this.turn.steps.length));
    const step = this.turn.steps[this.index];
    this.store.restore(step ? step.before : this.turn.steps[this.turn.steps.length - 1].after);
    this.cursor.hide();
    this.render();
  }

  async stepForward() {
    if (!this.turn || this.index >= this.turn.steps.length) return;
    await this.pause();
    this.playing = true;
    this.render();
    try {
      this.inflight = this.runStep(this.index);
      await this.inflight;
      this.index++;
    } catch (err) {
      if (!(err instanceof CancelledError)) toast(err.message, 'warn');
    }
    this.playing = false;
    this.cursor.hide();
    this.render();
  }

  stepBack() {
    this.jumpTo(this.index - 1);
  }

  async close() {
    if (!this.turn) return;
    this.playing = false;
    this.cursor.cancelled = true;
    if (this.inflight) { try { await this.inflight; } catch (_) { /* stopped */ } }
    this.cursor.hide();
    closeStrayDialogs();
    this.store.restore(this.saved.snap);
    this.store.history = this.saved.history;
    this.store.future = this.saved.future;
    this.store.emit('change', { label: 'end replay' });
    this.turn = null;
    this.bar.hidden = true;
    this.setBusy(false);
  }

  render() {
    clear(this.bar);
    if (!this.turn) return;
    const steps = this.turn.steps;
    const shown = Math.min(this.index, steps.length - 1);
    const label = this.index >= steps.length ? 'Finished - this is what the AI made.' : `Step ${this.index + 1} of ${steps.length}: ${steps[shown].title}`;
    const btn = (text, title, fn, ai, extra = {}) => h('button', { class: 'replay-btn', title, 'aria-label': title, 'data-replay': ai, onclick: fn, ...extra }, text);
    this.bar.append(
      h('div', { class: 'replay-top' },
        h('span', { class: 'replay-title' }, `⏪ Replay: “${this.turn.request.length > 50 ? this.turn.request.slice(0, 48) + '…' : this.turn.request}”`),
        h('span', { class: 'replay-note muted small' }, 'Your project comes back exactly as it was when you close this.')),
      h('div', { class: 'replay-controls' },
        btn('⏮', 'Back to the start', () => this.jumpTo(0), 'start'),
        btn('◀', 'Previous step', () => this.stepBack(), 'back', { disabled: this.index === 0 }),
        this.playing ? btn('⏸', 'Pause', () => this.pause(), 'pause') : btn('▶', 'Play from here', () => this.play(), 'play'),
        btn('▶|', 'Next step', () => this.stepForward(), 'next', { disabled: this.index >= steps.length || this.playing }),
        h('span', { class: 'replay-label' }, label),
        btn('✕ Close', 'Close the replay', () => this.close(), 'close', { class: 'replay-btn replay-close' })),
      h('div', { class: 'replay-steps' }, steps.map((s, i) => h('button', {
        class: `replay-dot ${i < this.index ? 'done' : ''} ${i === this.index ? 'current' : ''}`,
        title: `${i + 1}. ${s.title}`, 'aria-label': `Go to step ${i + 1}: ${s.title}`,
        onclick: () => this.jumpTo(i),
      }, String(i + 1)))),
    );
  }
}
