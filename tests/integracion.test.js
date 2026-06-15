import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  saveRutina, saveEjercicio, saveSesion, saveSerie,
  getSeriesPorEjercicio, getAllDataForExport, getDB,
} from '../js/db.js';
import { calculateEpley1RM } from '../js/analitico.js';
import { exportarBackup, importarBackup } from '../js/csv.js';

beforeEach(async () => {
  await initDB('memory://');
});

// ── Flujo completo de entrenamiento ──────────────────────────────────────────

describe('flujo completo: rutina → sesión → serie → 1RM', () => {
  it('encadena todas las capas y calcula 1RM correcto', async () => {
    const rutina    = await saveRutina('Pecho + Tríceps', 1);
    const ejercicio = await saveEjercicio('Press Banca', 'Pecho');
    const sesion    = await saveSesion('2026-06-13', rutina.id, 4);

    await saveSerie(sesion.id, ejercicio.id, 1, 60, 10);
    await saveSerie(sesion.id, ejercicio.id, 2, 60, 8);
    await saveSerie(sesion.id, ejercicio.id, 3, 60, 7);

    const series = await getSeriesPorEjercicio(ejercicio.id);
    expect(series.length).toBe(3);
    expect(series[0].fecha).toBeDefined();

    const max1RM = Math.max(
      ...series.map(s => calculateEpley1RM(Number(s.peso), s.repeticiones))
    );
    const esperado = calculateEpley1RM(60, 10);
    expect(max1RM).toBeCloseTo(esperado, 2);
    expect(max1RM).toBeGreaterThan(60);
  });

  it('serie BW (peso=0) no rompe el cálculo de 1RM', async () => {
    const rutina    = await saveRutina('Calistenia', 2);
    const ejercicio = await saveEjercicio('Dominadas', 'Espalda');
    const sesion    = await saveSesion('2026-06-13', rutina.id, 3);

    await saveSerie(sesion.id, ejercicio.id, 1, 0, 12);

    const series = await getSeriesPorEjercicio(ejercicio.id);
    const rm1 = calculateEpley1RM(Number(series[0].peso), series[0].repeticiones);
    expect(rm1).toBe(0);
    expect(Number.isNaN(rm1)).toBe(false);
    expect(Number.isFinite(rm1) || rm1 === 0).toBe(true);
  });
});

// ── Flujo backup JSON con ROLLBACK ────────────────────────────────────────────

describe('flujo backup: exportar → importar corrupto → ROLLBACK → DB intacta', () => {
  it('ROLLBACK ante JSON inválido deja la DB con los datos originales', async () => {
    const rutina    = await saveRutina('Test', 0);
    const ejercicio = await saveEjercicio('Sentadilla', 'Pierna');
    const sesion    = await saveSesion('2026-06-13', rutina.id, 3);
    await saveSerie(sesion.id, ejercicio.id, 1, 80, 5);

    // Exportar backup válido
    const datos = await getAllDataForExport();
    expect(datos.series.length).toBe(1);
    const jsonOriginal = exportarBackup(datos);
    const parsed = JSON.parse(jsonOriginal);
    expect(parsed.version).toBe(1);

    // Intentar importar JSON corrupto
    const dbInst = getDB();
    const resultado = await importarBackup('{ corrupto: verdad }', dbInst);
    expect(resultado.error).toBeTruthy();

    // DB sigue con los datos originales
    const { rows } = await dbInst.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(1);
  });

  it('importar backup válido después de uno corrupto deja la DB correcta', async () => {
    const dbInst = getDB();

    const r1 = await importarBackup('no es json', dbInst);
    expect(r1.error).toBeTruthy();

    const backupValido = {
      version: 1,
      conf: { pref_unit: 'lb', pref_acento: 'verde' },
      ejercicios: [{ id: 1, nombre: 'Press Banca', grupo_muscular: 'Pecho' }],
      rutinas: [{ id: 1, nombre: 'Pecho' }],
      rutina_ejercicios: [{ rutina_id: 1, ejercicio_id: 1, orden: 1, activo_hoy: true }],
      rutina_dias: [],
      sesiones: [{ id: 1, fecha: '2026-06-14', rutina_id: 1, energia_sueno: null, peso_corporal: null }],
      series: [{ sesion_id: 1, ejercicio_id: 1, numero_serie: 1, peso: 60, repeticiones: 10 }],
    };

    const r2 = await importarBackup(JSON.stringify(backupValido), dbInst);
    expect(r2.error).toBeNull();
    expect(r2.series).toBe(1);

    const { rows } = await dbInst.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(1);
  });
});
