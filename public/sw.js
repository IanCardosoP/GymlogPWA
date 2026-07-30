// Service Worker: tres cachés, partidas por MUTABILIDAD del contenido.
//
//  - SHELL_CACHE  (gymlog-shell-v<version>+<sha>): los pocos recursos de nombre
//    fijo cuyo contenido cambia en cada deploy — index.html, manifest.json,
//    iconos. Son ~30 KB. Se borra entera en cada activate.
//  - ASSETS_CACHE (gymlog-assets): TODO lo que Vite emite con hash de contenido
//    en el nombre — JS, CSS, .wasm, .data, .woff2. Al llevar hash, son
//    inmutables: una entrada existente ES la versión correcta. SIN versión, y
//    activate() la PODA contra el manifiesto en vez de borrarla.
//  - CATALOGO_CACHE (gymlog-catalogo): datos de referencia del catálogo (873
//    movimientos, ~9 MB de imágenes). Sin versión; inmutables por nombre de
//    archivo, y los JSON se refrescan con stale-while-revalidate.
//
// Por qué esta partición y no la anterior (shell versionado + catálogo):
// el esquema viejo metía los 16.2 MB de artefactos de PGLite en la caché
// versionada por deploy, y activate() la borraba en cada push a main porque el
// sha cambia siempre. Si el usuario no completaba la re-descarga de esos 16 MB
// con red, el arranque siguiente sin red moría en initDB() → pantalla en blanco
// en iOS. Ahora esos bytes viven en gymlog-assets, sobreviven los deploys, y
// solo se descargan cuando su hash cambia de verdad.

// Tres placeholders los reemplaza el build (plugin `sello-de-version` en
// vite.config.js): __APP_VERSION__ por «version de package.json + sha del
// commit», y los dos manifiestos por sus arrays JSON de URLs. Nunca escribas
// aquí un valor a mano: el build falla si cualquiera de los tres no está — es
// el seguro contra volver a fijarlos manualmente.
// En un build sin sellar (desarrollo) quedan como strings: el guard de
// `manifiestosSellados()` detecta eso y omite el precache en vez de intentar
// cachear un string carácter por carácter.
const SHELL_CACHE = 'gymlog-shell-v__APP_VERSION__';
const ASSETS_CACHE = 'gymlog-assets';
const CATALOGO_CACHE = 'gymlog-catalogo';
const PRECACHE_SHELL = '__PRECACHE_SHELL__';
const PRECACHE_ASSETS = '__PRECACHE_ASSETS__';

const esImagenCatalogo = pathname => pathname.includes('/assets/catalogo/img/');
const esDatoCatalogo = pathname =>
  pathname.endsWith('/assets/catalogo/catalogo.json') ||
  pathname.endsWith('/assets/catalogo/instrucciones.json');
// Todo lo que emite Rollup vive plano bajo `assets/` y lleva hash de contenido.
// El catálogo cuelga de `assets/catalogo/` y tiene su propia caché, así que se
// excluye explícitamente.
const esAssetHasheado = pathname =>
  pathname.includes('/assets/') && !pathname.includes('/assets/catalogo/');

// Un build sin sellar deja los placeholders como strings. `cache.addAll(str)`
// no falla ruidosamente: WebIDL convierte el string en secuencia por el
// protocolo de iterador y intenta cachear una URL por carácter → 404 en cadena
// → el install falla en bucle. Pasó de verdad con `pnpm dev --host` (ver el
// guard de registro en js/app.js).
const manifiestosSellados = () =>
  Array.isArray(PRECACHE_SHELL) && Array.isArray(PRECACHE_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      // skipWaiting SOLO tras completar el precache: si falla a medias, el SW
      // nuevo no toma control con una caché incompleta y el SW viejo sigue
      // sirviendo su copia completa. Reintenta en la visita siguiente. Es el
      // modo de fallo seguro, y es deliberado (evita la pantalla en blanco).
      precachear().then(() => self.skipWaiting()),
      sembrarCatalogo(),
    ])
  );
});

async function precachear() {
  if (!manifiestosSellados()) {
    console.warn('[sw] manifiestos sin sellar (build de desarrollo): se omite el precache');
    return;
  }
  // El shell son ~30 KB de nombre fijo: addAll atómico, tiene que entrar entero.
  const shell = await caches.open(SHELL_CACHE);
  await shell.addAll(PRECACHE_SHELL);
  await precachearAssets();
}

// Los assets se precachean ENTRADA POR ENTRADA, no con un addAll único.
// Motivo: addAll es todo-o-nada, y acá hay ~17 MB (el motor de la base pesa
// 16.2). En red móvil un fallo puntual tiraría el lote completo. Además:
//  - se salta lo que ya está cacheado → un deploy que no cambia PGLite hace
//    CERO red para esos 16 MB (es el objetivo de toda esta partición);
//  - un reintento por entrada absorbe los fallos intermitentes de fetch dentro
//    del SW, que en Safari/iOS son frecuentes.
// Si algo queda fuera igualmente, lanza: skipWaiting() no corre y el SW viejo
// (con su caché completa) sigue a cargo.
async function precachearAssets() {
  const cache = await caches.open(ASSETS_CACHE);
  const fallos = [];

  await Promise.all(PRECACHE_ASSETS.map(async url => {
    // Hash de contenido en el nombre ⇒ si está, es la versión correcta.
    if (await cache.match(url, { ignoreVary: true })) return;

    for (let intento = 0; intento < 2; intento++) {
      try {
        const respuesta = await fetch(url);
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        await cache.put(url, respuesta);
        return;
      } catch {
        if (intento === 1) fallos.push(url);
      }
    }
  }));

  if (fallos.length > 0) {
    throw new Error(`precache incompleto, ${fallos.length} assets sin cachear: ${fallos.join(', ')}`);
  }
}

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
  event.waitUntil((async () => {
    const vigentes = new Set([SHELL_CACHE, ASSETS_CACHE, CATALOGO_CACHE]);
    const keys = await caches.keys();

    // Borra los shells de deploys anteriores Y las cachés monolíticas legadas
    // `gymlog-v<sello>` del esquema viejo (su contenido ya está repartido entre
    // gymlog-shell-v* y gymlog-assets por el install de este mismo SW, que
    // corre antes que activate). gymlog-assets y gymlog-catalogo están en
    // `vigentes`, así que nunca entran acá.
    await Promise.all(
      keys.filter(k => k.startsWith('gymlog-') && !vigentes.has(k))
        .map(k => caches.delete(k))
    );

    await podarAssets();
    await self.clients.claim();
  })());
});

// La diferencia que arregla el bug: gymlog-assets se PODA, no se borra. Se
// eliminan solo las entradas que ya no están en el manifiesto de este build
// (chunks de versiones anteriores). Todo lo que sigue vigente — empezando por
// los 16.2 MB del motor, cuyo hash no cambia entre deploys — se queda donde
// está y no se vuelve a pedir por red.
async function podarAssets() {
  if (!manifiestosSellados()) return;

  const cache = await caches.open(ASSETS_CACHE);
  // Comparación por pathname: el manifiesto trae rutas absolutas del sitio
  // (`/GymlogPWA/assets/…`) y las Request cacheadas traen URL completa.
  const vigentes = new Set(
    PRECACHE_ASSETS.map(url => new URL(url, self.registration.scope).pathname)
  );
  const entradas = await cache.keys();

  await Promise.all(
    entradas
      .filter(request => !vigentes.has(new URL(request.url).pathname))
      .map(request => cache.delete(request))
  );
}

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

  // La lectura es global (caches.match busca en las tres); el destino del put
  // sí tiene que ser la caché correcta, o un asset hasheado acabaría en el
  // shell y se borraría en el deploy siguiente.
  event.respondWith(
    cacheFirstConFetch(event, esAssetHasheado(pathname) ? ASSETS_CACHE : SHELL_CACHE)
  );
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

// Resto del shell y assets hasheados: cache-first con cache-on-fetch.
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
