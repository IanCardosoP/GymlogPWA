// Orquestador principal: Store global, dispatch, routing SPA por manipulación del DOM

const TABS = ['diario', 'progreso', 'config'];

// Registro de funciones render — se puebla en initApp() con dynamic imports
const RENDERS = {};

export const store = {
  currentTab: 'diario',
  activeRoutineId: null,
  loadedExercises: [],
  currentSesionId: null,
  prefUnit: 'lb',
};

export function dispatch(action, payload) {
  switch (action) {
    case 'SET_SESION':    store.currentSesionId  = payload; break;
    case 'SET_RUTINA':    store.activeRoutineId  = payload; break;
    case 'SET_EXERCISES': store.loadedExercises  = payload; break;
    case 'SET_PREF_UNIT': store.prefUnit         = payload; break;
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

  const { initDB, getConf } = await import('./db.js');
  await initDB('idb://gym-log-db');
  const conf = await getConf();
  store.prefUnit = conf.pref_unit;

  bindNav();
  navigateTo('diario');
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof window !== 'undefined') {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
    initApp();
  }
});
