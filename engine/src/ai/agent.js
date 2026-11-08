// The AI helper's work loop: send the conversation to the AI, perform the
// tool calls it asks for (with the visible cursor), send back the results,
// and repeat until it is done. Every step is recorded for replay.

import { CancelledError } from './cursor.js';
import { toolSchemas } from './tools.js';

const MAX_ROUNDS = 40;

export class Agent {
  constructor(editor, { tools, cursor, systemPrompt }) {
    this.editor = editor;
    this.store = editor.store;
    this.tools = tools;
    this.schemas = toolSchemas(tools);
    this.cursor = cursor;
    this.systemPrompt = systemPrompt;
    this.messages = [];
    this.running = false;
    this.abort = null;
  }

  reset() {
    this.messages = [];
  }

  cancel() {
    this.cursor.cancelled = true;
    if (this.abort) this.abort.abort();
  }

  // Runs one request from the user. `ui` receives progress callbacks.
  async run(userText, provider, ui) {
    if (this.running) throw new Error('The AI helper is already working.');
    this.running = true;
    this.cursor.cancelled = false;
    const turn = {
      id: `turn_${Date.now().toString(36)}`,
      request: userText,
      startSnapshot: this.store.snapshot(),
      steps: [],
      status: 'running',
      provider: provider.id,
      usage: { input: 0, output: 0 },
    };
    this.messages.push({ role: 'user', content: userText });
    let parseRetries = 0;
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        this.abort = new AbortController();
        let response;
        try {
          response = await provider.send({
            system: this.systemPrompt,
            tools: this.schemas,
            messages: this.messages,
            signal: this.abort.signal,
            onText: (t) => ui.onStreamText && ui.onStreamText(t),
            onProgress: (t) => ui.onProgress && ui.onProgress(t),
          });
        } catch (err) {
          if (err.cancelled || this.cursor.cancelled) throw new CancelledError();
          if (err.parse && parseRetries++ < 2) continue;
          throw err;
        }
        parseRetries = 0;
        if (response.usage) {
          const u = response.usage;
          turn.usage.input += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          turn.usage.output += u.output_tokens || 0;
        }
        this.messages.push({ role: 'assistant', content: response.content });
        for (const b of response.content) {
          if (b.type === 'text' && b.text.trim()) ui.onText && ui.onText(b.text);
          if (b.type === 'thinking' && b.thinking && b.thinking.trim()) ui.onProgress && ui.onProgress(b.thinking);
        }
        if (response.stop_reason === 'refusal') {
          turn.status = 'declined';
          ui.onNotice && ui.onNotice('The AI declined this request. Try asking in a different way.');
          break;
        }
        const uses = response.content.filter((b) => b.type === 'tool_use');
        if (response.stop_reason === 'max_tokens' && uses.length) {
          // A tool call was cut off - don't run it; tell the AI and continue.
          this.messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Your message was cut off before this tool call finished, so it was not run. Please try again with a shorter input (for example, split a long script into edit_script calls).' })) });
          continue;
        }
        if (response.stop_reason === 'pause_turn') continue;
        if (!uses.length) break;

        const results = [];
        for (const use of uses) {
          if (this.cursor.cancelled) {
            results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Not run: the user pressed Stop.' });
            continue;
          }
          const step = await this.runTool(use, ui);
          // Failed attempts that changed nothing aren't shown or replayed - the AI deals with those itself.
          const noChange = step.error && step.before && step.after && step.before.json === step.after.json;
          if (!step.readOnly && !noChange) turn.steps.push(step);
          ui.onStep && ui.onStep(step, turn);
          results.push(step.toolResult);
        }
        this.messages.push({ role: 'user', content: results });
        if (this.cursor.cancelled) throw new CancelledError();
      }
      if (turn.status === 'running') turn.status = 'done';
    } catch (err) {
      if (err instanceof CancelledError || err.cancelled) turn.status = 'stopped';
      else { turn.status = 'error'; turn.error = err.message; }
      // Keep the conversation valid: every tool call needs a result.
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === 'assistant') {
        const uses = last.content.filter((b) => b.type === 'tool_use');
        if (uses.length) this.messages.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: 'Not run: the user pressed Stop.' })) });
      }
    } finally {
      this.running = false;
      this.abort = null;
      this.cursor.hide();
      turn.endSnapshot = this.store.snapshot();
    }
    return turn;
  }

  async runTool(use, ui) {
    const tool = this.tools.find((t) => t.name === use.name);
    const step = { id: use.id, tool: use.name, input: use.input || {}, actions: [], readOnly: !!(tool && tool.readOnly) };
    if (!tool) {
      step.error = `Unknown tool "${use.name}".`;
      step.toolResult = { type: 'tool_result', tool_use_id: use.id, is_error: true, content: step.error };
      return step;
    }
    step.title = safeTitle(tool, step.input);
    ui.onToolStart && ui.onToolStart(step);
    step.before = this.store.snapshot();
    this.store.idLog = [];
    this.cursor.recording = step.actions;
    try {
      const result = await tool.run(step.input, { cur: this.cursor, editor: this.editor, store: this.store, replay: false });
      step.toolResult = { type: 'tool_result', tool_use_id: use.id, content: formatResult(result) };
    } catch (err) {
      if (err instanceof CancelledError) {
        step.error = 'Stopped';
        step.toolResult = { type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Stopped by the user part way through. The project may be partly changed.' };
      } else {
        step.error = err.message;
        step.toolResult = { type: 'tool_result', tool_use_id: use.id, is_error: true, content: `Error: ${err.message}` };
      }
      closeStrayDialogs();
    } finally {
      step.ids = this.store.idLog || [];
      this.store.idLog = null;
      this.cursor.recording = null;
      this.cursor.unhighlight();
      step.after = this.store.snapshot();
    }
    return step;
  }
}

function safeTitle(tool, input) {
  try { return tool.title(input); } catch (_) { return tool.name; }
}

function formatResult(result) {
  if (result === undefined || result === null) return 'Done.';
  if (typeof result === 'string') return result;
  if (result.content) return result.content;
  return JSON.stringify(result);
}

// If a tool failed half way through a dialog, close it so the editor is usable.
export function closeStrayDialogs() {
  document.querySelectorAll('.dialog-backdrop').forEach((d) => {
    const btn = d.querySelector('[data-ai="dialog-close"]');
    if (btn) btn.click(); else d.remove();
  });
  document.querySelectorAll('.context-menu').forEach((m) => m.remove());
}

// A one-line description of the buttons a step pressed.
export function describeActions(step) {
  const parts = [];
  for (const a of step.actions) {
    if (a.kind === 'click') parts.push(a.label);
    else if (a.kind === 'type') parts.push(/^-?\d+(\.\d+)?$/.test(a.value) ? `${a.label} = ${a.value}` : `${a.label} = “${a.value.length > 24 ? a.value.slice(0, 22) + '…' : a.value}”`);
    else if (a.kind === 'choose') parts.push(`${a.label} = ${a.value}`);
    else if (a.kind === 'check') parts.push(`${a.value ? '☑' : '☐'} ${a.label}`);
    else if (a.kind === 'drag' || a.kind === 'code' || a.kind === 'paint' || a.kind === 'point') parts.push(a.label);
  }
  return parts.join(' → ');
}
