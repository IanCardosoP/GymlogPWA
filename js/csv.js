// Backup completo en JSON — exportación e importación con transacción obligatoria
// Nombrado csv por compatibilidad con versiones anteriores, aunque ahora es JSON

export const BACKUP_VERSION = 1;

export function exportarBackup(datos) {
  return JSON.stringify(datos);
}

async function insertarEnLotes(dbInstance, tabla, columnas, filas, tamanoLote = 500) {
  if (filas.length === 0) return;
  const n = columnas.length;
  for (let i = 0; i < filas.length; i += tamanoLote) {
    const lote = filas.slice(i, i + tamanoLote);
    const placeholders = lote
      .map((_, fi) => `(${columnas.map((_, ci) => `?${fi * n + ci + 1}`).join(',')})`)
      .join(',');
    const valores = lote.flatMap(fila => columnas.map(col => fila[col] ?? null));
    await dbInstance.query(
      `INSERT INTO ${tabla} (${columnas.join(',')}) VALUES ${placeholders}`,
      valores
    );
  }
}

export async function importarBackup(textoJson, dbInstance) {
  let datos;
  try {
    datos = JSON.parse(textoJson);
  } catch {
    return { error: 'Archivo JSON inválido o corrupto.' };
  }

  if (datos.version !== BACKUP_VERSION) {
    return { error: `Versión de backup incompatible: ${datos.version ?? 'desconocida'}` };
  }

  const {
    conf,
    ejercicios = [],
    rutinas = [],
    rutina_ejercicios = [],
    rutina_dias = [],
    sesiones = [],
    series = [],
  } = datos;

  try {
    await dbInstance.exec('BEGIN');

    // Limpiar en orden inverso a las FK
    await dbInstance.exec('DELETE FROM series');
    await dbInstance.exec('DELETE FROM sesiones');
    await dbInstance.exec('DELETE FROM rutina_dias');
    await dbInstance.exec('DELETE FROM rutina_ejercicios');
    await dbInstance.exec('DELETE FROM rutinas');
    await dbInstance.exec('DELETE FROM ejercicios');

    // Backups previos no traen los campos de catálogo: se normalizan a sus
    // defaults (catalogo_revisado es NOT NULL, no admite el null de fila[col]).
    await insertarEnLotes(dbInstance, 'ejercicios',
      ['id', 'nombre', 'grupo_muscular', 'catalogo_id', 'catalogo_revisado'],
      ejercicios.map(e => ({
        ...e,
        catalogo_id: e.catalogo_id ?? null,
        catalogo_revisado: e.catalogo_revisado ?? false,
      })));

    await insertarEnLotes(dbInstance, 'rutinas',
      ['id', 'nombre'], rutinas);

    await insertarEnLotes(dbInstance, 'rutina_ejercicios',
      ['rutina_id', 'ejercicio_id', 'orden', 'activo_hoy'], rutina_ejercicios);

    await insertarEnLotes(dbInstance, 'rutina_dias',
      ['rutina_id', 'dia'], rutina_dias);

    // Las columnas de tiempo y las de cardio se añadieron después del formato
    // original. Los backups viejos no las traen: insertarEnLotes usa
    // `fila[col] ?? null`, así que entran como NULL sin romper nada y sin
    // necesidad de subir BACKUP_VERSION (el cambio es aditivo y compatible).
    await insertarEnLotes(dbInstance, 'sesiones',
      ['id', 'fecha', 'rutina_id', 'energia_sueno', 'peso_corporal',
       'sensacion_final', 'cardio_tipo', 'cardio_tiempo', 'hora_inicio', 'hora_fin'], sesiones);

    await insertarEnLotes(dbInstance, 'series',
      ['sesion_id', 'ejercicio_id', 'numero_serie', 'peso', 'repeticiones'], series);

    if (conf)
      await dbInstance.query(
        'UPDATE conf SET pref_unit = ?1, pref_acento = ?2 WHERE id = 1',
        [conf.pref_unit ?? 'lb', conf.pref_acento ?? 'verde']);

    // Antes acá había cinco SELECT setval(...) para reajustar las secuencias de
    // Postgres y que los INSERT futuros no colisionaran con los IDs restaurados.
    // En SQLite no hace falta: con INTEGER PRIMARY KEY AUTOINCREMENT el motor
    // mantiene sqlite_sequence y lo sube solo al insertar un id explícito mayor
    // que el máximo registrado, que es justo lo que hace este import.

    await dbInstance.exec('COMMIT');
    return {
      ejercicios: ejercicios.length,
      rutinas: rutinas.length,
      sesiones: sesiones.length,
      series: series.length,
      error: null,
    };

  } catch (err) {
    await dbInstance.exec('ROLLBACK');
    return { error: err.message };
  }
}
