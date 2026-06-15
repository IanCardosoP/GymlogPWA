// Backup completo en JSON — exportación e importación con transacción obligatoria

export const BACKUP_VERSION = 1;

export function exportarBackup(datos) {
  const json = JSON.stringify(datos, null, 2);

  if (typeof document !== 'undefined') {
    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gymlog-backup-${new Date().toLocaleDateString('en-CA')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return json;
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

    for (const e of ejercicios)
      await dbInstance.query(
        'INSERT INTO ejercicios (id, nombre, grupo_muscular) VALUES ($1, $2, $3)',
        [e.id, e.nombre, e.grupo_muscular]);

    for (const r of rutinas)
      await dbInstance.query(
        'INSERT INTO rutinas (id, nombre) VALUES ($1, $2)',
        [r.id, r.nombre]);

    for (const re of rutina_ejercicios)
      await dbInstance.query(
        'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden, activo_hoy) VALUES ($1, $2, $3, $4)',
        [re.rutina_id, re.ejercicio_id, re.orden, re.activo_hoy]);

    for (const rd of rutina_dias)
      await dbInstance.query(
        'INSERT INTO rutina_dias (rutina_id, dia) VALUES ($1, $2)',
        [rd.rutina_id, rd.dia]);

    for (const s of sesiones)
      await dbInstance.query(
        'INSERT INTO sesiones (id, fecha, rutina_id, energia_sueno, peso_corporal) VALUES ($1, $2, $3, $4, $5)',
        [s.id, s.fecha, s.rutina_id, s.energia_sueno ?? null, s.peso_corporal ?? null]);

    for (const sr of series)
      await dbInstance.query(
        'INSERT INTO series (sesion_id, ejercicio_id, numero_serie, peso, repeticiones) VALUES ($1, $2, $3, $4, $5)',
        [sr.sesion_id, sr.ejercicio_id, sr.numero_serie, sr.peso, sr.repeticiones]);

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
