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
      pref_unit TEXT NOT NULL DEFAULT 'lb',
      CONSTRAINT chk_pref_unit CHECK (pref_unit IN ('kg', 'lb')),
      CONSTRAINT chk_single_row CHECK (id = 1)
    );

    INSERT INTO conf (id, pref_unit)
    VALUES (1, 'lb')
    ON CONFLICT (id) DO NOTHING;
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

export async function saveEjercicio(nombre, grupoMuscular) {
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

// ── Series ────────────────────────────────────────────────────────────────────

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

export async function clearRutinaDia(dia) {
  await db.query(
    'UPDATE rutinas SET dia_sugerido = NULL WHERE dia_sugerido = $1',
    [Number(dia)]
  );
}

export async function getAllSeriesForExport() {
  const result = await db.query(`
    SELECT se.fecha, r.nombre AS rutina_nombre,
           e.nombre AS ejercicio_nombre, e.grupo_muscular,
           s.numero_serie, s.peso, s.repeticiones,
           se.peso_corporal, se.energia_sueno
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    JOIN ejercicios e ON e.id = s.ejercicio_id
    LEFT JOIN rutinas r ON r.id = se.rutina_id
    ORDER BY se.fecha ASC, s.sesion_id ASC, s.numero_serie ASC
  `);
  return result.rows;
}
