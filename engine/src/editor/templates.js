// Starting points for new projects.
import { Store, newProject } from './store.js';
import { starterArt } from './starterArt.js';

export const TEMPLATES = [
  { id: 'platformer', name: 'Platformer starter', icon: '🏃', summary: 'A small finished level with a player, coins, enemies and a goal flag. Play it, then change it.' },
  { id: 'blank', name: 'Blank project', icon: '📄', summary: 'An empty scene plus the starter pictures. Build everything yourself (or with the AI).' },
];

export const PLAYER_SCRIPT = `// Player controls.
// The numbers below show up in the Inspector so you can tweak them.
let speed = 260;      // how fast the player runs
let jumpPower = 600;  // how high the player jumps

function update(dt) {
  // Run left and right with the arrow keys / A and D
  me.velocity.x = input.axis("left", "right") * speed;

  // Face the way we are running, and swap pictures
  if (me.velocity.x !== 0) me.flipX = me.velocity.x < 0;
  me.image = me.velocity.x !== 0 && me.isOnFloor() ? "hero_walk" : "hero";

  // Jump, but only when standing on something
  if (input.justPressed("jump") && me.isOnFloor()) {
    me.velocity.y = -jumpPower;
    playSound("jump");
  }

  // Fell off the bottom of the level? Start again.
  if (me.y > 900) {
    playSound("lose");
    game.restart();
  }
}
`;

export const COIN_SCRIPT = `// A coin the player can collect.
let startY = 0;

function start() {
  startY = me.y;
}

function update(dt) {
  // Bob gently up and down
  me.y = startY + Math.sin(game.time * 4) * 3;
}

function onTouch(other) {
  if (other.name === "Player") {
    game.vars.score = (game.vars.score || 0) + 1;
    playSound("coin");
    me.destroy();
  }
}
`;

export const SLIME_SCRIPT = `// An enemy that walks back and forth.
let speed = 70;
let direction = -1;

function update(dt) {
  me.velocity.x = direction * speed;

  // Turn around when bumping into a wall, or at the edge of a drop
  const groundAhead = game.isSolidAt(me.x + direction * 16, me.bottom + 4);
  if (me.isOnWall() || (me.isOnFloor() && !groundAhead)) direction = -direction;
  me.flipX = direction > 0;

  // Fell into a hole? Remove it.
  if (me.y > 1200) me.destroy();
}

function onTouch(other) {
  if (other.name !== "Player") return;
  // Landed on top of the slime? Squash it!
  if (other.velocity.y > 0 && other.bottom < me.y) {
    other.velocity.y = -400;
    playSound("hit");
    game.shake(6, 0.2);
    me.destroy();
  } else {
    // Otherwise the player got hurt
    playSound("lose");
    game.restart();
  }
}
`;

export const FLAG_SCRIPT = `// Reaching the flag wins the level.
function onTouch(other) {
  if (other.name === "Player") {
    playSound("win");
    game.changeScene("You Win");
  }
}
`;

export const SCORE_SCRIPT = `// Shows the score in the corner of the screen.
function update(dt) {
  me.text = "Coins: " + (game.vars.score || 0);
}
`;

export const SPIKES_SCRIPT = `// Spikes hurt the player.
function onTouch(other) {
  if (other.name === "Player") {
    playSound("hit");
    game.restart();
  }
}
`;

export const WIN_SCRIPT = `// The "You win" screen.
function start() {
  me.find("Final Score").text = "You collected " + (game.vars.score || 0) + " coins";
}

function update(dt) {
  if (input.justPressed("jump") || input.justPressed("action")) {
    game.vars.score = 0;
    game.changeScene("Level 1");
  }
}

function onClick() {
  game.vars.score = 0;
  game.changeScene("Level 1");
}
`;

// Level map, built in code so it is easy to read and change.
// Letters: G grass, D dirt, B brick, = plank (one-way), c coin,
// s slime, ^ spikes, F flag, ~ cloud
function buildLevelMap() {
  const W = 64;
  const H = 17;
  const g = Array.from({ length: H }, () => Array(W).fill('.'));
  const fill = (x0, x1, y, ch) => { for (let x = x0; x <= x1; x++) g[y][x] = ch; };
  const put = (list, ch) => list.forEach(([x, y]) => { g[y][x] = ch; });
  // Ground, with two gaps to jump over
  fill(0, 19, 15, 'G'); fill(0, 19, 16, 'D');
  fill(23, 40, 15, 'G'); fill(23, 40, 16, 'D');
  fill(45, 63, 15, 'G'); fill(45, 63, 16, 'D');
  // A small hill with spikes on top
  fill(30, 35, 14, 'G'); fill(30, 35, 15, 'D');
  // Walls at the start and end
  for (let y = 9; y <= 14; y++) { g[y][0] = 'B'; g[y][63] = 'B'; }
  // Floating platforms
  fill(7, 12, 11, '=');
  fill(15, 20, 8, '=');
  fill(25, 28, 10, 'B');
  fill(37, 42, 11, '=');
  fill(43, 50, 6, 'B');
  fill(51, 53, 9, '=');
  fill(55, 56, 12, 'B'); fill(55, 56, 13, 'B'); fill(55, 56, 14, 'B');
  // Raised ground for the goal
  fill(58, 62, 14, 'G');
  // Coins, enemies, spikes, goal, clouds
  put([[8, 10], [10, 10], [12, 10], [16, 7], [18, 7], [20, 7], [21, 12], [26, 9], [27, 9], [38, 10], [40, 10], [42, 12], [45, 5], [47, 5], [49, 5], [52, 8]], 'c');
  put([[14, 14], [27, 14], [48, 14]], 's');
  put([[32, 13], [33, 13]], '^');
  put([[60, 13]], 'F');
  put([[5, 2], [23, 1], [41, 2], [57, 1]], '~');
  return g.map((row) => row.join(''));
}
const LEVEL = buildLevelMap();
const PLAYER_START = [2, 13];

function sceneOf(store, name) {
  return store.scenes.find((s) => s.name === name);
}

export function createProjectFromTemplate(templateId, name) {
  const project = newProject(name || (templateId === 'platformer' ? 'My Platformer' : 'My Game'));
  const store = new Store(project);
  const art = {};
  for (const a of starterArt()) art[a.name] = store.addAsset(a);

  if (templateId === 'blank') {
    store.addScene({ name: 'Main' });
    store.addNode({ type: 'Camera', name: 'Camera', props: { x: 480, y: 270, stayInLevel: false } });
    store.select(null);
  } else {
    buildPlatformer(store, art);
  }
  store.history = [];
  store.future = [];
  return store.project;
}

function buildPlatformer(store, art) {
  const T = 32;
  // Level scene first so it becomes the start scene.
  const levelId = store.addScene({ name: 'Level 1' });

  // Reusable objects, each in its own scene (like Godot).
  store.addScene({ name: 'Coin', rootType: 'Sprite', rootProps: { image: art.coin, width: 24, height: 24, body: 'trigger', animSpeed: 8 } });
  store.attachNewScript(sceneOf(store, 'Coin').root.id, COIN_SCRIPT, 'coin');

  store.addScene({ name: 'Slime', rootType: 'Sprite', rootProps: { image: art.slime, width: 32, height: 32, body: 'character', gravity: true, hitboxHeight: 20, hitboxY: 6, animSpeed: 3 } });
  store.attachNewScript(sceneOf(store, 'Slime').root.id, SLIME_SCRIPT, 'slime');

  store.addScene({ name: 'Flag', rootType: 'Sprite', rootProps: { image: art.flag, width: 32, height: 64, body: 'trigger', hitboxWidth: 24 } });
  store.attachNewScript(sceneOf(store, 'Flag').root.id, FLAG_SCRIPT, 'flag');

  store.addScene({ name: 'Spikes', rootType: 'Sprite', rootProps: { image: art.spikes, width: 32, height: 32, body: 'trigger', hitboxHeight: 14, hitboxY: 9 } });
  store.attachNewScript(sceneOf(store, 'Spikes').root.id, SPIKES_SCRIPT, 'spikes');

  // You Win screen.
  const winId = store.addScene({ name: 'You Win' });
  const winRoot = store.scene(winId).root.id;
  store.attachNewScript(winRoot, WIN_SCRIPT, 'win_screen');
  store.addNode({ sceneId: winId, parentId: winRoot, type: 'Text', name: 'Title', props: { text: 'You win!', size: 64, align: 'center', x: 480, y: 160, color: '#ffe45c' } });
  store.addNode({ sceneId: winId, parentId: winRoot, type: 'Text', name: 'Final Score', props: { text: 'You collected 0 coins', size: 28, align: 'center', x: 480, y: 260 } });
  store.addNode({ sceneId: winId, parentId: winRoot, type: 'Text', name: 'Hint', props: { text: 'Press jump (or tap) to play again', size: 22, align: 'center', x: 480, y: 330, color: '#e8f4ff' } });
  store.addNode({ sceneId: winId, parentId: winRoot, type: 'Sprite', name: 'Hero', props: { image: art.hero, width: 96, height: 96, x: 480, y: 440 } });

  // Build the level.
  store.openScene(levelId);
  const root = store.scene(levelId).root.id;
  const tilemap = store.addNode({
    sceneId: levelId, parentId: root, type: 'TileMap', name: 'Ground',
    props: {
      tileSize: T,
      tiles: [
        { name: 'Grass', image: art.grass, solid: true },
        { name: 'Dirt', image: art.dirt, solid: true },
        { name: 'Brick', image: art.brick, solid: true },
        { name: 'Plank', image: art.plank, solid: false, platform: true },
        { name: 'Stone', image: art.stone, solid: true },
      ],
    },
  });
  const tileFor = { G: 0, D: 1, B: 2, '=': 3 };
  const byTile = new Map();
  LEVEL.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch in tileFor) {
        const t = tileFor[ch];
        if (!byTile.has(t)) byTile.set(t, []);
        byTile.get(t).push([x, y]);
      }
    });
  });
  for (const [t, cells] of byTile) store.paintTiles(tilemap, cells, t);

  const center = (x, y, h = T) => ({ x: x * T + T / 2, y: (y + 1) * T - h / 2 });
  LEVEL.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '~') store.addNode({ sceneId: levelId, parentId: root, type: 'Sprite', name: 'Cloud', props: { image: art.cloud, width: 128, height: 64, layer: -5, opacity: 0.9, ...center(x, y) } });
    });
  });

  const player = store.addNode({
    sceneId: levelId, parentId: root, type: 'Sprite', name: 'Player',
    props: { image: art.hero, width: 32, height: 32, body: 'character', gravity: true, hitboxWidth: 20, hitboxHeight: 28, hitboxY: 2, layer: 5, ...center(PLAYER_START[0], PLAYER_START[1]) },
  });
  store.attachNewScript(player, PLAYER_SCRIPT, 'player');

  const copies = { c: 'Coin', s: 'Slime', '^': 'Spikes', F: 'Flag' };
  LEVEL.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const sceneName = copies[ch];
      if (!sceneName) return;
      const h = ch === 'F' ? 64 : T;
      const copyId = store.addNode({ sceneId: levelId, parentId: root, type: 'SceneCopy', name: sceneName, props: { scene: sceneOf(store, sceneName).id, ...center(x, y, h) } });
      // The first slime starts walking away from the player.
      if (ch === 's' && x < 20) store.setScriptVar(copyId, 'direction', 1);
    });
  });

  store.addNode({ sceneId: levelId, parentId: root, type: 'Camera', name: 'Camera', props: { follow: 'Player', x: 480, y: 270 } });
  const score = store.addNode({ sceneId: levelId, parentId: root, type: 'Text', name: 'Score', props: { text: 'Coins: 0', size: 26, x: 20, y: 16, onScreen: true, layer: 10 } });
  store.attachNewScript(score, SCORE_SCRIPT, 'score');
  store.select(player);
}
