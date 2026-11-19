// Guarda la app en el móvil para que funcione sin conexión (gimnasio sin cobertura, viaje).
const CACHE = 'mixie-v3';
importScripts('media.js');
const MEDIA_FILES = [...new Set(Object.values(self.MIXIE.MEDIA).flatMap((m) => (m.frames || [m.src, m.poster]).filter(Boolean)))];
const CORE = ['./', 'index.html', 'styles.css', 'data.js', 'media.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', ...MEDIA_FILES];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Primero la copia guardada (rápido y sin conexión) y, en segundo plano, se actualiza desde la red.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const key = req.mode === 'navigate' ? 'index.html' : req;
    const cached = await cache.match(key);
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
