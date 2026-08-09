// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clampMinutos, calcularProgreso, leerUltimaDuracion, guardarUltimaDuracion,
  minutoDesdeTranslate, leerEstadoActivo, formatearRestante,
} from '../js/componentes/temporizadorDescanso.js';

describe('clampMinutos', () => {
  it('deja pasar valores dentro de 1-5 tal cual', () => {
    expect(clampMinutos(3)).toBe(3);
  });

  it('clampea al límite inferior (1)', () => {
    expect(clampMinutos(0)).toBe(1);
    expect(clampMinutos(-3)).toBe(1);
  });

  it('clampea al límite superior (5)', () => {
    expect(clampMinutos(6)).toBe(5);
    expect(clampMinutos(999)).toBe(5);
  });

  it('redondea valores no enteros', () => {
    expect(clampMinutos(2.6)).toBe(3);
    expect(clampMinutos(2.4)).toBe(2);
  });

  it('retorna el default (2) para valores no finitos', () => {
    expect(clampMinutos(NaN)).toBe(2);
    expect(clampMinutos(undefined)).toBe(2);
    expect(clampMinutos('abc')).toBe(2);
  });
});

describe('calcularProgreso', () => {
  it('retorna 1 (100%) justo al iniciar', () => {
    const ahora = 1000;
    const duracionTotalMs = 60_000;
    const finEn = ahora + duracionTotalMs;
    expect(calcularProgreso(finEn, ahora, duracionTotalMs)).toBe(1);
  });

  it('retorna 0.5 (50%) a mitad de camino', () => {
    const duracionTotalMs = 60_000;
    const finEn = 60_000;
    const ahora = finEn - duracionTotalMs / 2;
    expect(calcularProgreso(finEn, ahora, duracionTotalMs)).toBeCloseTo(0.5, 5);
  });

  it('retorna 0 exacto al llegar al final', () => {
    const finEn = 60_000;
    expect(calcularProgreso(finEn, finEn, 60_000)).toBe(0);
  });

  it('nunca baja de 0 aunque "ahora" pase el final (clamp)', () => {
    const finEn = 60_000;
    expect(calcularProgreso(finEn, finEn + 5_000, 60_000)).toBe(0);
  });

  it('retorna 0 si duracionTotalMs es 0 o negativo', () => {
    expect(calcularProgreso(1000, 500, 0)).toBe(0);
    expect(calcularProgreso(1000, 500, -100)).toBe(0);
  });
});

describe('formatearRestante', () => {
  it('formatea "M:SS" con un minuto o más, segundos con cero a la izquierda', () => {
    expect(formatearRestante(125_000)).toBe('2:05');
    expect(formatearRestante(124_000)).toBe('2:04');
    expect(formatearRestante(60_000)).toBe('1:00');
  });

  it('formatea "Ns" sin cero a la izquierda por debajo de un minuto', () => {
    expect(formatearRestante(59_000)).toBe('59s');
    expect(formatearRestante(58_000)).toBe('58s');
    expect(formatearRestante(10_000)).toBe('10s');
    expect(formatearRestante(9_000)).toBe('9s');
    expect(formatearRestante(1_000)).toBe('1s');
  });

  it('redondea hacia arriba (nunca muestra menos tiempo del que realmente queda)', () => {
    expect(formatearRestante(500)).toBe('1s'); // 0.5s reales → se muestra "1s", no "0s"
    expect(formatearRestante(58_999)).toBe('59s');
  });

  it('nunca baja de "0s" aunque el resto sea negativo', () => {
    expect(formatearRestante(-500)).toBe('0s');
  });

  it('minutos nunca lleva cero a la izquierda (el rango elegible es 1-5)', () => {
    expect(formatearRestante(300_000)).toBe('5:00');
  });
});

describe('minutoDesdeTranslate', () => {
  const ALTURA = 36;

  it('"0m" (cancelar) en la vuelta media (translateY=-396)', () => {
    expect(minutoDesdeTranslate(-396, ALTURA)).toBe(0);
  });

  it('minuto 1 en la vuelta media (translateY=-432)', () => {
    expect(minutoDesdeTranslate(-432, ALTURA)).toBe(1);
  });

  it('minuto 5 en la vuelta media (translateY=-576)', () => {
    expect(minutoDesdeTranslate(-576, ALTURA)).toBe(5);
  });

  it('un valor intermedio (minuto 3)', () => {
    expect(minutoDesdeTranslate(-504, ALTURA)).toBe(3);
  });

  it('un empate exacto a mitad de dos ítems redondea hacia el valor siguiente', () => {
    // Punto medio exacto entre minuto 1 (-432) y minuto 2 (-468)
    expect(minutoDesdeTranslate(-450, ALTURA)).toBe(2);
  });

  it('es cíclico: la misma posición dentro de otra vuelta da el mismo valor', () => {
    expect(minutoDesdeTranslate(-396, ALTURA)).toBe(minutoDesdeTranslate(-180, ALTURA));
    expect(minutoDesdeTranslate(-396, ALTURA)).toBe(minutoDesdeTranslate(36, ALTURA));
  });

  it('sigue resolviendo a un valor válido más allá del rango típicamente renderizado', () => {
    expect(minutoDesdeTranslate(-1200, ALTURA)).toBe(4);
    expect(minutoDesdeTranslate(100, ALTURA)).toBe(4);
  });

  it('coincide con la posición visual real del wheel (regresión del bug reportado: "1m" centrado confirmaba "5m")', () => {
    // translateDesdeMinuto no está exportada (uso interno), así que este caso
    // reproduce la geometría real del CSS a mano: viewport de 108px, centro
    // en 54px, VUELTA_MEDIA=2, RANGO_WHEEL=6 (0-5, no 1-5: incluye "0m") —
    // mismos números que usa el módulo. Si esto alguna vez vuelve a
    // desalinearse con la fórmula real, este test debe fallar.
    const VUELTA_MEDIA = 2, RANGO_WHEEL = 6;
    const translateDesdeIndice = indice => -(indice - 1) * ALTURA;
    const translateDesdeMinutoEsperado = m => translateDesdeIndice(VUELTA_MEDIA * RANGO_WHEEL + m);

    for (let m = 0; m <= 5; m++) {
      expect(minutoDesdeTranslate(translateDesdeMinutoEsperado(m), ALTURA)).toBe(m);
    }
  });
});

describe('leerUltimaDuracion / guardarUltimaDuracion', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('retorna el default (2) cuando no hay nada guardado', () => {
    expect(leerUltimaDuracion()).toBe(2);
  });

  it('recuerda el valor guardado', () => {
    guardarUltimaDuracion(4);
    expect(leerUltimaDuracion()).toBe(4);
  });

  it('clampea al guardar un valor fuera de rango', () => {
    guardarUltimaDuracion(99);
    expect(leerUltimaDuracion()).toBe(5);
  });

  it('retorna el default si el valor guardado está corrupto', () => {
    localStorage.setItem('gymlog:descanso-minutos', '{not json');
    expect(leerUltimaDuracion()).toBe(2);
  });
});

describe('leerEstadoActivo', () => {
  const CLAVE = 'gymlog:descanso-estado';

  beforeEach(() => {
    localStorage.clear();
  });

  it('retorna null cuando no hay nada guardado', () => {
    expect(leerEstadoActivo()).toBeNull();
  });

  it('ida y vuelta con un estado válido', () => {
    const finEn = Date.now() + 60_000;
    localStorage.setItem(CLAVE, JSON.stringify({ finEn, duracionTotalMs: 60_000 }));
    expect(leerEstadoActivo()).toEqual({ finEn, duracionTotalMs: 60_000 });
  });

  it('retorna null si el JSON está corrupto', () => {
    localStorage.setItem(CLAVE, '{not json');
    expect(leerEstadoActivo()).toBeNull();
  });

  it('retorna null si duracionTotalMs es 0, negativa o no numérica', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ finEn: Date.now(), duracionTotalMs: 0 }));
    expect(leerEstadoActivo()).toBeNull();

    localStorage.setItem(CLAVE, JSON.stringify({ finEn: Date.now(), duracionTotalMs: -100 }));
    expect(leerEstadoActivo()).toBeNull();

    localStorage.setItem(CLAVE, JSON.stringify({ finEn: Date.now(), duracionTotalMs: 'abc' }));
    expect(leerEstadoActivo()).toBeNull();
  });

  it('retorna null si finEn no es numérico', () => {
    localStorage.setItem(CLAVE, JSON.stringify({ finEn: 'abc', duracionTotalMs: 60_000 }));
    expect(leerEstadoActivo()).toBeNull();
  });
});
