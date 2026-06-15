// Exportación e importación CSV con contrato estricto y transacciones obligatorias

export const CSV_HEADERS = 'fecha,rutina_nombre,ejercicio_nombre,grupo_muscular,numero_serie,peso,repeticiones,peso_corporal,energia_sueno';

export function exportarCSV(datos) {
  const lineas = [CSV_HEADERS];

  for (const row of datos) {
    const cols = [
      row.fecha ?? '',
      row.rutina_nombre ?? '',
      row.ejercicio_nombre ?? '',
      row.grupo_muscular ?? '',
      row.numero_serie ?? '',
      row.peso ?? 0,
      row.repeticiones ?? '',
      row.peso_corporal ?? '',
      row.energia_sueno ?? '',
    ];
    lineas.push(cols.join(','));
  }

  const csvStr = lineas.join('\n');

  if (typeof document !== 'undefined') {
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gymlog-${new Date().toLocaleDateString('en-CA')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return csvStr;
}

export async function importarCSV(archivoTexto, dbInstance) {
  const lineas = archivoTexto.trim().split('\n');

  const primeraLinea = (lineas[0] ?? '').trim();
  if (primeraLinea !== CSV_HEADERS) {
    return {
      exitosas: 0,
      fallidas: 0,
      error: `Headers inválidos. Esperado: "${CSV_HEADERS}"`,
    };
  }

  const filas = lineas.slice(1).filter(l => l.trim());
  if (filas.length === 0) return { exitosas: 0, fallidas: 0, error: null };

  // Validar tipos ANTES de abrir transacción
  for (const linea of filas) {
    const cols = linea.split(',');
    if (cols.length !== 9) {
      return { exitosas: 0, fallidas: filas.length, error: `Fila malformada: "${linea}"` };
    }
    const peso = parseFloat(cols[5]);
    const repeticiones = parseInt(cols[6], 10);
    if (isNaN(peso) || peso < 0) {
      return { exitosas: 0, fallidas: filas.length, error: `Valor de peso inválido: "${cols[5]}"` };
    }
    if (isNaN(repeticiones) || repeticiones < 0) {
      return { exitosas: 0, fallidas: filas.length, error: `Valor de repeticiones inválido: "${cols[6]}"` };
    }
  }

  let exitosas = 0;

  try {
    await dbInstance.exec('BEGIN');

    for (const linea of filas) {
      const [
        fecha, rutina_nombre, ejercicio_nombre, grupo_muscular,
        numero_serie_str, peso_str, repeticiones_str, peso_corporal_str, energia_sueno_str,
      ] = linea.split(',');

      const peso = parseFloat(peso_str);
      const repeticiones = parseInt(repeticiones_str, 10);
      const energiaSueno = parseInt(energia_sueno_str, 10) || null;
      const pesoCorporal = parseFloat(peso_corporal_str) || null;

      // Get or create rutina
      let { rows: rRutina } = await dbInstance.query(
        'SELECT id FROM rutinas WHERE nombre = $1', [rutina_nombre]
      );
      if (rRutina.length === 0) {
        const ins = await dbInstance.query(
          'INSERT INTO rutinas (nombre) VALUES ($1) RETURNING id', [rutina_nombre]
        );
        rRutina = ins.rows;
      }
      const rutinaId = rRutina[0].id;

      // Get or create ejercicio
      let { rows: rEj } = await dbInstance.query(
        'SELECT id FROM ejercicios WHERE nombre = $1', [ejercicio_nombre]
      );
      if (rEj.length === 0) {
        const ins = await dbInstance.query(
          'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ($1, $2) RETURNING id',
          [ejercicio_nombre, grupo_muscular]
        );
        rEj = ins.rows;
      }
      const ejercicioId = rEj[0].id;

      // Get or create sesion
      let { rows: rSesion } = await dbInstance.query(
        'SELECT id FROM sesiones WHERE fecha = $1 AND rutina_id = $2',
        [fecha, rutinaId]
      );
      if (rSesion.length === 0) {
        const ins = await dbInstance.query(
          'INSERT INTO sesiones (fecha, rutina_id, energia_sueno, peso_corporal) VALUES ($1, $2, $3, $4) RETURNING id',
          [fecha, rutinaId, energiaSueno, pesoCorporal]
        );
        rSesion = ins.rows;
      }
      const sesionId = rSesion[0].id;

      await dbInstance.query(
        'INSERT INTO series (sesion_id, ejercicio_id, numero_serie, peso, repeticiones) VALUES ($1, $2, $3, $4, $5)',
        [sesionId, ejercicioId, parseInt(numero_serie_str, 10), peso, repeticiones]
      );

      exitosas++;
    }

    await dbInstance.exec('COMMIT');
    return { exitosas, fallidas: 0, error: null };

  } catch (err) {
    await dbInstance.exec('ROLLBACK');
    return { exitosas: 0, fallidas: filas.length, error: err.message };
  }
}
