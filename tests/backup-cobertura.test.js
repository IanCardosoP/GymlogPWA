import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDB, getDB, getAllDataForExport,
  saveRutina, saveEjercicio, linkEjercicioToRutina, addRutinaDia,
  saveSesion, saveSerie, touchSesionTiempo, updatePrefAcento, getOrCreateEjercicio,
} from '../js/db.js';
import { importarBackup } from '../js/csv.js';
import { cerrarMotor } from '../js/motor.js';

// Guard de la CLASE de bug, no de una instancia.
//
// Historia: `sesiones.hora_inicio` y `hora_fin` existían en el esquema y
// progreso.js/diario.js calculaban con ellas la duración del entrenamiento,
// pero getAllDataForExport() no las seleccionaba. Resultado: cada backup/restore
// —y la migración a SQLite, que reutiliza ese mismo camino— borraba en silencio
// la duración de todas las sesiones pasadas. Nadie lo vio porque los tests
// comprobaban los campos que sí viajaban.
//
// Estos dos tests cierran el agujero por los dos lados:
//   A) cobertura  → una columna nueva en la DDL obliga a decidir: o entra en el
//                   backup, o se documenta por qué no. Detecta huecos de EXPORT.
//   B) ida y vuelta → exportar, importar y volver a exportar tiene que dar lo
//                   mismo. Detecta huecos de IMPORT (una columna que se exporta
//                   pero csv.js no inserta).

// Columnas deliberadamente fuera del backup. Si añades una, escribe el porqué:
// la lista existe para que excluir sea una decisión consciente, no un olvido.
const EXCLUIDAS = {
  'rutina_ejercicios.id': 'clave subrogada, se regenera al importar',
  'rutina_dias.id':       'clave subrogada, se regenera al importar',
  'series.id':            'clave subrogada, se regenera al importar',
  'conf.id':              'singleton fijo a 1',
  'conf.device_id':       'identidad del dispositivo — restaurar un backup en otro teléfono mezclaría la telemetría',
  'rutinas.dia_sugerido': 'legado: la asignación de días vive en rutina_dias, que sí se exporta',
};

// Tabla del esquema → clave dentro del objeto de backup.
const TABLAS = {
  ejercicios: 'ejercicios',
  rutinas: 'rutinas',
  rutina_ejercicios: 'rutina_ejercicios',
  rutina_dias: 'rutina_dias',
  sesiones: 'sesiones',
  series: 'series',
  conf: 'conf',
};

// Siembra al menos una fila por tabla y con TODAS las columnas no nulas, para
// que las claves de cada fila exportada sean observables.
async function sembrarTodo() {
  const rutina = await saveRutina('Empuje', 2);
  await addRutinaDia(rutina.id, 1);

  const ej = await getOrCreateEjercicio('Press banca', 'PECHO', 'Barbell_Bench_Press');
  await linkEjercicioToRutina(rutina.id, ej.id, 1);

  const sesion = await saveSesion('2026-07-20', rutina.id, 4);
  await saveSerie(sesion.id, ej.id, 1, 137.5, 8);
  await saveSerie(sesion.id, ej.id, 2, 0, 12); // BW
  await touchSesionTiempo(sesion.id);          // puebla hora_inicio / hora_fin

  // Columnas que hoy no escribe nadie desde la UI: se pueblan a mano para que el
  // test las cubra igual (que estén muertas hoy no significa que puedan perderse).
  await getDB().query(
    `UPDATE sesiones SET peso_corporal = ?1, sensacion_final = ?2,
                         cardio_tipo = ?3, cardio_tiempo = ?4 WHERE id = ?5`,
    [78.4, 'fuerte', 'cinta', 20, sesion.id]
  );

  await updatePrefAcento('morado');
  return { rutina, ej, sesion };
}

const columnasDe = async tabla => {
  const { rows } = await getDB().query(`PRAGMA table_info(${tabla})`);
  return rows.map(r => r.name);
};

beforeEach(async () => { await initDB('memory://'); });
afterEach(() => { cerrarMotor(); });

describe('cobertura del backup: ninguna columna se pierde en silencio', () => {
  it('cada columna del esquema o viaja en el backup, o está documentada como excluida', async () => {
    await sembrarTodo();
    const backup = await getAllDataForExport();

    const huerfanas = [];
    for (const [tabla, clave] of Object.entries(TABLAS)) {
      const enBackup = backup[clave];
      const fila = Array.isArray(enBackup) ? enBackup[0] : enBackup;
      expect(fila, `la tabla ${tabla} no tiene filas sembradas: el test no puede comprobarla`)
        .toBeTruthy();

      const exportadas = new Set(Object.keys(fila));
      for (const columna of await columnasDe(tabla)) {
        if (exportadas.has(columna)) continue;
        if (EXCLUIDAS[`${tabla}.${columna}`]) continue;
        huerfanas.push(`${tabla}.${columna}`);
      }
    }

    expect(
      huerfanas,
      `Columnas del esquema que no viajan en el backup:\n  ${huerfanas.join('\n  ')}\n\n` +
      'Añádelas a getAllDataForExport() y a importarBackup(), o documéntalas en ' +
      'EXCLUIDAS de este test explicando por qué se quedan fuera.'
    ).toEqual([]);
  });

  it('la duración del entrenamiento sobrevive al backup (el bug concreto)', async () => {
    const { sesion } = await sembrarTodo();
    const backup = await getAllDataForExport();
    const exportada = backup.sesiones.find(s => s.id === sesion.id);

    expect(exportada.hora_inicio).toBeTruthy();
    expect(exportada.hora_fin).toBeTruthy();
    expect(Number.isNaN(Date.parse(exportada.hora_inicio))).toBe(false);
  });
});

describe('ida y vuelta: exportar → importar → exportar da lo mismo', () => {
  it('ninguna columna se pierde en el import (el otro lado del agujero)', async () => {
    await sembrarTodo();
    const original = await getAllDataForExport();

    const resultado = await importarBackup(JSON.stringify(original), getDB());
    expect(resultado.error).toBeNull();

    const restaurado = await getAllDataForExport();

    // exported_at cambia por definición (es la fecha de exportación).
    const sinFecha = ({ exported_at, ...resto }) => resto;
    expect(sinFecha(restaurado)).toEqual(sinFecha(original));
  });

  it('la duración sigue ahí después de restaurar', async () => {
    const { sesion } = await sembrarTodo();
    const original = await getAllDataForExport();
    const antes = original.sesiones.find(s => s.id === sesion.id);

    await importarBackup(JSON.stringify(original), getDB());

    const { rows } = await getDB().query(
      'SELECT hora_inicio, hora_fin FROM sesiones WHERE id = ?1', [sesion.id]
    );
    expect(rows[0].hora_inicio).toBe(antes.hora_inicio);
    expect(rows[0].hora_fin).toBe(antes.hora_fin);
  });

  it('un backup viejo sin las columnas nuevas sigue importándose (compatibilidad)', async () => {
    // El formato v1 original no traía hora_inicio/hora_fin ni cardio_*. Añadirlas
    // no puede romper la restauración de un archivo que el usuario guardó antes.
    await sembrarTodo();
    const backup = await getAllDataForExport();
    backup.sesiones = backup.sesiones.map(({
      sensacion_final, cardio_tipo, cardio_tiempo, hora_inicio, hora_fin, ...viejo
    }) => viejo);

    const resultado = await importarBackup(JSON.stringify(backup), getDB());

    expect(resultado.error).toBeNull();
    expect(resultado.sesiones).toBe(1);
    const { rows } = await getDB().query('SELECT hora_inicio FROM sesiones');
    expect(rows[0].hora_inicio).toBeNull();
  });
});
