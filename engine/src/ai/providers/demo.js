// A pre-recorded demo of the AI helper, so people can see how it works
// before adding an API key. It is NOT a real AI: it always does the same
// steps (adds a collectible gem) and says so at the end.

export const DEMO_REQUEST = 'Show me a demo: add a gem the player can collect.';

const GEM_SCRIPT = `// A gem that spins and can be collected by the Player.

function update(dt) {
  // Spin a quarter turn every second
  me.rotation += 90 * dt;
}

function onTouch(other) {
  if (other.name === "Player") {
    playSound("coin");
    me.destroy();
  }
}
`;

function lastToolResult(messages) {
  const last = messages[messages.length - 1];
  if (!last || !Array.isArray(last.content)) return null;
  const r = last.content.find((b) => b.type === 'tool_result');
  if (!r) return null;
  try { return JSON.parse(typeof r.content === 'string' ? r.content : r.content[0].text); } catch (_) { return null; }
}

function stepsSinceUserText(messages) {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') n++;
    if (m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'))) break;
  }
  return n;
}

let counter = 0;
const toolUse = (name, input) => ({ type: 'tool_use', id: `demo_${Date.now().toString(36)}_${counter++}`, name, input });
const message = (content, stop) => ({ role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 0, output_tokens: 0 } });

export function createDemoProvider(editor) {
  let state = {};
  return {
    id: 'demo',
    label: 'Demo (pre-recorded)',
    async send({ messages, onProgress }) {
      await new Promise((r) => setTimeout(r, 500));
      const step = stepsSinceUserText(messages);
      const store = editor.store;
      if (step === 0) {
        state = {};
        return message([
          { type: 'text', text: 'Sure! Watch the purple cursor - I\'ll add a spinning gem the player can collect.' },
          toolUse('get_project_overview', {}),
        ], 'tool_use');
      }
      if (step === 1) {
        if (onProgress) onProgress('Adding a Sprite for the gem…');
        let x = Math.round(store.project.settings.width / 2);
        let y = Math.round(store.project.settings.height / 2);
        const scene = store.scene();
        let player = null;
        if (scene) (function find(n) { if (n.name === 'Player') player = n; n.children.forEach(find); }(scene.root));
        if (player) { x = Math.round(player.props.x + 160); y = Math.round(player.props.y - 64); }
        const hasCoinArt = !!store.assetByName('coin');
        return message([toolUse('add_object', {
          type: 'Sprite', name: 'Gem',
          properties: { x, y, width: 32, height: 32, body: 'trigger', ...(hasCoinArt ? { image: 'coin' } : {}) },
        })], 'tool_use');
      }
      if (step === 2) {
        state.gem = lastToolResult(messages)?.object_id;
        if (!state.gem) return message([{ type: 'text', text: 'The demo could not add the gem, so it stopped here.' }], 'end_turn');
        if (onProgress) onProgress('Writing a script so the gem spins and can be collected…');
        return message([toolUse('write_script', { object_id: state.gem, code: GEM_SCRIPT })], 'tool_use');
      }
      if (step === 3) {
        if (onProgress) onProgress('Testing it…');
        return message([toolUse('play_game', { seconds: 2 })], 'tool_use');
      }
      return message([{ type: 'text', text: 'Done! I added a **Gem** that spins, and its script makes it disappear with a sound when the **Player** touches it. Press **▶ Play** to try it.\n\nTip: you can do this yourself with **＋ Add → Sprite**, then **📜 Add script** in the Inspector.\n\n*This was a pre-recorded demo so you can see how the helper works. To ask your own questions, add a Claude API key in **Settings → AI helper**.*' }], 'end_turn');
    },
  };
}
