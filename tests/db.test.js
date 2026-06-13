import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  getEjercicios, saveEjercicio,
  getRutinas, saveRutina, getRutinaEjercicios, updateActivoHoy,
  saveSesion, getSesionDelDia,
  saveSerie, getUltimaSerie, getSeriesPorEjercicio,
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
