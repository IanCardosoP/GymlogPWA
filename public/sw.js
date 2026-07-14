// Service Worker: estrategia Cache-First. Cachea recursos al vuelo en la primera carga.
// Sin ASSETS_TO_CACHE hardcodeados — compatible con filenames hasheados de Vite.
// Nota: las fuentes woff2 (JetBrains Mono) se sirven same-origin y entran por
// esta misma vía cache-on-fetch → disponibles offline tras la primera carga.

// __APP_VERSION__ lo reemplaza el build (ver plugin `sello-de-version` en
// vite.config.js) por «version de package.json + sha del commit». Nunca escribas
// aquí un número a mano: el build falla si el placeholder no está.
// En `pnpm run dev` el literal queda tal cual — es una constante estable, inocua.
const CACHE_NAME = 'gymlog-v__APP_VERSION__';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // beacons POST (telemetría) pasan directo a la red
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(self.registration.scope));
    })
  );
});
