import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Test de COMPORTAMIENTO del Service Worker sellado, no de su forma.
//
// Los tests estáticos de sw.test.js validan que el archivo diga lo que debe
// decir. Este ejecuta el dist/sw.js real contra una Cache API falsa y simula el
// ciclo que provocaba el bug: usuario con todo cacheado → llega un deploy →
// install + activate del SW nuevo. El bug era que ese activate borraba los
// 16.2 MB del motor de la base, y en el arranque siguiente sin red la app
// moría en initDB() con la pantalla vacía.
//
// Es el test que habría atrapado los cinco intentos de arreglo anteriores:
// todos cambiaban la estrategia de fetch, ninguno tocaba el ciclo de deploy.

const DIST_SW = fileURLToPath(new URL('../dist/sw.js', import.meta.url));
const SCOPE = 'https://ian.github.io/GymlogPWA/';

const absoluta = recurso =>
  new URL(typeof recurso === 'string' ? recurso : recurso.url, SCOPE).href;

class CacheFalsa {
  constructor() { this.entradas = new Map(); }
  async match(recurso) { return this.entradas.get(absoluta(recurso)); }
  async put(recurso, respuesta) { this.entradas.set(absoluta(recurso), respuesta); }
  async delete(recurso) { return this.entradas.delete(absoluta(recurso)); }
  // La Cache API devuelve Requests, con .url absoluta
  async keys() { return [...this.entradas.keys()].map(url => ({ url })); }
  async addAll(urls) {
    // Semántica real: todo-o-nada
    const respuestas = await Promise.all(urls.map(u => globalThis.__fetchFalso(absoluta(u))));
    if (respuestas.some(r => !r.ok)) throw new TypeError('addAll falló');
    urls.forEach((u, i) => this.entradas.set(absoluta(u), respuestas[i]));
  }
}

// Ejecuta un sw.js en un entorno falso y devuelve el estado observable.
// `almacen` se comparte entre invocaciones para simular que el navegador
// conserva las cachés de un deploy al siguiente.
async function correrCicloDeVida(fuente, almacen, opciones = {}) {
  const { fallarUrls = [] } = opciones;
  const pedidas = [];

  const fetchFalso = async recurso => {
    const url = absoluta(recurso);
    pedidas.push(url);
    const ok = !fallarUrls.some(frag => url.includes(frag));
    return {
      ok,
      status: ok ? 200 : 503,
      type: 'basic',
      url,
      clone() { return { ...this, clone: this.clone }; },
    };
  };
  globalThis.__fetchFalso = fetchFalso;

  const caches = {
    async open(nombre) {
      if (!almacen.has(nombre)) almacen.set(nombre, new CacheFalsa());
      return almacen.get(nombre);
    },
    async keys() { return [...almacen.keys()]; },
    async delete(nombre) { return almacen.delete(nombre); },
    async match(recurso) {
      for (const cache of almacen.values()) {
        const hit = await cache.match(recurso);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const handlers = {};
  let skipWaiting = 0;
  let claim = 0;
  const self = {
    addEventListener: (tipo, fn) => { handlers[tipo] = fn; },
    registration: { scope: SCOPE },
    skipWaiting: async () => { skipWaiting++; },
    clients: { claim: async () => { claim++; } },
  };

  const Response = { error: () => ({ ok: false, type: 'error' }) };
  const consola = { warn: () => {}, error: () => {}, log: () => {} };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'console', fuente)(
    self, caches, fetchFalso, Response, consola
  );

  const despachar = async tipo => {
    const pendientes = [];
    await handlers[tipo]({ waitUntil: p => pendientes.push(p) });
    // Se agrega el resultado para que un rechazo del precache aflore acá
    return Promise.allSettled(pendientes);
  };

  const resultadoInstall = await despachar('install');
  const resultadoActivate = await despachar('activate');

  return { almacen, pedidas, skipWaiting, claim, resultadoInstall, resultadoActivate };
}

const urlsEn = (almacen, nombre) =>
  [...(almacen.get(nombre)?.entradas.keys() ?? [])];

describe('sw.js sellado — ciclo de deploy (el bug de la pantalla en blanco)', () => {
  let swV1, swV2, motor;

  beforeAll(() => {
    // El build lo hace tests/setup/build.js, una vez por corrida.
    swV1 = readFileSync(DIST_SW, 'utf-8');

    // Simula el deploy siguiente: cambia el sello de versión y los hashes de los
    // chunks JS, pero NO los del motor. Es lo que pasa de verdad en cada push a
    // main: el sha del CACHE_NAME cambia siempre, el wasm de PGLite solo cambia
    // si se actualiza la dependencia (verificado: dos builds consecutivos
    // emitieron el mismo pglite-*.wasm con distinto index-*.js).
    // Anclado a la DECLARACIÓN. Un `/gymlog-shell-v[^']+/` suelto es greedy y se
    // come el comentario de cabecera hasta la primera comilla del archivo,
    // destruyendo `const SHELL_CACHE` — el SW resultante lanza ReferenceError y
    // no hace nada, con lo que todas las aserciones de abajo pasarían VACÍAS.
    swV2 = swV1
      .replace(/^const SHELL_CACHE = '[^']*';$/m, "const SHELL_CACHE = 'gymlog-shell-v9.9.9+deploy2';")
      .replace(/index-([A-Za-z0-9_-]+)\.js/g, 'index-NUEVOHASH2.js');

    // Guard anti-vacío: swV2 tiene que seguir siendo un SW válido y distinto.
    expect(/^const SHELL_CACHE = 'gymlog-shell-v9\.9\.9\+deploy2';$/m.test(swV2)).toBe(true);
    expect(/^const ASSETS_CACHE = 'gymlog-assets';$/m.test(swV2)).toBe(true);
    expect(swV2).not.toBe(swV1);

    motor = JSON.parse(/^const PRECACHE_ASSETS = (\[.*\]);$/m.exec(swV1)[1])
      .filter(u => u.endsWith('.wasm') || u.endsWith('.data'));
    expect(motor.length).toBeGreaterThan(0);
  });

  it('el install deja el motor de la base en gymlog-assets', async () => {
    const { almacen, skipWaiting } = await correrCicloDeVida(swV1, new Map());

    const enAssets = urlsEn(almacen, 'gymlog-assets');
    for (const url of motor) {
      expect(enAssets, `el motor no quedó cacheado: ${url}`).toContain(absoluta(url));
    }
    expect(skipWaiting).toBe(1);
  });

  it('UN DEPLOY NUEVO NO BORRA EL MOTOR — la regresión que causó el bug', async () => {
    const almacen = new Map();
    await correrCicloDeVida(swV1, almacen);
    const { pedidas, skipWaiting, resultadoInstall, resultadoActivate } =
      await correrCicloDeVida(swV2, almacen);

    // Guard anti-vacío: si el SW nuevo se cayera sin hacer nada, el motor
    // "sobreviviría" y este test pasaría sin haber probado nada. Primero se
    // exige que el deploy haya ocurrido de verdad.
    expect(resultadoInstall.filter(r => r.status === 'rejected')).toEqual([]);
    expect(resultadoActivate.filter(r => r.status === 'rejected')).toEqual([]);
    expect(skipWaiting).toBe(1);
    expect(urlsEn(almacen, 'gymlog-assets'))
      .toContain(absoluta('/GymlogPWA/assets/index-NUEVOHASH2.js'));

    // 1. Sigue ahí después del activate del SW nuevo.
    const enAssets = urlsEn(almacen, 'gymlog-assets');
    for (const url of motor) {
      expect(enAssets, `el deploy borró el motor: ${url}`).toContain(absoluta(url));
    }

    // 2. Y no se volvió a pedir por red: es la diferencia entre re-bajar 16.2 MB
    //    en cada deploy (con la ventana de fallo que dejaba la app sin arrancar)
    //    y no tocar la red en absoluto.
    for (const url of motor) {
      expect(pedidas, `el deploy re-bajó el motor: ${url}`).not.toContain(absoluta(url));
    }
  });

  it('el deploy sí poda los chunks que dejaron de existir', async () => {
    const almacen = new Map();
    await correrCicloDeVida(swV1, almacen);
    // Solo los .js: el index-*.css no se renombra en swV2, así que sigue vigente
    // y NO debe podarse (ese es justamente el comportamiento correcto).
    const viejos = urlsEn(almacen, 'gymlog-assets')
      .filter(u => /\/index-(?!NUEVOHASH2)[^/]*\.js$/.test(u));
    expect(viejos.length).toBeGreaterThan(0);

    await correrCicloDeVida(swV2, almacen);

    const enAssets = urlsEn(almacen, 'gymlog-assets');
    for (const viejo of viejos) {
      expect(enAssets, `chunk obsoleto sin podar: ${viejo}`).not.toContain(viejo);
    }
    expect(enAssets).toContain(absoluta('/GymlogPWA/assets/index-NUEVOHASH2.js'));
  });

  it('el shell viejo y las cachés monolíticas legadas (gymlog-v*) sí se borran', async () => {
    const almacen = new Map();
    // Simula un usuario que viene del esquema anterior
    const legada = new CacheFalsa();
    await legada.put('/GymlogPWA/index.html', { ok: true });
    almacen.set('gymlog-v1.2.0+a95fa17', legada);

    await correrCicloDeVida(swV1, almacen);

    expect([...almacen.keys()]).not.toContain('gymlog-v1.2.0+a95fa17');
    expect([...almacen.keys()]).toContain('gymlog-assets');
  });

  it('gymlog-catalogo sobrevive los deploys (se siembra y nadie la borra)', async () => {
    const almacen = new Map();
    await correrCicloDeVida(swV1, almacen);
    const tras1 = urlsEn(almacen, 'gymlog-catalogo');
    expect(tras1).toContain(absoluta('/GymlogPWA/assets/catalogo/catalogo.json'));
    expect(tras1).toContain(absoluta('/GymlogPWA/assets/catalogo/instrucciones.json'));

    const { pedidas } = await correrCicloDeVida(swV2, almacen);
    expect(urlsEn(almacen, 'gymlog-catalogo')).toEqual(tras1);
    // Ya sembrada: no se re-baja el ~1 MB de JSON en cada deploy
    expect(pedidas).not.toContain(absoluta('/GymlogPWA/assets/catalogo/instrucciones.json'));
  });

  it('si el motor no se puede cachear, NO toma control (el SW viejo sigue sirviendo)', async () => {
    // Modo de fallo seguro y deliberado: más vale quedarse en la versión
    // anterior, que sí tiene sus bytes completos, que activar una versión que
    // arrancaría en blanco sin red.
    const { skipWaiting, resultadoInstall } = await correrCicloDeVida(
      swV1, new Map(), { fallarUrls: ['.wasm'] }
    );

    expect(skipWaiting).toBe(0);
    expect(resultadoInstall.some(r => r.status === 'rejected')).toBe(true);
  });

  it('un fallo al sembrar el catálogo NO impide tomar control', async () => {
    // El catálogo es dato de referencia: su ausencia degrada el buscador, no
    // rompe el arranque. No debe bloquear el precache del shell.
    const { skipWaiting } = await correrCicloDeVida(
      swV1, new Map(), { fallarUrls: ['/assets/catalogo/'] }
    );
    expect(skipWaiting).toBe(1);
  });
});
