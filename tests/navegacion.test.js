// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { navigateTo, store } from '../js/app.js';

function buildDOM() {
  document.body.innerHTML = `
    <nav id="tab-nav">
      <button class="tab-btn is-active" data-tab="diario" aria-selected="true"></button>
      <button class="tab-btn" data-tab="progreso" aria-selected="false"></button>
      <button class="tab-btn" data-tab="config" aria-selected="false"></button>
    </nav>
    <section id="diario-container"></section>
    <section id="progreso-container" hidden></section>
    <section id="config-container" hidden></section>
  `;
}

describe('navegación SPA', () => {
  beforeEach(() => {
    buildDOM();
    navigateTo('diario');
  });

  it('actualiza store.currentTab al navegar', () => {
    navigateTo('progreso');
    expect(store.currentTab).toBe('progreso');
  });

  it('mueve is-active al botón correcto', () => {
    navigateTo('progreso');
    const btns = document.querySelectorAll('.tab-btn');
    expect(btns[0].classList.contains('is-active')).toBe(false);
    expect(btns[1].classList.contains('is-active')).toBe(true);
    expect(btns[2].classList.contains('is-active')).toBe(false);
  });

  it('actualiza aria-selected correctamente', () => {
    navigateTo('config');
    const btns = document.querySelectorAll('.tab-btn');
    expect(btns[0].getAttribute('aria-selected')).toBe('false');
    expect(btns[1].getAttribute('aria-selected')).toBe('false');
    expect(btns[2].getAttribute('aria-selected')).toBe('true');
  });

  it('oculta los contenedores no activos y muestra el activo', () => {
    navigateTo('progreso');
    expect(document.getElementById('diario-container').hasAttribute('hidden')).toBe(true);
    expect(document.getElementById('progreso-container').hasAttribute('hidden')).toBe(false);
    expect(document.getElementById('config-container').hasAttribute('hidden')).toBe(true);
  });

  it('navegar a una tab inválida no modifica el store', () => {
    navigateTo('diario');
    navigateTo('invalida');
    expect(store.currentTab).toBe('diario');
  });
});
