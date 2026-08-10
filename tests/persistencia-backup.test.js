import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { crearIndexedDBFalsa } from './setup/idb-falsa.js';
import { initDB, getDB } from '../js/db.js';
import { cerrarMotor } from '../js/motor.js';
import { importarBackup } from '../js/csv.js';

// El test que faltaba cuando "restaurar desde backup" dejó la app en blanco en
// producción (agosto 2026).
//
// El import corría entero y devolvía sus contadores, pero escribía SOLO en la
// base en memoria: nadie persistía el snapshot a IndexedDB. config.js recarga la
// página justo después, así que la base restaurada moría con la página y el
// arranque siguiente leía el snapshot anterior — vacío, porque el usuario
// acababa de borrar los datos de la app.
//
// Ningún test lo detectaba porque todos usan `memory://`, donde la persistencia
// es no-op por diseño. Este corre con persistencia REAL contra la IndexedDB
// falsa de tests/setup/idb-falsa.js, y la recarga se simula con
// cerrarMotor() + initDB(): si el snapshot no está en "disco", no hay datos.

const BACKUP = {
  version: 1,
  exported_at: '2026-08-09',
  conf: { pref_unit: 'kg', pref_acento: 'morado' },
  ejercicios: [
    { id: 1,  nombre: 'Press Banca', grupo_muscular: 'PECHO',
      catalogo_id: 'Barbell_Bench_Press', catalogo_revisado: true },
    { id: 34, nombre: 'Dominadas',   grupo_muscular: 'ESPALDA',
      catalogo_id: null, catalogo_revisado: false },
  ],
  rutinas: [{ id: 1, nombre: 'Torso A' }],
  rutina_ejercicios: [
    { rutina_id: 1, ejercicio_id: 1,  orden: 1, activo_hoy: true },
    { rutina_id: 1, ejercicio_id: 34, orden: 2, activo_hoy: true },
  ],
  rutina_dias: [{ rutina_id: 1, dia: 1 }],
  sesiones: [{
    id: 7, fecha: '2026-08-08', rutina_id: 1, energia_sueno: 4,
    peso_corporal: 82.5, sensacion_final: null, cardio_tipo: null,
    cardio_tiempo: null,
    hora_inicio: '2026-08-08T17:02:00.000Z',
    hora_fin:    '2026-08-08T18:11:00.000Z',
  }],
  series: [
    { sesion_id: 7, ejercicio_id: 1,  numero_serie: 1, peso: 60,  repeticiones: 8 },
    { sesion_id: 7, ejercicio_id: 1,  numero_serie: 2, peso: 62.5, repeticiones: 6 },
    // peso 0 = peso corporal (CLAUDE.md §8): debe volver como 0, no como null.
    { sesion_id: 7, ejercicio_id: 34, numero_serie: 1, peso: 0,   repeticiones: 10 },
  ],
};

const contar = async tabla => {
  const { rows } = await getDB().query(`SELECT COUNT(*) AS c FROM ${tabla}`);
  return rows[0].c;
};

describe('persistencia del restaurar-backup', () => {
  beforeAll(() => {
    globalThis.indexedDB = crearIndexedDBFalsa();
  });

  afterAll(() => {
    cerrarMotor();
    delete globalThis.indexedDB;
  });

  it('los datos importados sobreviven a la recarga de la página', async () => {
    // Dispositivo con los datos borrados: base persistente y vacía.
    await initDB('idb://gym-log-db');
    expect(await contar('series')).toBe(0);

    const resultado = await importarBackup(JSON.stringify(BACKUP), getDB());
    expect(resultado.error).toBeNull();
    expect(resultado.series).toBe(3);

    // El location.reload() que hace config.js justo después del import.
    cerrarMotor();
    await initDB('idb://gym-log-db');

    expect(await contar('ejercicios')).toBe(2);
    expect(await contar('rutinas')).toBe(1);
    expect(await contar('rutina_ejercicios')).toBe(2);
    expect(await contar('rutina_dias')).toBe(1);
    expect(await contar('sesiones')).toBe(1);
    expect(await contar('series')).toBe(3);
  });

  it('conserva los valores, no solo el número de filas', async () => {
    const { rows: sesiones } = await getDB().query(
      'SELECT fecha, peso_corporal, hora_inicio, hora_fin FROM sesiones WHERE id = 7');
    expect(sesiones[0]).toEqual({
      fecha: '2026-08-08',
      peso_corporal: 82.5,
      hora_inicio: '2026-08-08T17:02:00.000Z',
      hora_fin:    '2026-08-08T18:11:00.000Z',
    });

    const { rows: bw } = await getDB().query(
      'SELECT peso, repeticiones FROM series WHERE ejercicio_id = 34');
    expect(bw[0]).toEqual({ peso: 0, repeticiones: 10 });

    const { rows: conf } = await getDB().query(
      'SELECT pref_unit, pref_acento FROM conf WHERE id = 1');
    expect(conf[0]).toEqual({ pref_unit: 'kg', pref_acento: 'morado' });
  });

  it('una importación posterior también sobrevive a la recarga', async () => {
    const soloUnaSerie = {
      ...BACKUP,
      series: [BACKUP.series[0]],
    };
    const resultado = await importarBackup(JSON.stringify(soloUnaSerie), getDB());
    expect(resultado.error).toBeNull();

    cerrarMotor();
    await initDB('idb://gym-log-db');

    expect(await contar('series')).toBe(1);
  });
});
