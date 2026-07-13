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
      .map((_, fi) => `(${columnas.map((_, ci) => `$${fi * n + ci + 1}`).join(',')})`)
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

    await insertarEnLotes(dbInstance, 'sesiones',
      ['id', 'fecha', 'rutina_id', 'energia_sueno', 'peso_corporal'], sesiones);

    await insertarEnLotes(dbInstance, 'series',
      ['sesion_id', 'ejercicio_id', 'numero_serie', 'peso', 'repeticiones'], series);

    if (conf)
      await dbInstance.query(
        'UPDATE conf SET pref_unit = $1, pref_acento = $2 WHERE id = 1',
        [conf.pref_unit ?? 'lb', conf.pref_acento ?? 'verde']);

    // Resetear secuencias para que futuros INSERTs no colisionen con IDs restaurados
    await dbInstance.exec(`
      SELECT setval('ejercicios_id_seq', COALESCE((SELECT MAX(id) FROM ejercicios), 0) + 1, false);
      SELECT setval('rutinas_id_seq', COALESCE((SELECT MAX(id) FROM rutinas), 0) + 1, false);
      SELECT setval('rutina_ejercicios_id_seq', COALESCE((SELECT MAX(id) FROM rutina_ejercicios), 0) + 1, false);
      SELECT setval('sesiones_id_seq', COALESCE((SELECT MAX(id) FROM sesiones), 0) + 1, false);
      SELECT setval('series_id_seq', COALESCE((SELECT MAX(id) FROM series), 0) + 1, false);
    `);

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
