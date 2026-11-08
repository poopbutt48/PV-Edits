// The single list of every kind of object in Sprout.
// The game runtime, the editor's Inspector and the AI helper's documentation
// all read from this file, so a property only has to be described once.

const P = (key, type, def, label, help, extra = {}) => ({ key, type, default: def, label, help, ...extra });

const POSITION = [
  P('x', 'number', 0, 'Position X', 'How far right the object is, in pixels. Pictures and shapes are measured from their centre.', { group: 'Position' }),
  P('y', 'number', 0, 'Position Y', 'How far down the object is, in pixels. Bigger numbers are lower on the screen.', { group: 'Position' }),
  P('rotation', 'number', 0, 'Rotation', 'Turns the object, in degrees. 90 is a quarter turn clockwise.', { group: 'Position' }),
  P('scaleX', 'number', 1, 'Scale X', 'Stretches the object sideways. 1 is normal size, 2 is double.', { group: 'Position', step: 0.1 }),
  P('scaleY', 'number', 1, 'Scale Y', 'Stretches the object up and down. 1 is normal size.', { group: 'Position', step: 0.1 }),
  P('visible', 'bool', true, 'Visible', 'Untick to hide the object (and everything inside it).', { group: 'Position' }),
  P('layer', 'number', 0, 'Draw order', 'Objects with a higher number are drawn on top of objects with a lower number.', { group: 'Position' }),
];

const PHYSICS = [
  P('body', 'enum', 'none', 'Body type', 'How this object takes part in collisions.', {
    group: 'Physics',
    options: [
      ['none', 'None - just decoration'],
      ['solid', 'Solid - walls and floors that never move'],
      ['platform', 'Platform - stand on top, jump up through it'],
      ['character', 'Character - moves and bumps into solids'],
      ['trigger', 'Trigger - notices touches, blocks nothing'],
    ],
  }),
  P('gravity', 'bool', false, 'Falls with gravity', 'Characters with this ticked fall down until they land on something solid.', { group: 'Physics', showIf: (p) => p.body === 'character' }),
  P('hitboxWidth', 'number', 0, 'Hitbox width', 'Width of the invisible box used for bumping and touching. 0 means the same size as the picture.', { group: 'Physics', showIf: (p) => p.body !== 'none' }),
  P('hitboxHeight', 'number', 0, 'Hitbox height', 'Height of the invisible collision box. 0 means the same size as the picture.', { group: 'Physics', showIf: (p) => p.body !== 'none' }),
  P('hitboxX', 'number', 0, 'Hitbox shift X', 'Moves the collision box sideways from the centre.', { group: 'Physics', showIf: (p) => p.body !== 'none' }),
  P('hitboxY', 'number', 0, 'Hitbox shift Y', 'Moves the collision box up or down from the centre.', { group: 'Physics', showIf: (p) => p.body !== 'none' }),
];

export const NODE_TYPES = {
  Group: {
    label: 'Group',
    icon: '📁',
    summary: 'An empty container. Put objects inside it to move or hide them together.',
    props: [...POSITION],
  },
  Sprite: {
    label: 'Sprite',
    icon: '🖼️',
    summary: 'Shows a picture. Use it for players, enemies, coins and scenery.',
    props: [
      ...POSITION,
      P('image', 'image', '', 'Picture', 'Which picture from your Assets to show.', { group: 'Look' }),
      P('width', 'number', 0, 'Width', 'Display width in pixels. 0 means the picture’s own width.', { group: 'Look' }),
      P('height', 'number', 0, 'Height', 'Display height in pixels. 0 means the picture’s own height.', { group: 'Look' }),
      P('flipX', 'bool', false, 'Flip sideways', 'Mirrors the picture left-to-right. Handy for making a character face the other way.', { group: 'Look' }),
      P('flipY', 'bool', false, 'Flip upside down', 'Mirrors the picture top-to-bottom.', { group: 'Look' }),
      P('opacity', 'number', 1, 'Opacity', '1 is fully visible, 0.5 is see-through, 0 is invisible.', { group: 'Look', step: 0.1, min: 0, max: 1 }),
      P('animSpeed', 'number', 8, 'Animation speed', 'For pictures with several frames: frames shown per second. 0 stops the animation.', { group: 'Look' }),
      ...PHYSICS,
    ],
  },
  Shape: {
    label: 'Shape',
    icon: '⬛',
    summary: 'A coloured rectangle or circle. Great for quick prototypes, walls and platforms.',
    props: [
      ...POSITION,
      P('shape', 'enum', 'rect', 'Shape', 'Rectangle or circle.', { group: 'Look', options: [['rect', 'Rectangle'], ['circle', 'Circle']] }),
      P('width', 'number', 64, 'Width', 'Width in pixels.', { group: 'Look' }),
      P('height', 'number', 64, 'Height', 'Height in pixels.', { group: 'Look' }),
      P('color', 'color', '#4caf50', 'Colour', 'Fill colour.', { group: 'Look' }),
      P('opacity', 'number', 1, 'Opacity', '1 is fully visible, 0 is invisible.', { group: 'Look', step: 0.1, min: 0, max: 1 }),
      ...PHYSICS,
    ],
  },
  Text: {
    label: 'Text',
    icon: '🔤',
    summary: 'Shows words on screen, like a score, a title or a message.',
    props: [
      ...POSITION,
      P('text', 'text', 'Hello!', 'Text', 'The words to show. Scripts can change this, for example to show the score.', { group: 'Look', multiline: true }),
      P('size', 'number', 24, 'Font size', 'How big the letters are, in pixels.', { group: 'Look' }),
      P('color', 'color', '#ffffff', 'Colour', 'Colour of the letters.', { group: 'Look' }),
      P('font', 'enum', 'sans', 'Font', 'Letter style.', { group: 'Look', options: [['sans', 'Clean'], ['serif', 'Classic'], ['mono', 'Typewriter'], ['round', 'Rounded']] }),
      P('align', 'enum', 'left', 'Align', 'Which side of the position the text starts from.', { group: 'Look', options: [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] }),
      P('outline', 'bool', true, 'Dark outline', 'Draws a dark edge around the letters so they are readable on any background.', { group: 'Look' }),
      P('onScreen', 'bool', false, 'Stick to screen', 'Keeps the text in the same place on screen even when the camera moves. Use it for scores and health bars.', { group: 'Look' }),
    ],
  },
  TileMap: {
    label: 'Tile Map',
    icon: '🧱',
    summary: 'A grid you paint tiles onto, like grass, bricks and spikes. The fastest way to build levels.',
    props: [
      P('x', 'number', 0, 'Position X', 'Where the top-left corner of the grid is.', { group: 'Position' }),
      P('y', 'number', 0, 'Position Y', 'Where the top-left corner of the grid is.', { group: 'Position' }),
      P('visible', 'bool', true, 'Visible', 'Untick to hide the tiles.', { group: 'Position' }),
      P('layer', 'number', -1, 'Draw order', 'Higher numbers are drawn on top.', { group: 'Position' }),
      P('tileSize', 'number', 32, 'Tile size', 'Width and height of each grid square, in pixels.', { group: 'Tiles' }),
      P('tiles', 'tiles', [], 'Tile types', 'The kinds of tile you can paint, and whether each one is solid.', { group: 'Tiles' }),
      P('cells', 'cells', {}, 'Painted tiles', 'Which tile is painted in each square. Paint them in the Scene view.', { group: 'Tiles', hidden: true }),
    ],
  },
  Camera: {
    label: 'Camera',
    icon: '🎥',
    summary: 'Decides which part of the level the player sees. It can follow the player around.',
    props: [
      P('x', 'number', 0, 'Position X', 'Where the camera looks when it is not following anything.', { group: 'Position' }),
      P('y', 'number', 0, 'Position Y', 'Where the camera looks when it is not following anything.', { group: 'Position' }),
      P('follow', 'nodeName', '', 'Follow', 'Name of the object the camera keeps in the middle of the screen, for example Player.', { group: 'Camera' }),
      P('zoom', 'number', 1, 'Zoom', '1 is normal, 2 is zoomed in twice as close.', { group: 'Camera', step: 0.1 }),
      P('smoothing', 'number', 0.15, 'Smoothing', 'How gently the camera catches up. 0 snaps instantly, 0.3 is very floaty.', { group: 'Camera', step: 0.05, min: 0, max: 0.95 }),
      P('stayInLevel', 'bool', true, 'Stay inside level', 'Stops the camera from showing empty space past the edges of your Tile Maps.', { group: 'Camera' }),
    ],
  },
  SceneCopy: {
    label: 'Scene Copy',
    icon: '🔗',
    summary: 'Places a copy of another scene, like one Coin or one Enemy. Change the original and every copy updates.',
    props: [
      P('x', 'number', 0, 'Position X', 'Where to place the copy.', { group: 'Position' }),
      P('y', 'number', 0, 'Position Y', 'Where to place the copy.', { group: 'Position' }),
      P('scene', 'scene', '', 'Scene', 'Which scene to place a copy of.', { group: 'Scene' }),
    ],
  },
};

export const NODE_TYPE_ORDER = ['Sprite', 'Shape', 'Text', 'TileMap', 'Camera', 'SceneCopy', 'Group'];

export const BODY_TYPES = ['none', 'solid', 'platform', 'character', 'trigger'];

export function propDefs(type) {
  return NODE_TYPES[type] ? NODE_TYPES[type].props : [];
}

export function propDef(type, key) {
  return propDefs(type).find((p) => p.key === key) || null;
}

export function defaultProps(type) {
  const out = {};
  for (const p of propDefs(type)) out[p.key] = cloneValue(p.default);
  return out;
}

export function cloneValue(v) {
  if (v === null || typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

// Turns whatever the user (or AI) typed into the right kind of value for a property.
export function coerceProp(type, key, value) {
  const def = propDef(type, key);
  if (!def) throw new Error(`A ${type} has no property called "${key}".`);
  switch (def.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : parseFloat(value);
      if (!Number.isFinite(n)) throw new Error(`"${def.label}" needs a number.`);
      let v = n;
      if (def.min !== undefined) v = Math.max(def.min, v);
      if (def.max !== undefined) v = Math.min(def.max, v);
      return v;
    }
    case 'bool':
      if (typeof value === 'string') return value === 'true' || value === '1' || value === 'yes';
      return !!value;
    case 'enum': {
      const ok = def.options.map((o) => o[0]);
      if (!ok.includes(value)) throw new Error(`"${def.label}" must be one of: ${ok.join(', ')}.`);
      return value;
    }
    case 'color': {
      const s = String(value).trim();
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) throw new Error(`"${def.label}" needs a colour like #ff8800.`);
      return s.length === 4 ? '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3] : s.toLowerCase();
    }
    case 'tiles':
      if (!Array.isArray(value)) throw new Error('Tile types must be a list.');
      return value.map(normalizeTile);
    case 'cells':
      if (typeof value !== 'object' || value === null) throw new Error('Painted tiles must be an object.');
      return value;
    default:
      return value == null ? '' : String(value);
  }
}

export function normalizeTile(t) {
  return {
    name: String(t.name || 'Tile'),
    image: t.image || '',
    color: t.color || '#8d6e63',
    solid: t.solid !== undefined ? !!t.solid : true,
    platform: !!t.platform,
  };
}
