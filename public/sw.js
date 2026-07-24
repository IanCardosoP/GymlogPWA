// Service Worker: dos cachés independientes.
//  - CACHE_NAME     (gymlog-v<version>+<sha>): shell versionado por deploy —
//    HTML, JS/CSS hasheados, fuentes. Se invalida entero en cada push a main
//    (ver plugin `sello-de-version` en vite.config.js).
//  - CATALOGO_CACHE (gymlog-catalogo): datos de referencia del catálogo de
//    ejercicios (873 movimientos, ~9 MB de imágenes). SIN versión — sobrevive
//    los deploys porque el contenido es de referencia estático: las imágenes
//    son inmutables por nombre de archivo y catalogo.json/instrucciones.json
//    se refrescan con stale-while-revalidate, nunca con un borrado completo.
// Sin ASSETS_TO_CACHE hardcodeados para el resto del shell — compatible con
// filenames hasheados de Vite; se cachean al vuelo en la primera carga
// (cache-on-fetch), salvo lo listado en PRECACHE (ver abajo).

// Dos placeholders los reemplaza el build (plugin `sello-de-version` en
// vite.config.js): CACHE_NAME por «version de package.json + sha del commit»,
// PRECACHE por el array JSON de URLs del shell a precachear. Nunca escribas
// aquí un valor a mano: el build falla si cualquiera de los dos no está — es
// el seguro contra volver a fijarlos manualmente.
// En `pnpm run dev` los literales quedan tal cual — inocuo, porque el SW no
// se registra en localhost (ver app.js).
const CACHE_NAME = 'gymlog-v__APP_VERSION__';
const CATALOGO_CACHE = 'gymlog-catalogo';
const PRECACHE = '__PRECACHE_MANIFEST__';

const esImagenCatalogo = pathname => pathname.includes('/assets/catalogo/img/');
const esDatoCatalogo = pathname =>
  pathname.endsWith('/assets/catalogo/catalogo.json') ||
  pathname.endsWith('/assets/catalogo/instrucciones.json');

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      // skipWaiting SOLO tras completar el addAll: si el precache del shell
      // falla a medias, el SW nuevo no toma control con una caché incompleta
      // (evita la pantalla en blanco que motivó este rediseño).
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          // Solo cachés de shell versionadas. `gymlog-catalogo` NUNCA se toca
          // aquí — es justo lo que la separa de la caché monolítica anterior.
          .filter(k => k.startsWith('gymlog-v') && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // beacons POST (telemetría) pasan directo a la red

  const { pathname } = new URL(event.request.url);

  if (esImagenCatalogo(pathname)) {
    event.respondWith(cacheFirstPuro(event, CATALOGO_CACHE));
    return;
  }

  if (esDatoCatalogo(pathname)) {
    event.respondWith(staleWhileRevalidate(event, CATALOGO_CACHE));
    return;
  }

  event.respondWith(cacheFirstConFetch(event, CACHE_NAME));
});

// Imágenes del catálogo: inmutables por nombre de archivo (el generador nunca
// reescribe un _0.webp/_1.webp existente) → cache-first puro, sin fallback de
// shell (una imagen fallida no es una navegación).
function cacheFirstPuro(event, cacheName) {
  const { request } = event;
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok && response.type !== 'opaque') {
        const clone = response.clone();
        // waitUntil: si el navegador mata el SW antes de terminar el put, la
        // entrada quedaría a medias (visto en Safari/iOS, que es agresivo).
        event.waitUntil(caches.open(cacheName).then(c => c.put(request, clone)));
      }
      return response;
    }).catch(() => Response.error());
  });
}

// catalogo.json / instrucciones.json sí cambian (nuevos ejercicios): se sirve
// la caché al instante si existe y se refresca en segundo plano para la
// próxima vez — nunca bloquea la respuesta esperando a la red.
//
// Excepción: si quien pide el recurso puso cache:'reload' (o 'no-store' /
// 'no-cache') — el botón «Descargar catálogo» de config.js, precisamente
// para traer ejercicios nuevos que el PM haya publicado — se invierte a
// network-first: la respuesta que recibe el llamador ES la de red (no la
// copia vieja), y de paso se refresca gymlog-catalogo igual. Si la red
// falla, cae a la copia cacheada en vez de romper.
function staleWhileRevalidate(event, cacheName) {
  const { request } = event;

  if (request.cache === 'reload' || request.cache === 'no-store' || request.cache === 'no-cache') {
    return fetch(request).then(response => {
      if (response.ok && response.type !== 'opaque') {
        const clone = response.clone();
        event.waitUntil(caches.open(cacheName).then(c => c.put(request, clone)));
      }
      return response;
    }).catch(() => caches.match(request).then(cached => cached ?? Response.error()));
  }

  const enRed = fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque') {
      const clone = response.clone();
      event.waitUntil(caches.open(cacheName).then(c => c.put(request, clone)));
    }
    return response;
  }).catch(() => null);

  return caches.match(request).then(cached => cached ?? enRed.then(r => r ?? Response.error()));
}

// Resto del shell: cache-first con cache-on-fetch, como antes del split.
function cacheFirstConFetch(event, cacheName) {
  const { request } = event;
  return caches.match(request).then(cached => {
    if (cached) return cached;
    return fetch(request).then(response => {
      if (response.ok && response.type !== 'opaque') {
        const clone = response.clone();
        // waitUntil: si el navegador mata el SW antes de terminar el put, la
        // entrada quedaría a medias (visto en Safari/iOS, que es agresivo).
        event.waitUntil(caches.open(cacheName).then(c => c.put(request, clone)));
      }
      return response;
    }).catch(() => {
      // Solo la navegación cae al shell de la SPA. Devolver el index.html a un
      // <img>/JSON fallido lo dejaría "cargado" con cuerpo HTML → imagen en
      // blanco sin reintento (síntoma real en Safari/iOS, cuyos fetch dentro
      // del SW fallan de forma intermitente).
      if (request.mode === 'navigate') {
        return caches.match(self.registration.scope)
          .then(shell => shell ?? Response.error());
      }
      return Response.error();
    });
  });
}
