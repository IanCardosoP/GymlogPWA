// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as arranque from '../js/componentes/arranque.js';

// El arranque solía fallar en silencio: `await initDB()` rechazaba, initApp() no
// tenía catch y se invocaba sin .catch(), así que bindNav() y navigateTo() nunca
// corrían. El usuario veía la nav pintada y los tres paneles vacíos, sin un solo
// mensaje. Estos tests fijan que ese silencio no vuelva.

function montarDOM() {
  document.body.innerHTML = `
    <section id="diario-container"></section>
    <section id="progreso-container" hidden></section>
    <section id="config-container" hidden></section>
  `;
}

describe('componente de arranque', () => {
  beforeEach(() => {
    montarDOM();
    arranque.limpiar();
  });

  it('sin estado no pinta nada (no estorba en el caso feliz)', () => {
    expect(arranque.hayEstado()).toBe(false);
    arranque.render('diario-container');
    expect(document.getElementById('diario-container').children.length).toBe(0);
  });

  it('el estado de carga pinta un mensaje y un skeleton', () => {
    arranque.setCargando('Preparando base de datos…');
    arranque.render('diario-container');

    const cont = document.getElementById('diario-container');
    expect(cont.querySelector('.arranque-mensaje').textContent).toBe('Preparando base de datos…');
    expect(cont.querySelectorAll('.diario-skeleton-bloque').length).toBe(3);
  });

  it('el fallo pinta título, mensaje y un botón de reintentar', () => {
    arranque.setFallo({
      titulo: '[ ✕ NO SE PUDO INICIAR ]',
      mensaje: 'No se pudo preparar la base de datos.',
      detalle: 'TypeError: Failed to fetch',
    });
    arranque.render('diario-container');

    const cont = document.getElementById('diario-container');
    expect(cont.querySelector('.arranque-titulo').textContent).toContain('NO SE PUDO INICIAR');
    expect(cont.querySelector('.arranque-mensaje').textContent).toBeTruthy();

    const botones = [...cont.querySelectorAll('.arranque-btn')].map(b => b.textContent);
    expect(botones.some(t => t.includes('REINTENTAR'))).toBe(true);

    // El detalle técnico es lo que convierte "no carga" en un reporte accionable.
    expect(cont.querySelector('.arranque-detalle-texto').textContent)
      .toBe('TypeError: Failed to fetch');
  });

  it('render es idempotente: N veces no duplica nodos', () => {
    arranque.setFallo({ titulo: 'T', mensaje: 'M' });
    arranque.render('diario-container');
    arranque.render('diario-container');
    arranque.render('diario-container');

    const cont = document.getElementById('diario-container');
    expect(cont.querySelectorAll('.arranque-titulo').length).toBe(1);
    expect(cont.querySelectorAll('.arranque-mensaje').length).toBe(1);
    // Sin Service Worker en jsdom no se ofrece «completar descarga»: queda solo
    // el de reintentar, y sigue siendo uno tras tres renders.
    expect(cont.querySelectorAll('.arranque-btn').length).toBe(1);
    expect(cont.children.length).toBe(1);
  });

  it('puede pintarse en cualquier pestaña (navegar debe seguir funcionando)', () => {
    arranque.setFallo({ titulo: 'T', mensaje: 'M' });
    arranque.render('config-container');
    expect(document.getElementById('config-container').querySelector('.arranque-titulo'))
      .not.toBeNull();
  });

  it('OWASP A01: el detalle del error se inserta como texto, nunca como HTML', () => {
    // El mensaje de error puede traer contenido no controlado (una URL, la
    // respuesta de un servidor). Si se inyectara con innerHTML, sería XSS.
    arranque.setFallo({
      titulo: '<script>alert(1)</script>',
      mensaje: '<img src=x onerror=alert(2)>',
      detalle: '<iframe src="javascript:alert(3)"></iframe>',
    });
    arranque.render('diario-container');

    const cont = document.getElementById('diario-container');
    expect(cont.querySelector('script')).toBeNull();
    expect(cont.querySelector('img')).toBeNull();
    expect(cont.querySelector('iframe')).toBeNull();
    expect(cont.querySelector('.arranque-detalle-texto').textContent)
      .toBe('<iframe src="javascript:alert(3)"></iframe>');
  });

  it('sin conexión añade la pista de reconectar una vez', () => {
    const original = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

    arranque.setFallo({ titulo: 'T', mensaje: 'M' });
    arranque.render('diario-container');

    const pistas = [...document.querySelectorAll('.arranque-pista')].map(p => p.textContent);
    expect(pistas.some(t => t.includes('Conéctate una vez'))).toBe(true);

    Object.defineProperty(navigator, 'onLine', { value: original, configurable: true });
  });
});

describe('initApp: un fallo de la base no deja la pantalla vacía', () => {
  let arranqueMod;

  beforeEach(() => {
    vi.resetModules();
    montarDOM();
    document.body.insertAdjacentHTML('afterbegin', `
      <nav id="tab-nav">
        <button class="tab-btn is-active" data-tab="diario" aria-selected="true"></button>
        <button class="tab-btn" data-tab="progreso" aria-selected="false"></button>
        <button class="tab-btn" data-tab="config" aria-selected="false"></button>
      </nav>
    `);
  });

  afterEach(() => { vi.doUnmock?.('../js/db.js'); });

  it('captura el rechazo de initDB y pinta el panel de fallo', async () => {
    vi.doMock('../js/componentes/diario.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/componentes/progreso.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/componentes/config.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/telemetria.js', () => ({
      registrarUso: vi.fn(),
      registrarFalloArranque: vi.fn(),
      detectOS: () => 'other',
    }));
    vi.doMock('../js/db.js', () => ({
      // El fallo real reportado: el wasm del motor no está en caché y no hay red.
      initDB: () => Promise.reject(new TypeError('Failed to fetch pglite.wasm')),
      getConf: vi.fn(),
      getOrCreateDeviceId: vi.fn(),
      getRutinas: vi.fn(),
      getRutinaEjercicios: vi.fn(),
    }));

    const { initApp, store } = await import('../js/app.js');
    arranqueMod = await import('../js/componentes/arranque.js');

    // No debe rechazar: el fallo se convierte en UI, no en unhandled rejection.
    await expect(initApp()).resolves.toBeUndefined();

    expect(store.estado).toBe('fallo');
    expect(arranqueMod.hayEstado()).toBe(true);

    const cont = document.getElementById('diario-container');
    expect(cont.querySelector('.arranque-titulo')).not.toBeNull();
    expect(cont.textContent).toContain('NO SE PUDO INICIAR');
  });

  it('la nav queda operativa aunque la base no cargue', async () => {
    vi.doMock('../js/componentes/diario.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/componentes/progreso.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/componentes/config.js', () => ({ render: vi.fn() }));
    vi.doMock('../js/telemetria.js', () => ({
      registrarUso: vi.fn(),
      registrarFalloArranque: vi.fn(),
      detectOS: () => 'other',
    }));
    vi.doMock('../js/db.js', () => ({
      initDB: () => Promise.reject(new TypeError('Failed to fetch')),
      getConf: vi.fn(),
      getOrCreateDeviceId: vi.fn(),
      getRutinas: vi.fn(),
      getRutinaEjercicios: vi.fn(),
    }));

    const { initApp, store } = await import('../js/app.js');
    await initApp();

    // bindNav() corre ANTES del await, así que el click funciona: antes quedaba
    // después de `await initDB()` y la nav se quedaba inerte.
    document.querySelector('[data-tab="progreso"]').click();

    expect(store.currentTab).toBe('progreso');
    expect(document.getElementById('progreso-container').hasAttribute('hidden')).toBe(false);
    // Y el panel de fallo se repinta en la pestaña que se abra, no se queda vacía.
    expect(document.getElementById('progreso-container').querySelector('.arranque-titulo'))
      .not.toBeNull();
  });
});
