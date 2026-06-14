import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  saveRutina, saveEjercicio, saveSesion, saveSerie,
  getSeriesPorEjercicio, getAllSeriesForExport, getDB,
} from '../js/db.js';
import { calculateEpley1RM } from '../js/analitico.js';
import { exportarCSV, importarCSV, CSV_HEADERS } from '../js/csv.js';

beforeEach(async () => {
  await initDB('memory://');
});

// ── Flujo completo de entrenamiento ──────────────────────────────────────────

describe('flujo completo: rutina → sesión → serie → 1RM', () => {
  it('encadena todas las capas y calcula 1RM correcto', async () => {
    const rutina   = await saveRutina('Pecho + Tríceps', 1);
    const ejercicio = await saveEjercicio('Press Banca', 'Pecho');
    const sesion   = await saveSesion('2026-06-13', rutina.id, 4);

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
    const rutina   = await saveRutina('Calistenia', 2);
    const ejercicio = await saveEjercicio('Dominadas', 'Espalda');
    const sesion   = await saveSesion('2026-06-13', rutina.id, 3);

    await saveSerie(sesion.id, ejercicio.id, 1, 0, 12);

    const series = await getSeriesPorEjercicio(ejercicio.id);
    const rm1 = calculateEpley1RM(Number(series[0].peso), series[0].repeticiones);
    expect(rm1).toBe(0);
    expect(Number.isNaN(rm1)).toBe(false);
    expect(Number.isFinite(rm1) || rm1 === 0).toBe(true);
  });
});

// ── Flujo CSV con ROLLBACK ────────────────────────────────────────────────────

describe('flujo CSV: exportar → corromper → importar → ROLLBACK → DB intacta', () => {
  it('el ROLLBACK impide que se inserten datos de un CSV corrupto', async () => {
    // Insertar 1 serie real
    const rutina   = await saveRutina('Test', 0);
    const ejercicio = await saveEjercicio('Sentadilla', 'Pierna');
    const sesion   = await saveSesion('2026-06-13', rutina.id, 3);
    await saveSerie(sesion.id, ejercicio.id, 1, 80, 5);

    // Exportar
    const datos = await getAllSeriesForExport();
    expect(datos.length).toBe(1);
    const csvOriginal = exportarCSV(datos);
    expect(csvOriginal.split('\n')[0]).toBe(CSV_HEADERS);

    // Corromper la columna "peso"
    const lineas = csvOriginal.split('\n');
    const cols   = lineas[1].split(',');
    cols[5]      = 'CORRUPTO';
    lineas[1]    = cols.join(',');
    const csvCorrupto = lineas.join('\n');

    // Intentar importar el CSV corrupto en el mismo DB
    const dbInst  = getDB();
    const resultado = await importarCSV(csvCorrupto, dbInst);

    expect(resultado.exitosas).toBe(0);
    expect(resultado.error).toBeTruthy();

    // La DB sigue teniendo solo la 1 serie original (ROLLBACK = no se añadió nada)
    const { rows } = await dbInst.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(1);
  });

  it('importar CSV válido después de uno corrupto deja la DB correcta', async () => {
    const csvValido = `${CSV_HEADERS}\n2026-06-14,Pecho,Press Banca,Pecho,1,60,10,,4`;
    const csvCorrupto = `${CSV_HEADERS}\n2026-06-14,Pecho,Press Banca,Pecho,1,XXX,10,,4`;

    const dbInst = getDB();

    const r1 = await importarCSV(csvCorrupto, dbInst);
    expect(r1.exitosas).toBe(0);

    const r2 = await importarCSV(csvValido, dbInst);
    expect(r2.exitosas).toBe(1);
    expect(r2.error).toBeNull();

    const { rows } = await dbInst.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(1);
  });
});
