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
    Promise.all([
      caches.open(CACHE_NAME)
        .then(cache => cache.addAll(PRECACHE))
        // skipWaiting SOLO tras completar el addAll: si el precache del shell
        // falla a medias, el SW nuevo no toma control con una caché incompleta
        // (evita la pantalla en blanco que motivó este rediseño).
        .then(() => self.skipWaiting()),
      sembrarCatalogo(),
    ])
  );
});

// catalogo.json / instrucciones.json (~800 KB) sembrados en el install para
// que el buscador del catálogo funcione offline aunque el usuario NUNCA haya
// abierto el picker con red — el warming de app.js solo cubre imágenes, y
// stale-while-revalidate solo cachea lo que ya se pidió al menos una vez.
// Solo si no están ya en gymlog-catalogo: no tiene sentido re-bajar ~800 KB
// en cada deploy, ya que esta caché persiste entre versiones (no la borra
// activate). Tolerante a fallos: si la red falla acá, el precache del shell
// sigue su curso igual — el SWR normal los repone en cuanto haya red.
function sembrarCatalogo() {
  const urls = [
    `${self.registration.scope}assets/catalogo/catalogo.json`,
    `${self.registration.scope}assets/catalogo/instrucciones.json`,
  ];
  return caches.open(CATALOGO_CACHE)
    .then(cache => Promise.all(urls.map(url =>
      // ignoreVary: el fetch de acá va en modo cors (con header Origin); el
      // <img>/fetch real de la página puede ir sin él (no-cors) — mismo
      // motivo que el resto de .match() del archivo (ver nota en fetch).
      cache.match(url, { ignoreVary: true }).then(cached => {
        if (cached) return;
        return fetch(url)
          .then(response => { if (response.ok) return cache.put(url, response); })
          .catch(() => {});
      })
    )))
    .catch(() => {});
}

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

// Todas las llamadas a .match() de este archivo pasan { ignoreVary: true }.
// Motivo: algunos hostings (vite preview/sirv, y potencialmente cualquiera)
// responden con `Vary: Origin`. El fetch de cache.addAll() en install va en
// modo cors y lleva header Origin; la petición real de un <img> de la página
// va en no-cors, sin Origin → el algoritmo de Vary de la Cache API no
// matchea esa entrada aunque la URL sea idéntica → miss en todo lo que solo
// existe por precache (QR, íconos, y hasta el fallback del shell → pantalla
// blanca). Para assets estáticos same-origin, Vary es irrelevante: ignorarlo
// es el fix estándar.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return; // beacons POST (telemetría) pasan directo a la red
  // Extensiones del navegador (chrome-extension://, moz-extension://, etc.)
  // interceptadas por el propio SW: Cache.put() lanza TypeError con esos
  // esquemas ("Request scheme 'chrome-extension' is unsupported"). No son
  // peticiones nuestras — directo a la red, sin respondWith.
  if (!event.request.url.startsWith('http')) return;

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
  return caches.match(request, { ignoreVary: true }).then(cached => {
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
    }).catch(() => caches.match(request, { ignoreVary: true }).then(cached => cached ?? Response.error()));
  }

  const enRed = fetch(request).then(response => {
    if (response.ok && response.type !== 'opaque') {
      const clone = response.clone();
      event.waitUntil(caches.open(cacheName).then(c => c.put(request, clone)));
    }
    return response;
  }).catch(() => null);

  return caches.match(request, { ignoreVary: true }).then(cached => cached ?? enRed.then(r => r ?? Response.error()));
}

// Resto del shell: cache-first con cache-on-fetch, como antes del split.
function cacheFirstConFetch(event, cacheName) {
  const { request } = event;
  return caches.match(request, { ignoreVary: true }).then(cached => {
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
        return caches.match(self.registration.scope, { ignoreVary: true })
          .then(shell => shell ?? Response.error());
      }
      return Response.error();
    });
  });
}
