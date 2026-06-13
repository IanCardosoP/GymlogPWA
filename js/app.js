// Orquestador principal: Store global, dispatch, routing SPA por manipulación del DOM

const TABS = ['diario', 'progreso', 'config'];

export const store = {
  currentTab: 'diario',
  activeRoutineId: null,
  loadedExercises: [],
  currentSesionId: null,
  prefUnit: 'lb',
};

export function navigateTo(tabName) {
  if (!TABS.includes(tabName)) return;

  store.currentTab = tabName;

  const btnList = document.querySelectorAll('.tab-btn');
  btnList.forEach(btn => {
    const isTarget = btn.dataset.tab === tabName;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-selected', String(isTarget));
  });

  TABS.forEach(tab => {
    const container = document.getElementById(`${tab}-container`);
    if (container) {
      if (tab === tabName) {
        container.removeAttribute('hidden');
      } else {
        container.setAttribute('hidden', '');
      }
    }
  });
}

function bindNav() {
  const nav = document.getElementById('tab-nav');
  if (!nav) return;
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (btn) navigateTo(btn.dataset.tab);
  });
}

export function initApp() {
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
