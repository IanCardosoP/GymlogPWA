import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDB, getDB, saveRutina, saveEjercicio, linkEjercicioToRutina, saveSesion,
  saveSerie, getActividadSemanal, getAllDataForExport, getUltimasSeriesPorEjercicio,
  getPesoMaxPorEjercicio, getEjerciciosPendientesRevision, getOrCreateEjercicio,
  reordenarEjercicios, getRutinaEjercicios, touchSesionTiempo, getSesionDelDia,
} from '../js/db.js';
import { cerrarMotor } from '../js/motor.js';

// Cubre lo que el port de dialecto Postgres → SQLite pudo romper en silencio.
// Los tests de db.test.js ya validan el comportamiento de negocio; acá van las
// trampas propias del cambio de motor.

beforeEach(async () => { await initDB('memory://'); });
afterEach(() => { cerrarMotor(); });

describe('port del dialecto: agrupación por semana', () => {
  // El idioma que circula para replicar date_trunc('week') en SQLite,
  // date(fecha,'weekday 1','-7 days'), está MAL: 'weekday 1' no avanza si la
  // fecha YA es lunes, así que el -7 la manda a la semana anterior. Este test
  // fija el caso borde, que es el que lo delata.
  const sembrarSesionConSerie = async fecha => {
    const ej = await saveEjercicio(`E-${fecha}`, 'pecho');
    const sesion = await saveSesion(fecha, null, null);
    await saveSerie(sesion.id, ej.id, 1, 100, 5);
  };

  it('un lunes se agrupa en SU semana, no en la anterior', async () => {
    // 2026-07-27 es lunes.
    await sembrarSesionConSerie('2026-07-27');
    const filas = await getActividadSemanal('2026-07-30', 8);

    expect(filas.length).toBe(1);
    expect(filas[0].semana_lunes).toBe('2026-07-27');
  });

  it('domingo pertenece a la semana que empezó el lunes anterior (como Postgres)', async () => {
    // 2026-08-02 es domingo → su lunes es 2026-07-27.
    await sembrarSesionConSerie('2026-08-02');
    const filas = await getActividadSemanal('2026-08-02', 8);

    expect(filas[0].semana_lunes).toBe('2026-07-27');
  });

  it('todos los días de una misma semana caen en el mismo lunes', async () => {
    for (const fecha of ['2026-07-27', '2026-07-29', '2026-07-31', '2026-08-02']) {
      await sembrarSesionConSerie(fecha);
    }
    const filas = await getActividadSemanal('2026-08-02', 8);

    expect(filas.length).toBe(1);
    expect(filas[0].semana_lunes).toBe('2026-07-27');
    expect(filas[0].sesiones).toBe(4);
  });
});

describe('port del dialecto: DISTINCT ON → ROW_NUMBER', () => {
  it('getUltimasSeriesPorEjercicio devuelve una fila por ejercicio, la más reciente', async () => {
    const a = await saveEjercicio('A', 'pecho');
    const b = await saveEjercicio('B', 'pierna');

    const vieja = await saveSesion('2026-07-01', null, null);
    const nueva = await saveSesion('2026-07-20', null, null);
    await saveSerie(vieja.id, a.id, 1, 50, 10);
    await saveSerie(nueva.id, a.id, 1, 80, 8);
    await saveSerie(nueva.id, b.id, 1, 120, 5);

    const filas = await getUltimasSeriesPorEjercicio([a.id, b.id]);

    expect(filas.length).toBe(2);
    expect(filas.find(f => f.ejercicio_id === a.id).peso).toBe(80);
    expect(filas.find(f => f.ejercicio_id === b.id).peso).toBe(120);
    // La columna auxiliar del ROW_NUMBER no debe filtrarse al resultado.
    expect(filas[0]).not.toHaveProperty('rn');
  });

  it('getUltimasSeriesPorEjercicio expande la lista IN sin concatenar valores', async () => {
    // Sustituye al = ANY($1) de Postgres. Se comprueba que respeta el filtro:
    // un ejercicio fuera de la lista no aparece.
    const a = await saveEjercicio('A', 'pecho');
    const b = await saveEjercicio('B', 'pierna');
    const sesion = await saveSesion('2026-07-20', null, null);
    await saveSerie(sesion.id, a.id, 1, 80, 8);
    await saveSerie(sesion.id, b.id, 1, 120, 5);

    const filas = await getUltimasSeriesPorEjercicio([a.id]);
    expect(filas.length).toBe(1);
    expect(filas[0].ejercicio_id).toBe(a.id);
  });

  it('getPesoMaxPorEjercicio devuelve el máximo por ejercicio, sin columna auxiliar', async () => {
    const ej = await saveEjercicio('Press', 'pecho');
    const s1 = await saveSesion('2026-07-01', null, null);
    const s2 = await saveSesion('2026-07-10', null, null);
    await saveSerie(s1.id, ej.id, 1, 100, 5);
    await saveSerie(s2.id, ej.id, 1, 60, 12);

    const filas = await getPesoMaxPorEjercicio();

    expect(filas.length).toBe(1);
    expect(filas[0].peso_max).toBe(100);
    expect(filas[0].fecha_pr).toBe('2026-07-01');
    expect(filas[0]).not.toHaveProperty('rn');
  });
});

describe('port del dialecto: tipos', () => {
  it('REAL vuelve como number, no como string (PGLite devolvía NUMERIC en string)', async () => {
    const ej = await saveEjercicio('Press', 'pecho');
    const sesion = await saveSesion('2026-07-20', null, null);
    const serie = await saveSerie(sesion.id, ej.id, 1, 137.5, 8);

    expect(typeof serie.peso).toBe('number');
    expect(serie.peso).toBe(137.5);
  });

  it('los booleanos siguen siendo booleanos aunque SQLite los guarde como 0/1', async () => {
    const sinVinculo = await getOrCreateEjercicio('Fondos', 'pecho');
    expect(sinVinculo.catalogo_revisado).toBe(false);

    const conVinculo = await getOrCreateEjercicio('Press banca', 'pecho', 'Barbell_Bench_Press');
    expect(conVinculo.catalogo_revisado).toBe(true);

    expect(await getEjerciciosPendientesRevision()).toHaveLength(1);
  });

  it('el backup exporta booleanos, no 0/1 (compatibilidad del formato v1)', async () => {
    const rutina = await saveRutina('Empuje', null);
    const ej = await saveEjercicio('Press', 'pecho');
    await linkEjercicioToRutina(rutina.id, ej.id, 1);

    const backup = await getAllDataForExport();

    expect(typeof backup.ejercicios[0].catalogo_revisado).toBe('boolean');
    expect(typeof backup.rutina_ejercicios[0].activo_hoy).toBe('boolean');
    // El formato no debe cambiar de versión por el cambio de motor.
    expect(backup.version).toBe(1);
  });

  it('NOW() portado a JS: touchSesionTiempo escribe un ISO válido y no lo pisa', async () => {
    const sesion = await saveSesion('2026-07-30', null, null);

    await touchSesionTiempo(sesion.id);
    const primera = await getSesionDelDia('2026-07-30');
    expect(Number.isNaN(Date.parse(primera.hora_inicio))).toBe(false);

    await touchSesionTiempo(sesion.id);
    const segunda = await getSesionDelDia('2026-07-30');
    // hora_inicio va con COALESCE: se fija una vez. hora_fin sí avanza.
    expect(segunda.hora_inicio).toBe(primera.hora_inicio);
  });
});

describe('port del dialecto: claves ajenas y transacciones', () => {
  it('PRAGMA foreign_keys está activo (el esquema depende de ON DELETE CASCADE)', async () => {
    const { rows } = await getDB().query('PRAGMA foreign_keys');
    expect(rows[0].foreign_keys).toBe(1);
  });

  it('reordenarEjercicios persiste el orden completo dentro de una transacción', async () => {
    const rutina = await saveRutina('Empuje', null);
    const ids = [];
    for (const nombre of ['A', 'B', 'C']) {
      const ej = await saveEjercicio(nombre, 'pecho');
      const re = await linkEjercicioToRutina(rutina.id, ej.id, 0);
      ids.push(re.id);
    }

    await reordenarEjercicios(rutina.id, [ids[2], ids[0], ids[1]]);
    const filas = await getRutinaEjercicios(rutina.id);

    expect(filas.map(f => f.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(filas.map(f => f.orden)).toEqual([1, 2, 3]);
  });
});
