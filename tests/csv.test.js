import { describe, it, expect, beforeEach } from 'vitest';
import { exportarBackup, importarBackup, BACKUP_VERSION } from '../js/csv.js';
import { initDB } from '../js/db.js';

let db;

beforeEach(async () => {
  db = await initDB('memory://');
});

// ── Exportación ───────────────────────────────────────────────────────────────

describe('exportarBackup', () => {
  it('retorna un JSON con los campos estructurales correctos', () => {
    const datos = {
      version: 1,
      exported_at: '2026-06-15',
      conf: { pref_unit: 'lb', pref_acento: 'verde' },
      ejercicios: [],
      rutinas: [],
      rutina_ejercicios: [],
      rutina_dias: [],
      sesiones: [],
      series: [],
    };
    const json = exportarBackup(datos);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed).toHaveProperty('conf');
    expect(parsed).toHaveProperty('ejercicios');
    expect(parsed).toHaveProperty('rutinas');
    expect(parsed).toHaveProperty('rutina_dias');
    expect(parsed).toHaveProperty('series');
  });
});

// ── Importación — errores de validación ──────────────────────────────────────

describe('importarBackup — JSON inválido', () => {
  it('retorna error sin tocar la DB', async () => {
    const r = await importarBackup('esto no es json', db);
    expect(r.error).toBeTruthy();
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM rutinas');
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('importarBackup — versión incompatible', () => {
  it('retorna error de versión', async () => {
    const r = await importarBackup(JSON.stringify({ version: 99 }), db);
    expect(r.error).toMatch(/incompatible/i);
  });
});

// ── Importación — datos completos ─────────────────────────────────────────────

const BACKUP_COMPLETO = {
  version: 1,
  exported_at: '2026-06-15',
  conf: { pref_unit: 'kg', pref_acento: 'morado' },
  ejercicios: [
    { id: 1, nombre: 'Press Banca', grupo_muscular: 'Pecho' },
    { id: 2, nombre: 'Sentadilla',  grupo_muscular: 'Piernas' },
  ],
  rutinas: [
    { id: 1, nombre: 'Push A' },
  ],
  rutina_ejercicios: [
    { rutina_id: 1, ejercicio_id: 1, orden: 1, activo_hoy: true },
    { rutina_id: 1, ejercicio_id: 2, orden: 2, activo_hoy: false },
  ],
  rutina_dias: [
    { rutina_id: 1, dia: 1 },
    { rutina_id: 1, dia: 3 },
  ],
  sesiones: [
    { id: 1, fecha: '2026-06-13', rutina_id: 1, energia_sueno: 4, peso_corporal: null },
  ],
  series: [
    { sesion_id: 1, ejercicio_id: 1, numero_serie: 1, peso: 60, repeticiones: 10 },
    { sesion_id: 1, ejercicio_id: 1, numero_serie: 2, peso: 65, repeticiones: 8 },
  ],
};

describe('importarBackup — backup completo', () => {
  it('retorna { error: null } con conteos correctos', async () => {
    const r = await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    expect(r.error).toBeNull();
    expect(r.rutinas).toBe(1);
    expect(r.ejercicios).toBe(2);
    expect(r.sesiones).toBe(1);
    expect(r.series).toBe(2);
  });

  it('restaura ejercicios sin series (Sentadilla no tiene series)', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows } = await db.query("SELECT nombre FROM ejercicios WHERE nombre = 'Sentadilla'");
    expect(rows.length).toBe(1);
  });

  it('restaura rutina_dias correctamente', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows } = await db.query('SELECT dia FROM rutina_dias WHERE rutina_id = 1 ORDER BY dia');
    expect(rows.map(r => r.dia)).toEqual([1, 3]);
  });

  it('restaura conf (pref_unit y pref_acento)', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows } = await db.query('SELECT pref_unit, pref_acento FROM conf WHERE id = 1');
    expect(rows[0].pref_unit).toBe('kg');
    expect(rows[0].pref_acento).toBe('morado');
  });

  it('restaura series y se pueden consultar', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(2);
  });

  it('segunda importación del mismo backup reemplaza sin duplicar', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows: rEj } = await db.query('SELECT COUNT(*) AS n FROM ejercicios');
    const { rows: rSe } = await db.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rEj[0].n)).toBe(2);
    expect(Number(rSe[0].n)).toBe(2);
  });

  it('tras restaurar, nuevos INSERTs no colisionan con IDs restaurados', async () => {
    await importarBackup(JSON.stringify(BACKUP_COMPLETO), db);
    const { rows } = await db.query(
      "INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ('Curl Bíceps', 'Brazos') RETURNING id"
    );
    expect(rows[0].id).toBeGreaterThan(2);
  });
});
