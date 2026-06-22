// Capa de datos: instancia PGLite, DDL, funciones de servicio SQL puras (solo promesas)
import { PGlite } from '@electric-sql/pglite';

let db = null;

export async function initDB(uri = 'idb://gym-log-db') {
  db = new PGlite(uri);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS ejercicios (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      grupo_muscular TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rutinas (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      dia_sugerido INT
    );

    CREATE TABLE IF NOT EXISTS rutina_ejercicios (
      id SERIAL PRIMARY KEY,
      rutina_id INT REFERENCES rutinas(id) ON DELETE CASCADE,
      ejercicio_id INT REFERENCES ejercicios(id) ON DELETE CASCADE,
      orden INT,
      activo_hoy BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS sesiones (
      id SERIAL PRIMARY KEY,
      fecha DATE,
      rutina_id INT REFERENCES rutinas(id),
      energia_sueno INT,
      peso_corporal NUMERIC,
      sensacion_final TEXT,
      cardio_tipo TEXT,
      cardio_tiempo INT
    );

    CREATE TABLE IF NOT EXISTS series (
      id SERIAL PRIMARY KEY,
      sesion_id INT REFERENCES sesiones(id) ON DELETE CASCADE,
      ejercicio_id INT REFERENCES ejercicios(id),
      numero_serie INT,
      peso NUMERIC,
      repeticiones INT
    );

    CREATE TABLE IF NOT EXISTS conf (
      id INT PRIMARY KEY DEFAULT 1,
      pref_unit   TEXT NOT NULL DEFAULT 'lb',
      pref_acento TEXT NOT NULL DEFAULT 'verde',
      CONSTRAINT chk_pref_unit CHECK (pref_unit IN ('kg', 'lb')),
      CONSTRAINT chk_single_row CHECK (id = 1)
    );

    INSERT INTO conf (id, pref_unit)
    VALUES (1, 'lb')
    ON CONFLICT (id) DO NOTHING;

    ALTER TABLE conf ADD COLUMN IF NOT EXISTS pref_acento TEXT NOT NULL DEFAULT 'verde';

    ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS hora_inicio TIMESTAMPTZ;
    ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS hora_fin    TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS rutina_dias (
      id        SERIAL PRIMARY KEY,
      rutina_id INT REFERENCES rutinas(id) ON DELETE CASCADE,
      dia       INT NOT NULL,
      UNIQUE (rutina_id, dia)
    );

    INSERT INTO rutina_dias (rutina_id, dia)
    SELECT id, dia_sugerido FROM rutinas
    WHERE dia_sugerido IS NOT NULL
    ON CONFLICT DO NOTHING;
  `);

  return db;
}

export function getDB() {
  return db;
}

// ── Ejercicios ────────────────────────────────────────────────────────────────

export async function getEjercicios() {
  const result = await db.query(
    'SELECT id, nombre, grupo_muscular FROM ejercicios ORDER BY nombre'
  );
  return result.rows;
}

export async function updateEjercicioNombre(ejId, nuevoNombre, nuevoGrupo) {
  const result = await db.query(
    'UPDATE ejercicios SET nombre = $1, grupo_muscular = COALESCE($3, grupo_muscular) WHERE id = $2 RETURNING *',
    [nuevoNombre, ejId, nuevoGrupo ?? null]
  );
  return result.rows[0];
}

export async function deleteEjercicio(ejId) {
  await db.query('DELETE FROM series WHERE ejercicio_id = $1', [ejId]);
  await db.query('DELETE FROM ejercicios WHERE id = $1', [ejId]);
}

export async function removeEjercicioDeRutina(rutinaId, ejId) {
  await db.query(
    'DELETE FROM rutina_ejercicios WHERE rutina_id = $1 AND ejercicio_id = $2',
    [rutinaId, ejId]
  );
  const { rows } = await db.query(
    'SELECT 1 FROM rutina_ejercicios WHERE ejercicio_id = $1 LIMIT 1',
    [ejId]
  );
  if (rows.length === 0) {
    await db.query('DELETE FROM series WHERE ejercicio_id = $1', [ejId]);
    await db.query('DELETE FROM ejercicios WHERE id = $1', [ejId]);
  }
}

export async function saveEjercicio(nombre, grupoMuscular) {
  const result = await db.query(
    'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ($1, $2) RETURNING *',
    [nombre, grupoMuscular]
  );
  return result.rows[0];
}

export async function getOrCreateEjercicio(nombre, grupoMuscular) {
  const { rows } = await db.query(
    'SELECT * FROM ejercicios WHERE LOWER(nombre) = LOWER($1) LIMIT 1',
    [nombre]
  );
  if (rows.length > 0) return rows[0];
  const result = await db.query(
    'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ($1, $2) RETURNING *',
    [nombre, grupoMuscular]
  );
  return result.rows[0];
}

// ── Rutinas ───────────────────────────────────────────────────────────────────

export async function getRutinas() {
  const result = await db.query('SELECT * FROM rutinas');
  return result.rows;
}

export async function getRutinasDias() {
  const { rows } = await db.query('SELECT rutina_id, dia FROM rutina_dias ORDER BY dia');
  return rows;
}

export async function addRutinaDia(rutinaId, dia) {
  await db.query(
    'INSERT INTO rutina_dias (rutina_id, dia) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [rutinaId, dia]
  );
}

export async function removeRutinaDia(rutinaId, dia) {
  await db.query(
    'DELETE FROM rutina_dias WHERE rutina_id = $1 AND dia = $2',
    [rutinaId, dia]
  );
}

// Un día solo puede pertenecer a una rutina: desvincula cualquier asignación previa y asigna la nueva
export async function assignRutinaDiaExclusivo(rutinaId, dia) {
  await db.query('BEGIN');
  await db.query('DELETE FROM rutina_dias WHERE dia = $1', [dia]);
  await db.query('INSERT INTO rutina_dias (rutina_id, dia) VALUES ($1, $2)', [rutinaId, dia]);
  await db.query('COMMIT');
}

export async function updateRutinaNombre(rutinaId, nuevoNombre) {
  const { rows } = await db.query(
    'UPDATE rutinas SET nombre = $1 WHERE id = $2 RETURNING *',
    [nuevoNombre, rutinaId]
  );
  return rows[0];
}

export async function deleteRutina(rutinaId) {
  await db.query('UPDATE sesiones SET rutina_id = NULL WHERE rutina_id = $1', [rutinaId]);
  await db.query('DELETE FROM rutinas WHERE id = $1', [rutinaId]);
  // rutina_ejercicios y rutina_dias cascadean automáticamente
}

export async function saveRutina(nombre, diaSugerido) {
  const result = await db.query(
    'INSERT INTO rutinas (nombre, dia_sugerido) VALUES ($1, $2) RETURNING *',
    [nombre, diaSugerido ?? null]
  );
  return result.rows[0];
}

export async function getRutinaEjercicios(rutinaId) {
  const result = await db.query(
    `SELECT re.id, re.rutina_id, re.ejercicio_id, re.orden, re.activo_hoy,
            e.nombre, e.grupo_muscular
     FROM rutina_ejercicios re
     JOIN ejercicios e ON e.id = re.ejercicio_id
     WHERE re.rutina_id = $1
     ORDER BY re.orden`,
    [rutinaId]
  );
  return result.rows;
}

export async function updateActivoHoy(rutinaEjercicioId, activoHoy) {
  const result = await db.query(
    'UPDATE rutina_ejercicios SET activo_hoy = $1 WHERE id = $2 RETURNING *',
    [activoHoy, rutinaEjercicioId]
  );
  return result.rows[0];
}

// ── Sesiones ──────────────────────────────────────────────────────────────────

export async function saveSesion(fechaLocal, rutinaId, energiaSueno) {
  const result = await db.query(
    'INSERT INTO sesiones (fecha, rutina_id, energia_sueno) VALUES ($1, $2, $3) RETURNING *',
    [fechaLocal, rutinaId ?? null, energiaSueno ?? null]
  );
  return result.rows[0];
}

export async function getSesionDelDia(fechaLocal) {
  const result = await db.query(
    'SELECT * FROM sesiones WHERE fecha = $1 ORDER BY id DESC LIMIT 1',
    [fechaLocal]
  );
  return result.rows[0] ?? null;
}

export async function touchSesionTiempo(sesionId) {
  await db.query(
    `UPDATE sesiones
     SET hora_inicio = COALESCE(hora_inicio, NOW()),
         hora_fin    = NOW()
     WHERE id = $1`,
    [sesionId]
  );
}

// ── Series ────────────────────────────────────────────────────────────────────

export async function deleteSerie(serieId) {
  await db.query('DELETE FROM series WHERE id = $1', [serieId]);
}

export async function renumerarSeries(sesionId, ejercicioId) {
  await db.query(
    `WITH ordered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY numero_serie ASC) AS n
       FROM series WHERE sesion_id = $1 AND ejercicio_id = $2
     )
     UPDATE series SET numero_serie = ordered.n
     FROM ordered WHERE series.id = ordered.id`,
    [sesionId, ejercicioId]
  );
}

export async function saveSerie(sesionId, ejercicioId, numeroSerie, peso, repeticiones) {
  const result = await db.query(
    `INSERT INTO series (sesion_id, ejercicio_id, numero_serie, peso, repeticiones)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [sesionId, ejercicioId, numeroSerie, peso, repeticiones]
  );
  return result.rows[0];
}

export async function getUltimaSerie(ejercicioId) {
  const result = await db.query(
    `SELECT s.* FROM series s
     JOIN sesiones se ON se.id = s.sesion_id
     WHERE s.ejercicio_id = $1
     ORDER BY se.fecha DESC, s.numero_serie DESC
     LIMIT 1`,
    [ejercicioId]
  );
  return result.rows[0] ?? null;
}

export async function getSeriesDeSesionEjercicio(sesionId, ejercicioId) {
  const result = await db.query(
    `SELECT * FROM series
     WHERE sesion_id = $1 AND ejercicio_id = $2
     ORDER BY numero_serie ASC`,
    [sesionId, ejercicioId]
  );
  return result.rows;
}

export async function getTodasSeriesDeHoy(sesionId) {
  if (!sesionId) return [];
  const result = await db.query(
    'SELECT * FROM series WHERE sesion_id = $1 ORDER BY ejercicio_id, numero_serie ASC',
    [sesionId]
  );
  return result.rows;
}

export async function getUltimasSeriesPorEjercicio(ejIds) {
  if (!ejIds || ejIds.length === 0) return [];
  const result = await db.query(
    `SELECT DISTINCT ON (s.ejercicio_id) s.*
     FROM series s
     JOIN sesiones se ON se.id = s.sesion_id
     WHERE s.ejercicio_id = ANY($1)
     ORDER BY s.ejercicio_id, se.fecha DESC, s.numero_serie DESC`,
    [ejIds]
  );
  return result.rows;
}

export async function getSeriesConEjerciciosBySesion(sesionId) {
  const result = await db.query(
    `SELECT s.*, e.nombre, e.grupo_muscular
     FROM series s
     JOIN ejercicios e ON e.id = s.ejercicio_id
     WHERE s.sesion_id = $1
     ORDER BY s.ejercicio_id, s.numero_serie ASC`,
    [sesionId]
  );
  return result.rows;
}

export async function getSeriesPorEjercicio(ejercicioId) {
  const result = await db.query(
    `SELECT s.*, se.fecha
     FROM series s
     JOIN sesiones se ON se.id = s.sesion_id
     WHERE s.ejercicio_id = $1
     ORDER BY se.fecha ASC, s.numero_serie ASC`,
    [ejercicioId]
  );
  return result.rows;
}

// ── Conf ──────────────────────────────────────────────────────────────────────

export async function getConf() {
  const result = await db.query('SELECT * FROM conf WHERE id = 1');
  return result.rows[0];
}

export async function updatePrefAcento(key) {
  const { rows } = await db.query(
    'UPDATE conf SET pref_acento = $1 WHERE id = 1 RETURNING *',
    [key]
  );
  return rows[0];
}

export async function updatePrefUnit(unit) {
  if (unit !== 'kg' && unit !== 'lb') {
    throw new Error(`Unidad inválida: "${unit}". Solo se aceptan 'kg' o 'lb'.`);
  }
  const result = await db.query(
    'UPDATE conf SET pref_unit = $1 WHERE id = 1 RETURNING *',
    [unit]
  );
  return result.rows[0];
}

// ── Funciones auxiliares para componentes UI ───────────────────────────────────

export async function getEjerciciosOrdenadosPorUso() {
  const result = await db.query(`
    SELECT e.id, e.nombre, e.grupo_muscular, MAX(se.fecha) AS ultima_fecha
    FROM ejercicios e
    LEFT JOIN series s ON s.ejercicio_id = e.id
    LEFT JOIN sesiones se ON se.id = s.sesion_id
    GROUP BY e.id, e.nombre, e.grupo_muscular
    ORDER BY ultima_fecha DESC NULLS LAST, e.nombre ASC
  `);
  return result.rows;
}

export async function getRutinaEjerciciosSuplentes(rutinaId) {
  const result = await db.query(
    `SELECT re.id, re.rutina_id, re.ejercicio_id, re.orden, re.activo_hoy,
            e.nombre, e.grupo_muscular
     FROM rutina_ejercicios re
     JOIN ejercicios e ON e.id = re.ejercicio_id
     WHERE re.rutina_id = $1 AND re.activo_hoy = FALSE
     ORDER BY e.nombre`,
    [rutinaId]
  );
  return result.rows;
}

export async function linkEjercicioToRutina(rutinaId, ejercicioId, orden) {
  const { rows: existing } = await db.query(
    'SELECT id FROM rutina_ejercicios WHERE rutina_id = $1 AND ejercicio_id = $2',
    [rutinaId, ejercicioId]
  );
  if (existing.length > 0) return existing[0];
  const result = await db.query(
    'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden, activo_hoy) VALUES ($1, $2, $3, TRUE) RETURNING *',
    [rutinaId, ejercicioId, orden ?? 0]
  );
  return result.rows[0];
}

export async function updateRutinaDia(rutinaId, diaSugerido) {
  if (diaSugerido !== null) {
    // Un día solo puede pertenecer a una rutina — limpia asignación previa
    await db.query(
      'UPDATE rutinas SET dia_sugerido = NULL WHERE dia_sugerido = $1 AND id != $2',
      [Number(diaSugerido), rutinaId]
    );
  }
  const result = await db.query(
    'UPDATE rutinas SET dia_sugerido = $1 WHERE id = $2 RETURNING *',
    [diaSugerido === null ? null : Number(diaSugerido), rutinaId]
  );
  return result.rows[0];
}

export async function swapOrden(reId1, reId2) {
  const [{ rows: r1 }, { rows: r2 }] = await Promise.all([
    db.query('SELECT orden FROM rutina_ejercicios WHERE id = $1', [reId1]),
    db.query('SELECT orden FROM rutina_ejercicios WHERE id = $1', [reId2]),
  ]);
  if (!r1[0] || !r2[0]) return;
  await Promise.all([
    db.query('UPDATE rutina_ejercicios SET orden = $1 WHERE id = $2', [r2[0].orden, reId1]),
    db.query('UPDATE rutina_ejercicios SET orden = $1 WHERE id = $2', [r1[0].orden, reId2]),
  ]);
}

export async function clearRutinaDia(dia) {
  await db.query(
    'UPDATE rutinas SET dia_sugerido = NULL WHERE dia_sugerido = $1',
    [Number(dia)]
  );
}

// ── Analítica y estadísticas ──────────────────────────────────────────────────

export async function getEstadisticasGlobales(fechaHoy) {
  const { rows: [stats] } = await db.query(`
    SELECT
      (SELECT COUNT(*)::int FROM sesiones) AS total_sesiones,
      (SELECT COALESCE(SUM(peso * repeticiones)::float, 0) FROM series) AS volumen_total,
      (SELECT COUNT(*)::int FROM sesiones
       WHERE fecha >= $1::date - INTERVAL '27 days') AS sesiones_4_sem
  `, [fechaHoy]);

  const { rows: fechaRows } = await db.query(
    `SELECT DISTINCT fecha::text FROM sesiones ORDER BY fecha DESC`
  );

  return {
    total_sesiones: stats.total_sesiones,
    volumen_total: stats.volumen_total,
    sesiones_4_sem: stats.sesiones_4_sem,
    fechas: fechaRows.map(r => r.fecha),
  };
}

export async function getActividadSemanal(fechaHoy, semanas = 8) {
  const { rows } = await db.query(`
    SELECT
      date_trunc('week', fecha)::date::text AS semana_lunes,
      COUNT(*)::int AS sesiones
    FROM sesiones
    WHERE fecha >= $1::date - ($2 || ' weeks')::interval
    GROUP BY semana_lunes
    ORDER BY semana_lunes ASC
  `, [fechaHoy, semanas]);
  return rows;
}

export async function getVolumenPorGrupoMuscular(fechaHoy, semanas = 4) {
  const { rows } = await db.query(`
    SELECT
      e.grupo_muscular,
      COALESCE(SUM(s.peso * s.repeticiones)::float, 0) AS volumen
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    JOIN ejercicios e ON e.id = s.ejercicio_id
    WHERE se.fecha >= $1::date - ($2 || ' weeks')::interval
    GROUP BY e.grupo_muscular
    ORDER BY volumen DESC
  `, [fechaHoy, semanas]);
  return rows;
}

export async function getPR1RMPorEjercicio() {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (e.id)
      e.id AS ejercicio_id,
      e.nombre,
      e.grupo_muscular,
      (s.peso * (1 + s.repeticiones / 30.0))::float AS pr_1rm,
      se.fecha::text AS fecha_pr
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    JOIN ejercicios e ON e.id = s.ejercicio_id
    WHERE s.peso > 0
    ORDER BY e.id, pr_1rm DESC
  `);
  return rows;
}

export async function getVolumenPorSesion(ejId) {
  const { rows } = await db.query(`
    SELECT
      se.fecha::text AS fecha,
      COALESCE(SUM(s.peso * s.repeticiones)::float, 0) AS volumen
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    WHERE s.ejercicio_id = $1
    GROUP BY se.fecha
    ORDER BY se.fecha ASC
  `, [ejId]);
  return rows;
}

export async function getAllDataForExport() {
  const [conf, ejercicios, rutinas, reRows, rdRows, sesiones, series] = await Promise.all([
    db.query('SELECT pref_unit, pref_acento FROM conf WHERE id = 1'),
    db.query('SELECT id, nombre, grupo_muscular FROM ejercicios ORDER BY id'),
    db.query('SELECT id, nombre FROM rutinas ORDER BY id'),
    db.query('SELECT rutina_id, ejercicio_id, orden, activo_hoy FROM rutina_ejercicios ORDER BY rutina_id, orden'),
    db.query('SELECT rutina_id, dia FROM rutina_dias ORDER BY rutina_id, dia'),
    db.query('SELECT id, fecha::text AS fecha, rutina_id, energia_sueno, peso_corporal FROM sesiones ORDER BY fecha, id'),
    db.query('SELECT sesion_id, ejercicio_id, numero_serie, peso, repeticiones FROM series ORDER BY sesion_id, numero_serie'),
  ]);
  return {
    version: 1,
    exported_at: new Date().toLocaleDateString('en-CA'),
    conf: conf.rows[0] ?? { pref_unit: 'lb', pref_acento: 'verde' },
    ejercicios: ejercicios.rows,
    rutinas: rutinas.rows,
    rutina_ejercicios: reRows.rows,
    rutina_dias: rdRows.rows,
    sesiones: sesiones.rows,
    series: series.rows,
  };
}
