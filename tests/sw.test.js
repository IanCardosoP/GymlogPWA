import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Checks estáticos sobre el ARCHIVO FUENTE (public/sw.js, no el dist/sw.js
// sellado por el build) — mismo espíritu que tests/assets.test.js: validación
// a nivel de archivo, sin instanciar el Service Worker (entorno node).

const SW_PATH = fileURLToPath(new URL('../public/sw.js', import.meta.url));
const fuente = readFileSync(SW_PATH, 'utf-8');

describe('public/sw.js (checks estáticos)', () => {
  it('lleva el placeholder de versión __APP_VERSION__ sin sellar a mano', () => {
    expect(fuente).toContain('__APP_VERSION__');
    expect(fuente).toContain("const SHELL_CACHE = 'gymlog-shell-v__APP_VERSION__';");
  });

  it('lleva los dos placeholders de precache sin sellar a mano', () => {
    expect(fuente).toContain("const PRECACHE_SHELL = '__PRECACHE_SHELL__';");
    expect(fuente).toContain("const PRECACHE_ASSETS = '__PRECACHE_ASSETS__';");
  });

  it('la caché de assets hasheados (gymlog-assets) NO lleva placeholder de versión', () => {
    // Es el núcleo del arreglo: los assets de Vite llevan hash de contenido en
    // el nombre, así que son inmutables y su caché debe sobrevivir los deploys.
    // Si esta caché se versionara, activate() volvería a borrar los 16.2 MB del
    // motor de la base en cada push a main → pantalla en blanco offline.
    // Anclado a la DECLARACIÓN, no a un escaneo del archivo: los comentarios
    // nombran las cachés y los placeholders en prosa y darían falso positivo.
    const declarado = /^const ASSETS_CACHE = '([^']*)';$/m.exec(fuente);
    expect(declarado?.[1]).toBe('gymlog-assets');
  });

  it('la caché del catálogo (gymlog-catalogo) es un literal fijo, sin placeholder de versión', () => {
    // Si el placeholder de versión apareciera pegado a este nombre, activate()
    // la trataría como una caché de shell y la borraría en cada deploy —
    // justo lo que la separación de cachés existe para evitar. Anclado a la
    // DECLARACIÓN, no a un escaneo del archivo: los comentarios nombran las
    // cachés y los placeholders en prosa y darían falso positivo.
    const declarado = /^const CATALOGO_CACHE = '([^']*)';$/m.exec(fuente);
    expect(declarado?.[1]).toBe('gymlog-catalogo');
  });

  it('activate() nunca borra gymlog-assets ni gymlog-catalogo (están en las vigentes)', () => {
    expect(fuente).toMatch(
      /const vigentes = new Set\(\[SHELL_CACHE, ASSETS_CACHE, CATALOGO_CACHE\]\)/
    );
    expect(fuente).toMatch(/\.filter\(k => k\.startsWith\('gymlog-'\) && !vigentes\.has\(k\)\)/);
  });

  it('activate() PODA gymlog-assets contra el manifiesto, no la borra', () => {
    // La diferencia exacta que arregla el bug. Con borrado completo, cada
    // deploy tiraba los 16.2 MB del motor porque el sha del CACHE_NAME cambia
    // en cada push. Con poda, solo se van las entradas que ya no están en el
    // manifiesto: el hash del wasm no cambia entre deploys → se queda.
    expect(fuente).toContain('async function podarAssets()');
    expect(fuente).toMatch(/await podarAssets\(\)/);
    const cuerpo = fuente.slice(fuente.indexOf('async function podarAssets()'));
    // Poda = borrar por entrada lo que NO está vigente; jamás caches.delete de
    // la caché entera.
    expect(cuerpo).toMatch(/\.filter\(request => !vigentes\.has\(/);
    expect(cuerpo).toMatch(/\.map\(request => cache\.delete\(request\)\)/);
    expect(cuerpo).not.toContain('caches.delete(ASSETS_CACHE)');
  });

  it('install() precachea dentro de waitUntil y skipWaiting solo si el precache completó', () => {
    expect(fuente).toMatch(
      /event\.waitUntil\(\s*Promise\.all\(\[[\s\S]*?precachear\(\)\.then\(\(\) => self\.skipWaiting\(\)\)/
    );
    expect(fuente).toContain('await shell.addAll(PRECACHE_SHELL)');
    expect(fuente).toContain('await precachearAssets()');
  });

  it('precachearAssets() se salta lo ya cacheado — un deploy no re-baja los 16 MB del motor', () => {
    // El otro lado del arreglo: sin este skip, cada install volvería a pedir
    // los 16.2 MB por red aunque ya estuvieran en gymlog-assets.
    const cuerpo = fuente.slice(
      fuente.indexOf('async function precachearAssets()'),
      fuente.indexOf('function sembrarCatalogo()')
    );
    const idxMatch = cuerpo.indexOf('cache.match(url, { ignoreVary: true })');
    const idxFetch = cuerpo.indexOf('await fetch(url)');
    expect(idxMatch).toBeGreaterThan(-1);
    expect(idxFetch).toBeGreaterThan(idxMatch);
    // Y no un addAll único: 17 MB en todo-o-nada se caen enteros por un fallo
    // puntual de red móvil.
    expect(cuerpo).not.toContain('addAll');
  });

  it('un manifiesto sin sellar omite el precache en vez de cachear un string carácter por carácter', () => {
    // `cache.addAll('__PRECACHE_SHELL__')` no falla ruidosamente: WebIDL itera
    // el string y pide una URL por carácter → 404 en cadena → install en bucle.
    // Pasó de verdad con `pnpm dev --host`.
    expect(fuente).toContain('const manifiestosSellados = () =>');
    expect(fuente).toMatch(/Array\.isArray\(PRECACHE_SHELL\) && Array\.isArray\(PRECACHE_ASSETS\)/);
    expect(fuente).toMatch(/if \(!manifiestosSellados\(\)\)/);
  });

  it('los assets hasheados y el shell van a cachés distintas en el put', () => {
    // La lectura es global (caches.match busca en las tres), pero el destino
    // del put tiene que ser el correcto: un asset hasheado en la caché del
    // shell se borraría en el deploy siguiente.
    expect(fuente).toMatch(
      /cacheFirstConFetch\(event, esAssetHasheado\(pathname\) \? ASSETS_CACHE : SHELL_CACHE\)/
    );
    expect(fuente).toMatch(
      /esAssetHasheado = pathname =>\s*pathname\.includes\('\/assets\/'\) && !pathname\.includes\('\/assets\/catalogo\/'\)/
    );
  });

  it('install() siembra catalogo.json e instrucciones.json en gymlog-catalogo (buscador offline sin haber abierto el picker antes)', () => {
    expect(fuente).toContain('function sembrarCatalogo()');
    expect(fuente).toMatch(/event\.waitUntil\(\s*Promise\.all\(\[[\s\S]*?sembrarCatalogo\(\)/);
    // Construidas desde el scope del registro, no desde PRECACHE (ese es solo shell)
    expect(fuente).toMatch(/\$\{self\.registration\.scope\}assets\/catalogo\/catalogo\.json/);
    expect(fuente).toMatch(/\$\{self\.registration\.scope\}assets\/catalogo\/instrucciones\.json/);
    // No debe re-bajar lo que ya está: primero cache.match, y solo si no hay nada, fetch
    const cuerpoSiembra = fuente.slice(fuente.indexOf('function sembrarCatalogo'));
    const idxMatch = cuerpoSiembra.indexOf('cache.match(url,');
    const idxFetch = cuerpoSiembra.indexOf('fetch(url)');
    expect(idxMatch).toBeGreaterThan(-1);
    expect(idxFetch).toBeGreaterThan(idxMatch);
    // Tolerante a fallos: un .catch() en la cadena de siembra, para no abortar
    // el precache del shell si la red falla en el install.
    expect(cuerpoSiembra).toMatch(/\.catch\(\(\) => \{\}\)/);
  });

  it('solo intercepta peticiones GET y esquemas http (ignora chrome-extension:// y similares)', () => {
    expect(fuente).toMatch(/event\.request\.method !== 'GET'/);
    expect(fuente).toMatch(/event\.request\.url\.startsWith\('http'\)/);
    // El guard de esquema debe estar ANTES del ruteo por pathname (new URL(...)),
    // si no, sigue rompiendo el put() con chrome-extension:// antes de llegar acá.
    const idxGuardScheme = fuente.indexOf("event.request.url.startsWith('http')");
    const idxNewURL = fuente.indexOf('new URL(event.request.url)');
    expect(idxGuardScheme).toBeGreaterThan(-1);
    expect(idxGuardScheme).toBeLessThan(idxNewURL);
  });

  it('el fallback de shell solo aplica a navegaciones (mode === "navigate")', () => {
    expect(fuente).toContain("request.mode === 'navigate'");
    expect(fuente).toContain('caches.match(self.registration.scope,');
  });

  it('todas las llamadas a .match() pasan { ignoreVary: true } (Vary: Origin de hostings + addAll cors vs página no-cors)', () => {
    // El bug real: cache.addAll() en install pide en modo cors (header Origin);
    // la petición de un <img>/fetch de la página puede ir sin él → el
    // algoritmo de Vary de la Cache API no matchea la entrada precacheada
    // aunque la URL sea idéntica. ignoreVary la vuelve irrelevante.
    const llamadas = (fuente.match(/\.match\([^)]*\)/g) ?? [])
      .filter(l => l !== '.match()'); // menciones en prosa dentro de comentarios
    expect(llamadas.length).toBeGreaterThan(0);
    for (const llamada of llamadas) {
      expect(llamada, `sin ignoreVary: ${llamada}`).toContain('ignoreVary: true');
    }
  });

  it('las imágenes del catálogo van cache-first puro; catalogo.json/instrucciones.json, stale-while-revalidate', () => {
    expect(fuente).toContain('cacheFirstPuro');
    expect(fuente).toContain('staleWhileRevalidate');
    expect(fuente).toMatch(/esImagenCatalogo.*=.*pathname\.includes\('\/assets\/catalogo\/img\/'\)/);
  });

  it('los put en caché van dentro de event.waitUntil (comportamiento Safari/iOS conservado)', () => {
    const ocurrencias = fuente.match(/event\.waitUntil\(caches\.open\(cacheName\)\.then\(c => c\.put\(request, clone\)\)\)/g);
    expect(ocurrencias?.length).toBeGreaterThanOrEqual(3); // cacheFirstPuro, staleWhileRevalidate, cacheFirstConFetch
  });

  it('staleWhileRevalidate pasa a network-first cuando el llamador pide cache:"reload"/"no-store"/"no-cache"', () => {
    // Ancla el fix del botón «Descargar catálogo»: sin esto, cache:'reload'
    // desde config.js no bastaba para traer ejercicios nuevos en el primer
    // clic, porque SWR seguía sirviendo la copia cacheada de inmediato.
    const cuerpoSWR = fuente.slice(
      fuente.indexOf('function staleWhileRevalidate'),
      fuente.indexOf('function cacheFirstConFetch')
    );
    expect(cuerpoSWR).toMatch(/request\.cache === 'reload'/);
    expect(cuerpoSWR).toMatch(/request\.cache === 'no-store'/);
    expect(cuerpoSWR).toMatch(/request\.cache === 'no-cache'/);
    // El branch de red forzada debe devolver la respuesta de red, no la
    // cacheada — fetch(request) antes que ningún caches.match/cached.
    const idxCheck = cuerpoSWR.indexOf("request.cache === 'reload'");
    const idxFetch = cuerpoSWR.indexOf('fetch(request)', idxCheck);
    const idxCachesMatchPrevio = cuerpoSWR.lastIndexOf('caches.match(request,', idxFetch);
    expect(idxFetch).toBeGreaterThan(idxCheck);
    expect(idxCachesMatchPrevio).toBeLessThan(idxCheck);
  });
});
