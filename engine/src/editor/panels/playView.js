// Runs the game inside the editor, with Stop / Restart and friendly errors.
import { h, clear } from '../dom.js';
import { Game } from '../../runtime/game.js';
import { AudioSystem } from '../../runtime/audio.js';

export class PlayView {
  constructor(editor, el) {
    this.editor = editor;
    this.el = el;
    this.game = null;
    this.audio = new AudioSystem();
    this.stage = h('div', { class: 'play-stage', 'data-ai': 'game-view', 'data-ai-label': 'the running game' });
    this.banner = h('div', { class: 'play-error', hidden: true, role: 'alert' });
    this.muteBtn = h('button', { class: 'btn btn-small', onclick: () => this.toggleMute() }, '🔊');
    this.sceneLabel = h('span', { class: 'play-label' });
    el.append(
      h('div', { class: 'play-toolbar' },
        h('button', { class: 'btn btn-small btn-danger', 'data-ai': 'play-stop', onclick: () => this.editor.stop() }, '■ Stop'),
        h('button', { class: 'btn btn-small', 'data-ai': 'play-restart', onclick: () => this.restart() }, '⟳ Restart'),
        this.muteBtn,
        this.sceneLabel,
        h('span', { class: 'play-tip' }, 'Arrows / WASD to move · Space to jump · Esc to stop')),
      this.stage,
      this.banner,
    );
  }

  async start(sceneId) {
    this.stop();
    this.lastScene = sceneId;
    this.el.hidden = false;
    clear(this.stage);
    this.banner.hidden = true;
    const project = JSON.parse(JSON.stringify(this.editor.store.project));
    const scene = sceneId ? project.scenes[sceneId] : project.scenes[project.settings.startScene] || project.scenes[project.sceneOrder[0]];
    if (!scene) { this.showBanner({ message: 'There is no scene to play yet. Create a scene first.' }); return; }
    this.sceneLabel.textContent = `Playing: ${scene.name}`;
    this.audio.ensure();
    this.audio.resume();
    const game = new Game(project, this.stage, {
      audio: this.audio,
      onLog: ({ text, object }) => this.editor.output.log(text, object),
      onError: (info) => { this.editor.output.error(info); this.showBanner(info); },
    });
    this.game = game;
    try {
      await game.start(scene.id);
    } catch (err) {
      this.showBanner({ message: err.message });
    }
  }

  restart() {
    this.start(this.lastScene);
  }

  stop() {
    if (this.game) {
      this.game.stop();
      this.game = null;
    }
    clear(this.stage);
    this.el.hidden = true;
    this.banner.hidden = true;
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.muteBtn.textContent = this.audio.muted ? '🔇' : '🔊';
  }

  showBanner(info) {
    clear(this.banner);
    this.banner.hidden = false;
    this.banner.append(
      h('div', { class: 'play-error-title' }, '⚠ The game stopped because of a problem'),
      h('div', { class: 'play-error-msg' }, info.message),
      info.script ? h('div', { class: 'play-error-where' }, `In ${info.script}${info.line ? `, line ${info.line}` : ''}${info.objectName ? `, on "${info.objectName}"` : ''}`) : null,
      h('div', { class: 'play-error-actions' },
        info.scriptId ? h('button', { class: 'btn btn-small', onclick: () => { this.editor.stop(); this.editor.openScript(info.scriptId, info.line); } }, 'Show me the line') : null,
        info.script ? h('button', { class: 'btn btn-small btn-ai', 'data-ai': 'banner-fix-ai', onclick: () => { this.editor.stop(); this.editor.ai.askToFix(info); } }, '🤖 Fix it with AI') : null,
        this.game ? h('button', { class: 'btn btn-small', onclick: () => { this.banner.hidden = true; if (this.game) { this.game.errorPaused = false; this.game.paused = false; } } }, 'Keep playing') : null));
  }

  screenshot() {
    const c = this.stage.querySelector('canvas');
    if (!c) return null;
    try { return c.toDataURL('image/png'); } catch (_) { return null; }
  }
}
