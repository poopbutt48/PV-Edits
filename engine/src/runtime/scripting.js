// Turns the JavaScript a user writes into something the game can run,
// and turns crashes into friendly messages with the right line number.

export const SCRIPT_HOOKS = ['start', 'update', 'onTouch', 'onTouchEnd', 'onClick', 'onDestroy'];

export const SCRIPT_GLOBALS = [
  'me', 'game', 'input', 'playSound', 'playMusic', 'stopMusic', 'after', 'every',
  'random', 'randomInt', 'chance', 'clamp', 'lerp', 'log', 'print',
];

// Finds top-level `let speed = 300;` style settings so the Inspector can show them.
export function findScriptSettings(code) {
  const out = [];
  const re = /^(?:let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false)\s*;?[ \t]*(?:\/\/[ \t]*(.*))?$/gm;
  let m;
  while ((m = re.exec(code))) {
    const raw = m[2];
    let value;
    let type;
    if (raw === 'true' || raw === 'false') { value = raw === 'true'; type = 'bool'; }
    else if (raw[0] === '"' || raw[0] === "'") {
      try { value = raw[0] === '"' ? JSON.parse(raw) : raw.slice(1, -1); } catch (_) { value = raw.slice(1, -1); }
      type = 'text';
    } else { value = parseFloat(raw); type = 'number'; }
    out.push({ name: m[1], value, type, comment: (m[3] || '').trim() });
  }
  return out;
}

let lineOffset = null;
// Different browsers add a different number of hidden lines when they
// compile code with `new Function`. We measure it once.
function getLineOffset() {
  if (lineOffset !== null) return lineOffset;
  try {
    const f = new Function('a', '"use strict";throw new Error("probe")\n//# sourceURL=__sprout_probe.js');
    f();
  } catch (e) {
    const m = /__sprout_probe\.js:(\d+)/.exec(String(e.stack || ''));
    lineOffset = m ? parseInt(m[1], 10) - 1 : 0;
  }
  return lineOffset;
}

function safeFileName(name) {
  return String(name || 'script').replace(/[^\w.-]+/g, '_');
}

export class ScriptError extends Error {
  constructor(message, info) {
    super(message);
    this.info = info; // { script, scriptId, line, column, objectName, phase }
  }
}

// Looks through an error's stack for the line inside the user's script.
export function lineFromError(err, scriptFile) {
  const stack = String((err && err.stack) || '');
  const esc = scriptFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(esc + ':(\\d+):(\\d+)').exec(stack);
  if (!m) return null;
  return { line: parseInt(m[1], 10) - getLineOffset(), column: parseInt(m[2], 10) };
}

// Friendlier wording for the most common beginner mistakes.
export function friendlyMessage(err) {
  const msg = String((err && err.message) || err);
  let m;
  if ((m = /^(\w+) is not defined$/.exec(msg))) return `"${m[1]}" is not defined. Check the spelling, or create it with let ${m[1]} = ...`;
  if ((m = /Cannot read properties of (null|undefined) \(reading '(.+)'\)/.exec(msg))) return `Tried to use ".${m[2]}" on something that is ${m[1]}. Often this means game.find() did not find an object with that name.`;
  if ((m = /Cannot set properties of (null|undefined) \(setting '(.+)'\)/.exec(msg))) return `Tried to set ".${m[2]}" on something that is ${m[1]}. Often this means game.find() did not find an object with that name.`;
  if ((m = /(.+) is not a function/.exec(msg))) return `${m[1]} is not a function. Check the spelling and the brackets.`;
  if (/Unexpected end of input/.test(msg)) return 'The script ends too early. A closing bracket } or ) is probably missing.';
  if ((m = /Unexpected token '?(.+?)'?$/.exec(msg))) return `Something is in the wrong place near "${m[1]}". Check for a missing bracket, comma or quote.`;
  return msg;
}

// Compiles a script for one object. Returns the object's hooks.
export function compileScript(script, api) {
  const file = `${safeFileName(script.name)}`;
  const settings = findScriptSettings(script.code);
  const setter = settings.map((s) => `case ${JSON.stringify(s.name)}: ${s.name} = __v; break;`).join('\n');
  const getter = settings.map((s) => `${JSON.stringify(s.name)}: ${s.name}`).join(', ');
  const hooks = SCRIPT_HOOKS.map((h) => `${h}: typeof ${h} === "function" ? ${h} : null`).join(', ');
  const body = `"use strict";${script.code}
;return { ${hooks}, __set(__n, __v) { switch (__n) { ${setter} } }, __get() { return { ${getter} }; } };
//# sourceURL=${file}`;
  let factory;
  try {
    factory = new Function(...SCRIPT_GLOBALS, body);
  } catch (err) {
    // Syntax errors: re-check with just the user's code to get a better position.
    let line = null;
    try { new Function(script.code); } catch (e2) { const p = lineFromError(e2, 'anonymous'); if (p) line = p.line; }
    throw new ScriptError(friendlyMessage(err), { script: script.name, scriptId: script.id, line, phase: 'compile' });
  }
  return {
    file,
    settings,
    // Creates the script's state for one object and returns its hooks.
    instantiate(api) {
      const args = SCRIPT_GLOBALS.map((g) => api[g]);
      return factory.apply(api.me, args);
    },
  };
}

// Checks a script for syntax errors without running it (used by the editor).
export function checkSyntax(code) {
  try {
    new Function(...SCRIPT_GLOBALS, `"use strict";${code}\n//# sourceURL=__sprout_check.js`);
    return null;
  } catch (err) {
    return { message: friendlyMessage(err), raw: String(err.message || err) };
  }
}
