// Offline cache for the web version. Bump VERSION when files change.
const VERSION = 'strobe-tuner-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/saira-var.woff',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/audio.js', 'js/capture-worklet.js', 'js/fft.js', 'js/headstock.js', 'js/learn.js',
  'js/music.js', 'js/pitch.js', 'js/references.js', 'js/store.js', 'js/strobe-engine.js', 'js/strobe-view.js',
  'js/sweeteners.js', 'js/temperaments.js', 'js/tone.js', 'js/tuner-core.js', 'js/tunings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first so updates arrive promptly; fall back to the cache offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
