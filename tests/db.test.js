import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  getEjercicios, saveEjercicio,
  getRutinas, saveRutina, getRutinaEjercicios, updateActivoHoy, updateRutinaDia, clearRutinaDia,
  saveSesion, getSesionDelDia,
  saveSerie, getUltimaSerie, getSeriesPorEjercicio, getSeriesDeSesionEjercicio,
  getConf, updatePrefUnit,
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

  it('clearRutinaDia deja el día sin rutina asignada', async () => {
    const rutina = await saveRutina('Espalda', 3);     // miércoles
    await clearRutinaDia(3);
    const todas = await getRutinas();
    const actual = todas.find(r => r.id === rutina.id);
    expect(actual.dia_sugerido).toBeNull();
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
