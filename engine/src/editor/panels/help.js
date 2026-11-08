// "Script help": everything a script can use, with plain-English explanations.
import { h, openDialog } from '../dom.js';
import { API_GROUPS, SCRIPT_EVENTS, EXAMPLE_PLAYER_SCRIPT } from '../../runtime/apiDocs.js';

export function openHelpDialog(editor) {
  return openDialog({
    title: 'Script help',
    ai: 'help-dialog',
    wide: true,
    build: () => h('div', { class: 'dialog-body help-body' },
      h('p', null, 'Scripts are written in ', h('strong', null, 'JavaScript'), '. Add one to an object with ', h('em', null, '📜 Add script'), ' in the Inspector. Inside a script, ', h('code', null, 'me'), ' is the object the script belongs to.'),
      h('p', { class: 'muted' }, 'Stuck? Ask the AI helper, for example: "make the player jump higher" or "explain what update(dt) means".'),
      h('h3', null, 'Functions your script can have'),
      h('table', { class: 'api-table' }, SCRIPT_EVENTS.map((e) => h('tr', null, h('td', null, h('code', null, `function ${e.name} { }`)), h('td', null, e.doc)))),
      API_GROUPS.map((g) => [
        h('h3', null, g.title),
        h('table', { class: 'api-table' }, g.items.map(([n, d]) => h('tr', null, h('td', null, h('code', null, n)), h('td', null, d)))),
      ]),
      h('h3', null, 'Example: a player you can control'),
      h('pre', { class: 'code-sample' }, EXAMPLE_PLAYER_SCRIPT),
      h('h3', null, 'Keyboard shortcuts'),
      h('table', { class: 'api-table' }, [
        ['F5', 'Play'], ['F8 or Esc', 'Stop'], ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+S', 'Save now'], ['Ctrl+D', 'Duplicate'], ['Delete', 'Delete selected'],
        ['V / H / B / E', 'Select, Move view, Paint tiles, Erase tiles'], ['Arrow keys', 'Nudge the selected object (Shift = 10 pixels)'], ['F', 'Zoom to the selected object'], ['Space + drag', 'Move the view'],
      ].map(([k, d]) => h('tr', null, h('td', null, h('kbd', null, k)), h('td', null, d))))),
  });
}
