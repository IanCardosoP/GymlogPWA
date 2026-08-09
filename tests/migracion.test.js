import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { leerBaseLegada } from '../js/migracion/desdePglite.js';
import { importarBackup } from '../js/csv.js';
import { initDB, getDB, getAllDataForExport } from '../js/db.js';
import { cerrarMotor } from '../js/motor.js';

// El test que decide si la migración pierde datos o no: se construye una base
// PGLite REAL con el esquema viejo (dialecto Postgres, SERIAL, NUMERIC, BOOLEAN,
// DATE), se puebla con datos representativos, se lee con el lector legado y se
// importa al motor SQLite. Luego se compara el export resultante contra lo
// sembrado, campo por campo.
//
// No se mockea PGLite a propósito: un mock probaría que el código llama a las
// funciones que espera, no que los datos sobrevivan al cambio de dialecto — que
// es justo el riesgo (NUMERIC como string, BOOLEAN, DATE::text, ids explícitos).

const DDL_LEGADA = `
  CREATE TABLE ejercicios (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    grupo_muscular TEXT NOT NULL,
    catalogo_id TEXT,
    catalogo_revisado BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE TABLE rutinas (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, dia_sugerido INT
  );
  CREATE TABLE rutina_ejercicios (
    id SERIAL PRIMARY KEY,
    rutina_id INT REFERENCES rutinas(id) ON DELETE CASCADE,
    ejercicio_id INT REFERENCES ejercicios(id) ON DELETE CASCADE,
    orden INT, activo_hoy BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE rutina_dias (
    id SERIAL PRIMARY KEY,
    rutina_id INT REFERENCES rutinas(id) ON DELETE CASCADE,
    dia INT NOT NULL, UNIQUE (rutina_id, dia)
  );
  CREATE TABLE sesiones (
    id SERIAL PRIMARY KEY, fecha DATE, rutina_id INT REFERENCES rutinas(id),
    energia_sueno INT, peso_corporal NUMERIC,
    sensacion_final TEXT, cardio_tipo TEXT, cardio_tiempo INT,
    hora_inicio TIMESTAMPTZ, hora_fin TIMESTAMPTZ
  );
  CREATE TABLE series (
    id SERIAL PRIMARY KEY,
    sesion_id INT REFERENCES sesiones(id) ON DELETE CASCADE,
    ejercicio_id INT REFERENCES ejercicios(id),
    numero_serie INT, peso NUMERIC, repeticiones INT
  );
  CREATE TABLE conf (
    id INT PRIMARY KEY DEFAULT 1,
    pref_unit TEXT NOT NULL DEFAULT 'lb',
    pref_acento TEXT NOT NULL DEFAULT 'verde'
  );
  INSERT INTO conf (id, pref_unit, pref_acento) VALUES (1, 'kg', 'morado');

  INSERT INTO ejercicios (nombre, grupo_muscular, catalogo_id, catalogo_revisado) VALUES
    ('Press banca', 'PECHO', 'Barbell_Bench_Press', TRUE),
    ('Dominadas',   'ESPALDA', NULL, FALSE),
    ('Sentadilla',  'PIERNA', 'Barbell_Squat', TRUE);

  INSERT INTO rutinas (nombre, dia_sugerido) VALUES ('Empuje', 1), ('Tirón', 3);
  INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden, activo_hoy) VALUES
    (1, 1, 1, TRUE), (1, 3, 2, TRUE), (2, 2, 1, FALSE);
  INSERT INTO rutina_dias (rutina_id, dia) VALUES (1, 1), (2, 3), (2, 5);

  -- hora_inicio/hora_fin son TIMESTAMPTZ acá y TEXT en el motor nuevo. Sembrarlas
  -- es lo que faltaba: sin ellas el test no podía ver que la migración las perdía,
  -- y progreso.js calcula con ellas la duración del entrenamiento.
  INSERT INTO sesiones (fecha, rutina_id, energia_sueno, peso_corporal, hora_inicio, hora_fin) VALUES
    ('2026-07-20', 1, 4, 78.4, '2026-07-20T18:00:00.000Z', '2026-07-20T19:12:30.000Z'),
    ('2026-07-27', 2, 3, 78.1, NULL, NULL);

  -- peso 0 = peso corporal (regla BW de CLAUDE.md §8): tiene que sobrevivir como 0,
  -- nunca como null.
  INSERT INTO series (sesion_id, ejercicio_id, numero_serie, peso, repeticiones) VALUES
    (1, 1, 1, 137.5, 8), (1, 1, 2, 137.5, 6), (1, 3, 1, 90.25, 10),
    (2, 2, 1, 0, 12), (2, 2, 2, 0, 9);
`;

describe('migración PGLite → SQLite: fidelidad de los datos', () => {
  let backup;

  beforeAll(async () => {
    const pg = new PGlite('memory://');
    await pg.exec(DDL_LEGADA);
    backup = await leerBaseLegada(pg);
    await pg.close();

    await initDB('memory://');
    const resultado = await importarBackup(JSON.stringify(backup), getDB());
    expect(resultado.error).toBeNull();
  }, 120_000);

  afterAll(() => { cerrarMotor(); });

  it('el lector legado produce un backup con la forma del formato v1', () => {
    expect(backup.version).toBe(1);
    expect(backup.ejercicios).toHaveLength(3);
    expect(backup.rutinas).toHaveLength(2);
    expect(backup.rutina_ejercicios).toHaveLength(3);
    expect(backup.rutina_dias).toHaveLength(3);
    expect(backup.sesiones).toHaveLength(2);
    expect(backup.series).toHaveLength(5);
  });

  it('conserva las preferencias del usuario', async () => {
    const exportado = await getAllDataForExport();
    expect(exportado.conf.pref_unit).toBe('kg');
    expect(exportado.conf.pref_acento).toBe('morado');
  });

  it('conserva los ejercicios con su vínculo al catálogo', async () => {
    const { ejercicios } = await getAllDataForExport();
    const porNombre = Object.fromEntries(ejercicios.map(e => [e.nombre, e]));

    expect(porNombre['Press banca'].catalogo_id).toBe('Barbell_Bench_Press');
    expect(porNombre['Press banca'].catalogo_revisado).toBe(true);
    expect(porNombre['Dominadas'].catalogo_id).toBeNull();
    expect(porNombre['Dominadas'].catalogo_revisado).toBe(false);
    expect(porNombre['Sentadilla'].grupo_muscular).toBe('PIERNA');
  });

  it('conserva los pesos decimales como números (PGLite los daba en string)', async () => {
    const { series } = await getAllDataForExport();
    const pesos = series.map(s => s.peso).sort((a, b) => a - b);

    expect(pesos).toEqual([0, 0, 90.25, 137.5, 137.5]);
    for (const s of series) expect(typeof s.peso).toBe('number');
  });

  it('respeta la regla BW: peso 0 sigue siendo 0, nunca null', async () => {
    const { series } = await getAllDataForExport();
    const bw = series.filter(s => s.peso === 0);

    expect(bw).toHaveLength(2);
    for (const s of bw) expect(s.peso).not.toBeNull();
  });

  it('conserva las fechas de sesión como YYYY-MM-DD (sin corrimiento de zona)', async () => {
    const { sesiones } = await getAllDataForExport();
    const fechas = sesiones.map(s => s.fecha).sort();

    expect(fechas).toEqual(['2026-07-20', '2026-07-27']);
  });

  it('conserva la duración del entrenamiento (hora_inicio / hora_fin)', async () => {
    const { sesiones } = await getAllDataForExport();
    const conTiempo = sesiones.find(s => s.fecha === '2026-07-20');

    // Formato ISO, el mismo que escribe el motor nuevo: progreso.js hace
    // `new Date(hora_fin) - new Date(hora_inicio)` y un formato de Postgres
    // ('2026-07-20 18:00:00+00') no parsea de forma fiable.
    expect(conTiempo.hora_inicio).toBe('2026-07-20T18:00:00.000Z');
    expect(conTiempo.hora_fin).toBe('2026-07-20T19:12:30.000Z');

    const duracionMin = (new Date(conTiempo.hora_fin) - new Date(conTiempo.hora_inicio)) / 60000;
    expect(duracionMin).toBe(72.5);
  });

  it('una sesión sin tiempos migra con NULL, no revienta', async () => {
    const { sesiones } = await getAllDataForExport();
    const sinTiempo = sesiones.find(s => s.fecha === '2026-07-27');

    expect(sinTiempo.hora_inicio).toBeNull();
    expect(sinTiempo.hora_fin).toBeNull();
  });

  it('conserva el peso corporal decimal de las sesiones', async () => {
    const { sesiones } = await getAllDataForExport();
    const pesos = sesiones.map(s => s.peso_corporal).sort((a, b) => a - b);

    expect(pesos).toEqual([78.1, 78.4]);
  });

  it('conserva los días asignados a cada rutina', async () => {
    const { rutinas, rutina_dias } = await getAllDataForExport();
    const empuje = rutinas.find(r => r.nombre === 'Empuje');
    const tiron = rutinas.find(r => r.nombre === 'Tirón');

    expect(rutina_dias.filter(d => d.rutina_id === empuje.id).map(d => d.dia)).toEqual([1]);
    expect(rutina_dias.filter(d => d.rutina_id === tiron.id).map(d => d.dia)).toEqual([3, 5]);
  });

  it('conserva la composición y el orden de las rutinas', async () => {
    const { rutina_ejercicios } = await getAllDataForExport();
    const deEmpuje = rutina_ejercicios.filter(r => r.rutina_id === 1);

    expect(deEmpuje.map(r => r.orden)).toEqual([1, 2]);
    expect(rutina_ejercicios.map(r => typeof r.activo_hoy)).toEqual(['boolean', 'boolean', 'boolean']);
  });

  it('las secuencias quedan sanas: un INSERT nuevo no colisiona con los ids restaurados', async () => {
    // El import viejo llamaba a setval() de Postgres para esto. En SQLite lo hace
    // sqlite_sequence al insertar ids explícitos, y este test lo verifica en vez
    // de darlo por supuesto.
    const { rows } = await getDB().query(
      "INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ('Nuevo', 'CORE') RETURNING id"
    );
    const { ejercicios } = await getAllDataForExport();
    const idsPrevios = ejercicios.filter(e => e.nombre !== 'Nuevo').map(e => e.id);

    expect(idsPrevios).not.toContain(rows[0].id);
    expect(rows[0].id).toBeGreaterThan(Math.max(...idsPrevios));
  });
});
