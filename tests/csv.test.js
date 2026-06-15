import { describe, it, expect, beforeEach } from 'vitest';
import { exportarCSV, importarCSV, CSV_HEADERS } from '../js/csv.js';
import { initDB } from '../js/db.js';

let db;

beforeEach(async () => {
  db = await initDB('memory://');
});

const FILA_VALIDA = '2026-06-13,Pecho,Press Banca,Pecho,1,60,10,,4';
const CSV_VALIDO = `${CSV_HEADERS}\n${FILA_VALIDA}`;

// ── Exportación ───────────────────────────────────────────────────────────────

describe('exportarCSV', () => {
  it('la primera línea del CSV exportado es exactamente CSV_HEADERS', () => {
    const datos = [
      { fecha: '2026-06-13', rutina_nombre: 'Pecho', ejercicio_nombre: 'Press Banca',
        grupo_muscular: 'Pecho', numero_serie: 1, peso: 60, repeticiones: 10,
        peso_corporal: null, energia_sueno: 4 },
    ];
    const csv = exportarCSV(datos);
    const primeraLinea = csv.split('\n')[0];
    expect(primeraLinea).toBe(CSV_HEADERS);
  });

  it('genera una línea de datos por cada objeto del array', () => {
    const datos = [
      { fecha: '2026-06-13', rutina_nombre: 'A', ejercicio_nombre: 'B',
        grupo_muscular: 'C', numero_serie: 1, peso: 0, repeticiones: 10,
        peso_corporal: null, energia_sueno: null },
      { fecha: '2026-06-14', rutina_nombre: 'A', ejercicio_nombre: 'B',
        grupo_muscular: 'C', numero_serie: 1, peso: 50, repeticiones: 8,
        peso_corporal: null, energia_sueno: null },
    ];
    const lineas = exportarCSV(datos).split('\n');
    expect(lineas.length).toBe(3); // headers + 2 filas
  });
});

// ── Importación ───────────────────────────────────────────────────────────────

describe('importarCSV — headers inválidos', () => {
  it('retorna error explícito y cero inserciones', async () => {
    const csvMalo = `fecha,COLUMNA_INVENTADA\n2026-06-13,algo`;
    const resultado = await importarCSV(csvMalo, db);
    expect(resultado.exitosas).toBe(0);
    expect(resultado.error).toBeTruthy();

    const { rows } = await db.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('importarCSV — fila corrupta con peso inválido', () => {
  it('ejecuta ROLLBACK y la DB queda intacta', async () => {
    const csvCorrupto = `${CSV_HEADERS}\n2026-06-13,Pecho,Press Banca,Pecho,1,abc,10,,4`;
    const resultado = await importarCSV(csvCorrupto, db);

    expect(resultado.exitosas).toBe(0);
    expect(resultado.fallidas).toBeGreaterThan(0);
    expect(resultado.error).toBeTruthy();

    const { rows } = await db.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('importarCSV — CSV válido', () => {
  it('retorna { exitosas: N, fallidas: 0, error: null }', async () => {
    const resultado = await importarCSV(CSV_VALIDO, db);
    expect(resultado.exitosas).toBe(1);
    expect(resultado.fallidas).toBe(0);
    expect(resultado.error).toBeNull();
  });

  it('la serie queda persistida en la DB', async () => {
    await importarCSV(CSV_VALIDO, db);
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM series');
    expect(Number(rows[0].n)).toBe(1);
  });

  it('importar el mismo CSV dos veces no duplica sesiones ni rutinas', async () => {
    await importarCSV(CSV_VALIDO, db);
    await importarCSV(CSV_VALIDO, db);
    const { rows: rRutinas } = await db.query('SELECT COUNT(*) AS n FROM rutinas');
    const { rows: rSesiones } = await db.query('SELECT COUNT(*) AS n FROM sesiones');
    expect(Number(rRutinas[0].n)).toBe(1);
    expect(Number(rSesiones[0].n)).toBe(1);
  });
});
