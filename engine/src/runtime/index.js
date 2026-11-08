// Entry point for exported games: a single HTML file that runs a project.
import { Game } from './game.js';
import { AudioSystem } from './audio.js';

export { Game, AudioSystem };

export async function play(container, project, options = {}) {
  const game = new Game(project, container, options);
  await game.start(options.scene);
  return game;
}

// Used by exported games: shows errors on screen instead of failing silently.
export async function boot(project) {
  const container = document.getElementById('game');
  const errorBox = document.getElementById('error');
  const unlock = () => game && game.audio.resume();
  let game = null;
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  game = await play(container, project, {
    onError(info) {
      errorBox.style.display = 'block';
      errorBox.textContent = `Oops! ${info.message}\n(${info.script}${info.line ? ', line ' + info.line : ''}, on "${info.objectName}")`;
    },
  });
  return game;
}
