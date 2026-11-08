// The AI helper panel: chat, live progress, the "what I pressed" summary
// with rewind/replay, and the helper's settings.
import { h, clear, toast, miniMarkdown, confirmDialog, isMobileLayout } from '../editor/dom.js';
import { GhostCursor } from './cursor.js';
import { createTools } from './tools.js';
import { Agent, describeActions } from './agent.js';
import { ReplayController } from './replay.js';
import { buildSystemPrompt } from './prompt.js';
import { createAnthropicProvider, MODELS, EFFORTS } from './providers/anthropic.js';
import { createDemoProvider, DEMO_REQUEST } from './providers/demo.js';

const SUGGESTIONS = [
  'Add a coin the player can collect',
  'Make the player jump higher',
  'Add an enemy that walks back and forth',
  'How do I add my own picture?',
  'Explain what the player script does',
];

const SPEED_OPTIONS = [['slow', '🐢 Slow'], ['normal', '🚶 Normal'], ['fast', '🏃 Fast'], ['instant', '⚡ Instant']];

const store = {
  get(k, d) { try { return localStorage.getItem(`sprout.ai.${k}`) ?? d; } catch (_) { return d; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(`sprout.ai.${k}`); else localStorage.setItem(`sprout.ai.${k}`, v); } catch (_) { /* unavailable */ } },
};

export class AIPanel {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.cursor = new GhostCursor(editor);
    this.cursor.speed = store.get('speed', 'normal');
    this.tools = createTools(editor);
    this.agent = new Agent(editor, { tools: this.tools, cursor: this.cursor, systemPrompt: buildSystemPrompt() });
    this.replay = new ReplayController(editor, { tools: this.tools, cursor: this.cursor, setBusy: (on, kind) => this.setBusy(on, kind) });
    this.turns = [];
    this.build();
  }

  destroy() {
    this.agent.cancel();
    this.cursor.destroy();
    this.replay.bar.remove();
    if (this.overlay) this.overlay.remove();
  }

  // ------------------------------------------------------------ settings

  get apiKey() { return store.get('key', ''); }
  get model() { return store.get('model', MODELS[0].id); }
  get effort() { return store.get('effort', 'medium'); }

  provider(demo = false) {
    if (demo) return createDemoProvider(this.editor);
    return createAnthropicProvider({ apiKey: this.apiKey, model: this.model, effort: this.effort });
  }

  buildSettings() {
    const keyInput = h('input', { type: 'password', value: this.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off', 'aria-label': 'Claude API key', 'data-ai': 'ai-key-input' });
    const show = h('button', { class: 'btn btn-small', type: 'button', onclick: () => { keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; } }, '👁');
    const save = h('button', { class: 'btn btn-small btn-primary', type: 'button', onclick: () => { store.set('key', keyInput.value.trim() || null); toast(keyInput.value.trim() ? 'API key saved on this device' : 'API key removed'); this.renderIntro(); } }, 'Save key');
    const model = h('select', { 'aria-label': 'AI model', onchange: (e) => { store.set('model', e.target.value); this.renderHeader(); } },
      MODELS.map((m) => h('option', { value: m.id, selected: m.id === this.model }, m.label)));
    const effort = h('select', { 'aria-label': 'How hard the AI thinks', onchange: (e) => store.set('effort', e.target.value) },
      EFFORTS.map(([v, l]) => h('option', { value: v, selected: v === this.effort }, l)));
    const speed = h('select', { 'aria-label': 'Cursor speed', onchange: (e) => this.setSpeed(e.target.value) },
      SPEED_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === this.cursor.speed }, l)));
    const priceList = h('ul', { class: 'small muted' }, MODELS.map((m) => h('li', null, `${m.label}: ${m.price}`)));
    return h('div', { class: 'settings-grid' },
      h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Claude API key'),
        h('div', { class: 'field-control' }, h('div', { class: 'key-row' }, keyInput, show, save),
          h('div', { class: 'field-help' }, 'The helper uses Claude, made by Anthropic. You need your own API key, and Anthropic charges you for what you use. Create one on Anthropic\'s developer platform (platform.claude.com). The key is stored only on this device and is sent only to Anthropic.'))),
      h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Model'), h('div', { class: 'field-control' }, model, h('div', { class: 'field-help' }, 'Prices per million tokens (roughly 750,000 words) as of when this version was made. Check Anthropic\'s website for current prices.'), priceList)),
      h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Thinking effort'), h('div', { class: 'field-control' }, effort, h('div', { class: 'field-help' }, 'More effort usually gives better results for big changes, but takes longer and costs more.'))),
      h('div', { class: 'field-row' }, h('label', { class: 'field-label' }, 'Cursor speed'), h('div', { class: 'field-control' }, speed, h('div', { class: 'field-help' }, 'How fast the AI moves its cursor. Slow is best for learning; Instant skips the animation.'))),
    );
  }

  setSpeed(v) {
    this.cursor.speed = v;
    store.set('speed', v);
    if (this.speedSel) this.speedSel.value = v;
  }

  // ------------------------------------------------------------ layout

  build() {
    this.header = h('div', { class: 'panel-header ai-header' });
    this.list = h('div', { class: 'ai-messages', role: 'log', 'aria-live': 'polite' });
    this.status = h('div', { class: 'ai-status', hidden: true });
    this.input = h('textarea', {
      rows: 2, placeholder: 'Ask me to make something, or how to do something…', 'aria-label': 'Message the AI helper', 'data-ai': 'ai-input',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.submit(); } },
    });
    this.sendBtn = h('button', { class: 'btn btn-primary', onclick: () => this.submit() }, 'Send');
    this.stopBtn = h('button', { class: 'btn btn-danger', hidden: true, onclick: () => this.stop() }, '■ Stop');
    this.speedSel = h('select', { class: 'ai-speed', title: 'How fast the AI cursor moves', 'aria-label': 'Cursor speed', onchange: (e) => this.setSpeed(e.target.value) },
      SPEED_OPTIONS.map(([v, l]) => h('option', { value: v, selected: v === this.cursor.speed }, l)));
    this.composer = h('div', { class: 'ai-composer' }, this.input, h('div', { class: 'ai-composer-row' }, this.speedSel, h('span', { class: 'flex' }), this.stopBtn, this.sendBtn));
    this.el.append(this.header, this.list, this.status, this.composer);
    this.renderHeader();
    this.renderIntro();
  }

  renderHeader() {
    clear(this.header);
    const m = MODELS.find((x) => x.id === this.model);
    this.header.append(
      h('h3', null, '🤖 AI helper'),
      h('span', { class: 'ai-model muted small', title: m ? m.label : this.model }, m ? m.label.split(' - ')[0].replace('Claude ', '') : ''),
      h('div', { class: 'header-actions' },
        h('button', { class: 'icon-btn', title: 'Start a new conversation', 'aria-label': 'New conversation', onclick: () => this.newChat() }, '🗒'),
        h('button', { class: 'icon-btn', title: 'AI settings', 'aria-label': 'AI settings', onclick: () => this.editor.openSettings('ai') }, '⚙️'),
        h('button', { class: 'icon-btn ai-close', title: 'Hide the AI helper', 'aria-label': 'Hide the AI helper', onclick: () => this.editor.toggleAI(false) }, '✕')));
  }

  renderIntro() {
    if (this.list.querySelector('.ai-msg')) return;
    clear(this.list);
    const hasKey = !!this.apiKey;
    this.list.appendChild(h('div', { class: 'ai-intro' },
      h('p', null, h('strong', null, 'Hi! I can build things in your game for you - and show you how.')),
      h('p', { class: 'muted small' }, 'Ask me anything. I\'ll move my own purple cursor around the editor so you can watch, then list what I pressed. You can rewind and replay every step.'),
      hasKey ? null : h('div', { class: 'ai-keybox' },
        h('p', { class: 'small' }, 'To use me, add a Claude API key (you pay Anthropic for what you use).'),
        h('div', { class: 'ai-keybox-btns' },
          h('button', { class: 'btn btn-small btn-primary', onclick: () => this.editor.openSettings('ai') }, '🔑 Add API key'),
          h('button', { class: 'btn btn-small', 'data-ai': 'ai-demo', onclick: () => this.runDemo() }, '▶ Watch a demo first'))),
      h('div', { class: 'ai-suggestions' }, SUGGESTIONS.map((s) => h('button', { class: 'chip', onclick: () => { this.input.value = s; this.submit(); } }, s)))));
  }

  newChat() {
    if (this.agent.running) return;
    this.agent.reset();
    this.turns = [];
    clear(this.list);
    this.renderIntro();
  }

  scroll() {
    this.list.scrollTop = this.list.scrollHeight;
  }

  addMessage(role, content, cls = '') {
    const el = h('div', { class: `ai-msg ai-${role} ${cls}` });
    if (role === 'user') el.textContent = content;
    else el.innerHTML = miniMarkdown(content);
    this.list.querySelector('.ai-intro')?.remove();
    this.list.appendChild(el);
    this.scroll();
    return el;
  }

  setStatus(text) {
    this.status.hidden = !text;
    this.status.textContent = text || '';
  }

  // Blocks the editor while the AI (or a replay) is using it.
  setBusy(on, kind = 'agent') {
    this.editor.aiBusy = on;
    document.body.classList.toggle('ai-busy', on);
    if (on) {
      if (!this.overlay) {
        this.overlay = h('div', { class: 'ai-overlay' });
        document.body.appendChild(this.overlay);
      }
      clear(this.overlay);
      if (kind === 'agent') {
        this.overlay.appendChild(h('div', { class: 'ai-banner' },
          h('span', null, '🤖 The AI helper is working - watch the purple cursor'),
          h('button', { class: 'btn btn-small btn-danger', onclick: () => this.stop() }, '■ Stop')));
      }
      this.overlay.hidden = false;
    } else if (this.overlay) {
      this.overlay.hidden = true;
    }
    this.sendBtn.hidden = on && kind === 'agent';
    this.stopBtn.hidden = !(on && kind === 'agent');
    this.input.disabled = on;
  }

  // ------------------------------------------------------------ running

  async submit() {
    const text = this.input.value.trim();
    if (!text || this.agent.running || this.replay.active) return;
    if (!this.apiKey) {
      this.addMessage('assistant', 'I need a Claude API key before I can help with your own requests. Press **⚙️** above (or **Settings → AI helper**) to add one, or watch the demo to see how I work.', 'ai-notice');
      this.list.appendChild(h('div', { class: 'ai-keybox-btns' },
        h('button', { class: 'btn btn-small btn-primary', onclick: () => this.editor.openSettings('ai') }, '🔑 Add API key'),
        h('button', { class: 'btn btn-small', onclick: () => this.runDemo() }, '▶ Watch the demo')));
      this.scroll();
      return;
    }
    this.input.value = '';
    await this.run(text, this.provider(false));
  }

  async runDemo() {
    if (this.agent.running || this.replay.active) return;
    if (!this.editor.store.scene()) { toast('Open a scene first.', 'warn'); return; }
    await this.run(DEMO_REQUEST, this.provider(true), true);
  }

  askToFix(info) {
    this.editor.toggleAI(true);
    const where = `${info.script || 'a script'}${info.line ? `, line ${info.line}` : ''}${info.objectName ? ` (on the object "${info.objectName}")` : ''}`;
    this.input.value = `My game has a problem in ${where}: "${info.message}". Please fix it and explain what was wrong in simple words.`;
    if (this.apiKey) this.submit();
    else { this.input.focus(); this.submit(); }
  }

  stop() {
    this.agent.cancel();
    this.setStatus('Stopping…');
  }

  async run(text, provider, demo = false) {
    if (this.editor.playView.game) this.editor.stop();
    if (this.editor.scriptEditor.scriptId) this.editor.scriptEditor.pushNow();
    this.addMessage('user', text);
    if (demo) this.list.lastChild.classList.add('ai-demo-msg');
    // A demo uses its own short conversation so it doesn't mix with real ones.
    const savedMessages = demo ? this.agent.messages : null;
    if (demo) this.agent.messages = [];
    this.setBusy(true, 'agent');
    this.setStatus('Thinking…');
    let live = null;
    const progress = h('details', { class: 'ai-progress' }, h('summary', null, 'What I was thinking'));
    let progressCount = 0;
    const turn = await this.agent.run(text, provider, {
      onStreamText: (t) => {
        if (!live) live = this.addMessage('assistant', '');
        live.innerHTML = miniMarkdown(t);
        this.scroll();
      },
      onText: (t) => {
        if (live) { live.innerHTML = miniMarkdown(t); live = null; } else this.addMessage('assistant', t);
      },
      onProgress: (t) => {
        this.setStatus(`💭 ${t.length > 140 ? t.slice(0, 138) + '…' : t}`);
        if (progress.lastChild && progress.lastChild.dataset && progress.lastChild.dataset.text === t) return;
        const line = h('div', { class: 'small muted', dataset: { text: t } }, t);
        progress.appendChild(line);
        progressCount++;
      },
      onToolStart: (step) => { live = null; this.setStatus(`🖱 ${step.title}…`); },
      onStep: (step) => { if (step.error && step.error !== 'Stopped') this.setStatus(`⚠ ${step.error}`); },
      onNotice: (t) => this.addMessage('assistant', t, 'ai-notice'),
    });
    if (demo) this.agent.messages = savedMessages;
    // On phones the AI switches tabs while it works; come back to show the summary.
    if (isMobileLayout()) this.editor.showMobilePanel('ai');
    this.setBusy(false);
    this.setStatus('');
    if (progressCount) this.list.appendChild(progress);
    this.turns.push(turn);
    this.renderTurnCard(turn);
    if (turn.status === 'error') this.addMessage('assistant', `⚠ ${turn.error}`, 'ai-error');
    if (turn.status === 'stopped') this.addMessage('assistant', 'Stopped. Anything I already did is still there - use **Undo all of this** below if you want it gone.', 'ai-notice');
    this.scroll();
  }

  renderTurnCard(turn) {
    const steps = turn.steps.filter((s) => !s.readOnly);
    if (!steps.length) {
      if (turn.usage && turn.usage.output) this.list.appendChild(h('div', { class: 'ai-usage muted small' }, usageText(turn)));
      return;
    }
    const card = h('div', { class: 'ai-card' },
      h('div', { class: 'ai-card-title' }, `🖱 What I pressed (${steps.length} step${steps.length > 1 ? 's' : ''})`),
      h('ol', { class: 'ai-steps' }, steps.map((s) => h('li', { class: s.error ? 'step-failed' : '' },
        h('strong', null, s.title),
        s.actions.length ? h('div', { class: 'ai-step-actions' }, describeActions(s)) : null,
        s.error ? h('div', { class: 'ai-step-error' }, `⚠ ${s.error}`) : null))),
      h('div', { class: 'ai-card-btns' },
        h('button', { class: 'btn btn-small btn-primary', 'data-ai': 'ai-replay', onclick: () => this.replay.open(turn) }, '⏪ Rewind & watch again'),
        h('button', { class: 'btn btn-small', onclick: () => this.undoTurn(turn) }, '↶ Undo all of this')),
      turn.usage && turn.usage.output ? h('div', { class: 'ai-usage muted small' }, usageText(turn)) : null);
    this.list.appendChild(card);
  }

  async undoTurn(turn) {
    if (this.agent.running || this.replay.active) return;
    const ok = await confirmDialog({
      title: 'Undo the AI\'s changes',
      message: 'Put the project back to how it was before this request? Anything changed since then (by you or the AI) will be undone too. You can redo it with Ctrl+Y.',
      okText: 'Undo all of this',
    });
    if (!ok) return;
    this.editor.store.restoreAsChange(turn.startSnapshot, 'Undo AI changes');
    toast('Put back how it was before');
  }
}

function usageText(turn) {
  const k = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));
  if (turn.provider === 'demo') return 'Demo - no AI was used.';
  return `Used about ${k(turn.usage.input)} input and ${k(turn.usage.output)} output tokens.`;
}
