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

// ── Vínculo con el catálogo en el backup ─────────────────────────────────────
// El catálogo es un asset estático y NUNCA se guarda en la base del usuario: el
// backup solo debe llevar el puntero (catalogo_id) de sus propios ejercicios.

describe('backup y catálogo', () => {
  it('el ciclo exportar → importar conserva el vínculo con el catálogo', async () => {
    const {
      saveRutina, getOrCreateEjercicio, linkEjercicioToRutina,
      saveSesion, saveSerie, getAllDataForExport, getEjercicios,
    } = await import('../js/db.js');

    // Un ejercicio del catálogo y otro personalizado (sin vínculo)
    const rutina = await saveRutina('Pecho', 1);
    const delCatalogo = await getOrCreateEjercicio('Prensa de pierna', 'PIERNA', 'Leg_Press');
    const personalizado = await getOrCreateEjercicio('Mi invento raro', 'GENERAL');
    await linkEjercicioToRutina(rutina.id, delCatalogo.id, 1);
    await linkEjercicioToRutina(rutina.id, personalizado.id, 2);
    const sesion = await saveSesion('2026-07-13', rutina.id, null);
    await saveSerie(sesion.id, delCatalogo.id, 1, 100, 10);

    const datos = await getAllDataForExport();

    // El backup NO arrastra el catálogo: solo los ejercicios del usuario
    expect(datos.ejercicios).toHaveLength(2);
    expect(datos.ejercicios.find(e => e.nombre === 'Prensa de pierna').catalogo_id).toBe('Leg_Press');

    // Restaurar sobre una base limpia
    db = await initDB('memory://');
    const res = await importarBackup(exportarBackup(datos), db);
    expect(res.error).toBeNull();

    const restaurados = await getEjercicios();
    const { rows } = await db.query(
      'SELECT nombre, catalogo_id, catalogo_revisado FROM ejercicios ORDER BY nombre'
    );
    expect(restaurados).toHaveLength(2);

    const prensa = rows.find(r => r.nombre === 'Prensa de pierna');
    expect(prensa.catalogo_id).toBe('Leg_Press');       // la imagen sigue asociada
    expect(prensa.catalogo_revisado).toBe(true);

    const invento = rows.find(r => r.nombre === 'Mi invento raro');
    expect(invento.catalogo_id).toBeNull();             // sin vínculo, como estaba
    expect(invento.catalogo_revisado).toBe(false);

    // Las series siguen apuntando al ejercicio correcto
    const { rows: series } = await db.query('SELECT ejercicio_id, peso FROM series');
    expect(series).toHaveLength(1);
    expect(Number(series[0].peso)).toBe(100);
  });

  it('un backup ANTERIOR al catálogo (sin catalogo_id) se importa sin fallar', async () => {
    // Exactamente lo que exportaba la versión previa: ejercicios sin los campos nuevos
    const backupViejo = JSON.stringify({
      version: BACKUP_VERSION,
      exported_at: '2026-06-01',
      conf: { pref_unit: 'kg', pref_acento: 'verde' },
      ejercicios: [
        { id: 1, nombre: 'Press Banca', grupo_muscular: 'PECHO' },
        { id: 2, nombre: 'Sentadilla', grupo_muscular: 'PIERNA' },
      ],
      rutinas: [{ id: 1, nombre: 'Full Body' }],
      rutina_ejercicios: [{ rutina_id: 1, ejercicio_id: 1, orden: 1, activo_hoy: true }],
      rutina_dias: [{ rutina_id: 1, dia: 1 }],
      sesiones: [{ id: 1, fecha: '2026-06-01', rutina_id: 1, energia_sueno: 3, peso_corporal: 80 }],
      series: [{ sesion_id: 1, ejercicio_id: 1, numero_serie: 1, peso: 60, repeticiones: 8 }],
    });

    const res = await importarBackup(backupViejo, db);
    expect(res.error).toBeNull();
    expect(res.ejercicios).toBe(2);

    // Los campos nuevos toman su default; el usuario los verá como "por revisar"
    const { rows } = await db.query(
      'SELECT nombre, catalogo_id, catalogo_revisado FROM ejercicios ORDER BY id'
    );
    for (const r of rows) {
      expect(r.catalogo_id).toBeNull();
      expect(r.catalogo_revisado).toBe(false);
    }
  });
});
