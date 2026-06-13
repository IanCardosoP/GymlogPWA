// Lógica analítica pura: 1RM Epley, barras ASCII, preparación de datos de progreso

export const METRICAS_REGISTRY = {
  '1rm_epley': {
    nombre: 'Fuerza Estimada (1RM)',
    calcular: (seriesArray) => prepararDatosProgreso(seriesArray),
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
