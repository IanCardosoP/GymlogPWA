import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  getEjercicios, saveEjercicio, getOrCreateEjercicio, updateEjercicioNombre, deleteEjercicio, removeEjercicioDeRutina,
  getRutinas, saveRutina, getRutinaEjercicios, updateActivoHoy, updateRutinaDia, clearRutinaDia, swapOrden,
  reordenarEjercicios, linkEjercicioToRutina,
  getRutinasDias, addRutinaDia, removeRutinaDia, updateRutinaNombre, deleteRutina,
  saveSesion, getSesionDelDia, touchSesionTiempo, resetSesionTiempoIfVacia,
  saveSerie, deleteSerie, renumerarSeries, getUltimaSerie, getSeriesPorEjercicio, getSeriesDeSesionEjercicio,
  getConf, updatePrefUnit, updatePrefAcento, getOrCreateDeviceId,
  getEstadisticasGlobales, getActividadSemanal, getVolumenPorGrupoMuscular,
  getPesoMaxPorEjercicio, getVolumenPorSesion,
  getFechasConSesiones, getSesionesConSeriesEnRango,
  getEjerciciosPendientesRevision, vincularEjercicioCatalogo, descartarSugerenciaCatalogo,
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

  it('updateEjercicioNombre sin tercer argumento no cambia grupo_muscular', async () => {
    const ej = await saveEjercicio('Curl Bíceps', 'BRAZO');
    const updated = await updateEjercicioNombre(ej.id, 'Curl Martillo');
    expect(updated.nombre).toBe('Curl Martillo');
    expect(updated.grupo_muscular).toBe('BRAZO');
  });

  it('updateEjercicioNombre con tercer argumento actualiza nombre y grupo_muscular', async () => {
    const ej = await saveEjercicio('Peso Muerto', 'GENERAL');
    const updated = await updateEjercicioNombre(ej.id, 'Peso Muerto Rumano', 'ESPALDA');
    expect(updated.nombre).toBe('Peso Muerto Rumano');
    expect(updated.grupo_muscular).toBe('ESPALDA');
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

  it('reordenarEjercicios persiste el nuevo orden secuencial 1..N', async () => {
    const rutina = await saveRutina('Pierna', 2);
    const ej1 = await saveEjercicio('Sentadilla', 'PIERNA');
    const ej2 = await saveEjercicio('Leg Press',  'PIERNA');
    const ej3 = await saveEjercicio('Prensa',     'PIERNA');
    const { id: re1 } = await linkEjercicioToRutina(rutina.id, ej1.id, 1);
    const { id: re2 } = await linkEjercicioToRutina(rutina.id, ej2.id, 2);
    const { id: re3 } = await linkEjercicioToRutina(rutina.id, ej3.id, 3);

    // Orden barajado: el último pasa al frente, el primero al fondo
    await reordenarEjercicios(rutina.id, [re3, re2, re1]);

    const lista = await getRutinaEjercicios(rutina.id);
    expect(lista.map(r => r.ejercicio_id)).toEqual([ej3.id, ej2.id, ej1.id]);
    expect(lista.map(r => r.orden)).toEqual([1, 2, 3]);
  });

  it('reordenarEjercicios sincroniza activo_hoy: TRUE los primeros 8, FALSE los suplentes', async () => {
    const rutina = await saveRutina('Full Body', 4);
    const reIds = [];
    for (let i = 1; i <= 10; i++) {
      const ej = await saveEjercicio(`Ejercicio ${i}`, 'GENERAL');
      const { id } = await linkEjercicioToRutina(rutina.id, ej.id, i);
      reIds.push(id);
    }

    // El último (suplente) sube al frente: desplaza al 8º a la zona de suplentes
    const nuevoOrden = [reIds[9], ...reIds.slice(0, 9)];
    await reordenarEjercicios(rutina.id, nuevoOrden);

    const lista = await getRutinaEjercicios(rutina.id);
    expect(lista.map(r => r.id)).toEqual(nuevoOrden);
    expect(lista.slice(0, 8).every(r => r.activo_hoy === true)).toBe(true);
    expect(lista.slice(8).every(r => r.activo_hoy === false)).toBe(true);
  });

  it('reordenarEjercicios ignora ids que no pertenecen a la rutina', async () => {
    const rutinaA = await saveRutina('A', 5);
    const rutinaB = await saveRutina('B', 6);
    const ejA = await saveEjercicio('Curl',  'BRAZO');
    const ejB = await saveEjercicio('Press', 'HOMBRO');
    const { id: reA } = await linkEjercicioToRutina(rutinaA.id, ejA.id, 1);
    const { id: reB } = await linkEjercicioToRutina(rutinaB.id, ejB.id, 7);

    // reB no pertenece a rutinaA: su orden no debe cambiar
    await reordenarEjercicios(rutinaA.id, [reB, reA]);

    const listaB = await getRutinaEjercicios(rutinaB.id);
    expect(listaB[0].orden).toBe(7);
    const listaA = await getRutinaEjercicios(rutinaA.id);
    expect(listaA[0].orden).toBe(2);
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

  it('renumerarSeries reordena las series consecutivamente tras un borrado', async () => {
    const sesion = await saveSesion('2026-06-14', null, null);
    const ej     = await saveEjercicio('Sentadilla', 'Pierna');
    const s1     = await saveSerie(sesion.id, ej.id, 1, 100, 5);
    const s2     = await saveSerie(sesion.id, ej.id, 2, 100, 5);
    await saveSerie(sesion.id, ej.id, 3, 100, 5);

    await deleteSerie(s1.id);
    await renumerarSeries(sesion.id, ej.id);

    const result = await getSeriesDeSesionEjercicio(sesion.id, ej.id);
    expect(result).toHaveLength(2);
    expect(result[0].numero_serie).toBe(1);
    expect(result[0].id).toBe(s2.id);
    expect(result[1].numero_serie).toBe(2);
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

  it('getOrCreateDeviceId genera un UUID válido en la primera llamada', async () => {
    const id = await getOrCreateDeviceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('getOrCreateDeviceId es idempotente: la segunda llamada devuelve el mismo id', async () => {
    const primero  = await getOrCreateDeviceId();
    const segundo  = await getOrCreateDeviceId();
    expect(segundo).toBe(primero);
    const conf = await getConf();
    expect(conf.device_id).toBe(primero);
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

// ── getOrCreateEjercicio ──────────────────────────────────────────────────────

describe('getOrCreateEjercicio', () => {
  it('crea un ejercicio nuevo si el nombre no existe', async () => {
    const ej = await getOrCreateEjercicio('Sentadilla', 'Pierna');
    expect(ej.id).toBeDefined();
    expect(ej.nombre).toBe('Sentadilla');
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
  });

  it('retorna el existente en match exacto sin crear duplicado', async () => {
    const original = await saveEjercicio('Press Banca', 'Pecho');
    const result   = await getOrCreateEjercicio('Press Banca', 'Pecho');
    expect(result.id).toBe(original.id);
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
  });

  it('retorna el existente en match case-insensitive', async () => {
    const original = await saveEjercicio('Press Banca', 'Pecho');
    const result   = await getOrCreateEjercicio('press BANCA', 'Pecho');
    expect(result.id).toBe(original.id);
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
  });

  it('no crea duplicado si se llama dos veces con el mismo nombre', async () => {
    await getOrCreateEjercicio('Extensión de pierna', 'Pierna');
    await getOrCreateEjercicio('Extensión de pierna', 'Pierna');
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
  });
});

// ── removeEjercicioDeRutina ───────────────────────────────────────────────────

describe('removeEjercicioDeRutina', () => {
  it('elimina el ejercicio del diccionario si no queda en ninguna rutina', async () => {
    const db     = (await import('../js/db.js')).getDB();
    const rutina = await saveRutina('Pierna', 3);
    const ej     = await saveEjercicio('Extensión de pierna', 'Pierna');
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1)',
      [rutina.id, ej.id]
    );
    await removeEjercicioDeRutina(rutina.id, ej.id);
    const todos = await getEjercicios();
    expect(todos.length).toBe(0);
  });

  it('mantiene el ejercicio en el diccionario si aún vive en otra rutina', async () => {
    const db      = (await import('../js/db.js')).getDB();
    const rutinaA = await saveRutina('Pierna', 3);
    const rutinaB = await saveRutina('Pierna Ligera', 6);
    const ej      = await saveEjercicio('Extensión de pierna', 'Pierna');
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1)',
      [rutinaA.id, ej.id]
    );
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1)',
      [rutinaB.id, ej.id]
    );
    await removeEjercicioDeRutina(rutinaA.id, ej.id);
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
    const reB = await getRutinaEjercicios(rutinaB.id);
    expect(reB.some(r => r.ejercicio_id === ej.id)).toBe(true);
  });

  it('elimina también las series cuando el ejercicio queda huérfano', async () => {
    const db     = (await import('../js/db.js')).getDB();
    const rutina = await saveRutina('Pierna', 3);
    const ej     = await saveEjercicio('Extensión de pierna', 'Pierna');
    const sesion = await saveSesion('2026-06-21', rutina.id, null);
    await saveSerie(sesion.id, ej.id, 1, 50, 12);
    await db.query(
      'INSERT INTO rutina_ejercicios (rutina_id, ejercicio_id, orden) VALUES ($1, $2, 1)',
      [rutina.id, ej.id]
    );
    await removeEjercicioDeRutina(rutina.id, ej.id);
    const todos = await getEjercicios();
    expect(todos.length).toBe(0);
    const series = await getSeriesPorEjercicio(ej.id);
    expect(series.length).toBe(0);
  });
});

// ── getEstadisticasGlobales ───────────────────────────────────────────────────

describe('getEstadisticasGlobales', () => {
  it('retorna ceros con la BD vacía', async () => {
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.total_sesiones).toBe(0);
    expect(stats.volumen_total).toBe(0);
    expect(stats.sesiones_4_sem).toBe(0);
    expect(stats.fechas).toEqual([]);
  });

  it('cuenta sesiones totales correctamente', async () => {
    const ej = await saveEjercicio('Press Banca', 'PECHO');
    const s1 = await saveSesion('2026-06-19', null, null);
    await saveSerie(s1.id, ej.id, 1, 80, 10);
    const s2 = await saveSesion('2026-06-20', null, null);
    await saveSerie(s2.id, ej.id, 1, 80, 10);
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.total_sesiones).toBe(2);
  });

  it('no cuenta sesiones sin series registradas', async () => {
    await saveSesion('2026-06-19', null, null); // sesión vacía — no debe contar
    const ej  = await saveEjercicio('Sentadilla', 'PIERNA');
    const ses = await saveSesion('2026-06-20', null, null);
    await saveSerie(ses.id, ej.id, 1, 100, 5);
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.total_sesiones).toBe(1);
  });

  it('suma el volumen de todas las series', async () => {
    const ej  = await saveEjercicio('Press Banca', 'PECHO');
    const ses = await saveSesion('2026-06-21', null, null);
    await saveSerie(ses.id, ej.id, 1, 80, 10);   // 800
    await saveSerie(ses.id, ej.id, 2, 80, 8);    // 640 → total 1440
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.volumen_total).toBeCloseTo(1440);
  });

  it('devuelve las fechas de sesiones en orden descendente', async () => {
    const ej = await saveEjercicio('Dominadas', 'ESPALDA');
    const s1 = await saveSesion('2026-06-19', null, null);
    await saveSerie(s1.id, ej.id, 1, 0, 8);
    const s2 = await saveSesion('2026-06-21', null, null);
    await saveSerie(s2.id, ej.id, 1, 0, 10);
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.fechas[0]).toBe('2026-06-21');
    expect(stats.fechas[1]).toBe('2026-06-19');
  });

  it('sesiones_4_sem solo cuenta sesiones con series en los últimos 28 días', async () => {
    const ej   = await saveEjercicio('Curl', 'BRAZO');
    const old  = await saveSesion('2026-05-01', null, null); // fuera del rango
    await saveSerie(old.id, ej.id, 1, 15, 12);
    const s2   = await saveSesion('2026-06-10', null, null); // dentro
    await saveSerie(s2.id, ej.id, 1, 15, 12);
    const s3   = await saveSesion('2026-06-21', null, null); // dentro
    await saveSerie(s3.id, ej.id, 1, 15, 12);
    await saveSesion('2026-06-15', null, null);              // vacía — no cuenta
    const stats = await getEstadisticasGlobales('2026-06-21');
    expect(stats.sesiones_4_sem).toBe(2);
    expect(stats.total_sesiones).toBe(3);
  });
});

// ── getActividadSemanal ───────────────────────────────────────────────────────

describe('getActividadSemanal', () => {
  it('retorna array vacío sin sesiones', async () => {
    const rows = await getActividadSemanal('2026-06-21', 8);
    expect(rows).toEqual([]);
  });

  it('agrupa sesiones por semana (lunes)', async () => {
    const ej = await saveEjercicio('Press Militar', 'HOMBRO');
    const s1 = await saveSesion('2026-06-16', null, null); // lunes
    await saveSerie(s1.id, ej.id, 1, 60, 8);
    const s2 = await saveSesion('2026-06-17', null, null); // martes — misma semana
    await saveSerie(s2.id, ej.id, 1, 60, 8);
    const s3 = await saveSesion('2026-06-23', null, null); // lunes siguiente
    await saveSerie(s3.id, ej.id, 1, 60, 8);
    await saveSesion('2026-06-18', null, null);            // sesión vacía — no debe contar
    const rows = await getActividadSemanal('2026-06-23', 8);
    expect(rows.length).toBe(2);
    expect(rows[0].sesiones).toBe(2);
    expect(rows[1].sesiones).toBe(1);
  });
});

// ── getVolumenPorGrupoMuscular ────────────────────────────────────────────────

describe('getVolumenPorGrupoMuscular', () => {
  it('retorna array vacío sin series', async () => {
    const rows = await getVolumenPorGrupoMuscular('2026-06-21', 4);
    expect(rows).toEqual([]);
  });

  it('agrupa volumen por grupo muscular', async () => {
    const ejPecho  = await saveEjercicio('Press Banca', 'PECHO');
    const ejPierna = await saveEjercicio('Sentadilla', 'PIERNA');
    const ses = await saveSesion('2026-06-21', null, null);
    await saveSerie(ses.id, ejPecho.id, 1, 80, 10);   // PECHO 800
    await saveSerie(ses.id, ejPierna.id, 1, 100, 5);  // PIERNA 500

    const rows = await getVolumenPorGrupoMuscular('2026-06-21', 4);
    const pecho  = rows.find(r => r.grupo_muscular === 'PECHO');
    const pierna = rows.find(r => r.grupo_muscular === 'PIERNA');
    expect(pecho?.volumen).toBeCloseTo(800);
    expect(pierna?.volumen).toBeCloseTo(500);
  });

  it('excluye sesiones fuera del rango de semanas', async () => {
    const ej  = await saveEjercicio('Press', 'PECHO');
    const old = await saveSesion('2026-04-01', null, null);
    await saveSerie(old.id, ej.id, 1, 100, 10); // fuera del rango

    const rows = await getVolumenPorGrupoMuscular('2026-06-21', 4);
    expect(rows).toEqual([]);
  });
});

// ── getPesoMaxPorEjercicio ────────────────────────────────────────────────────

describe('getPesoMaxPorEjercicio', () => {
  it('retorna array vacío sin series', async () => {
    const rows = await getPesoMaxPorEjercicio();
    expect(rows).toEqual([]);
  });

  it('retorna el mayor peso real por ejercicio', async () => {
    const ej  = await saveEjercicio('Press Banca', 'PECHO');
    const s1  = await saveSesion('2026-06-01', null, null);
    const s2  = await saveSesion('2026-06-15', null, null);
    await saveSerie(s1.id, ej.id, 1, 80, 10); // peso 80
    await saveSerie(s2.id, ej.id, 1, 90, 5);  // peso 90 — es el mayor
    const rows = await getPesoMaxPorEjercicio();
    expect(rows.length).toBe(1);
    expect(rows[0].peso_max).toBe(90);
    expect(rows[0].fecha_pr).toBe('2026-06-15'); // fecha donde se levantó el mayor peso
  });

  it('ignora series de peso cero (BW)', async () => {
    const ej  = await saveEjercicio('Dominadas', 'ESPALDA');
    const ses = await saveSesion('2026-06-21', null, null);
    await saveSerie(ses.id, ej.id, 1, 0, 10); // BW — debe ignorarse
    const rows = await getPesoMaxPorEjercicio();
    expect(rows).toEqual([]);
  });
});

// ── getVolumenPorSesion ───────────────────────────────────────────────────────

describe('getVolumenPorSesion', () => {
  it('retorna array vacío sin series', async () => {
    const ej = await saveEjercicio('Press Banca', 'PECHO');
    const rows = await getVolumenPorSesion(ej.id);
    expect(rows).toEqual([]);
  });

  it('suma volumen por sesión para el ejercicio dado', async () => {
    const ej = await saveEjercicio('Press Banca', 'PECHO');
    const s1 = await saveSesion('2026-06-01', null, null);
    const s2 = await saveSesion('2026-06-08', null, null);
    await saveSerie(s1.id, ej.id, 1, 80, 10); // 800
    await saveSerie(s1.id, ej.id, 2, 80, 8);  // 640 → 1440
    await saveSerie(s2.id, ej.id, 1, 85, 8);  // 680
    const rows = await getVolumenPorSesion(ej.id);
    expect(rows.length).toBe(2);
    expect(rows[0].volumen).toBeCloseTo(1440);
    expect(rows[1].volumen).toBeCloseTo(680);
  });

  it('no incluye series de otros ejercicios', async () => {
    const ej1 = await saveEjercicio('Press Banca', 'PECHO');
    const ej2 = await saveEjercicio('Aperturas', 'PECHO');
    const ses = await saveSesion('2026-06-21', null, null);
    await saveSerie(ses.id, ej1.id, 1, 80, 10);
    await saveSerie(ses.id, ej2.id, 1, 30, 12);
    const rows = await getVolumenPorSesion(ej1.id);
    expect(rows.length).toBe(1);
    expect(rows[0].volumen).toBeCloseTo(800);
  });
});

// ── getFechasConSesiones ──────────────────────────────────────────────────────

describe('getFechasConSesiones', () => {
  it('retorna array vacío sin sesiones', async () => {
    const fechas = await getFechasConSesiones();
    expect(fechas).toEqual([]);
  });

  it('excluye sesiones sin series y ordena descendente', async () => {
    const ej = await saveEjercicio('Sentadilla', 'PIERNA');
    await saveSesion('2026-06-18', null, null); // vacía — no debe aparecer
    const s1 = await saveSesion('2026-06-19', null, null);
    await saveSerie(s1.id, ej.id, 1, 100, 5);
    const s2 = await saveSesion('2026-06-21', null, null);
    await saveSerie(s2.id, ej.id, 1, 100, 5);
    const fechas = await getFechasConSesiones();
    expect(fechas).toEqual(['2026-06-21', '2026-06-19']);
  });
});

// ── getSesionesConSeriesEnRango ───────────────────────────────────────────────

describe('getSesionesConSeriesEnRango', () => {
  it('retorna array vacío para un rango sin sesiones', async () => {
    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    expect(rows).toEqual([]);
  });

  it('retorna array vacío para una sesión sin series', async () => {
    await saveSesion('2026-06-21', null, null);
    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    expect(rows).toEqual([]);
  });

  it('incluye los dos extremos del rango (BETWEEN inclusive)', async () => {
    const ej  = await saveEjercicio('Sentadilla', 'PIERNA');
    const s1  = await saveSesion('2026-06-01', null, null);
    await saveSerie(s1.id, ej.id, 1, 100, 5);
    const s2  = await saveSesion('2026-06-30', null, null);
    await saveSerie(s2.id, ej.id, 1, 100, 5);

    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    const sesionIds = new Set(rows.map(r => r.sesion_id));
    expect(sesionIds).toEqual(new Set([s1.id, s2.id]));
  });

  it('excluye fechas fuera del rango', async () => {
    const ej = await saveEjercicio('Peso Muerto', 'ESPALDA');
    const fuera = await saveSesion('2026-05-31', null, null);
    await saveSerie(fuera.id, ej.id, 1, 120, 5);

    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    expect(rows).toEqual([]);
  });

  it('trae rutina_id y las series con nombre de ejercicio de cada sesión', async () => {
    const rutina = await saveRutina('Push Day', null);
    const ej1 = await saveEjercicio('Press Banca', 'PECHO');
    const ej2 = await saveEjercicio('Press Militar', 'HOMBRO');
    const ses = await saveSesion('2026-06-21', rutina.id, null);
    await saveSerie(ses.id, ej1.id, 1, 80, 10);
    await saveSerie(ses.id, ej1.id, 2, 80, 8);
    await saveSerie(ses.id, ej2.id, 1, 40, 12);

    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    expect(rows.length).toBe(3);
    expect(rows.every(r => r.sesion_id === ses.id)).toBe(true);
    expect(rows.every(r => r.rutina_id === rutina.id)).toBe(true);
    expect(rows.every(r => r.rutina_nombre === 'Push Day')).toBe(true);
    expect(rows.filter(r => r.ejercicio_nombre === 'Press Banca').length).toBe(2);
    expect(rows.filter(r => r.ejercicio_nombre === 'Press Militar').length).toBe(1);
  });

  it('incluye varias sesiones en fechas distintas dentro del rango', async () => {
    const ej  = await saveEjercicio('Curl', 'BRAZO');
    const s1  = await saveSesion('2026-06-05', null, null);
    await saveSerie(s1.id, ej.id, 1, 15, 12);
    const s2  = await saveSesion('2026-06-12', null, null);
    await saveSerie(s2.id, ej.id, 1, 15, 12);

    const rows = await getSesionesConSeriesEnRango('2026-06-01', '2026-06-30');
    const sesionIds = new Set(rows.map(r => r.sesion_id));
    expect(sesionIds.size).toBe(2);
    expect(sesionIds).toEqual(new Set([s1.id, s2.id]));
  });
});

// ── resetSesionTiempoIfVacia ──────────────────────────────────────────────────

describe('resetSesionTiempoIfVacia', () => {
  it('resetea hora_inicio y hora_fin cuando la sesión queda sin series', async () => {
    const ses = await saveSesion('2026-06-23', null, null);
    await touchSesionTiempo(ses.id);
    const ej  = await saveEjercicio('Press', 'PECHO');
    const s   = await saveSerie(ses.id, ej.id, 1, 80, 10);
    await deleteSerie(s.id);
    await resetSesionTiempoIfVacia(ses.id);

    const db = (await import('../js/db.js')).getDB();
    const { rows: [row] } = await db.query(
      'SELECT hora_inicio, hora_fin FROM sesiones WHERE id = $1', [ses.id]
    );
    expect(row.hora_inicio).toBeNull();
    expect(row.hora_fin).toBeNull();
  });

  it('NO resetea si la sesión aún tiene series', async () => {
    const ses = await saveSesion('2026-06-23', null, null);
    const ej  = await saveEjercicio('Press', 'PECHO');
    await saveSerie(ses.id, ej.id, 1, 80, 10);
    const s2  = await saveSerie(ses.id, ej.id, 2, 80, 8);
    await touchSesionTiempo(ses.id);
    await deleteSerie(s2.id); // elimina solo la 2ª, queda la 1ª
    await resetSesionTiempoIfVacia(ses.id);

    const db = (await import('../js/db.js')).getDB();
    const { rows: [row] } = await db.query(
      'SELECT hora_inicio FROM sesiones WHERE id = $1', [ses.id]
    );
    expect(row.hora_inicio).not.toBeNull();
  });
});

// ── Vínculo con el catálogo estático ─────────────────────────────────────────

describe('vínculo con catálogo (catalogo_id / catalogo_revisado)', () => {
  it('getOrCreateEjercicio sin catalogoId crea fila sin vínculo, pendiente de revisión', async () => {
    const ej = await getOrCreateEjercicio('Mi ejercicio raro', 'GENERAL');
    expect(ej.catalogo_id).toBeNull();
    expect(ej.catalogo_revisado).toBe(false);
  });

  it('getOrCreateEjercicio con catalogoId crea fila vinculada y ya revisada', async () => {
    const ej = await getOrCreateEjercicio('Prensa de pierna', 'PIERNA', 'Leg_Press');
    expect(ej.catalogo_id).toBe('Leg_Press');
    expect(ej.catalogo_revisado).toBe(true);
  });

  it('getOrCreateEjercicio completa el vínculo de una fila existente sin catalogo_id', async () => {
    const original = await saveEjercicio('Prensa de pierna', 'PIERNA');
    expect(original.catalogo_id ?? null).toBeNull();
    const result = await getOrCreateEjercicio('prensa de PIERNA', 'PIERNA', 'Leg_Press');
    expect(result.id).toBe(original.id);
    expect(result.catalogo_id).toBe('Leg_Press');
    const todos = await getEjercicios();
    expect(todos.length).toBe(1);
  });

  it('getOrCreateEjercicio NO pisa un vínculo existente distinto', async () => {
    await getOrCreateEjercicio('Prensa de pierna', 'PIERNA', 'Leg_Press');
    const result = await getOrCreateEjercicio('Prensa de pierna', 'PIERNA', 'Otro_Id');
    expect(result.catalogo_id).toBe('Leg_Press');
  });

  it('getEjerciciosPendientesRevision solo lista filas no revisadas', async () => {
    await saveEjercicio('Ejercicio viejo A', 'PECHO');
    await saveEjercicio('Ejercicio viejo B', 'ESPALDA');
    await getOrCreateEjercicio('Del catálogo', 'PIERNA', 'Leg_Press');
    const pendientes = await getEjerciciosPendientesRevision();
    expect(pendientes.map(e => e.nombre)).toEqual(['Ejercicio viejo A', 'Ejercicio viejo B']);
  });

  it('vincularEjercicioCatalogo asigna el puntero y saca la fila de pendientes', async () => {
    const ej = await saveEjercicio('Press banca', 'PECHO');
    const upd = await vincularEjercicioCatalogo(ej.id, 'Barbell_Bench_Press_-_Medium_Grip');
    expect(upd.catalogo_id).toBe('Barbell_Bench_Press_-_Medium_Grip');
    expect(upd.catalogo_revisado).toBe(true);
    expect(await getEjerciciosPendientesRevision()).toEqual([]);
  });

  it('descartarSugerenciaCatalogo marca revisado sin tocar catalogo_id ni grupo_muscular', async () => {
    const ej = await saveEjercicio('Mi invento', 'CORE');
    const upd = await descartarSugerenciaCatalogo(ej.id);
    expect(upd.catalogo_id).toBeNull();
    expect(upd.catalogo_revisado).toBe(true);
    expect(upd.grupo_muscular).toBe('CORE');
    // Un ejercicio rechazado no vuelve a aparecer como pendiente
    expect(await getEjerciciosPendientesRevision()).toEqual([]);
  });
});
