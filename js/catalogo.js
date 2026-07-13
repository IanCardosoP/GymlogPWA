// Catálogo estático de ejercicios (free-exercise-db): carga, búsqueda bilingüe y sugerencias.
// Lógica pura — sin imports de DOM ni de db.js. El catálogo NUNCA se inserta en PGLite;
// vive como JSON en assets y aquí solo se consulta en memoria.
import { expandirConSinonimos } from './sinonimos.js';

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

// Palabras sin valor discriminante (es + en, porque también se busca en nombre_en).
// Exigirlas rompía matches válidos: "Fondos DE tríceps" vs "Fondos versión tríceps".
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'a', 'al', 'para', 'y',
  'por', 'sobre', 'un', 'una',
  'the', 'of', 'with', 'on', 'to', 'and', 'for',
]);

// Stemming crudo de plurales: quita la "s" final y luego la "e" final.
// Lingüísticamente burdo, pero se aplica IGUAL a consulta y catálogo, que es lo
// único que importa para comparar: cruces/cruce → "cruc", aperturas/apertura →
// "apertura", flexiones/flexion → "flexion", triceps/tricep → "tricep".
function raiz(token) {
  let t = token;
  if (t.length > 3 && t.endsWith('s')) t = t.slice(0, -1);
  if (t.length > 3 && t.endsWith('e')) t = t.slice(0, -1);
  return t;
}

function tokenizar(texto) {
  return new Set(
    normalizarTexto(texto)
      .split(/\s+/)
      .filter(t => t && !PALABRAS_VACIAS.has(t))
      .map(raiz)
  );
}

// Puntúa por solapamiento proporcional de tokens (no todo-o-nada):
// cobertura = cuánto de lo que el usuario escribió aparece en el nombre;
// precisión = cuánto del nombre es relevante (penaliza suave el relleno).
function puntuarNombre(nombre, consultaNorm, tokensConsulta) {
  const n = normalizarTexto(nombre);
  if (n === consultaNorm) return 100;

  const tokensNombre = tokenizar(nombre);
  if (tokensNombre.size === 0 || tokensConsulta.size === 0) return 0;

  let comunes = 0;
  for (const t of tokensConsulta) if (tokensNombre.has(t)) comunes++;
  if (comunes === 0) return 0;

  const cobertura = comunes / tokensConsulta.size;
  const precision = comunes / tokensNombre.size;
  const puntaje = 100 * (0.7 * cobertura + 0.3 * precision);

  return Math.round(n.startsWith(consultaNorm) ? Math.max(puntaje, 92) : puntaje);
}

// La consulta compite contra el nombre en español Y en inglés, y contra cada
// variante de argot (peck deck → mariposa); gana el mayor puntaje.
export function puntuarEntrada(entrada, consultaNorm) {
  let mejor = 0;
  for (const variante of expandirConSinonimos(consultaNorm)) {
    const tokens = tokenizar(variante);
    mejor = Math.max(
      mejor,
      puntuarNombre(entrada.nombre_es, variante, tokens),
      puntuarNombre(entrada.nombre_en, variante, tokens),
    );
  }
  return mejor;
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

// Equipo de gimnasio de uso frecuente: sus chips van primero en el modal para
// no obligar a scrollear la fila. Solo afecta el ORDEN de los chips — el
// filtrado y el ranking de ejercicios no cambian.
const EQUIPOS_PRIORITARIOS = ['mancuerna', 'máquina', 'barra', 'polea', 'barra Z'];

export function equiposDeCatalogo(datos) {
  const presentes = new Set(datos.map(e => e.equipo_es));
  const prioritarios = EQUIPOS_PRIORITARIOS.filter(e => presentes.has(e));
  const resto = [...presentes]
    .filter(e => !EQUIPOS_PRIORITARIOS.includes(e))
    .sort((a, b) => a.localeCompare(b));
  return [...prioritarios, ...resto];
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
