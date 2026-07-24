// Orquestador principal: Store global, dispatch, routing SPA por manipulación del DOM
import { registrarUso } from './telemetria.js';
import { urlsParaWarming } from './catalogo.js';

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

export async function initApp() {
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
  await initDB('idb://gym-log-db');
  const conf = await getConf();
  store.prefUnit  = conf.pref_unit;
  store.acentoKey = conf.pref_acento ?? 'verde';
  aplicarAcento(store.acentoKey);
  getOrCreateDeviceId().then(id => registrarUso(id, 'open')); // fire-and-forget

  bindNav();
  navigateTo('diario');

  calentarCacheImagenesCatalogo(getRutinas, getRutinaEjercicios); // fire-and-forget
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined') {
    if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
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
    initApp();
  }
});
