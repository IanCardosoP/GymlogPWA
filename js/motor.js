// Motor de base de datos: SQLite compilado a WASM, en memoria, persistido como
// un único archivo serializado en IndexedDB.
//
// Sustituye a PGLite. El porqué es el bug que motivó este rediseño: PGLite pesa
// 16.2 MB de artefactos (pglite.wasm 9.7 MB + pglite.data 6.1 MB + initdb.wasm)
// que tienen que estar en caché ANTES de que la app pueda pintar nada. Ese
// volumen es, en sí mismo, la superficie de fallo en iOS — WebKit desaloja las
// cachés del origen completo bajo presión de cuota. sqlite3.wasm son 845 KB:
// ~19× menos.
//
// Decisiones de diseño, con el criterio de MENOS PIEZAS MÓVILES ESPECÍFICAS DE
// iOS (que es todo el punto del ejercicio):
//
//  - Base en memoria + snapshot del archivo completo a IndexedDB. NO OPFS: el
//    VFS `opfs-sahpool` exige createSyncAccessHandle(), que solo existe en
//    workers, y OPFS en iOS tiene bugs propios. Cero superficie OPFS = cero
//    bugs de OPFS. Tampoco el VFS `opfs` clásico, que necesita SharedArrayBuffer
//    y por tanto cabeceras COOP/COEP que GitHub Pages no permite fijar.
//  - Sin Web Worker: un límite menos que cruzar y depurar.
//  - El coste del snapshot completo es irrelevante acá: la base de este proyecto
//    son 7 tablas y unos miles de filas tras años de uso (< 1 MB).
//  - Los bytes del wasm se guardan en la MISMA IndexedDB que los datos del
//    usuario. Hoy el motor puede desaparecer mientras los datos sobreviven —
//    exactamente el síntoma reportado. Compartiendo almacén, motor y datos
//    tienen un único destino de desalojo, y la Cache API deja de ser crítica
//    para arrancar.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const DB_IDB = 'gymlog-motor';
const DB_IDB_VERSION = 1;
const ALMACEN = 'kv';
const CLAVE_META = 'meta';
const SLOTS = ['snapshot_a', 'snapshot_b'];

// Debounce corto: agrupa las escrituras de una serie de sets seguidos sin dejar
// una ventana de pérdida perceptible.
const DEBOUNCE_MS = 150;

let sqlite3 = null;
let handle = null;
let idb = null;
// En modo efímero (tests, equivalente al memory:// de PGLite) no hay IndexedDB
// que tocar: guardar() y guardarAhora() son no-op. Así el contrato de initDB no
// cambia y los tests no necesitan un shim de IndexedDB.
let persistencia = false;
let slotActual = 0;
let generacion = 0;
let pendiente = null;
let guardando = Promise.resolve();

// ── IndexedDB (almacén clave-valor mínimo) ────────────────────────────────────

function abrirIDB() {
  if (idb) return Promise.resolve(idb);
  return new Promise((resolver, rechazar) => {
    const solicitud = indexedDB.open(DB_IDB, DB_IDB_VERSION);
    solicitud.onupgradeneeded = () => {
      const bd = solicitud.result;
      if (!bd.objectStoreNames.contains(ALMACEN)) bd.createObjectStore(ALMACEN);
    };
    solicitud.onsuccess = () => { idb = solicitud.result; resolver(idb); };
    solicitud.onerror = () => rechazar(solicitud.error);
  });
}

function idbLeer(clave) {
  return abrirIDB().then(bd => new Promise((resolver, rechazar) => {
    const tx = bd.transaction(ALMACEN, 'readonly');
    const peticion = tx.objectStore(ALMACEN).get(clave);
    peticion.onsuccess = () => resolver(peticion.result ?? null);
    peticion.onerror = () => rechazar(peticion.error);
  }));
}

function idbEscribir(pares) {
  return abrirIDB().then(bd => new Promise((resolver, rechazar) => {
    const tx = bd.transaction(ALMACEN, 'readwrite');
    const almacen = tx.objectStore(ALMACEN);
    for (const [clave, valor] of pares) almacen.put(valor, clave);
    tx.oncomplete = resolver;
    tx.onerror = () => rechazar(tx.error);
  }));
}

// ── Snapshot: doble slot con contador de generación ───────────────────────────
// Un put de IndexedDB ya es atómico por transacción, así que el doble slot no es
// contra un write a medias: es contra una SERIALIZACIÓN corrupta o un fallo a
// mitad de la exportación. Se escribe siempre en el slot que NO está en uso y el
// puntero se mueve al final; si algo falla, la copia anterior sigue intacta.
// Es seguro barato sobre el único riesgo real de guardar el archivo completo.

export async function guardarAhora() {
  if (!handle || !persistencia) return;

  const bytes = sqlite3.capi.sqlite3_js_db_export(handle.pointer);
  const siguiente = 1 - slotActual;
  generacion += 1;

  await idbEscribir([
    [SLOTS[siguiente], bytes],
    [CLAVE_META, { slot: siguiente, generacion, guardado_en: Date.now() }],
  ]);

  slotActual = siguiente;
}

// Encola un guardado con debounce. Devuelve la promesa del guardado en curso
// para que quien quiera esperarlo pueda (los tests lo hacen).
export function guardar() {
  if (!persistencia) return Promise.resolve();
  if (pendiente) clearTimeout(pendiente);
  guardando = new Promise(resolver => {
    pendiente = setTimeout(() => {
      pendiente = null;
      guardarAhora().catch(error => console.error('[motor] no se pudo guardar:', error))
        .then(resolver);
    }, DEBOUNCE_MS);
  });
  return guardando;
}

// El ciclo de vida real de una PWA en iOS: la app se suspende sin previo aviso y
// no siempre llega un 'beforeunload'. 'pagehide' y 'visibilitychange' son los dos
// eventos en los que WebKit sí es fiable.
function engancharCicloDeVida() {
  if (typeof document === 'undefined') return;
  const forzar = () => {
    if (pendiente) { clearTimeout(pendiente); pendiente = null; }
    guardarAhora().catch(() => {});
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') forzar();
  });
  window.addEventListener('pagehide', forzar);
}

async function cargarSnapshot() {
  const meta = await idbLeer(CLAVE_META);
  if (!meta || typeof meta.slot !== 'number') return null;

  const bytes = await idbLeer(SLOTS[meta.slot]);
  if (bytes) {
    slotActual = meta.slot;
    generacion = meta.generacion ?? 0;
    return bytes;
  }

  // El puntero apunta a un slot vacío: se intenta el otro antes de rendirse y
  // arrancar en blanco, que sería perder los datos del usuario.
  const alterno = await idbLeer(SLOTS[1 - meta.slot]);
  if (alterno) {
    slotActual = 1 - meta.slot;
    generacion = meta.generacion ?? 0;
    console.warn('[motor] snapshot principal ausente; se usó la copia alterna');
    return alterno;
  }
  return null;
}

// ── Apertura ──────────────────────────────────────────────────────────────────

function restaurar(bytes) {
  const puntero = sqlite3.wasm.allocFromTypedArray(bytes);
  const rc = sqlite3.capi.sqlite3_deserialize(
    handle.pointer, 'main', puntero, bytes.byteLength, bytes.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE
  );
  if (rc !== 0) throw new Error(`sqlite3_deserialize falló (rc=${rc})`);
}

// `persistir: false` da una base efímera para los tests, equivalente al
// `memory://` de PGLite: mismo contrato, sin tocar IndexedDB.
export async function abrirMotor({ persistir = true } = {}) {
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: () => {} });
  handle = new sqlite3.oo1.DB(':memory:');
  persistencia = persistir;

  if (persistir) {
    const bytes = await cargarSnapshot();
    if (bytes) restaurar(bytes);
    engancharCicloDeVida();
  }

  // SQLite no activa las claves ajenas por defecto, y el esquema depende de
  // ON DELETE CASCADE (rutina_ejercicios, rutina_dias, series).
  handle.exec('PRAGMA foreign_keys = ON');

  return { query, exec };
}

export function cerrarMotor() {
  if (pendiente) { clearTimeout(pendiente); pendiente = null; }
  handle?.close();
  // Soltar TAMBIÉN la conexión a IndexedDB, no solo la base SQLite. Mientras esta
  // siga abierta, un deleteDatabase('gymlog-motor') se queda bloqueado
  // indefinidamente: es lo que hacía que el «BORRAR TODO» solo funcionara de
  // milagro, completándose durante el unload de la recarga.
  idb?.close();
  idb = null;
  persistencia = false;
  handle = null;
  sqlite3 = null;
  slotActual = 0;
  generacion = 0;
}

// ── Borrado total ─────────────────────────────────────────────────────────────
// IndexedDB es competencia de este módulo (es quien la abre, la nombra y la
// mantiene), así que el borrado vive acá y no en el componente de config.
//
// deleteDatabase() devuelve un IDBRequest, que NO es thenable: un
// `Promise.all(nombres.map(n => indexedDB.deleteDatabase(n)))` resuelve en el
// mismo tick sin haber borrado nada. Hay que esperar el evento.

// Nombres a borrar cuando el navegador no expone indexedDB.databases()
// (Safari < 14). DB_IDB va primero: es la base con los datos del usuario, y
// justamente era la que la rama de respaldo se dejaba sin borrar.
const BASES_CONOCIDAS = [DB_IDB, 'gym-log-db', '/gym-log-db'];

// El «borrar todo» borra las bases DE ESTA APP, no las del origen entero. En
// GitHub Pages el origen es `<usuario>.github.io`, compartido por todos los
// repos publicados del mismo usuario: un deleteDatabase indiscriminado sobre
// indexedDB.databases() se llevaría por delante los datos de otra app suya.
// El `includes('gym-log-db')` cubre el nombre que Emscripten/IDBFS le pone a la
// base legada de PGLite, que lleva el dataDir como prefijo ('/pglite/gym-log-db').
const esBaseDeLaApp = nombre =>
  nombre === DB_IDB || nombre.includes('gym-log-db') || nombre.includes('gymlog');

function borrarBase(nombre, tiempoLimiteMs) {
  return new Promise(resolver => {
    let resuelto = false;
    const terminar = estado => {
      if (resuelto) return;
      resuelto = true;
      clearTimeout(temporizador);
      resolver({ nombre, estado });
    };

    // Red de seguridad: si otra pestaña tiene la base abierta, el borrado queda
    // bloqueado para siempre. Mejor informar y seguir que dejar la UI colgada.
    const temporizador = setTimeout(() => terminar('bloqueada'), tiempoLimiteMs);

    const peticion = indexedDB.deleteDatabase(nombre);
    peticion.onsuccess = () => terminar('borrada');
    peticion.onerror   = () => terminar('error');
    peticion.onblocked = () => terminar('bloqueada');
  });
}

/**
 * Borra las IndexedDB de la app y ESPERA a que el borrado ocurra de verdad.
 * Cierra el motor primero: si no, la propia conexión abierta bloquea el borrado.
 *
 * @param {{tiempoLimiteMs?: number}} opciones - tope por base antes de darla por
 *   bloqueada y seguir. Parametrizado para que los tests no esperen segundos.
 * @returns {Promise<{borradas: string[], bloqueadas: string[]}>}
 */
export async function borrarBasesDeDatos({ tiempoLimiteMs = 3000 } = {}) {
  cerrarMotor();

  if (typeof indexedDB === 'undefined') return { borradas: [], bloqueadas: [] };

  let nombres = BASES_CONOCIDAS;
  if (typeof indexedDB.databases === 'function') {
    try {
      const bases = await indexedDB.databases();
      nombres = bases.map(b => b.name).filter(n => n && esBaseDeLaApp(n));
    } catch {
      // Si la enumeración falla se borran las conocidas: peor es no borrar nada.
    }
  }

  const resultados = await Promise.all(
    nombres.map(nombre => borrarBase(nombre, tiempoLimiteMs)));

  return {
    borradas:   resultados.filter(r => r.estado === 'borrada').map(r => r.nombre),
    bloqueadas: resultados.filter(r => r.estado === 'bloqueada').map(r => r.nombre),
  };
}

export const motorAbierto = () => handle !== null;

// ── Shim de consultas ─────────────────────────────────────────────────────────
// Devuelve `{ rows }` como PGLite. Es lo que mantiene el diff acotado: los 52
// exports de db.js y los 31 usos de `.rows` en los componentes no cambian de
// forma, y los tests existentes siguen siendo la red de seguridad del port.

// SQLite no tiene tipo booleano: los binds van como 0/1. `undefined` a null
// porque los call sites usan `?? null` de forma inconsistente.
const normalizar = params => params.map(p => {
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p === undefined) return null;
  return p;
});

// SQLite guarda los booleanos como 0/1 y los devuelve así. PGLite devolvía true/
// false, y hay código y tests que comparan con === true. Normalizarlo en un único
// punto es lo que hace que el cambio de motor sea invisible para los componentes:
// si aparece una columna booleana nueva, se añade acá y a ningún otro sitio.
const COLUMNAS_BOOLEANAS = ['catalogo_revisado', 'activo_hoy'];

function aBooleanos(fila) {
  for (const columna of COLUMNAS_BOOLEANAS) {
    const valor = fila[columna];
    if (valor === 0 || valor === 1) fila[columna] = Boolean(valor);
  }
  return fila;
}

export async function query(sql, params = []) {
  if (!handle) throw new Error('motor no abierto');
  const rows = handle.selectObjects(sql, normalizar(params)).map(aBooleanos);
  return { rows };
}

// Multi-sentencia (la DDL). No devuelve filas.
export async function exec(sql) {
  if (!handle) throw new Error('motor no abierto');
  handle.exec(sql);
}

// ALTER TABLE ... ADD COLUMN IF NOT EXISTS no existe en SQLite, así que las
// migraciones idempotentes de columnas se hacen consultando el esquema.
//
// OWASP A03: `tabla`, `columna` y `definicion` son literales de nuestro propio
// código (nunca entrada del usuario) e interpolarlos es inevitable — PRAGMA y
// DDL no aceptan parámetros preparados en SQLite. No añadir acá ningún valor que
// venga de la UI.
export function asegurarColumna(tabla, columna, definicion) {
  const columnas = handle.selectObjects(`PRAGMA table_info(${tabla})`);
  if (columnas.some(c => c.name === columna)) return;
  handle.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}
