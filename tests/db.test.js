import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  getEjercicios, saveEjercicio, updateEjercicioNombre, deleteEjercicio,
  getRutinas, saveRutina, getRutinaEjercicios, updateActivoHoy, updateRutinaDia, clearRutinaDia, swapOrden,
  getRutinasDias, addRutinaDia, removeRutinaDia, updateRutinaNombre, deleteRutina,
  saveSesion, getSesionDelDia,
  saveSerie, deleteSerie, getUltimaSerie, getSeriesPorEjercicio, getSeriesDeSesionEjercicio,
  getConf, updatePrefUnit, updatePrefAcento,
} from '../js/db.js';

beforeEach(async () => {
  await initDB('memory://');
});

// ── Ejercicios ────────────────────────────────────────────────────────────────

describe('ejercicios', () => {
  it('inserta un ejercicio y getEjercicios lo retorna', async () => {
    await saveEjercicio('Press Banca', 'Pecho');
    const rows = await getEjercicios();
    expect(rows.length).toBe(1);
    expect(rows[0].nombre).toBe('Press Banca');
    expect(rows[0].grupo_muscular).toBe('Pecho');
  });

  it('updateEjercicioNombre actualiza el nombre correctamente', async () => {
    const ej = await saveEjercicio('Press Banca', 'Pecho');
    const updated = await updateEjercicioNombre(ej.id, 'Press Banca Inclinado');
    expect(updated.nombre).toBe('Press Banca Inclinado');
    const todos = await getEjercicios();
    expect(todos[0].nombre).toBe('Press Banca Inclinado');
  });

  it('deleteEjercicio elimina el ejercicio, sus series y su vínculo con rutinas', async () => {
    const rutina = await saveRutina('Pecho', 1);
    const ej     = await saveEjercicio('Fondos', 'Pecho');
    const sesion = await saveSesion('2026-06-14', rutina.id, null);
    await saveSerie(sesion.id, ej.id, 1, 20, 10);
    const db = (await import('../js/db.js')).getDB();
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1)',
      [rutina.id, ej.id]
    );

    await deleteEjercicio(ej.id);

    const { rows: ejRows }  = await db.query('SELECT * FROM ejercicios WHERE id = $1', [ej.id]);
    const { rows: reRows }  = await db.query('SELECT * FROM rutina_ejercicios WHERE ejercicio_id = $1', [ej.id]);
    const { rows: serRows } = await db.query('SELECT * FROM series WHERE ejercicio_id = $1', [ej.id]);
    expect(ejRows).toHaveLength(0);
    expect(reRows).toHaveLength(0);
    expect(serRows).toHaveLength(0);
  });

  it('retorna múltiples ejercicios ordenados por nombre', async () => {
    await saveEjercicio('Sentadilla', 'Pierna');
    await saveEjercicio('Curl Bíceps', 'Bíceps');
    const rows = await getEjercicios();
    expect(rows[0].nombre).toBe('Curl Bíceps');
    expect(rows[1].nombre).toBe('Sentadilla');
  });
});

// ── Rutinas ───────────────────────────────────────────────────────────────────

describe('rutinas', () => {
  it('inserta una rutina y getRutinas la retorna', async () => {
    await saveRutina('Pecho + Tríceps', 0);
    const rows = await getRutinas();
    expect(rows.length).toBe(1);
    expect(rows[0].nombre).toBe('Pecho + Tríceps');
  });

  it('getRutinaEjercicios devuelve ejercicios vinculados', async () => {
    const rutina = await saveRutina('Espalda', 1);
    const ej = await saveEjercicio('Jalón Polea', 'Espalda');
    const db = (await import('../js/db.js')).getDB();
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, $3)',
      [rutina.id, ej.id, 1]
    );
    const lista = await getRutinaEjercicios(rutina.id);
    expect(lista.length).toBe(1);
    expect(lista[0].nombre).toBe('Jalón Polea');
  });

  it('updateRutinaDia limpia la asignación previa del mismo día', async () => {
    const vieja = await saveRutina('Pecho', 0);        // domingo
    const nueva  = await saveRutina('Pierna', null);

    await updateRutinaDia(nueva.id, 0);               // asigna Pierna a domingo

    const todas = await getRutinas();
    const viejaActual = todas.find(r => r.id === vieja.id);
    const nuevaActual = todas.find(r => r.id === nueva.id);

    expect(viejaActual.dia_sugerido).toBeNull();       // Pecho ya no tiene día
    expect(nuevaActual.dia_sugerido).toBe(0);          // Pierna tiene domingo
  });

  it('swapOrden intercambia la posición de dos ejercicios en la rutina', async () => {
    const rutina = await saveRutina('Pecho', 1);
    const ej1 = await saveEjercicio('Press Banca', 'Pecho');
    const ej2 = await saveEjercicio('Aperturas', 'Pecho');
    const db = (await import('../js/db.js')).getDB();
    const { rows: [re1] } = await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1) RETURNING *',
      [rutina.id, ej1.id]
    );
    const { rows: [re2] } = await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 9) RETURNING *',
      [rutina.id, ej2.id]
    );

    await swapOrden(re1.id, re2.id);

    const lista = await getRutinaEjercicios(rutina.id);
    const actualEj1 = lista.find(r => r.ejercicio_id === ej1.id);
    const actualEj2 = lista.find(r => r.ejercicio_id === ej2.id);
    expect(actualEj1.orden).toBe(9);
    expect(actualEj2.orden).toBe(1);
  });

  it('clearRutinaDia deja el día sin rutina asignada', async () => {
    const rutina = await saveRutina('Espalda', 3);     // miércoles
    await clearRutinaDia(3);
    const todas = await getRutinas();
    const actual = todas.find(r => r.id === rutina.id);
    expect(actual.dia_sugerido).toBeNull();
  });

  it('addRutinaDia vincula una rutina a un día', async () => {
    const rutina = await saveRutina('Pecho', null);
    await addRutinaDia(rutina.id, 1); // lunes
    const dias = await getRutinasDias();
    const vinculo = dias.find(rd => rd.rutina_id === rutina.id && rd.dia === 1);
    expect(vinculo).toBeDefined();
  });

  it('addRutinaDia es idempotente (ON CONFLICT DO NOTHING)', async () => {
    const rutina = await saveRutina('Espalda', null);
    await addRutinaDia(rutina.id, 2);
    await addRutinaDia(rutina.id, 2); // segunda vez no debe lanzar error
    const dias = await getRutinasDias();
    const vinculos = dias.filter(rd => rd.rutina_id === rutina.id && rd.dia === 2);
    expect(vinculos).toHaveLength(1);
  });

  it('removeRutinaDia desvincula una rutina de un día', async () => {
    const rutina = await saveRutina('Pierna', null);
    await addRutinaDia(rutina.id, 4); // jueves
    await removeRutinaDia(rutina.id, 4);
    const dias = await getRutinasDias();
    const vinculo = dias.find(rd => rd.rutina_id === rutina.id && rd.dia === 4);
    expect(vinculo).toBeUndefined();
  });

  it('getRutinasDias retorna todos los vínculos rutina→día', async () => {
    const r1 = await saveRutina('Pecho', null);
    const r2 = await saveRutina('Pierna', null);
    await addRutinaDia(r1.id, 1);
    await addRutinaDia(r1.id, 4);
    await addRutinaDia(r2.id, 3);
    const dias = await getRutinasDias();
    expect(dias.length).toBeGreaterThanOrEqual(3);
    const diasR1 = dias.filter(rd => rd.rutina_id === r1.id).map(rd => rd.dia).sort();
    expect(diasR1).toEqual([1, 4]);
  });

  it('updateRutinaNombre actualiza el nombre de la rutina', async () => {
    const rutina = await saveRutina('Nombre Viejo', null);
    const updated = await updateRutinaNombre(rutina.id, 'Nombre Nuevo');
    expect(updated.nombre).toBe('Nombre Nuevo');
    const todas = await getRutinas();
    const actual = todas.find(r => r.id === rutina.id);
    expect(actual.nombre).toBe('Nombre Nuevo');
  });

  it('deleteRutina elimina rutina y desvincula sesiones y días', async () => {
    const rutina = await saveRutina('TempRutina', null);
    await addRutinaDia(rutina.id, 0);
    const sesion = await saveSesion('2026-06-14', rutina.id, null);
    await deleteRutina(rutina.id);
    const todas = await getRutinas();
    expect(todas.find(r => r.id === rutina.id)).toBeUndefined();
    const db = (await import('../js/db.js')).getDB();
    const { rows: diasRows } = await db.query(
      'SELECT * FROM rutina_dias WHERE rutina_id = $1', [rutina.id]
    );
    expect(diasRows).toHaveLength(0);
    const { rows: sesRows } = await db.query(
      'SELECT rutina_id FROM sesiones WHERE id = $1', [sesion.id]
    );
    expect(sesRows[0].rutina_id).toBeNull();
  });

  it('updateActivoHoy cambia el booleano correctamente', async () => {
    const rutina = await saveRutina('Pierna', 2);
    const ej = await saveEjercicio('Sentadilla', 'Pierna');
    const db = (await import('../js/db.js')).getDB();
    const { rows } = await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden, activo_hoy) VALUES ($1, $2, 1, TRUE) RETURNING *',
      [rutina.id, ej.id]
    );
    const re = rows[0];
    const updated = await updateActivoHoy(re.id, false);
    expect(updated.activo_hoy).toBe(false);
  });
});

// ── Sesiones y Series ─────────────────────────────────────────────────────────

describe('sesiones y series', () => {
  it('saveSesion persiste con fecha local de JS', async () => {
    const fechaLocal = '2026-06-13';
    await saveSesion(fechaLocal, null, 4);
    const sesion = await getSesionDelDia(fechaLocal);
    expect(sesion).not.toBeNull();
    expect(sesion.energia_sueno).toBe(4);
  });

  it('saveSerie con peso=0 (BW) persiste y se recupera como 0 numérico', async () => {
    const sesion = await saveSesion('2026-06-13', null, null);
    const ej = await saveEjercicio('Dominadas', 'Espalda');
    const serie = await saveSerie(sesion.id, ej.id, 1, 0, 10);
    expect(Number(serie.peso)).toBe(0);
    const ultima = await getUltimaSerie(ej.id);
    expect(Number(ultima.peso)).toBe(0);
  });

  it('deleteSerie elimina la serie por id', async () => {
    const sesion = await saveSesion('2026-06-14', null, null);
    const ej     = await saveEjercicio('Press Banca', 'Pecho');
    const serie  = await saveSerie(sesion.id, ej.id, 1, 80, 5);
    await deleteSerie(serie.id);
    const result = await getSeriesDeSesionEjercicio(sesion.id, ej.id);
    expect(result).toHaveLength(0);
  });

  it('getSeriesPorEjercicio retorna series con fecha de sesión', async () => {
    const sesion = await saveSesion('2026-06-13', null, null);
    const ej = await saveEjercicio('Press Banca', 'Pecho');
    await saveSerie(sesion.id, ej.id, 1, 60, 10);
    await saveSerie(sesion.id, ej.id, 2, 60, 8);
    const series = await getSeriesPorEjercicio(ej.id);
    expect(series.length).toBe(2);
    expect(series[0].fecha).toBeDefined();
  });
});

// ── Conf ──────────────────────────────────────────────────────────────────────

describe('conf', () => {
  it('getConf retorna la fila singleton con pref_unit por defecto "lb"', async () => {
    const conf = await getConf();
    expect(conf.id).toBe(1);
    expect(conf.pref_unit).toBe('lb');
  });

  it('updatePrefUnit cambia la unidad a kg', async () => {
    await updatePrefUnit('kg');
    const conf = await getConf();
    expect(conf.pref_unit).toBe('kg');
  });

  it('updatePrefUnit rechaza un valor inválido ANTES de llegar a SQL', async () => {
    await expect(updatePrefUnit('invalid')).rejects.toThrow('inválida');
  });

  it('intentar insertar segunda fila en conf lanza error de constraint', async () => {
    const db = (await import('../js/db.js')).getDB();
    await expect(
      db.query("INSERT INTO conf (id, pref_unit) VALUES (1, 'kg')")
    ).rejects.toThrow();
  });

  it('updatePrefAcento persiste la clave de acento', async () => {
    await updatePrefAcento('morado');
    const conf = await getConf();
    expect(conf.pref_acento).toBe('morado');
  });

  it('no existe función deleteConf en el módulo', async () => {
    const mod = await import('../js/db.js');
    expect(mod.deleteConf).toBeUndefined();
  });
});

// ── getSeriesDeSesionEjercicio ────────────────────────────────────────────────

describe('getSeriesDeSesionEjercicio', () => {
  it('devuelve solo las series de la sesión y ejercicio indicados', async () => {
    const rutina = await saveRutina('Pecho', 1);
    const ej1    = await saveEjercicio('Press Banca', 'Pecho');
    const ej2    = await saveEjercicio('Aperturas', 'Pecho');
    const s1     = await saveSesion('2026-06-14', rutina.id, null);
    const s2     = await saveSesion('2026-06-13', rutina.id, null);

    await saveSerie(s1.id, ej1.id, 1, 70, 10);
    await saveSerie(s1.id, ej1.id, 2, 70, 8);
    await saveSerie(s1.id, ej2.id, 1, 30, 12); // otro ejercicio, no debe aparecer
    await saveSerie(s2.id, ej1.id, 1, 60, 10); // otra sesión, no debe aparecer

    const result = await getSeriesDeSesionEjercicio(s1.id, ej1.id);

    expect(result.length).toBe(2);
    expect(result[0].numero_serie).toBe(1);
    expect(result[1].numero_serie).toBe(2);
    expect(result.every(r => r.sesion_id === s1.id)).toBe(true);
    expect(result.every(r => r.ejercicio_id === ej1.id)).toBe(true);
  });

  it('devuelve array vacío si no hay series para esa sesión+ejercicio', async () => {
    const rutina = await saveRutina('Espalda', 2);
    const ej     = await saveEjercicio('Dominadas', 'Espalda');
    const sesion = await saveSesion('2026-06-14', rutina.id, null);

    const result = await getSeriesDeSesionEjercicio(sesion.id, ej.id);
    expect(result).toEqual([]);
  });
});
