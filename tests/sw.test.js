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
    expect(fuente).toContain("const CACHE_NAME = 'gymlog-v__APP_VERSION__';");
  });

  it('lleva el placeholder de precache __PRECACHE_MANIFEST__ sin sellar a mano', () => {
    expect(fuente).toContain('__PRECACHE_MANIFEST__');
    expect(fuente).toContain("const PRECACHE = '__PRECACHE_MANIFEST__';");
  });

  it('la caché del catálogo (gymlog-catalogo) es un literal fijo, sin placeholder de versión', () => {
    expect(fuente).toContain("const CATALOGO_CACHE = 'gymlog-catalogo';");
    // Si el placeholder de versión apareciera pegado a este nombre, activate()
    // la trataría como una caché de shell y la borraría en cada deploy —
    // justo lo que la separación de cachés existe para evitar.
    expect(fuente).not.toMatch(/gymlog-catalogo[^'"]*__APP_VERSION__/);
  });

  it('activate() solo borra cachés de shell versionadas (gymlog-v*), nunca gymlog-catalogo', () => {
    expect(fuente).toMatch(/\.filter\(k => k\.startsWith\('gymlog-v'\) && k !== CACHE_NAME\)/);
  });

  it('install() precachea el shell dentro de waitUntil antes de skipWaiting', () => {
    expect(fuente).toMatch(/event\.waitUntil\(\s*caches\.open\(CACHE_NAME\)/);
    expect(fuente).toContain('cache.addAll(PRECACHE)');
    expect(fuente).toContain('.then(() => self.skipWaiting())');
  });

  it('solo intercepta peticiones GET', () => {
    expect(fuente).toMatch(/event\.request\.method !== 'GET'/);
  });

  it('el fallback de shell solo aplica a navegaciones (mode === "navigate")', () => {
    expect(fuente).toContain("request.mode === 'navigate'");
    expect(fuente).toContain('caches.match(self.registration.scope)');
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
});
