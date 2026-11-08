// End-to-end tests: runs the real editor in a headless browser.
//   npm test            (builds first)
// Needs Playwright with Chromium (npx playwright install chromium).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'output');
await mkdir(outDir, { recursive: true });
const PORT = 8790 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const URL = `http://localhost:${PORT}/`;

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

const browser = await chromium.launch();

async function newEditor(viewport = { width: 1440, height: 900 }, opts = {}) {
  const context = await browser.newContext({ viewport, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(URL);
  await page.click('[data-ai="template:platformer"]');
  await page.waitForSelector('.workspace');
  await page.waitForTimeout(300);
  return { page, errors, context };
}

// ---------------------------------------------------------------- 1. playing the starter game
{
  const { page, errors, context } = await newEditor();
  check('editor opens without errors', errors.length === 0, errors.join(' | '));
  await page.click('[data-ai="play-btn"]');
  await page.waitForFunction(() => window.sprout.playView.game && window.sprout.playView.game.running);
  await page.waitForTimeout(400);
  const x0 = await page.evaluate(() => window.sprout.playView.game.gameApi.find('Player').x);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowRight');
  const p = await page.evaluate(() => { const pl = window.sprout.playView.game.gameApi.find('Player'); return { x: pl.x, floor: pl.isOnFloor() }; });
  check('player runs right when holding the right arrow', p.x - x0 > 60, `moved ${Math.round(p.x - x0)}px`);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  const jumped = await page.evaluate(() => window.sprout.playView.game.gameApi.find('Player').velocity.y < 0 || !window.sprout.playView.game.gameApi.find('Player').isOnFloor());
  check('player jumps with Space', jumped);
  const slimes = await page.evaluate(() => window.sprout.playView.game.gameApi.findAll('Slime').map((s) => s.velocity.x));
  check('slimes patrol', slimes.length === 3 && slimes.every((v) => v !== 0), JSON.stringify(slimes));
  await page.screenshot({ path: path.join(outDir, 'playing.png') });
  await page.click('[data-ai="stop-btn"]');
  check('game stops', await page.evaluate(() => !window.sprout.playView.game));
  check('no errors while playing', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 2. every AI tool, via a scripted mock AI, then replay
{
  const { page, errors, context } = await newEditor();
  await page.evaluate((s) => window.sprout.ai.setSpeed(s), process.env.TOOL_SPEED || 'instant');
  const result = await page.evaluate(async () => {
    const ed = window.sprout;
    const store = ed.store;
    const find = (name) => { let f = null; for (const s of store.scenes) (function w(n) { if (!f && n.name === name) f = n; n.children.forEach(w); })(s.root); return f; };
    let n = 0;
    const use = (name, input) => ({ type: 'tool_use', id: `t${n++}`, name, input });
    const rounds = [
      () => [use('get_project_overview', {}), use('create_scene', { name: 'Bullet', top_type: 'Sprite', root_properties: { image: 'coin', width: 16, height: 16, body: 'trigger' } })],
      () => {
        const level = store.sceneByName('Level 1').id;
        return [
          use('open_scene', { scene_id: level }),
          use('add_object', { type: 'Shape', name: 'Wall', scene_id: level, properties: { x: 600, y: 300, width: 40, height: 200, color: '#ff0000', body: 'solid' } }),
          use('add_object', { type: 'Group', name: 'Decor' }),
          use('add_object', { type: 'TileMap', name: 'Extra', properties: { tileSize: 32 } }),
          use('add_object', { type: 'SceneCopy', name: 'Coin', properties: { scene: 'Coin', x: 500, y: 300 } }),
        ];
      },
      () => [
        use('add_object', { type: 'Text', name: 'Hello', parent_id: find('Decor').id, properties: { text: 'Hi!', size: 30, onScreen: true } }),
        use('add_object', { type: 'Sprite', name: 'Hat', parent_id: find('Player').id, properties: { image: 'heart', y: -20 } }),
        use('set_properties', { object_id: find('Wall').id, properties: { color: '#00ff00', rotation: 15, gravity: true } }),
        use('rename_object', { object_id: find('Wall').id, new_name: 'Big Wall' }),
        use('add_tile_type', { tilemap_id: find('Extra').id, name: 'Ice', color: '#aaddff', solid: true }),
        use('add_tile_type', { tilemap_id: find('Extra').id, name: 'Bridge', image: 'plank', platform: true }),
      ],
      () => [
        use('duplicate_object', { object_id: find('Big Wall').id, new_name: 'Wall 2', x: 700 }),
        use('paint_tiles', { tilemap_id: find('Extra').id, tile_index: 0, rects: [{ x: 2, y: 2, width: 5, height: 1 }], cells: [[10, 3]] }),
        use('paint_tiles', { tilemap_id: find('Extra').id, erase: true, cells: [[3, 2]] }),
        use('write_script', { object_id: find('Big Wall').id, code: 'let spin = 45; // degrees per second\n\nfunction update(dt) {\n  me.rotation += spin * dt;\n}\n' }),
      ],
      () => [
        use('move_object_into', { object_id: find('Wall 2').id, new_parent_id: find('Decor').id }),
        use('edit_script', { script_id: find('Big Wall').script, old_text: 'let spin = 45;', new_text: 'let spin = 90;' }),
        use('set_script_setting', { object_id: find('Player').id, name: 'speed', value: 320 }),
        use('set_script_setting', { object_id: find('Slime').id, name: 'speed', value: 40 }),
        use('draw_pixel_art', { name: 'star', palette: { y: '#ffd21f', o: '#7a4a00' }, frames: [['..o..', '.oyo.', 'oyyyo', '.oyo.', '..o..'], ['.....', '..o..', '.oyo.', '..o..', '.....']], fps: 4 }),
        use('change_project_settings', { settings: { background: '#223344', gravity: 1200, name: 'Tested Game' } }),
        use('set_input_action', { action: 'shoot', keys: ['KeyF', 'KeyK'] }),
      ],
      () => [
        use('set_start_scene', { scene_id: store.sceneByName('Level 1').id }),
        use('point_at', { target: 'add-object-button', message: 'This is where you add things' }),
        use('point_at', { target: `in-scene:${find('Player').id}`, message: 'This is your player' }),
        use('get_object', { object_id: find('Player').id }),
        use('read_script', { script_id: find('Big Wall').script }),
        use('play_game', { seconds: 1.5, inputs: [{ action: 'right', start: 0, duration: 1 }], screenshot: true }),
      ],
      () => [
        use('delete_object', { object_id: find('Big Wall').id }),
        use('add_object', { type: 'Nope', name: 'Bad' }),
        use('set_properties', { object_id: find('Player').id, properties: { notAProp: 1 } }),
      ],
      () => [{ type: 'text', text: 'All done.' }],
    ];
    let round = 0;
    const toolResults = [];
    const provider = {
      id: 'mock',
      async send({ messages }) {
        const last = messages[messages.length - 1];
        if (Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') toolResults.push(b);
        const content = rounds[round++]();
        return { role: 'assistant', content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: {} };
      },
    };
    await ed.ai.run('test every tool', provider);
    const turn = ed.ai.turns[ed.ai.turns.length - 1];
    const errorsByTool = toolResults.filter((r) => r.is_error).map((r) => (typeof r.content === 'string' ? r.content : JSON.stringify(r.content)).slice(0, 160));
    const p = store.project;
    const extra = find('Extra');
    const wall2 = find('Wall 2');
    const decor = find('Decor');
    const state = {
      status: turn.status,
      steps: turn.steps.length,
      errorsByTool,
      bulletScene: !!store.sceneByName('Bullet') && store.sceneByName('Bullet').root.type === 'Sprite' && store.sceneByName('Bullet').root.props.body === 'trigger',
      bigWallGone: !find('Big Wall'),
      wall2InDecor: !!decor && decor.children.some((c) => c === wall2),
      wall2: wall2 && { x: wall2.props.x, color: wall2.props.color, rot: wall2.props.rotation },
      hello: (() => { const t = find('Hello'); return t && t.props.onScreen && t.props.text === 'Hi!'; })(),
      hatInPlayer: find('Player').children.some((c) => c.name === 'Hat'),
      tiles: extra && extra.props.tiles.map((t) => `${t.name}:${t.solid}:${t.platform}:${t.image ? 'img' : t.color}`),
      cells: extra && Object.keys(extra.props.cells).sort(),
      playerSpeed: find('Player').scriptVars.speed,
      slimeCopyVar: find('Slime').scriptVars.speed,
      star: (() => { const a = store.assetByName('star'); return a && a.frames.length; })(),
      settings: { bg: p.settings.background, g: p.settings.gravity, name: p.name },
      shoot: p.input.shoot,
      playResult: toolResults.find((r) => Array.isArray(r.content)) ? 'had screenshot' : 'no screenshot',
    };
    return state;
  });
  check('mock AI run finished', result.status === 'done', result.status);
  const expectedErrors = result.errorsByTool.filter((e) => /Unknown type "Nope"|no property "notAProp"/.test(e));
  const unexpected = result.errorsByTool.filter((e) => !/Unknown type "Nope"|no property "notAProp"/.test(e));
  check('tools report helpful errors for bad input', expectedErrors.length === 2, result.errorsByTool.join(' || '));
  check('every other tool succeeded', unexpected.length === 0, unexpected.join(' || '));
  check('create_scene with Sprite top object', result.bulletScene);
  check('add_object into a group and into a sprite', result.hello && result.hatInPlayer);
  check('rename + duplicate + set_properties + move_object_into', result.wall2InDecor && result.wall2 && result.wall2.x === 700 && result.wall2.color === '#00ff00' && result.wall2.rot === 15, JSON.stringify(result.wall2));
  check('delete_object', result.bigWallGone);
  check('add_tile_type', JSON.stringify(result.tiles) === JSON.stringify(['Ground:true:false:#8d6e63', 'Ice:true:false:#aaddff', 'Bridge:true:true:img']), JSON.stringify(result.tiles));
  check('paint_tiles and erase', JSON.stringify(result.cells) === JSON.stringify(['10,3', '2,2', '4,2', '5,2', '6,2']), JSON.stringify(result.cells));
  check('script settings on an object and on a scene copy', result.playerSpeed === 320 && result.slimeCopyVar === 40);
  check('draw_pixel_art with 2 frames', result.star === 2);
  check('change_project_settings', result.settings.bg === '#223344' && result.settings.g === 1200 && result.settings.name === 'Tested Game', JSON.stringify(result.settings));
  check('set_input_action', JSON.stringify(result.shoot) === '["KeyF","KeyK"]');
  check('play_game returns a screenshot', result.playResult === 'had screenshot');

  // Replay the whole session and compare.
  const replay = await page.evaluate(async () => {
    const ed = window.sprout;
    const turn = ed.ai.turns[ed.ai.turns.length - 1];
    const finalJson = ed.store.snapshot().json;
    await ed.ai.replay.open(turn);
    const replayed = ed.store.snapshot().json === turn.steps[turn.steps.length - 1].after.json;
    const index = ed.ai.replay.index;
    await ed.ai.replay.close();
    return { replayed, index, steps: turn.steps.length, restored: ed.store.snapshot().json === finalJson };
  });
  check('replaying every step reproduces the same project', replay.replayed && replay.index === replay.steps && replay.steps === 28, JSON.stringify(replay));
  check('closing the replay restores the project', replay.restored);

  // Undo all of the AI's work in one go.
  const undone = await page.evaluate(() => {
    const ed = window.sprout;
    const turn = ed.ai.turns[ed.ai.turns.length - 1];
    ed.store.restoreAsChange(turn.startSnapshot, 'Undo AI changes');
    const strip = (json) => { const p = JSON.parse(json); delete p.modified; return JSON.stringify(p); };
    return strip(ed.store.snapshot().json) === strip(turn.startSnapshot.json);
  });
  check('undo all of the AI\'s changes', undone);
  await page.screenshot({ path: path.join(outDir, 'after-tools.png') });
  check('no page errors during AI tools', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 3. animated demo + summary
{
  const { page, errors, context } = await newEditor();
  await page.evaluate(() => window.sprout.ai.setSpeed('fast'));
  await page.click('[data-ai="ai-demo"]');
  await page.waitForTimeout(1800);
  const cursorVisible = await page.evaluate(() => !document.querySelector('.ghost-cursor').hidden);
  check('AI cursor is visible while working', cursorVisible);
  const blocked = await page.evaluate(() => document.body.classList.contains('ai-busy'));
  check('editor is locked while the AI works', blocked);
  await page.waitForSelector('.ai-card', { timeout: 60000 });
  const card = await page.evaluate(() => document.querySelector('.ai-card').innerText);
  check('summary card lists what was pressed', /What I pressed \(3 steps\)/.test(card) && /Add object → Sprite/.test(card), card.replace(/\n/g, ' | ').slice(0, 200));
  await page.screenshot({ path: path.join(outDir, 'demo-summary.png') });
  check('no errors during demo', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 4. friendly script errors
{
  const { page, errors, context } = await newEditor();
  await page.evaluate(() => {
    const s = window.sprout.store;
    const coin = s.sceneByName('Coin').root;
    s.setScriptCode(coin.script, 'function update(dt) {\n  me.x += 1;\n  misspelledThing.go();\n}\n');
  });
  await page.click('[data-ai="play-btn"]');
  await page.waitForSelector('.play-error:not([hidden])', { timeout: 5000 });
  const msg = await page.evaluate(() => document.querySelector('.play-error').innerText);
  check('runtime error shows a friendly message with the line', /misspelledThing" is not defined/.test(msg) && /line 3/.test(msg), msg.replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(outDir, 'script-error.png') });
  await page.click('[data-ai="stop-btn"]');
  // Syntax error shown in the script editor
  await page.evaluate(() => {
    const s = window.sprout.store;
    const coin = s.sceneByName('Coin').root;
    s.setScriptCode(coin.script, 'function update(dt) {\n  if (me.x > 3 {\n  }\n}\n');
    window.sprout.openScript(coin.script);
  });
  await page.waitForTimeout(300);
  const status = await page.evaluate(() => document.querySelector('.se-status').innerText);
  check('syntax errors are pointed out in the script editor', /line 2/.test(status), status);
  check('no unexpected page errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

// ---------------------------------------------------------------- 5. exported game runs on its own
{
  const { page, context } = await newEditor();
  const exported = await page.evaluate(() => window.sprout.buildExport());
  const file = path.join(outDir, 'exported-game.html');
  await writeFile(file, exported);
  const game = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const gErrors = [];
  game.on('pageerror', (e) => gErrors.push(e.message));
  await game.goto(`file://${file}`);
  await game.waitForTimeout(800);
  await game.keyboard.down('ArrowRight');
  await game.waitForTimeout(400);
  await game.keyboard.up('ArrowRight');
  const running = await game.evaluate(() => !!document.querySelector('canvas'));
  check('exported HTML game runs by itself', running && gErrors.length === 0, gErrors.join(' | '));
  await game.screenshot({ path: path.join(outDir, 'exported-game.png') });
  await game.close();
  await context.close();
}

// ---------------------------------------------------------------- 6. phone layout
{
  const { page, errors, context } = await newEditor({ width: 412, height: 860 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.screenshot({ path: path.join(outDir, 'phone-scene.png') });
  await page.click('[data-ai="mobile-tab:tree"]');
  await page.click('.tree-row:nth-child(7)');
  await page.click('[data-ai="mobile-tab:inspector"]');
  const inspectorShown = await page.evaluate(() => getComputedStyle(document.querySelector('.col-right')).display !== 'none');
  check('phone: Inspector tab shows the inspector', inspectorShown);
  await page.screenshot({ path: path.join(outDir, 'phone-inspector.png') });
  await page.click('[data-ai="mobile-tab:ai"]');
  await page.evaluate(() => window.sprout.ai.setSpeed('fast'));
  await page.click('[data-ai="ai-demo"]');
  await page.waitForSelector('.ai-card', { timeout: 90000 });
  const gem = await page.evaluate(() => { let f = null; for (const s of window.sprout.store.scenes) (function w(n) { if (n.name === 'Gem') f = n; n.children.forEach(w); })(s.root); return !!f; });
  check('phone: AI switches tabs by itself and finishes the demo', gem);
  await page.screenshot({ path: path.join(outDir, 'phone-ai.png') });
  check('phone: no errors', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
server.kill();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
