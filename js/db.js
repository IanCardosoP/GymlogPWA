// Capa de datos: SQL puro sobre SQLite (WASM), solo promesas, cero DOM.
//
// Portada desde PGLite. El motor y la persistencia viven en js/motor.js; acá solo
// hay SQL. `query()` devuelve `{ rows }` igual que PGLite, así que los
// componentes y los tests no cambian de forma.
//
// Notas del port de dialecto (Postgres → SQLite), para quien lea esto luego:
//  - SERIAL            → INTEGER PRIMARY KEY AUTOINCREMENT
//  - NUMERIC           → REAL. PGLite devolvía NUMERIC como string y por eso el
//                        SQL viejo estaba lleno de ::float; SQLite devuelve
//                        number nativo y esos casts desaparecen.
//  - BOOLEAN           → INTEGER 0/1 (SQLite no tiene tipo booleano)
//  - DATE / TIMESTAMPTZ→ TEXT. La fecha ya se captura y formatea en JS
//                        ('YYYY-MM-DD', ver CLAUDE.md §6), y sobre ISO-8601 la
//                        comparación lexicográfica coincide con la cronológica.
//  - $1, $2            → ?1, ?2 (posicionales, misma semántica ordinal)
//  - DISTINCT ON       → ROW_NUMBER() OVER (PARTITION BY …)
//  - NOW()             → timestamp capturado en JS, coherente con §6
//  - INTERVAL          → date(?, '-N days')
//  - = ANY($1)         → IN (?1, ?2, …) expandido, porque SQLite no bindea arrays
//  - date_trunc('week')→ ver LUNES_DE_LA_SEMANA abajo

import { abrirMotor, query, exec, asegurarColumna, guardar, guardarAhora } from './motor.js';

export async function initDB(uri = 'idb://gym-log-db') {
  // Contrato heredado de PGLite: 'memory://' da una base efímera (todos los
  // tests la usan), cualquier otra cosa persiste.
  await abrirMotor({ persistir: !String(uri).startsWith('memory://') });

  await exec(`
    CREATE TABLE IF NOT EXISTS ejercicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      grupo_muscular TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rutinas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      dia_sugerido INTEGER
    );

    CREATE TABLE IF NOT EXISTS rutina_ejercicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rutina_id INTEGER REFERENCES rutinas(id) ON DELETE CASCADE,
      ejercicio_id INTEGER REFERENCES ejercicios(id) ON DELETE CASCADE,
      orden INTEGER,
      activo_hoy INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sesiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT,
      rutina_id INTEGER REFERENCES rutinas(id),
      energia_sueno INTEGER,
      peso_corporal REAL,
      sensacion_final TEXT,
      cardio_tipo TEXT,
      cardio_tiempo INTEGER
    );

    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sesion_id INTEGER REFERENCES sesiones(id) ON DELETE CASCADE,
      ejercicio_id INTEGER REFERENCES ejercicios(id),
      numero_serie INTEGER,
      peso REAL,
      repeticiones INTEGER
    );

    CREATE TABLE IF NOT EXISTS conf (
      id INTEGER PRIMARY KEY DEFAULT 1,
      pref_unit   TEXT NOT NULL DEFAULT 'lb',
      pref_acento TEXT NOT NULL DEFAULT 'verde',
      CONSTRAINT chk_pref_unit CHECK (pref_unit IN ('kg', 'lb')),
      CONSTRAINT chk_single_row CHECK (id = 1)
    );

    INSERT INTO conf (id, pref_unit)
    VALUES (1, 'lb')
    ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS rutina_dias (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      rutina_id INTEGER REFERENCES rutinas(id) ON DELETE CASCADE,
      dia       INTEGER NOT NULL,
      UNIQUE (rutina_id, dia)
    );

    CREATE INDEX IF NOT EXISTS idx_sesiones_fecha      ON sesiones(fecha);
    CREATE INDEX IF NOT EXISTS idx_series_sesion_id    ON series(sesion_id);
    CREATE INDEX IF NOT EXISTS idx_series_ejercicio_id ON series(ejercicio_id);
    CREATE INDEX IF NOT EXISTS idx_re_rutina_orden     ON rutina_ejercicios(rutina_id, orden);
  `);

  // SQLite no tiene ADD COLUMN IF NOT EXISTS: las migraciones idempotentes de
  // columnas van por PRAGMA table_info (ver asegurarColumna en motor.js).
  asegurarColumna('conf', 'device_id', 'TEXT');
  asegurarColumna('sesiones', 'hora_inicio', 'TEXT');
  asegurarColumna('sesiones', 'hora_fin', 'TEXT');
  // Puntero opcional al catálogo estático de ejercicios (fuente_id del JSON en
  // assets/catalogo/). No es FK: el catálogo nunca vive en esta base.
  asegurarColumna('ejercicios', 'catalogo_id', 'TEXT');
  asegurarColumna('ejercicios', 'catalogo_revisado', 'INTEGER NOT NULL DEFAULT 0');

  // Backfill histórico de rutina_dias desde el rutinas.dia_sugerido legado.
  // OR IGNORE en vez de ON CONFLICT DO NOTHING: con INSERT…SELECT la cláusula
  // upsert es ambigua de parsear en SQLite, y OR IGNORE dice lo mismo sin
  // ambigüedad.
  await exec(`
    INSERT OR IGNORE INTO rutina_dias (rutina_id, dia)
    SELECT id, dia_sugerido FROM rutinas WHERE dia_sugerido IS NOT NULL;
  `);

  await guardarAhora();
  return { query, exec };
}

export function getDB() {
  return { query, exec };
}

// Toda mutación agenda un guardado del snapshot (con debounce). Las funciones
// transaccionales NO usan esto: exportar la base a mitad de una transacción
// abierta sería serializar un estado intermedio, así que llaman a guardar() a
// mano después del COMMIT.
async function mutar(sql, params = []) {
  const resultado = await query(sql, params);
  guardar();
  return resultado;
}

// date_trunc('week', fecha) de Postgres devuelve el LUNES de esa semana.
// El idioma que se ve por ahí para SQLite, date(fecha,'weekday 1','-7 days'),
// está MAL: 'weekday 1' no avanza si la fecha ya es lunes, así que en ese caso
// el -7 la manda a la semana anterior. Esta forma sí coincide con Postgres:
// strftime('%w') da 0=domingo…6=sábado, y (%w + 6) % 7 son los días a restar
// para llegar al lunes (lunes→0, domingo→6).
const LUNES_DE_LA_SEMANA = fecha =>
  `date(${fecha}, '-' || ((CAST(strftime('%w', ${fecha}) AS INTEGER) + 6) % 7) || ' days')`;

// ── Ejercicios ────────────────────────────────────────────────────────────────

export async function getEjercicios() {
  const result = await query(
    'SELECT id, nombre, grupo_muscular FROM ejercicios ORDER BY nombre'
  );
  return result.rows;
}

export async function updateEjercicioNombre(ejId, nuevoNombre, nuevoGrupo) {
  const result = await mutar(
    'UPDATE ejercicios SET nombre = ?1, grupo_muscular = COALESCE(?3, grupo_muscular) WHERE id = ?2 RETURNING *',
    [nuevoNombre, ejId, nuevoGrupo ?? null]
  );
  return result.rows[0];
}

export async function deleteEjercicio(ejId) {
  await query('DELETE FROM series WHERE ejercicio_id = ?1', [ejId]);
  await mutar('DELETE FROM ejercicios WHERE id = ?1', [ejId]);
}

export async function removeEjercicioDeRutina(rutinaId, ejId) {
  await query(
    'DELETE FROM rutina_ejercicios WHERE rutina_id = ?1 AND ejercicio_id = ?2',
    [rutinaId, ejId]
  );
  const { rows } = await query(
    'SELECT 1 FROM rutina_ejercicios WHERE ejercicio_id = ?1 LIMIT 1',
    [ejId]
  );
  if (rows.length === 0) {
    await query('DELETE FROM series WHERE ejercicio_id = ?1', [ejId]);
    await query('DELETE FROM ejercicios WHERE id = ?1', [ejId]);
  }
  guardar();
}

export async function saveEjercicio(nombre, grupoMuscular) {
  const result = await mutar(
    'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES (?1, ?2) RETURNING *',
    [nombre, grupoMuscular]
  );
  return result.rows[0];
}

export async function getOrCreateEjercicio(nombre, grupoMuscular, catalogoId = null) {
  const { rows } = await query(
    'SELECT * FROM ejercicios WHERE LOWER(nombre) = LOWER(?1) LIMIT 1',
    [nombre]
  );
  if (rows.length > 0) {
    // Si el usuario lo eligió del catálogo y su fila aún no tiene vínculo, se completa.
    if (catalogoId && !rows[0].catalogo_id) {
      const upd = await mutar(
        'UPDATE ejercicios SET catalogo_id = ?1, catalogo_revisado = 1 WHERE id = ?2 RETURNING *',
        [catalogoId, rows[0].id]
      );
      return upd.rows[0];
    }
    return rows[0];
  }
  // El `$3::text IS NOT NULL` del original se resuelve en JS: SQLite no necesita
  // el cast y el parámetro explícito es más claro.
  const result = await mutar(
    `INSERT INTO ejercicios (nombre, grupo_muscular, catalogo_id, catalogo_revisado)
     VALUES (?1, ?2, ?3, ?4) RETURNING *`,
    [nombre, grupoMuscular, catalogoId, catalogoId != null ? 1 : 0]
  );
  return result.rows[0];
}

// ── Vínculo con el catálogo estático (retrofit) ───────────────────────────────
// El catálogo vive en assets/catalogo/catalogo.json, nunca en esta base.
// Aquí solo se administra el puntero opaco catalogo_id de las filas del usuario.

export async function getEjerciciosPendientesRevision() {
  const { rows } = await query(
    'SELECT id, nombre, grupo_muscular FROM ejercicios WHERE catalogo_revisado = 0 ORDER BY nombre'
  );
  return rows;
}

export async function vincularEjercicioCatalogo(ejercicioId, fuenteId) {
  const { rows } = await mutar(
    'UPDATE ejercicios SET catalogo_id = ?1, catalogo_revisado = 1 WHERE id = ?2 RETURNING *',
    [fuenteId, ejercicioId]
  );
  return rows[0];
}

export async function descartarSugerenciaCatalogo(ejercicioId) {
  const { rows } = await mutar(
    'UPDATE ejercicios SET catalogo_revisado = 1 WHERE id = ?1 RETURNING *',
    [ejercicioId]
  );
  return rows[0];
}

// ── Rutinas ───────────────────────────────────────────────────────────────────

export async function getRutinas() {
  const result = await query('SELECT * FROM rutinas');
  return result.rows;
}

export async function getRutinasDias() {
  const { rows } = await query('SELECT rutina_id, dia FROM rutina_dias ORDER BY dia');
  return rows;
}

export async function addRutinaDia(rutinaId, dia) {
  await mutar(
    'INSERT OR IGNORE INTO rutina_dias (rutina_id, dia) VALUES (?1, ?2)',
    [rutinaId, dia]
  );
}

export async function removeRutinaDia(rutinaId, dia) {
  await mutar(
    'DELETE FROM rutina_dias WHERE rutina_id = ?1 AND dia = ?2',
    [rutinaId, dia]
  );
}

// Un día solo puede pertenecer a una rutina: desvincula cualquier asignación previa y asigna la nueva
export async function assignRutinaDiaExclusivo(rutinaId, dia) {
  await query('BEGIN');
  try {
    await query('DELETE FROM rutina_dias WHERE dia = ?1', [dia]);
    await query('INSERT INTO rutina_dias (rutina_id, dia) VALUES (?1, ?2)', [rutinaId, dia]);
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  guardar(); // tras el COMMIT, nunca dentro de la transacción
}

export async function updateRutinaNombre(rutinaId, nuevoNombre) {
  const { rows } = await mutar(
    'UPDATE rutinas SET nombre = ?1 WHERE id = ?2 RETURNING *',
    [nuevoNombre, rutinaId]
  );
  return rows[0];
}

export async function deleteRutina(rutinaId) {
  await query('UPDATE sesiones SET rutina_id = NULL WHERE rutina_id = ?1', [rutinaId]);
  await mutar('DELETE FROM rutinas WHERE id = ?1', [rutinaId]);
  // rutina_ejercicios y rutina_dias cascadean automáticamente
}

export async function saveRutina(nombre, diaSugerido) {
  const result = await mutar(
    'INSERT INTO rutinas (nombre, dia_sugerido) VALUES (?1, ?2) RETURNING *',
    [nombre, diaSugerido ?? null]
  );
  return result.rows[0];
}

export async function getRutinaEjercicios(rutinaId) {
  const result = await query(
    `SELECT re.id, re.rutina_id, re.ejercicio_id, re.orden, re.activo_hoy,
            e.nombre, e.grupo_muscular, e.catalogo_id
     FROM rutina_ejercicios re
     JOIN ejercicios e ON e.id = re.ejercicio_id
     WHERE re.rutina_id = ?1
     ORDER BY re.orden`,
    [rutinaId]
  );
  return result.rows;
}

export async function updateActivoHoy(rutinaEjercicioId, activoHoy) {
  const result = await mutar(
    'UPDATE rutina_ejercicios SET activo_hoy = ?1 WHERE id = ?2 RETURNING *',
    [activoHoy, rutinaEjercicioId]
  );
  return result.rows[0];
}

// ── Sesiones ──────────────────────────────────────────────────────────────────

export async function saveSesion(fechaLocal, rutinaId, energiaSueno) {
  const result = await mutar(
    'INSERT INTO sesiones (fecha, rutina_id, energia_sueno) VALUES (?1, ?2, ?3) RETURNING *',
    [fechaLocal, rutinaId ?? null, energiaSueno ?? null]
  );
  return result.rows[0];
}

export async function getSesionDelDia(fechaLocal) {
  const result = await query(
    'SELECT * FROM sesiones WHERE fecha = ?1 ORDER BY id DESC LIMIT 1',
    [fechaLocal]
  );
  return result.rows[0] ?? null;
}

export async function touchSesionTiempo(sesionId) {
  // NOW() de Postgres → timestamp capturado en JS, coherente con la regla de
  // timezone de CLAUDE.md §6 (el tiempo nunca lo pone SQL).
  const ahora = new Date().toISOString();
  await mutar(
    `UPDATE sesiones
     SET hora_inicio = COALESCE(hora_inicio, ?1),
         hora_fin    = ?1
     WHERE id = ?2`,
    [ahora, sesionId]
  );
}

export async function resetSesionTiempoIfVacia(sesionId) {
  await mutar(
    `UPDATE sesiones
     SET hora_inicio = NULL, hora_fin = NULL
     WHERE id = ?1
       AND NOT EXISTS (SELECT 1 FROM series WHERE sesion_id = ?1)`,
    [sesionId]
  );
}

// ── Series ────────────────────────────────────────────────────────────────────

export async function deleteSerie(serieId) {
  await mutar('DELETE FROM series WHERE id = ?1', [serieId]);
}

export async function renumerarSeries(sesionId, ejercicioId) {
  // UPDATE … FROM con CTE: soportado por SQLite desde 3.33 (acá corre 3.53).
  await mutar(
    `WITH ordered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY numero_serie ASC) AS n
       FROM series WHERE sesion_id = ?1 AND ejercicio_id = ?2
     )
     UPDATE series SET numero_serie = ordered.n
     FROM ordered WHERE series.id = ordered.id`,
    [sesionId, ejercicioId]
  );
}

export async function saveSerie(sesionId, ejercicioId, numeroSerie, peso, repeticiones) {
  const result = await mutar(
    `INSERT INTO series (sesion_id, ejercicio_id, numero_serie, peso, repeticiones)
     VALUES (?1, ?2, ?3, ?4, ?5) RETURNING *`,
    [sesionId, ejercicioId, numeroSerie, peso, repeticiones]
  );
  return result.rows[0];
}

export async function getUltimaSerie(ejercicioId) {
  const result = await query(
    `SELECT s.* FROM series s
     JOIN sesiones se ON se.id = s.sesion_id
     WHERE s.ejercicio_id = ?1
     ORDER BY se.fecha DESC, s.numero_serie DESC
     LIMIT 1`,
    [ejercicioId]
  );
  return result.rows[0] ?? null;
}

export async function getSeriesDeSesionEjercicio(sesionId, ejercicioId) {
  const result = await query(
    `SELECT * FROM series
     WHERE sesion_id = ?1 AND ejercicio_id = ?2
     ORDER BY numero_serie ASC`,
    [sesionId, ejercicioId]
  );
  return result.rows;
}

export async function getTodasSeriesDeHoy(sesionId) {
  if (!sesionId) return [];
  const result = await query(
    'SELECT * FROM series WHERE sesion_id = ?1 ORDER BY ejercicio_id, numero_serie ASC',
    [sesionId]
  );
  return result.rows;
}

export async function getUltimasSeriesPorEjercicio(ejIds) {
  if (!ejIds || ejIds.length === 0) return [];
  // SQLite no bindea arrays (no hay = ANY($1)): se expande la lista de
  // marcadores. Los valores siguen yendo como parámetros preparados — cero
  // concatenación de datos en el SQL (OWASP A03).
  const marcadores = ejIds.map((_, i) => `?${i + 1}`).join(', ');
  const result = await query(
    `SELECT id, sesion_id, ejercicio_id, numero_serie, peso, repeticiones FROM (
       SELECT s.*, ROW_NUMBER() OVER (
         PARTITION BY s.ejercicio_id ORDER BY se.fecha DESC, s.numero_serie DESC
       ) AS rn
       FROM series s
       JOIN sesiones se ON se.id = s.sesion_id
       WHERE s.ejercicio_id IN (${marcadores})
     )
     WHERE rn = 1
     ORDER BY ejercicio_id`,
    ejIds
  );
  return result.rows;
}

export async function getSeriesConEjerciciosBySesion(sesionId) {
  const result = await query(
    `SELECT s.*, e.nombre, e.grupo_muscular
     FROM series s
     JOIN ejercicios e ON e.id = s.ejercicio_id
     WHERE s.sesion_id = ?1
     ORDER BY s.ejercicio_id, s.numero_serie ASC`,
    [sesionId]
  );
  return result.rows;
}

export async function getSeriesPorEjercicio(ejercicioId) {
  const result = await query(
    `SELECT s.*, se.fecha
     FROM series s
     JOIN sesiones se ON se.id = s.sesion_id
     WHERE s.ejercicio_id = ?1
     ORDER BY se.fecha ASC, s.numero_serie ASC`,
    [ejercicioId]
  );
  return result.rows;
}

// ── Conf ──────────────────────────────────────────────────────────────────────

export async function getConf() {
  const result = await query('SELECT * FROM conf WHERE id = 1');
  return result.rows[0];
}

export async function updatePrefAcento(key) {
  const { rows } = await mutar(
    'UPDATE conf SET pref_acento = ?1 WHERE id = 1 RETURNING *',
    [key]
  );
  return rows[0];
}

export async function updatePrefUnit(unit) {
  if (unit !== 'kg' && unit !== 'lb') {
    throw new Error(`Unidad inválida: "${unit}". Solo se aceptan 'kg' o 'lb'.`);
  }
  const result = await mutar(
    'UPDATE conf SET pref_unit = ?1 WHERE id = 1 RETURNING *',
    [unit]
  );
  return result.rows[0];
}

export async function getOrCreateDeviceId() {
  const { rows } = await query('SELECT device_id FROM conf WHERE id = 1');
  if (rows[0]?.device_id) return rows[0].device_id;
  const id = crypto.randomUUID();
  await mutar('UPDATE conf SET device_id = ?1 WHERE id = 1', [id]);
  return id;
}

// ── Funciones auxiliares para componentes UI ───────────────────────────────────

export async function getEjerciciosOrdenadosPorUso() {
  const result = await query(`
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
  const result = await query(
    `SELECT re.id, re.rutina_id, re.ejercicio_id, re.orden, re.activo_hoy,
            e.nombre, e.grupo_muscular
     FROM rutina_ejercicios re
     JOIN ejercicios e ON e.id = re.ejercicio_id
     WHERE re.rutina_id = ?1 AND re.activo_hoy = 0
     ORDER BY e.nombre`,
    [rutinaId]
  );
  return result.rows;
}

export async function linkEjercicioToRutina(rutinaId, ejercicioId, orden) {
  const { rows: existing } = await query(
    'SELECT id FROM rutina_ejercicios WHERE rutina_id = ?1 AND ejercicio_id = ?2',
    [rutinaId, ejercicioId]
  );
  if (existing.length > 0) return existing[0];
  const result = await mutar(
    'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden, activo_hoy) VALUES (?1, ?2, ?3, 1) RETURNING *',
    [rutinaId, ejercicioId, orden ?? 0]
  );
  return result.rows[0];
}

export async function updateRutinaDia(rutinaId, diaSugerido) {
  if (diaSugerido !== null) {
    // Un día solo puede pertenecer a una rutina — limpia asignación previa
    await query(
      'UPDATE rutinas SET dia_sugerido = NULL WHERE dia_sugerido = ?1 AND id != ?2',
      [Number(diaSugerido), rutinaId]
    );
  }
  const result = await mutar(
    'UPDATE rutinas SET dia_sugerido = ?1 WHERE id = ?2 RETURNING *',
    [diaSugerido === null ? null : Number(diaSugerido), rutinaId]
  );
  return result.rows[0];
}

export async function swapOrden(reId1, reId2) {
  const [{ rows: r1 }, { rows: r2 }] = await Promise.all([
    query('SELECT orden FROM rutina_ejercicios WHERE id = ?1', [reId1]),
    query('SELECT orden FROM rutina_ejercicios WHERE id = ?1', [reId2]),
  ]);
  if (!r1[0] || !r2[0]) return;
  await query('UPDATE rutina_ejercicios SET orden = ?1 WHERE id = ?2', [r2[0].orden, reId1]);
  await query('UPDATE rutina_ejercicios SET orden = ?1 WHERE id = ?2', [r1[0].orden, reId2]);
  guardar();
}

// Persiste el orden completo tras un drag & drop: orden secuencial 1..N.
// `activo_hoy` se sigue escribiendo por compatibilidad con backups viejos; ya
// nadie la lee para decidir qué se muestra (ver CLAUDE.md §10).
export async function reordenarEjercicios(rutinaId, orderedReIds) {
  await query('BEGIN');
  try {
    for (let i = 0; i < orderedReIds.length; i++) {
      await query(
        'UPDATE rutina_ejercicios SET orden = ?1, activo_hoy = ?2 WHERE id = ?3 AND rutina_id = ?4',
        [i + 1, i < 8 ? 1 : 0, orderedReIds[i], rutinaId]
      );
    }
    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  }
  guardar(); // tras el COMMIT, nunca dentro de la transacción
}

export async function clearRutinaDia(dia) {
  await mutar(
    'UPDATE rutinas SET dia_sugerido = NULL WHERE dia_sugerido = ?1',
    [Number(dia)]
  );
}

// ── Analítica y estadísticas ──────────────────────────────────────────────────

export async function getEstadisticasGlobales(fechaHoy) {
  const { rows: [stats] } = await query(`
    SELECT
      (SELECT COUNT(*) FROM sesiones
       WHERE EXISTS (SELECT 1 FROM series WHERE sesion_id = sesiones.id)) AS total_sesiones,
      (SELECT COALESCE(SUM(peso * repeticiones), 0) FROM series) AS volumen_total,
      (SELECT COUNT(*) FROM sesiones
       WHERE fecha >= date(?1, '-27 days')
         AND EXISTS (SELECT 1 FROM series WHERE sesion_id = sesiones.id)) AS sesiones_4_sem
  `, [fechaHoy]);

  const { rows: fechaRows } = await query(
    `SELECT DISTINCT fecha FROM sesiones
     WHERE EXISTS (SELECT 1 FROM series WHERE sesion_id = sesiones.id)
     ORDER BY fecha DESC`
  );

  return {
    total_sesiones: stats.total_sesiones,
    volumen_total: stats.volumen_total,
    sesiones_4_sem: stats.sesiones_4_sem,
    fechas: fechaRows.map(r => r.fecha),
  };
}

export async function getActividadSemanal(fechaHoy, semanas = 8) {
  const { rows } = await query(`
    SELECT
      ${LUNES_DE_LA_SEMANA('fecha')} AS semana_lunes,
      COUNT(*) AS sesiones
    FROM sesiones
    WHERE fecha >= date(?1, '-' || (?2 * 7) || ' days')
      AND EXISTS (SELECT 1 FROM series WHERE sesion_id = sesiones.id)
    GROUP BY semana_lunes
    ORDER BY semana_lunes ASC
  `, [fechaHoy, semanas]);
  return rows;
}

export async function getVolumenPorGrupoMuscular(fechaHoy, semanas = 4) {
  const { rows } = await query(`
    SELECT
      e.grupo_muscular,
      COALESCE(SUM(s.peso * s.repeticiones), 0) AS volumen
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    JOIN ejercicios e ON e.id = s.ejercicio_id
    WHERE se.fecha >= date(?1, '-' || (?2 * 7) || ' days')
    GROUP BY e.grupo_muscular
    ORDER BY volumen DESC
  `, [fechaHoy, semanas]);
  return rows;
}

export async function getPesoMaxPorEjercicio() {
  // DISTINCT ON (e.id) … ORDER BY e.id, peso_max DESC → ROW_NUMBER particionado.
  const { rows } = await query(`
    SELECT ejercicio_id, nombre, grupo_muscular, peso_max, fecha_pr FROM (
      SELECT
        e.id AS ejercicio_id,
        e.nombre,
        e.grupo_muscular,
        s.peso AS peso_max,
        se.fecha AS fecha_pr,
        ROW_NUMBER() OVER (PARTITION BY e.id ORDER BY s.peso DESC) AS rn
      FROM series s
      JOIN sesiones se ON se.id = s.sesion_id
      JOIN ejercicios e ON e.id = s.ejercicio_id
      WHERE s.peso > 0
    )
    WHERE rn = 1
    ORDER BY ejercicio_id
  `);
  return rows;
}

export async function getVolumenPorSesion(ejId) {
  const { rows } = await query(`
    SELECT
      se.fecha AS fecha,
      COALESCE(SUM(s.peso * s.repeticiones), 0) AS volumen
    FROM series s
    JOIN sesiones se ON se.id = s.sesion_id
    WHERE s.ejercicio_id = ?1
    GROUP BY se.fecha
    ORDER BY se.fecha ASC
  `, [ejId]);
  return rows;
}

export async function getUltimasSesionesConSeries(n = 2) {
  const { rows } = await query(
    `SELECT
       se.id            AS sesion_id,
       se.fecha         AS fecha,
       se.hora_inicio,
       se.hora_fin,
       r.nombre         AS rutina_nombre,
       s.ejercicio_id,
       e.nombre         AS ejercicio_nombre,
       s.numero_serie,
       s.peso,
       s.repeticiones
     FROM (
       SELECT id, fecha, hora_inicio, hora_fin, rutina_id
       FROM sesiones
       WHERE EXISTS (SELECT 1 FROM series WHERE sesion_id = sesiones.id)
       ORDER BY fecha DESC, id DESC
       LIMIT ?1
     ) se
     LEFT JOIN rutinas    r ON r.id = se.rutina_id
     LEFT JOIN series     s ON s.sesion_id = se.id
     LEFT JOIN ejercicios e ON e.id = s.ejercicio_id
     ORDER BY se.fecha DESC, se.id DESC, s.ejercicio_id, s.numero_serie ASC`,
    [n]
  );
  return rows;
}

export async function getAllDataForExport() {
  const [conf, ejercicios, rutinas, reRows, rdRows, sesiones, series] = await Promise.all([
    query('SELECT pref_unit, pref_acento FROM conf WHERE id = 1'),
    query('SELECT id, nombre, grupo_muscular, catalogo_id, catalogo_revisado FROM ejercicios ORDER BY id'),
    query('SELECT id, nombre FROM rutinas ORDER BY id'),
    query('SELECT rutina_id, ejercicio_id, orden, activo_hoy FROM rutina_ejercicios ORDER BY rutina_id, orden'),
    query('SELECT rutina_id, dia FROM rutina_dias ORDER BY rutina_id, dia'),
    // TODAS las columnas de sesiones. Antes solo viajaban cinco, y hora_inicio /
    // hora_fin quedaban fuera: como progreso.js y diario.js calculan la duración
    // del entrenamiento con ellas, cada backup/restore —y la migración a SQLite,
    // que reutiliza este mismo camino— borraba en silencio la duración de todas
    // las sesiones pasadas. sensacion_final y cardio_* van también aunque hoy
    // nadie las escriba: dejarlas fuera es sembrar exactamente el mismo bug para
    // el día que alguien empiece a usarlas.
    query(`SELECT id, fecha, rutina_id, energia_sueno, peso_corporal,
                  sensacion_final, cardio_tipo, cardio_tiempo, hora_inicio, hora_fin
           FROM sesiones ORDER BY fecha, id`),
    query('SELECT sesion_id, ejercicio_id, numero_serie, peso, repeticiones FROM series ORDER BY sesion_id, numero_serie'),
  ]);

  // catalogo_revisado y activo_hoy salen ya como booleanos: el shim de query()
  // en motor.js los normaliza (SQLite los guarda como 0/1). Así un backup hecho
  // con SQLite es byte a byte compatible con el formato v1 que escribía PGLite.
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
