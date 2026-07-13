// Catálogo estático de ejercicios (free-exercise-db): carga, búsqueda bilingüe y sugerencias.
// Lógica pura — sin imports de DOM ni de db.js. El catálogo NUNCA se inserta en PGLite;
// vive como JSON en assets y aquí solo se consulta en memoria.

let catalogoCache = null;
let instruccionesCache = null;

export async function cargarCatalogo(url = 'assets/catalogo/catalogo.json') {
  if (catalogoCache) return catalogoCache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo cargar el catálogo (${res.status})`);
  catalogoCache = await res.json();
  return catalogoCache;
}

// Asset aparte (~700KB) del índice de búsqueda: se descarga solo al abrir el
// primer panel de detalles, no al arrancar la app ni al abrir el modal.
export async function cargarInstrucciones(url = 'assets/catalogo/instrucciones.json') {
  if (instruccionesCache) return instruccionesCache;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudieron cargar las instrucciones (${res.status})`);
  instruccionesCache = await res.json();
  return instruccionesCache;
}

export async function getInstrucciones(fuenteId) {
  if (!fuenteId) return [];
  const todas = await cargarInstrucciones();
  return todas[fuenteId] ?? [];
}

// Solo para tests: inyecta datos sin pasar por fetch.
export function _inyectarCatalogo(datos) {
  catalogoCache = datos;
}

export function _inyectarInstrucciones(datos) {
  instruccionesCache = datos;
}

export function normalizarTexto(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

// Puntúa la coincidencia de una consulta normalizada contra un nombre.
// 100 exacto · 90 prefijo · 75 inicio de palabra · 60 substring ·
// 45 todas las palabras de la consulta aparecen · 0 sin match.
function puntuarNombre(nombre, consultaNorm) {
  const n = normalizarTexto(nombre);
  if (n === consultaNorm) return 100;
  if (n.startsWith(consultaNorm)) return 90;
  if (n.includes(' ' + consultaNorm)) return 75;
  if (n.includes(consultaNorm)) return 60;
  const palabras = consultaNorm.split(/\s+/).filter(Boolean);
  if (palabras.length > 1 && palabras.every(p => n.includes(p))) return 45;
  return 0;
}

// La consulta compite contra el nombre en español Y en inglés; gana el mayor.
// Así "press" encuentra "Prensa de pierna" (via "Leg Press") y "dominadas"
// encuentra "Dominada" directamente.
export function puntuarEntrada(entrada, consultaNorm) {
  return Math.max(
    puntuarNombre(entrada.nombre_es, consultaNorm),
    puntuarNombre(entrada.nombre_en, consultaNorm),
  );
}

export function buscarEnCatalogo(datos, { texto = '', grupo = null, equipo = null, limit = 30, offset = 0 } = {}) {
  const consultaNorm = normalizarTexto(texto);
  let filtrados = datos;

  if (grupo)  filtrados = filtrados.filter(e => e.grupo_muscular === grupo);
  if (equipo) filtrados = filtrados.filter(e => e.equipo_es === equipo);

  let ordenados;
  if (consultaNorm) {
    ordenados = filtrados
      .map(e => ({ entrada: e, puntaje: puntuarEntrada(e, consultaNorm) }))
      .filter(x => x.puntaje > 0)
      .sort((a, b) =>
        b.puntaje - a.puntaje ||
        a.entrada.nombre_es.length - b.entrada.nombre_es.length ||
        a.entrada.nombre_es.localeCompare(b.entrada.nombre_es)
      )
      .map(x => x.entrada);
  } else {
    ordenados = [...filtrados].sort((a, b) => a.nombre_es.localeCompare(b.nombre_es));
  }

  return {
    resultados: ordenados.slice(offset, offset + limit),
    total: ordenados.length,
  };
}

// Umbral mínimo para que una sugerencia de retrofit sea presentable al usuario:
// 45 = al menos todas las palabras de su nombre aparecen en el candidato.
const UMBRAL_SUGERENCIA = 45;

// Lista rankeada de coincidencias para un nombre de usuario: alimenta tanto la
// sugerencia inicial como el ciclado de imagen (tap → siguiente coincidencia).
export function candidatosMatch(datos, nombreUsuario, limite = 8) {
  const consultaNorm = normalizarTexto(nombreUsuario);
  if (!consultaNorm) return [];

  return datos
    .map(entrada => ({ entrada, puntaje: puntuarEntrada(entrada, consultaNorm) }))
    .filter(x => x.puntaje >= UMBRAL_SUGERENCIA)
    .sort((a, b) =>
      b.puntaje - a.puntaje ||
      a.entrada.nombre_es.length - b.entrada.nombre_es.length ||
      a.entrada.nombre_es.localeCompare(b.entrada.nombre_es)
    )
    .slice(0, limite)
    .map(x => x.entrada);
}

export function mejorMatch(datos, nombreUsuario) {
  return candidatosMatch(datos, nombreUsuario, 1)[0] ?? null;
}

export function equiposDeCatalogo(datos) {
  return [...new Set(datos.map(e => e.equipo_es))].sort((a, b) => a.localeCompare(b));
}

// ── Wrappers sobre el catálogo cacheado (para la capa de UI) ─────────────────

export async function buscarCatalogo(opciones = {}) {
  const datos = await cargarCatalogo();
  return buscarEnCatalogo(datos, opciones);
}

export async function getEquiposCatalogo() {
  const datos = await cargarCatalogo();
  return equiposDeCatalogo(datos);
}

export async function sugerirMatch(nombreUsuario) {
  const datos = await cargarCatalogo();
  return mejorMatch(datos, nombreUsuario);
}

export async function getCandidatos(nombreUsuario, limite = 8) {
  const datos = await cargarCatalogo();
  return candidatosMatch(datos, nombreUsuario, limite);
}

export async function getEntradaCatalogo(fuenteId) {
  const datos = await cargarCatalogo();
  return datos.find(e => e.fuente_id === fuenteId) ?? null;
}
