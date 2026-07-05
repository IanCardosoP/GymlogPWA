// Lógica analítica pura: 1RM Epley, barras ASCII, preparación de datos de progreso

export const METRICAS_REGISTRY = {
  '1rm_epley': {
    nombre: 'Fuerza Estimada (1RM)',
    descripcion: [
      '¿Qué es? El máximo peso que podrías levantar en una sola repetición, estimado a partir de tus series del día.',
      '¿Cómo se calcula? Fórmula de Epley: 1RM = peso × (1 + reps ÷ 30). Se toma el valor más alto de todas las series de esa sesión.',
      '¿Para qué sirve? Permite comparar tu fuerza entre sesiones aunque uses pesos y repeticiones distintos cada día. Si tu 1RM estimado sube, estás progresando.',
    ],
    calcular: (seriesArray) => prepararDatosProgreso(seriesArray),
  },
  'peso_max': {
    nombre: 'Peso Máximo',
    descripcion: [
      '¿Qué es? El peso más alto que pusiste en la barra en esa sesión.',
      '¿Para qué sirve? Muestra directamente si estás manejando más carga, sin fórmulas. Ideal para seguir récords de levantamiento.',
    ],
    calcular: (seriesArray) => prepararDatosPesoMax(seriesArray),
  },
  'volumen_sesion': {
    nombre: 'Volumen Total',
    descripcion: [
      '¿Qué es? La suma de peso × repeticiones de todas tus series en esa sesión.',
      '¿Para qué sirve? Mide cuánto trabajo total hiciste. Puedes progresar aunque no suba el peso máximo, simplemente haciendo más series o reps.',
    ],
    calcular: (seriesArray) => prepararDatosVolumen(seriesArray),
  },
};

export function calculateEpley1RM(peso, reps) {
  if (peso === 0) return 0;
  return peso * (1 + reps / 30);
}

export function calcularBarraProgreso(valor1RM, maxAbsoluto1RM, anchoTotal = 20) {
  if (maxAbsoluto1RM === 0) return '░'.repeat(anchoTotal);
  const activas = Math.min(Math.round((valor1RM / maxAbsoluto1RM) * anchoTotal), anchoTotal);
  return '█'.repeat(activas) + '░'.repeat(anchoTotal - activas);
}

export function prepararDatosProgreso(seriesArray) {
  const porFecha = {};

  for (const serie of seriesArray) {
    const fecha = serie.fecha instanceof Date
      ? serie.fecha.toISOString().slice(0, 10)
      : String(serie.fecha).slice(0, 10);
    if (!porFecha[fecha]) porFecha[fecha] = [];
    porFecha[fecha].push(serie);
  }

  const sesiones = Object.entries(porFecha)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, series]) => {
      const max1RM = Math.max(
        ...series.map(s => calculateEpley1RM(Number(s.peso), Number(s.repeticiones)))
      );
      return { fecha, series, max1RM };
    });

  const maxAbsoluto = sesiones.reduce((max, s) => Math.max(max, s.max1RM), 0);

  return sesiones.map(s => ({
    fecha: s.fecha,
    series: s.series,
    max1RM: s.max1RM,
    barra: s.max1RM > 0 ? calcularBarraProgreso(s.max1RM, maxAbsoluto) : null,
    maxAbsoluto,
  }));
}

export function prepararDatosPesoMax(seriesArray) {
  const porFecha = {};
  for (const serie of seriesArray) {
    const fecha = serie.fecha instanceof Date
      ? serie.fecha.toISOString().slice(0, 10)
      : String(serie.fecha).slice(0, 10);
    if (!porFecha[fecha]) porFecha[fecha] = [];
    porFecha[fecha].push(serie);
  }

  const sesiones = Object.entries(porFecha)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, series]) => {
      const maxPeso = Math.max(...series.map(s => Number(s.peso)));
      return { fecha, series, maxPeso };
    });

  const maxAbsoluto = sesiones.reduce((m, s) => Math.max(m, s.maxPeso), 0);

  return sesiones.map(s => ({
    fecha: s.fecha,
    series: s.series,
    valor: s.maxPeso,
    barra: s.maxPeso > 0 ? calcularBarraProgreso(s.maxPeso, maxAbsoluto) : null,
    maxAbsoluto,
  }));
}

export function prepararDatosVolumen(seriesArray) {
  const porFecha = {};
  for (const serie of seriesArray) {
    const fecha = serie.fecha instanceof Date
      ? serie.fecha.toISOString().slice(0, 10)
      : String(serie.fecha).slice(0, 10);
    if (!porFecha[fecha]) porFecha[fecha] = [];
    porFecha[fecha].push(serie);
  }

  const sesiones = Object.entries(porFecha)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([fecha, series]) => {
      const volumen = series.reduce(
        (sum, s) => sum + Number(s.peso) * Number(s.repeticiones), 0
      );
      return { fecha, series, volumen };
    });

  const maxAbsoluto = sesiones.reduce((m, s) => Math.max(m, s.volumen), 0);

  return sesiones.map(s => ({
    fecha: s.fecha,
    series: s.series,
    valor: s.volumen,
    barra: s.volumen > 0 ? calcularBarraProgreso(s.volumen, maxAbsoluto) : null,
    maxAbsoluto,
  }));
}

export function calcularTendencia(sesiones) {
  if (!sesiones || sesiones.length < 4) return null;
  const ultimas4 = sesiones.slice(-4);
  const previas = sesiones.slice(0, sesiones.length - 4);
  if (previas.length === 0) return null;
  const previas4 = previas.slice(-4);

  const avg = (arr) => arr.reduce((sum, s) => sum + (s.max1RM ?? s.valor ?? 0), 0) / arr.length;
  const avgUltimas = avg(ultimas4);
  const avgPrevias = avg(previas4);

  if (avgPrevias === 0) return null;

  const delta = ((avgUltimas - avgPrevias) / avgPrevias) * 100;
  if (delta > 3)  return { icono: '↑', texto: `+${delta.toFixed(1)}%`, clase: 'positivo' };
  if (delta < -3) return { icono: '↓', texto: `${delta.toFixed(1)}%`,  clase: 'negativo' };
  return { icono: '→', texto: 'meseta', clase: 'neutro' };
}

export function calcularRacha(fechas, hoy) {
  if (!fechas || fechas.length === 0) return 0;
  const set = new Set(fechas);
  let racha = 0;
  let consecutiveRest = 0;
  const restWindow = []; // últimos 7 días procesados: true=descanso, false=entrenamiento
  const cursor = new Date(hoy + 'T12:00:00Z');

  while (true) {
    const key = cursor.toISOString().slice(0, 10);
    const isRest = !set.has(key);
    // El día corriente sin sesión aún no ha terminado (cuenta hasta las 23:59):
    // es un día pendiente, no un descanso que rompa la racha (issue #17).
    const esHoyPendiente = isRest && key === hoy;

    if (!isRest) {
      racha++;
      consecutiveRest = 0;
    } else if (!esHoyPendiente) {
      consecutiveRest++;
      if (consecutiveRest >= 2) break; // 2 descansos consecutivos rompen la racha
    }

    // El día pendiente de hoy no computa en la ventana semanal de descansos.
    if (!esHoyPendiente) {
      restWindow.unshift(isRest);
      if (restWindow.length > 7) restWindow.pop();
      // Regla semanal: máx 2 días de descanso en cualquier ventana de 7 días
      if (restWindow.length === 7 && restWindow.filter(Boolean).length > 2) break;
    }

    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return racha;
}
