import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guard de regresión del bug que dejó a los iPhones sin arrancar offline.
//
// Historia: el manifiesto de precache se armaba con una ALLOWLIST de
// extensiones (`.js`/`.css`) en vite.config.js. Eso dejaba fuera los 16.2 MB de
// artefactos de PGLite (pglite.wasm, pglite.data, initdb.wasm) y las fuentes
// .woff2 — los bytes sin los que initDB() no resuelve y la app no pinta nada.
// Solo se cacheaban al vuelo, en la caché versionada que activate() borraba en
// cada deploy. Los tests de entonces validaban la ESTRUCTURA del sw.js pero
// nunca su CONTENIDO sellado, así que el agujero sobrevivió cinco intentos de
// arreglo.
//
// Por eso este test compara el manifiesto SELLADO contra los archivos realmente
// emitidos en dist/ (el build lo hace tests/setup/build.js, una vez por corrida).
// Un test sobre el fuente no habría detectado nada: el fuente solo tiene
// placeholders.

const DIST_SW = fileURLToPath(new URL('../dist/sw.js', import.meta.url));
const DIST_ASSETS = fileURLToPath(new URL('../dist/assets', import.meta.url));

// Los assets que Vite COPIA verbatim desde public/assets/ (no los emite
// Rollup): no van al manifiesto porque no se piden por red — diario.js importa
// appUrl.png con `?inline`, así que viaja como data URI dentro del bundle.
const COPIADOS_DE_PUBLIC = new Set(['appUrl.png', 'catalogo']);

const leerManifiesto = (fuente, nombre) => {
  const linea = new RegExp(`^const ${nombre} = (\\[.*\\]);$`, 'm').exec(fuente);
  expect(linea, `${nombre} no quedó sellado como array en dist/sw.js`).not.toBeNull();
  return JSON.parse(linea[1]);
};

describe('manifiesto de precache (build real)', () => {
  let shell, assets, emitidos;

  beforeAll(() => {
    const fuente = readFileSync(DIST_SW, 'utf-8');
    shell = leerManifiesto(fuente, 'PRECACHE_SHELL');
    assets = leerManifiesto(fuente, 'PRECACHE_ASSETS');
    emitidos = readdirSync(DIST_ASSETS).filter(f => !COPIADOS_DE_PUBLIC.has(f));
  });

  it('no deja ningún placeholder sin sellar en dist/sw.js', () => {
    const fuente = readFileSync(DIST_SW, 'utf-8');
    for (const ph of ['__APP_VERSION__', '__PRECACHE_SHELL__', '__PRECACHE_ASSETS__']) {
      expect(fuente, `placeholder sin sellar: ${ph}`).not.toContain(ph);
    }
  });

  it('precachea el motor de la base de datos (.wasm y .data) — el bug original', () => {
    const motorEmitido = emitidos.filter(f => f.endsWith('.wasm') || f.endsWith('.data'));
    // Si PGLite deja de emitir wasm, este test debe romperse a propósito: el
    // supuesto de la aserción siguiente cambió y hay que revisarla.
    expect(motorEmitido.length, 'el build no emitió ningún .wasm/.data').toBeGreaterThan(0);

    for (const archivo of motorEmitido) {
      expect(assets, `el motor no está en el precache: ${archivo}`)
        .toContain(`/GymlogPWA/assets/${archivo}`);
    }
  });

  it('precachea TODO lo que Rollup emite, no solo .js y .css', () => {
    // La aserción amplia es deliberada: es la que impide que vuelva a colarse
    // una allowlist de extensiones y se olvide del próximo formato que aparezca.
    const faltantes = emitidos.filter(f => !assets.includes(`/GymlogPWA/assets/${f}`));
    expect(faltantes, `assets emitidos fuera del precache: ${faltantes.join(', ')}`).toEqual([]);
  });

  it('no precachea el catálogo (regla no negociable: es dato de referencia estático)', () => {
    const delCatalogo = [...shell, ...assets].filter(u => u.includes('/assets/catalogo/'));
    expect(delCatalogo).toEqual([]);
  });

  it('el shell solo lleva recursos de nombre fijo; los hasheados van a assets', () => {
    // La partición es por mutabilidad: si un asset hasheado cayera en el shell,
    // activate() lo borraría en el deploy siguiente (el bug, otra vez).
    expect(shell.filter(u => u.includes('/assets/'))).toEqual([]);
    expect(assets.every(u => u.includes('/assets/'))).toBe(true);
    expect(shell).toContain('/GymlogPWA/');
    expect(shell).toContain('/GymlogPWA/index.html');
  });

  it('el fallback de navegación tiene entrada propia (el scope pelado)', () => {
    // cacheFirstConFetch cae a caches.match(self.registration.scope) cuando una
    // navegación falla; sin esta entrada exacta, ese match no acierta.
    expect(shell).toContain('/GymlogPWA/');
  });
});
