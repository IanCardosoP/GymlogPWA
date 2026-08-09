// Migración única PGLite → SQLite.
//
// Este módulo es la ÚNICA parte del código que todavía importa PGLite, y lo hace
// con import() dinámico dentro de una función: así los 16.2 MB del motor viejo
// quedan en un chunk aparte que los usuarios nuevos jamás descargan, y los
// existentes bajan una sola vez.
//
// El lado de ESCRITURA reutiliza importarBackup() de js/csv.js, que ya inserta
// las 7 tablas dentro de BEGIN/COMMIT con ROLLBACK automático (CLAUDE.md §3, A08)
// y ya está cubierto por tests/csv.test.js. El lado de LECTURA, en cambio, sí
// necesita su propio SQL: corre contra la base Postgres legada, no contra el
// motor nuevo, así que no puede reutilizar getAllDataForExport() de db.js — que
// ya está en dialecto SQLite. Las consultas de abajo son una copia congelada del
// lector viejo y no deben "modernizarse".

import { importarBackup } from '../csv.js';

const CLAVE_MIGRADO = 'gymlog:migrado-a-sqlite';
const CLAVE_RESCATE = 'gymlog:rescate-pglite';

export const yaMigrado = () => {
  try { return localStorage.getItem(CLAVE_MIGRADO) !== null; } catch { return false; }
};

const marcarMigrado = detalle => {
  try { localStorage.setItem(CLAVE_MIGRADO, JSON.stringify(detalle)); } catch { /* modo privado */ }
};

// Detecta la base legada SIN cargar PGLite (que serían 16 MB para descubrir que
// no hace falta). Emscripten/IDBFS nombra la IndexedDB por el dataDir, así que en
// vez de fijar el prefijo exacto ('/pglite/gym-log-db') se busca por coincidencia:
// es resistente a que PGLite cambie el prefijo entre versiones.
export async function hayBaseLegada() {
  if (yaMigrado()) return false;
  if (typeof indexedDB === 'undefined') return false;
  // indexedDB.databases() existe en Safari ≥14 y Chrome ≥71. Si no está, no se
  // puede saber sin abrir PGLite: se devuelve null y decide quien llama.
  if (typeof indexedDB.databases !== 'function') return null;

  try {
    const bases = await indexedDB.databases();
    return bases.some(b => b.name?.includes('gym-log-db'));
  } catch {
    return null;
  }
}

// Copia congelada del lector legado, en dialecto Postgres.
// Exportada para poder probarla contra una PGLite real en memoria: es el punto
// donde se decide si se pierde o no un dato del usuario.
export async function leerBaseLegada(pg) {
  const [conf, ejercicios, rutinas, reRows, rdRows, sesiones, series] = await Promise.all([
    pg.query('SELECT pref_unit, pref_acento FROM conf WHERE id = 1'),
    pg.query('SELECT id, nombre, grupo_muscular, catalogo_id, catalogo_revisado FROM ejercicios ORDER BY id'),
    pg.query('SELECT id, nombre FROM rutinas ORDER BY id'),
    pg.query('SELECT rutina_id, ejercicio_id, orden, activo_hoy FROM rutina_ejercicios ORDER BY rutina_id, orden'),
    pg.query('SELECT rutina_id, dia FROM rutina_dias ORDER BY rutina_id, dia'),
    // hora_inicio/hora_fin son TIMESTAMPTZ en la base legada y TEXT en la nueva.
    // Se leen crudas (PGLite las devuelve como Date) y se normalizan a ISO en JS
    // — ver isoOrNull más abajo. Un `::text` de Postgres daría
    // '2026-07-30 09:00:00+00', que no es ISO-8601 y rompería el new Date() con
    // el que progreso.js calcula la duración.
    pg.query(`SELECT id, fecha::text AS fecha, rutina_id, energia_sueno, peso_corporal,
                     sensacion_final, cardio_tipo, cardio_tiempo, hora_inicio, hora_fin
              FROM sesiones ORDER BY fecha, id`),
    pg.query('SELECT sesion_id, ejercicio_id, numero_serie, peso, repeticiones FROM series ORDER BY sesion_id, numero_serie'),
  ]);

  return {
    version: 1,
    exported_at: new Date().toLocaleDateString('en-CA'),
    conf: conf.rows[0] ?? { pref_unit: 'lb', pref_acento: 'verde' },
    ejercicios: ejercicios.rows,
    rutinas: rutinas.rows,
    rutina_ejercicios: reRows.rows,
    rutina_dias: rdRows.rows,
    sesiones: sesiones.rows.map(s => ({
      ...s,
      hora_inicio: isoOrNull(s.hora_inicio),
      hora_fin: isoOrNull(s.hora_fin),
    })),
    series: series.rows,
  };
}

// TIMESTAMPTZ de PGLite → el mismo formato ISO que escribe el motor nuevo
// (new Date().toISOString()). Acepta Date o string por si el driver cambia de
// criterio entre versiones.
const isoOrNull = valor => {
  if (valor == null) return null;
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
};

// Guarda el backup íntegro antes de tocar nada. Si el import falla a medias (o
// sale bien pero el usuario reporta algo raro), los datos originales siguen
// recuperables desde acá sin depender de la base vieja.
function guardarRescate(backup) {
  try {
    localStorage.setItem(CLAVE_RESCATE, JSON.stringify(backup));
    return true;
  } catch {
    // Un historial largo puede pasarse de la cuota de localStorage. No es
    // bloqueante: la base PGLite original NO se borra en este release.
    return false;
  }
}

export function leerRescate() {
  try { return localStorage.getItem(CLAVE_RESCATE); } catch { return null; }
}

/**
 * Migra los datos del usuario desde la base PGLite legada al motor SQLite ya
 * abierto. Idempotente: si ya se migró, no hace nada.
 *
 * NO borra la base PGLite. Se conserva un release entero a propósito, hasta que
 * el PM confirme que nadie perdió datos; el borrado va en la fase de limpieza.
 *
 * @param {{query: Function, exec: Function}} destino - motor SQLite abierto
 * @returns {Promise<{migrado: boolean, motivo?: string, filas?: object}>}
 */
export async function migrarDesdePglite(destino) {
  if (yaMigrado()) return { migrado: false, motivo: 'ya-migrado' };

  const legadaPresente = await hayBaseLegada();
  if (legadaPresente === false) {
    // Instalación nueva: no hay nada que migrar y nunca se descarga PGLite.
    marcarMigrado({ en: new Date().toISOString(), motivo: 'sin-base-legada' });
    return { migrado: false, motivo: 'sin-base-legada' };
  }

  // legadaPresente === true (o null: no se pudo saber, así que se comprueba
  // abriendo). Acá y solo acá se pagan los 16 MB de PGLite.
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite('idb://gym-log-db');

  let backup;
  try {
    await pg.query('SELECT 1 FROM conf LIMIT 1');
    backup = await leerBaseLegada(pg);
  } catch {
    // La base existe pero no tiene el esquema esperado (o está vacía): no hay
    // datos de usuario que perder.
    await pg.close?.();
    marcarMigrado({ en: new Date().toISOString(), motivo: 'base-legada-vacia' });
    return { migrado: false, motivo: 'base-legada-vacia' };
  }

  const filas = {
    ejercicios: backup.ejercicios.length,
    rutinas: backup.rutinas.length,
    sesiones: backup.sesiones.length,
    series: backup.series.length,
  };

  // Una base legada sin una sola serie ni rutina no vale la pena migrar, pero se
  // marca igual para no volver a bajar PGLite en cada arranque.
  if (filas.series === 0 && filas.rutinas === 0 && filas.ejercicios === 0) {
    await pg.close?.();
    marcarMigrado({ en: new Date().toISOString(), motivo: 'base-legada-vacia' });
    return { migrado: false, motivo: 'base-legada-vacia' };
  }

  const rescatado = guardarRescate(backup);

  const resultado = await importarBackup(JSON.stringify(backup), destino);
  if (resultado.error) {
    await pg.close?.();
    // Sin marcar: se reintenta en el arranque siguiente. La base PGLite sigue
    // intacta, así que no se ha perdido nada.
    throw new Error(`migración fallida: ${resultado.error}`);
  }

  await pg.close?.();
  marcarMigrado({ en: new Date().toISOString(), filas, rescatado });
  return { migrado: true, filas, rescatado };
}
