import { describe, it, expect } from 'vitest';
import { calculateEpley1RM, calcularBarraProgreso, prepararDatosProgreso } from '../js/analitico.js';

describe('calculateEpley1RM', () => {
  it('calcula 1RM correctamente con peso y reps normales', () => {
    expect(calculateEpley1RM(100, 10)).toBeCloseTo(133.33, 1);
  });

  it('retorna 0 exacto cuando peso = 0 (regla BW)', () => {
    expect(calculateEpley1RM(0, 10)).toBe(0);
  });

  it('retorna el propio peso cuando reps = 0', () => {
    expect(calculateEpley1RM(80, 0)).toBe(80);
  });

  it('nunca retorna Infinity ni NaN para BW', () => {
    const resultado = calculateEpley1RM(0, 10);
    expect(Number.isFinite(resultado) || resultado === 0).toBe(true);
    expect(Number.isNaN(resultado)).toBe(false);
  });
});

describe('calcularBarraProgreso', () => {
  it('retorna string de exactamente 20 caracteres', () => {
    const barra = calcularBarraProgreso(76, 80);
    expect(barra.length).toBe(20);
  });

  it('retorna proporción correcta para 76/80', () => {
    const barra = calcularBarraProgreso(76, 80);
    const llenas = [...barra].filter(c => c === '█').length;
    expect(llenas).toBe(19);
  });

  it('retorna barra 100% llena cuando valor = máximo', () => {
    expect(calcularBarraProgreso(80, 80)).toBe('████████████████████');
  });

  it('retorna barra vacía cuando maxAbsoluto = 0', () => {
    expect(calcularBarraProgreso(0, 0)).toBe('░░░░░░░░░░░░░░░░░░░░');
  });

  it('no supera anchoTotal aunque el valor exceda el máximo', () => {
    const barra = calcularBarraProgreso(100, 80);
    expect(barra.length).toBe(20);
  });
});

describe('prepararDatosProgreso', () => {
  const seriesFixture = [
    { fecha: '2026-06-01', peso: 60, repeticiones: 10 },
    { fecha: '2026-06-01', peso: 60, repeticiones: 8 },
    { fecha: '2026-06-08', peso: 65, repeticiones: 10 },
  ];

  it('agrupa series por fecha y calcula max1RM por sesión', () => {
    const datos = prepararDatosProgreso(seriesFixture);
    expect(datos.length).toBe(2);
    expect(datos[0].fecha).toBe('2026-06-01');
    expect(datos[1].fecha).toBe('2026-06-08');
  });

  it('el max1RM de la segunda sesión es mayor (mejor rendimiento)', () => {
    const datos = prepararDatosProgreso(seriesFixture);
    expect(datos[1].max1RM).toBeGreaterThan(datos[0].max1RM);
  });

  it('la barra de la sesión con mayor 1RM es la barra completa', () => {
    const datos = prepararDatosProgreso(seriesFixture);
    const maxSesion = datos.reduce((m, d) => d.max1RM > m.max1RM ? d : m);
    expect(maxSesion.barra).toBe('████████████████████');
  });

  it('barra es null para sesiones con solo ejercicios BW', () => {
    const bwSeries = [{ fecha: '2026-06-01', peso: 0, repeticiones: 15 }];
    const datos = prepararDatosProgreso(bwSeries);
    expect(datos[0].barra).toBeNull();
  });

  it('retorna array vacío si no hay series', () => {
    expect(prepararDatosProgreso([])).toEqual([]);
  });
});
