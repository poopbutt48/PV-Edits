// Documentation for everything a script can use.
// Shown in the editor's "Script help" panel, used for code autocomplete,
// and given to the AI helper so it writes code that actually works.

export const SCRIPT_EVENTS = [
  { name: 'start()', doc: 'Runs once, when the object first appears in the game.' },
  { name: 'update(dt)', doc: 'Runs every frame (about 60 times a second). dt is the number of seconds since the last frame, usually about 0.016.' },
  { name: 'onTouch(other)', doc: 'Runs when this object starts touching another object. Needs a Body type. Fires for Trigger bodies, and when two Characters touch.' },
  { name: 'onTouchEnd(other)', doc: 'Runs when this object stops touching another object.' },
  { name: 'onClick()', doc: 'Runs when the player clicks or taps this object.' },
  { name: 'onDestroy()', doc: 'Runs just before this object is removed.' },
];

export const API_GROUPS = [
  {
    title: 'me - the object this script is attached to',
    prefix: 'me.',
    items: [
      ['me.x, me.y', 'Position in pixels. Change them to move the object.'],
      ['me.velocity.x, me.velocity.y', 'Speed in pixels per second. Characters move by this much automatically, bumping into solids.'],
      ['me.rotation', 'Turn angle in degrees.'],
      ['me.scaleX, me.scaleY', 'Size multiplier. 1 is normal.'],
      ['me.visible', 'true or false.'],
      ['me.opacity', '0 (invisible) to 1 (solid).'],
      ['me.flipX', 'true mirrors a Sprite so it faces the other way.'],
      ['me.image', 'Name of the picture a Sprite shows. Set it to switch pictures, e.g. me.image = "player_jump".'],
      ['me.frame', 'Which animation frame a Sprite is showing, starting at 0.'],
      ['me.text', 'The words a Text object shows.'],
      ['me.color', 'Colour of a Shape or Text, like "#ff0000".'],
      ['me.name', 'The object’s name, like "Player".'],
      ['me.vars', 'A place to store your own numbers and words on this object, e.g. me.vars.health = 3.'],
      ['me.isOnFloor()', 'true if a Character is standing on something.'],
      ['me.isOnWall()', 'true if a Character bumped into something sideways this frame.'],
      ['me.isOnCeiling()', 'true if a Character bumped its head this frame.'],
      ['me.left, me.right, me.top, me.bottom', 'Edges of the hitbox in the world (read only).'],
      ['me.touching(name)', 'true if this object is touching an object with that name right now.'],
      ['me.distanceTo(other)', 'Distance in pixels to another object.'],
      ['me.moveToward(x, y, step)', 'Moves up to step pixels toward a point.'],
      ['me.find(name)', 'Finds an object inside this one by name.'],
      ['me.destroy()', 'Removes this object from the game.'],
      ['me.flash(seconds)', 'Makes the object blink, e.g. after getting hurt.'],
    ],
  },
  {
    title: 'input - keyboard, touch and mouse',
    prefix: 'input.',
    items: [
      ['input.isDown("left")', 'true while an action is held. Built-in actions: left, right, up, down, jump, action.'],
      ['input.justPressed("jump")', 'true only on the frame the action was first pressed.'],
      ['input.justReleased("jump")', 'true only on the frame the action was let go.'],
      ['input.axis("left", "right")', '-1, 0 or 1. Handy for movement: me.velocity.x = input.axis("left", "right") * speed.'],
      ['input.mouseX, input.mouseY', 'Where the mouse or finger is, in world pixels.'],
      ['input.mouseDown', 'true while the mouse button or a finger is pressed.'],
      ['input.isKeyDown("KeyQ")', 'Checks a specific keyboard key by its code.'],
    ],
  },
  {
    title: 'game - the whole game',
    prefix: 'game.',
    items: [
      ['game.find("Player")', 'Finds the first object with that name, or null.'],
      ['game.findAll("Coin")', 'Finds every object with that name, as a list.'],
      ['game.spawn("Bullet", x, y)', 'Creates a copy of a scene at a position and returns it.'],
      ['game.changeScene("Level 2")', 'Switches to another scene.'],
      ['game.restart()', 'Restarts the current scene and clears game.vars.'],
      ['game.vars', 'Numbers and words that last between scenes, e.g. game.vars.score.'],
      ['game.time', 'Seconds since the scene started.'],
      ['game.width, game.height', 'Size of the game screen in pixels.'],
      ['game.camera', 'The active Camera object (or null).'],
      ['game.isSolidAt(x, y)', 'true if a solid tile, platform or solid object is at that point. Enemies use it to turn around at the edge of a drop.'],
      ['game.shake(strength, seconds)', 'Shakes the camera, e.g. game.shake(8, 0.3).'],
      ['game.pause() / game.resume()', 'Freezes and unfreezes everything except onClick.'],
    ],
  },
  {
    title: 'Helpers',
    prefix: '',
    items: [
      ['playSound("coin")', 'Plays a sound. Built-in sounds: jump, coin, hit, explosion, powerup, laser, click, win, lose. Imported sounds use their asset name.'],
      ['playMusic("song") / stopMusic()', 'Loops an imported sound as background music.'],
      ['after(seconds, () => { ... })', 'Runs code once, after a delay.'],
      ['every(seconds, () => { ... })', 'Runs code again and again, with a delay between each time.'],
      ['random(min, max)', 'A random decimal number between min and max.'],
      ['randomInt(min, max)', 'A random whole number from min to max (both included).'],
      ['chance(0.25)', 'true 25% of the time.'],
      ['clamp(value, min, max)', 'Keeps a number between two limits.'],
      ['lerp(a, b, t)', 'Blends between a and b. t = 0 gives a, t = 1 gives b.'],
      ['log(...things)', 'Prints to the Output panel, to help find bugs. print() does the same.'],
    ],
  },
];

export const SCRIPT_BASICS = `Scripts are JavaScript. Each object with a script gets its own copy of the script.
Variables written at the top of the script (outside the functions) belong to that one object.
Top-level "let name = value;" lines with a number, word or true/false become settings you can change per object in the Inspector.`;

export const EXAMPLE_PLAYER_SCRIPT = `// Player controls for a platformer.
let speed = 260;      // how fast the player runs
let jumpPower = 560;  // how high the player jumps

function update(dt) {
  // Run left and right
  me.velocity.x = input.axis("left", "right") * speed;
  if (me.velocity.x !== 0) me.flipX = me.velocity.x < 0;

  // Jump, but only when standing on something
  if (input.justPressed("jump") && me.isOnFloor()) {
    me.velocity.y = -jumpPower;
    playSound("jump");
  }

  // Fell off the level? Start again.
  if (me.y > 2000) game.restart();
}
`;

// Plain-text version for the AI's instructions.
export function apiDocsText() {
  let s = 'SCRIPT EVENTS (define any of these functions):\n';
  for (const e of SCRIPT_EVENTS) s += `- ${e.name}: ${e.doc}\n`;
  for (const g of API_GROUPS) {
    s += `\n${g.title.toUpperCase()}:\n`;
    for (const [n, d] of g.items) s += `- ${n}: ${d}\n`;
  }
  s += '\n' + SCRIPT_BASICS + '\n';
  return s;
}
