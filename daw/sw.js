/* Beatforge service worker: cache the app shell so it opens offline. */
const CACHE = 'beatforge-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/util.js', 'js/settings.js', 'js/db.js', 'js/fx.js', 'js/inst.js', 'js/samples.js', 'js/state.js', 'js/audio.js', 'js/seq.js',
  'js/templates.js', 'js/export.js', 'js/ui-widgets.js', 'js/ui-shell.js', 'js/ui-rack.js', 'js/ui-channel.js', 'js/ui-browser.js',
  'js/ui-mixer.js', 'js/ui-piano.js', 'js/ui-playlist.js', 'js/ui-auto.js', 'js/ui-keyboard.js', 'js/ui-tools.js', 'js/app.js',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // network first so updates show up, cache as fallback for offline use
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
