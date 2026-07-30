// Orquestador principal: Store global, dispatch, routing SPA por manipulación del DOM
import { registrarUso, registrarFalloArranque } from './telemetria.js';
import { urlsParaWarming } from './catalogo.js';
// Import ESTÁTICO a propósito: el panel de error no puede depender de un chunk
// que quizá sea justamente el que no carga.
import * as arranque from './componentes/arranque.js';

const TABS = ['diario', 'progreso', 'config'];

// Registro de funciones render — se puebla en initApp() con dynamic imports
const RENDERS = {};

export const ACENTOS = {
  verde:  '#00ff88',
  morado: '#bf00ff',
  rosa:   '#ff0080',
  cian:   '#00d4ff',
};

export function aplicarAcento(key) {
  document.documentElement.style.setProperty('--color-acento', ACENTOS[key] ?? ACENTOS.verde);
}

export const store = {
  currentTab: 'diario',
  activeRoutineId: null,
  loadedExercises: [],
  currentSesionId: null,
  prefUnit: 'lb',
  acentoKey: 'verde',
  // 'arrancando' | 'listo' | 'fallo'. Los componentes solo se renderizan en
  // 'listo': sus render() consultan la base, y antes de que initDB() resuelva
  // eso lanzaría. Mientras no lo esté, se pinta el panel de arranque.
  estado: 'arrancando',
};

export function dispatch(action, payload) {
  switch (action) {
    case 'SET_SESION':    store.currentSesionId  = payload; break;
    case 'SET_RUTINA':    store.activeRoutineId  = payload; break;
    case 'SET_EXERCISES': store.loadedExercises  = payload; break;
    case 'SET_PREF_UNIT': store.prefUnit         = payload; break;
    case 'SET_ACENTO':    store.acentoKey        = payload; aplicarAcento(payload); break;
  }
  RENDERS[store.currentTab]?.(store);
}

export function navigateTo(tabName) {
  if (!TABS.includes(tabName)) return;

  store.currentTab = tabName;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    const isTarget = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  TABS.forEach(tab => {
    const container = document.getElementById(`${tab}-container`);
    if (!container) return;
    if (tab === tabName) container.removeAttribute('hidden');
    else container.setAttribute('hidden', '');
  });

  // Mientras la app no esté lista, la pestaña que se abra muestra el estado de
  // arranque en vez de quedarse vacía. Navegar tiene que funcionar igual: es lo
  // que distingue "está cargando" de "está rota".
  if (store.estado !== 'listo') {
    arranque.render(`${tabName}-container`);
    return;
  }

  RENDERS[tabName]?.(store);
}

function bindNav() {
  const nav = document.getElementById('tab-nav');
  if (!nav) return;
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) navigateTo(btn.dataset.tab);
  });
}

// Warming best-effort de la caché de imágenes del catálogo: tras abrir el
// Diario, si hay red, precalienta en segundo plano las miniaturas de todos
// los ejercicios de todas las rutinas del usuario (no solo las visibles). El
// Service Worker las cachea al pasar (gymlog-catalogo) — así quedan
// disponibles offline aunque el usuario nunca haya llegado a verlas en
// pantalla. Fire-and-forget: nunca bloquea la UI, errores silenciosos.
function calentarCacheImagenesCatalogo(getRutinas, getRutinaEjercicios) {
  if (!navigator.onLine) return;

  const idle = typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : cb => setTimeout(cb, 1000);

  idle(async () => {
    try {
      const rutinas = await getRutinas();
      const filasPorRutina = await Promise.all(
        rutinas.map(r => getRutinaEjercicios(r.id))
      );
      const urls = urlsParaWarming(filasPorRutina.flat());
      const base = import.meta.env.BASE_URL;
      await Promise.allSettled(urls.map(url => fetch(`${base}${url}`)));
    } catch {
      // best-effort: red intermitente, DB no lista, etc. — sin romper la app.
    }
  });
}

// Umbral del watchdog. Cubre el caso *lie-fi* (red conectada con throughput ~0):
// ahí el fetch interno del motor no resuelve NI rechaza, así que sin esto la app
// se quedaría en «cargando» para siempre y sin forma de reintentar.
const TIMEOUT_ARRANQUE = 15_000;

// No aborta nada: solo avisa. La promesa del arranque sigue viva, porque si la
// descarga acaba llegando queremos que la app entre normal.
function armarWatchdog() {
  const id = setTimeout(() => {
    arranque.setFallo({
      titulo: '[ TARDA MÁS DE LO NORMAL ]',
      mensaje: 'La app sigue intentando preparar la base de datos. Si acabas de ' +
        'actualizar, puede estar descargando el motor.',
    });
    arranque.render(`${store.currentTab}-container`);
  }, TIMEOUT_ARRANQUE);

  return () => clearTimeout(id);
}

// Código corto y de conjunto cerrado para la telemetría: nunca se manda a la red
// un string arbitrario (mismo criterio que el whitelist del worker).
function clasificarFallo(error) {
  if (!navigator.onLine) return 'sin-red';
  const texto = String(error?.message ?? error);
  if (/dynamically imported module|Importing a module script failed/i.test(texto)) return 'chunk';
  if (/wasm|WebAssembly|\.data/i.test(texto)) return 'motor';
  return 'db';
}

function fallarArranque(error) {
  store.estado = 'fallo';

  // La migración es el único fallo en el que el usuario TIENE datos en juego, así
  // que se le dice explícitamente que están a salvo. Arrancar con la base vacía
  // sería peor que no arrancar: empezaría a registrar encima y acabaríamos con
  // dos conjuntos de datos divergentes. La base vieja no se borra hasta que la
  // migración haya salido bien.
  const esMigracion = /migración fallida/i.test(String(error?.message ?? ''));

  arranque.setFallo({
    titulo: esMigracion ? '[ ⚠ MIGRACIÓN PENDIENTE ]' : '[ ✕ NO SE PUDO INICIAR ]',
    mensaje: esMigracion
      ? 'Tus datos están a salvo, pero no se pudieron trasladar todavía. ' +
        'Conéctate una vez a internet y vuelve a abrir la app: se completa sola.'
      : navigator.onLine
        ? 'No se pudo preparar la base de datos. Falta parte de la app en la caché ' +
          'del dispositivo.'
        : 'Falta parte de la app en la caché del dispositivo y no hay conexión para ' +
          'reponerla.',
    detalle: `${error?.name ?? 'Error'}: ${error?.message ?? error}`,
  });
  arranque.render(`${store.currentTab}-container`);

  registrarFalloArranque(esMigracion ? 'migracion' : clasificarFallo(error));
}

export async function initApp() {
  // bindNav ANTES de cualquier await. Estaba después de `await initDB()`, así que
  // cuando la base no cargaba la nav quedaba pintada pero inerte: ni se podía
  // cambiar de pestaña. Poder navegar es lo que distingue "está cargando" de
  // "está rota".
  bindNav();
  arranque.setCargando('Preparando la aplicación…');
  arranque.render('diario-container');

  const desarmar = armarWatchdog();

  try {
    const [{ render: renderDiario }, { render: renderProgreso }, { render: renderConfig }] =
      await Promise.all([
        import('./componentes/diario.js'),
        import('./componentes/progreso.js'),
        import('./componentes/config.js'),
      ]);

    RENDERS['diario']  = renderDiario;
    RENDERS['progreso'] = renderProgreso;
    RENDERS['config']  = renderConfig;

    const { initDB, getConf, getOrCreateDeviceId, getRutinas, getRutinaEjercicios } =
      await import('./db.js');

    arranque.setCargando('Preparando base de datos…');
    arranque.render(`${store.currentTab}-container`);

    const motor = await initDB('idb://gym-log-db');

    // Migración única desde la base PGLite legada. El módulo se carga en un chunk
    // aparte y solo si hace falta: una instalación nueva nunca descarga PGLite.
    // Si falla, se propaga al panel de arranque en vez de arrancar con la base
    // vacía — el usuario tiene datos y hay que decírselo, no perderlos en
    // silencio (la base legada no se borra en este release).
    const { migrarDesdePglite, yaMigrado } = await import('./migracion/desdePglite.js');
    if (!yaMigrado()) {
      arranque.setCargando('Migrando tus datos…');
      arranque.render(`${store.currentTab}-container`);
      await migrarDesdePglite(motor);
    }

    const conf = await getConf();
    store.prefUnit  = conf.pref_unit;
    store.acentoKey = conf.pref_acento ?? 'verde';
    aplicarAcento(store.acentoKey);
    getOrCreateDeviceId().then(id => registrarUso(id, 'open')); // fire-and-forget

    store.estado = 'listo';
    arranque.limpiar();
    navigateTo(store.currentTab);

    calentarCacheImagenesCatalogo(getRutinas, getRutinaEjercicios); // fire-and-forget
  } catch (error) {
    fallarArranque(error);
  } finally {
    desarmar();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined') {
    // Solo en build de producción. Antes el guard era `hostname !== 'localhost'`,
    // pero `pnpm run dev` corre con --host justamente para probar en el móvil por
    // IP de LAN: ahí el SW SÍ se registraba, con los placeholders del manifiesto
    // sin sellar, y su install fallaba en bucle intentando cachear un string
    // carácter por carácter. import.meta.env.PROD no depende del hostname.
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
    }
    // Pide almacenamiento persistente: sin esto, el navegador puede purgar la
    // caché del catálogo (gymlog-catalogo, ~9 MB) bajo presión de espacio,
    // justo el bug que motivó separar las cachés. Fire-and-forget: el
    // navegador decide, y optional chaining degrada en silencio donde no existe.
    navigator.storage?.persist?.();
    // Feedback háptico de keycap en todo botón (patrón Terminal CLI de la skill).
    // navigator.vibrate no existe en iOS/desktop → optional chaining degrada en silencio.
    document.addEventListener('click', e => {
      if (e.target.closest('button')) navigator.vibrate?.(10);
    });
    // .catch() de último recurso: initApp ya captura lo suyo, pero un fallo al
    // pintar el propio panel de error no puede quedar como unhandled rejection
    // silenciosa — era exactamente el modo de fallo original.
    initApp().catch(error => console.error('[arranque] fallo no capturado:', error));
  }
});
