import { describe, it, expect, afterEach } from 'vitest';
import { crearIndexedDBFalsa } from './setup/idb-falsa.js';
import { initDB, getDB, saveEjercicio } from '../js/db.js';
import { cerrarMotor, borrarBasesDeDatos } from '../js/motor.js';

// Guard del «SÍ, BORRAR TODO» (issue #29).
//
// La versión anterior hacía `Promise.all(dbs.map(d => indexedDB.deleteDatabase(d.name)))`
// sobre IDBRequest, que no son thenables: resolvía en el mismo tick sin esperar
// nada. Y encima el motor dejaba su conexión a IndexedDB abierta, así que el
// borrado quedaba BLOQUEADO y solo se completaba de milagro durante el unload de
// la recarga — la misma apuesta sobre el unload que ya perdimos en el bug de
// restaurar backup (v1.5.3).
//
// La IndexedDB falsa de tests/setup/idb-falsa.js simula el bloqueo por conexión
// abierta, que es lo que hace este test capaz de detectar la regresión: si
// cerrarMotor() deja de cerrar la conexión, la base sobrevive al borrado.

const sembrar = async () => {
  await initDB('idb://gym-log-db');
  await saveEjercicio('Press Banca', 'PECHO');
};

const contarEjercicios = async () => {
  const { rows } = await getDB().query('SELECT COUNT(*) AS c FROM ejercicios');
  return rows[0].c;
};

describe('borrado total del almacenamiento', () => {
  afterEach(() => {
    cerrarMotor();
    delete globalThis.indexedDB;
  });

  it('espera al borrado real: nada sobrevive a la recarga', async () => {
    const idb = crearIndexedDBFalsa();
    globalThis.indexedDB = idb;

    await sembrar();
    expect(await contarEjercicios()).toBe(1);
    expect(idb._nombres()).toContain('gymlog-motor');

    const resultado = await borrarBasesDeDatos({ tiempoLimiteMs: 50 });

    expect(resultado.bloqueadas).toEqual([]);
    expect(resultado.borradas).toContain('gymlog-motor');
    // El borrado ocurrió ANTES de que la función resolviera, no durante el
    // unload de la recarga.
    expect(idb._nombres()).toEqual([]);

    // Lo que ve el usuario tras el location.reload().
    await initDB('idb://gym-log-db');
    expect(await contarEjercicios()).toBe(0);
  });

  it('borra gymlog-motor también sin indexedDB.databases()', async () => {
    // Safari < 14. La rama de respaldo solo borraba los nombres viejos de
    // PGLite, así que la base con los datos del usuario quedaba intacta y el
    // «borrado total» no borraba nada.
    const idb = crearIndexedDBFalsa({ conDatabases: false });
    globalThis.indexedDB = idb;

    await sembrar();
    expect(idb._nombres()).toContain('gymlog-motor');

    const resultado = await borrarBasesDeDatos({ tiempoLimiteMs: 50 });

    expect(resultado.borradas).toContain('gymlog-motor');
    expect(idb._nombres()).toEqual([]);
  });

  it('no toca las bases de otras apps del mismo origen', async () => {
    // En GitHub Pages el origen es <usuario>.github.io, compartido por todos los
    // repos publicados del mismo usuario. Borrar todo lo que devuelve
    // indexedDB.databases() se llevaría los datos de otra app suya.
    const idb = crearIndexedDBFalsa();
    globalThis.indexedDB = idb;

    idb.open('otra-app-del-usuario');
    await new Promise(r => setTimeout(r, 0));
    await sembrar();

    const resultado = await borrarBasesDeDatos({ tiempoLimiteMs: 50 });

    expect(resultado.borradas).toContain('gymlog-motor');
    expect(idb._nombres()).toEqual(['otra-app-del-usuario']);
  });

  it('no se cuelga si otra pestaña tiene la base abierta', async () => {
    const idb = crearIndexedDBFalsa();
    globalThis.indexedDB = idb;

    await sembrar();
    // Conexión ajena que el motor no controla (otra pestaña de la app).
    idb.open('gymlog-motor');
    await new Promise(r => setTimeout(r, 0));

    const resultado = await borrarBasesDeDatos({ tiempoLimiteMs: 50 });

    // Resuelve e informa en vez de dejar la UI colgada esperando para siempre.
    expect(resultado.bloqueadas).toContain('gymlog-motor');
  });
});
