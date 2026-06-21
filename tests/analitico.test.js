import { describe, it, expect } from 'vitest';
import {
  calculateEpley1RM, calcularBarraProgreso, prepararDatosProgreso,
  prepararDatosPesoMax, prepararDatosVolumen, calcularTendencia, calcularRacha,
} from '../js/analitico.js';

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

describe('prepararDatosPesoMax', () => {
  const fixture = [
    { fecha: '2026-06-01', peso: 60, repeticiones: 10 },
    { fecha: '2026-06-01', peso: 70, repeticiones: 5 },
    { fecha: '2026-06-08', peso: 75, repeticiones: 8 },
  ];

  it('agrupa por fecha y retorna el peso máximo de la sesión', () => {
    const datos = prepararDatosPesoMax(fixture);
    expect(datos.length).toBe(2);
    expect(datos[0].valor).toBe(70);
    expect(datos[1].valor).toBe(75);
  });

  it('la sesión con mayor peso tiene barra completa', () => {
    const datos = prepararDatosPesoMax(fixture);
    expect(datos[1].barra).toBe('████████████████████');
  });

  it('barra es null para sesiones de solo BW (peso=0)', () => {
    const bw = [{ fecha: '2026-06-01', peso: 0, repeticiones: 15 }];
    const datos = prepararDatosPesoMax(bw);
    expect(datos[0].barra).toBeNull();
  });

  it('retorna array vacío si no hay series', () => {
    expect(prepararDatosPesoMax([])).toEqual([]);
  });
});

describe('prepararDatosVolumen', () => {
  const fixture = [
    { fecha: '2026-06-01', peso: 60, repeticiones: 10 }, // 600
    { fecha: '2026-06-01', peso: 60, repeticiones: 8 },  // 480 → total 1080
    { fecha: '2026-06-08', peso: 70, repeticiones: 10 }, // 700
  ];

  it('agrupa por fecha y suma peso×reps', () => {
    const datos = prepararDatosVolumen(fixture);
    expect(datos.length).toBe(2);
    expect(datos[0].valor).toBeCloseTo(1080);
    expect(datos[1].valor).toBeCloseTo(700);
  });

  it('la sesión con mayor volumen tiene barra completa', () => {
    const datos = prepararDatosVolumen(fixture);
    expect(datos[0].barra).toBe('████████████████████');
  });

  it('BW (peso=0) contribuye 0 al volumen', () => {
    const bw = [{ fecha: '2026-06-01', peso: 0, repeticiones: 15 }];
    const datos = prepararDatosVolumen(bw);
    expect(datos[0].valor).toBe(0);
    expect(datos[0].barra).toBeNull();
  });
});

describe('calcularTendencia', () => {
  const mejorando = [
    { max1RM: 80 }, { max1RM: 82 }, { max1RM: 79 }, { max1RM: 81 }, // previas4: avg=80.5
    { max1RM: 85 }, { max1RM: 87 }, { max1RM: 86 }, { max1RM: 88 }, // últimas4: avg=86.5
  ];

  it('retorna null con menos de 4 sesiones', () => {
    expect(calcularTendencia([{ max1RM: 80 }, { max1RM: 85 }, { max1RM: 90 }])).toBeNull();
  });

  it('retorna null con exactamente 4 sesiones (sin previas para comparar)', () => {
    const cuatro = [{ max1RM: 80 }, { max1RM: 82 }, { max1RM: 84 }, { max1RM: 86 }];
    expect(calcularTendencia(cuatro)).toBeNull();
  });

  it('detecta tendencia positiva > 3%', () => {
    const result = calcularTendencia(mejorando);
    expect(result.icono).toBe('↑');
    expect(result.clase).toBe('positivo');
    expect(result.texto).toMatch(/^\+/);
  });

  it('detecta tendencia negativa < -3%', () => {
    const bajando = [
      { max1RM: 86 }, { max1RM: 88 }, { max1RM: 85 }, { max1RM: 87 }, // previas avg=86.5
      { max1RM: 78 }, { max1RM: 80 }, { max1RM: 79 }, { max1RM: 81 }, // últimas avg=79.5
    ];
    const result = calcularTendencia(bajando);
    expect(result.icono).toBe('↓');
    expect(result.clase).toBe('negativo');
  });

  it('detecta meseta cuando delta está entre -3% y +3%', () => {
    const meseta = [
      { max1RM: 100 }, { max1RM: 101 }, { max1RM: 99 }, { max1RM: 100 },
      { max1RM: 101 }, { max1RM: 100 }, { max1RM: 99 }, { max1RM: 101 },
    ];
    const result = calcularTendencia(meseta);
    expect(result.icono).toBe('→');
    expect(result.clase).toBe('neutro');
  });

  it('acepta propiedad "valor" en lugar de "max1RM" (otras métricas)', () => {
    const datos = [
      { valor: 80 }, { valor: 82 }, { valor: 79 }, { valor: 81 },
      { valor: 90 }, { valor: 91 }, { valor: 89 }, { valor: 90 },
    ];
    const result = calcularTendencia(datos);
    expect(result.icono).toBe('↑');
  });
});

describe('calcularRacha', () => {
  it('retorna 0 sin fechas', () => {
    expect(calcularRacha([], '2026-06-21')).toBe(0);
  });

  it('racha de 1 cuando solo entrenó hoy', () => {
    expect(calcularRacha(['2026-06-21'], '2026-06-21')).toBe(1);
  });

  it('racha de 3 días consecutivos terminando hoy', () => {
    expect(calcularRacha(['2026-06-21', '2026-06-20', '2026-06-19'], '2026-06-21')).toBe(3);
  });

  it('racha se rompe al haber un día sin entrenar', () => {
    // Entrenó ayer y el martes pasado pero no hoy ni el miércoles
    const fechas = ['2026-06-20', '2026-06-17'];
    expect(calcularRacha(fechas, '2026-06-21')).toBe(1);
  });

  it('si no entrenó hoy, cuenta desde ayer', () => {
    const fechas = ['2026-06-20', '2026-06-19', '2026-06-18'];
    expect(calcularRacha(fechas, '2026-06-21')).toBe(3);
  });
});
