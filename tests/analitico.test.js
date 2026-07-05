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

// Referencia de días (2026): Dom=21/28, Lun=22, Mar=23, Mié=24, Jue=25, Vie=26, Sáb=27
// Semana anterior: Dom=14, Lun=15, Mar=16, Mié=17, Jue=18, Vie=19, Sáb=20

describe('calcularRacha (máx 2 descansos no-consecutivos/semana)', () => {
  it('retorna 0 sin fechas', () => {
    expect(calcularRacha([], '2026-06-23')).toBe(0);
  });

  it('racha de 1 cuando solo entrenó hoy', () => {
    expect(calcularRacha(['2026-06-23'], '2026-06-23')).toBe(1);
  });

  it('racha de 3 con días de entrenamiento consecutivos', () => {
    // Lun 22, Mar 23, Mié 24
    expect(calcularRacha(['2026-06-24', '2026-06-23', '2026-06-22'], '2026-06-24')).toBe(3);
  });

  it('1 día de descanso no-consecutivo es gracia y no corta la racha', () => {
    // Jue 25 entrenó, Mié 24 descanso, Mar 23 entrenó → racha = 2
    expect(calcularRacha(['2026-06-25', '2026-06-23'], '2026-06-25')).toBe(2);
  });

  it('2 días concluidos de descanso consecutivos cortan la racha', () => {
    // Jue 25 entrenó; Vie 26 y Sáb 27 descanso (ya concluidos); hoy = Dom 28 pendiente → racha = 0
    expect(calcularRacha(['2026-06-25'], '2026-06-28')).toBe(0);
  });

  it('rutina estándar 5 días/sem con 2 descansos no-consecutivos mantiene la racha', () => {
    // LunMarJueVieSáb entrenados, MiéDom descanso → 5 sesiones, racha = 5
    const entrenados = ['2026-06-22', '2026-06-23', '2026-06-25', '2026-06-26', '2026-06-27'];
    expect(calcularRacha(entrenados, '2026-06-27')).toBe(5);
  });

  it('3 descansos no-consecutivos en ventana de 7 días rompen la racha', () => {
    // Patrón T-R-T-R-T-R-T en 7 días: entrenados Lun+Mié+Vie+Dom, descanso Mar+Jue+Sáb
    // hoy=Dom 28, entrenados: Dom 28, Vie 26, Mié 24, Lun 22
    // descanso: Sáb 27, Jue 25, Mar 23 → 3 descansos en ventana de 7
    expect(calcularRacha(['2026-06-28', '2026-06-26', '2026-06-24', '2026-06-22'], '2026-06-28')).toBe(4);
  });

  it('2 semanas completas (5 días/sem) con 2 descansos de gracia cada semana mantiene la racha', () => {
    // Semana 1: LunMarJueVieSáb (15,16,18,19,20) + descanso MiéDom (17,21)
    // Semana 2: LunMarJueVieSáb (22,23,25,26,27) + descanso MiéDom (24,28→hoy sin sesión)
    const semana1 = ['2026-06-15', '2026-06-16', '2026-06-18', '2026-06-19', '2026-06-20'];
    const semana2 = ['2026-06-22', '2026-06-23', '2026-06-25', '2026-06-26', '2026-06-27'];
    // hoy = Sáb 27 (último día entrenado)
    expect(calcularRacha([...semana2, ...semana1], '2026-06-27')).toBe(10);
  });

  it('2 descansos no-consecutivos en 5 días (sin completar ventana de 7) son válidos', () => {
    // Hoy=Jue 25: Jue entrenó, Mié 24 descanso, Mar 23 entrenó, Lun 22 descanso, Dom 21 entrenó
    // 2 descansos no-consecutivos — continúa
    expect(calcularRacha(['2026-06-25', '2026-06-23', '2026-06-21'], '2026-06-25')).toBe(3);
  });

  it('el día corriente sin sesión no rompe la racha hasta las 23:59 (issue #17)', () => {
    // Entrenó Vie 19 + Sáb 20, descanso Dom 21, usuario abre la app el Lun 22 por la mañana.
    // El Lun 22 aún es un día pendiente → la racha activa se mantiene = 2.
    expect(calcularRacha(['2026-06-20', '2026-06-19'], '2026-06-22')).toBe(2);
  });
});
