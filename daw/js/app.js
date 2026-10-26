'use strict';
/* Beatforge — boot: restore or create a project, wire audio, build every view. */
(() => {
const DAW = window.DAW;
const U = DAW.util, S = DAW.state, ui = DAW.ui;

async function boot() {
  DAW.settings.apply();
  await DAW.samples.loadUserList();
  let restored = false;
  if (DAW.settings.get('restoreLast')) { try { restored = await S.loadLast(); } catch (e) { console.warn('restore failed', e); } }
  if (!restored) {
    S.newProject('house');
    S.p.meta.name = 'Untitled';
  }
  DAW.audio.attach();
  ui.buildShell();
  ui.buildKeyboard();
  ui.order.forEach(id => { const v = ui.views[id]; if (v && v.build) v.build(); });
  ui.show('rack');

  const first = () => { DAW.audio.ensure().then(() => DAW.samples.preload(S.p)); ui.midi.connect(); };
  document.addEventListener('pointerdown', first, { once: true });
  document.addEventListener('keydown', first, { once: true });

  /* auto-save */
  let timer = 0;
  const arm = () => {
    clearInterval(timer);
    const sec = DAW.settings.get('autosave');
    if (sec) timer = setInterval(() => { if (S.dirty && S.p.meta.name) S.saveLocal().catch(() => {}); }, sec * 1000);
  };
  arm(); DAW.settings.on('autosave', arm);
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.dirty) S.saveLocal().catch(() => {}); });
  window.addEventListener('pagehide', () => { if (S.dirty) S.saveLocal().catch(() => {}); });

  /* drag & drop */
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault();
    for (const f of Array.from(e.dataTransfer.files || [])) {
      if (/\.(mid|midi)$/i.test(f.name)) await ui.importMidiFile(f);
      else if (/\.json$/i.test(f.name)) await ui.importProjectFile(f);
      else if (/^audio\//.test(f.type) || /\.(wav|mp3|ogg|flac|m4a)$/i.test(f.name)) { await DAW.samples.importFile(f); ui.toast('Imported ' + f.name); S.emit('samples'); }
    }
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  DAW.ready = true;
  S.emit('ready');
}
document.addEventListener('DOMContentLoaded', () => { boot().catch(e => { console.error(e); document.body.prepend(U.h('pre', { style: 'color:#f88;padding:1rem;white-space:pre-wrap' }, 'Beatforge failed to start:\n' + (e && e.stack || e))); }); });
})();
