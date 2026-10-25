// NBRZ Forge service worker: works offline after the first visit, but always prefers the
// network so new deploys show up immediately.
const CACHE = 'nbrz-forge-v2';
const CORE = [
  './', 'index.html', 'studio.css', 'manifest.webmanifest', 'catalog.json',
  'js/main.js', 'js/viewport.js', 'js/history.js', 'js/shapes.js', 'js/tools.js', 'js/sculpt.js', 'js/io.js',
  'js/prompt.js', 'js/xr.js', 'js/perform/stage.js', 'js/perform/motion.js',
  'js/audio/engine.js', 'js/audio/instruments.js', 'js/audio/sequencer.js', 'js/audio/deck.js', 'js/audio/spatial.js',
  'vendor/three/build/three.module.min.js', 'vendor/three/build/three.core.min.js',
  'vendor/csg/three-bvh-csg.module.js', 'vendor/csg/three-mesh-bvh.module.js', 'vendor/three/fonts/helvetiker_bold.typeface.json',
  'pocket/', 'pocket/index.html', 'pocket/pocket.css', 'pocket/pocket.js', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com|webxr-input-profiles/.test(url.href);
  if (!cacheable || url.hostname.endsWith('anthropic.com')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())),
  );
});
