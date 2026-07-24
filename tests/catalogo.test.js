import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizarTexto, buscarEnCatalogo, mejorMatch, candidatosMatch, equiposDeCatalogo,
  _inyectarCatalogo, _inyectarInstrucciones,
  buscarCatalogo, sugerirMatch, getCandidatos, getEntradaCatalogo, getInstrucciones,
  rutasImagenCatalogo, urlsParaWarming,
} from '../js/catalogo.js';

// Catálogo real generado en public/assets — los tests validan contra los datos
// que la app efectivamente sirve, no contra un fixture inventado.
const CATALOGO = JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/assets/catalogo/catalogo.json', import.meta.url)),
  'utf-8',
));

describe('catálogo real (integridad del asset)', () => {
  // Sin cota superior: el catálogo crece con scripts/agregar-ejercicio.js
  it('tiene al menos los 873 ejercicios base, con todos los campos', () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(873);
    const campos = ['fuente_id', 'nombre_es', 'nombre_en', 'grupo_muscular', 'equipo_es', 'equipo_en', 'imagen_a', 'imagen_b'];
    for (const e of CATALOGO) {
      for (const c of campos) expect(e[c], `campo ${c} en ${e.fuente_id}`).toBeTruthy();
    }
  });

  it('solo usa grupos musculares del vocabulario de la app', () => {
    const validos = new Set(['PECHO', 'ESPALDA', 'PIERNA', 'HOMBRO', 'BRAZO', 'CORE', 'GENERAL']);
    for (const e of CATALOGO) expect(validos.has(e.grupo_muscular), e.grupo_muscular).toBe(true);
  });

  it('no tiene fuente_id duplicados', () => {
    expect(new Set(CATALOGO.map(e => e.fuente_id)).size).toBe(CATALOGO.length);
  });

  it('instrucciones.json cubre todos los ejercicios del catálogo', () => {
    const instrucciones = JSON.parse(readFileSync(
      fileURLToPath(new URL('../public/assets/catalogo/instrucciones.json', import.meta.url)),
      'utf-8',
    ));
    for (const e of CATALOGO) {
      expect(Array.isArray(instrucciones[e.fuente_id]), `sin entrada: ${e.fuente_id}`).toBe(true);
    }
    // Los pasos nunca son cadenas vacías (la fuente traía algunas, se limpiaron)
    for (const pasos of Object.values(instrucciones)) {
      for (const p of pasos) expect(p.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('rutasImagenCatalogo', () => {
  // La tarjeta del Diario deriva sus miniaturas del catalogo_id en vez de
  // descargar catalogo.json (275 KB). Si el generador cambia el naming, esto
  // cae aquí en vez de dejar imágenes rotas en producción.
  it('coincide con imagen_a/imagen_b de todas las entradas del catálogo', () => {
    for (const e of CATALOGO) {
      const rutas = rutasImagenCatalogo(e.fuente_id);
      expect(rutas, e.fuente_id).toEqual({ a: e.imagen_a, b: e.imagen_b });
    }
  });

  it('devuelve null sin fuente_id (ejercicio sin vínculo al catálogo)', () => {
    expect(rutasImagenCatalogo(null)).toBeNull();
    expect(rutasImagenCatalogo('')).toBeNull();
    expect(rutasImagenCatalogo(undefined)).toBeNull();
  });
});

describe('urlsParaWarming', () => {
  // Alimenta tanto el warming automático (app.js, filas de getRutinaEjercicios)
  // como la descarga manual del catálogo completo (config.js, catalogo.json
  // mapeado a {catalogo_id: fuente_id}) — de ahí que solo dependa de esa forma.

  it('produce el par _0.webp/_1.webp por cada catalogo_id, en el mismo orden que rutasImagenCatalogo', () => {
    const urls = urlsParaWarming([{ catalogo_id: 'Leg_Press' }]);
    const rutas = rutasImagenCatalogo('Leg_Press');
    expect(urls).toEqual([rutas.a, rutas.b]);
  });

  it('deduplica filas con el mismo catalogo_id', () => {
    const urls = urlsParaWarming([
      { catalogo_id: 'Leg_Press' },
      { catalogo_id: 'Leg_Press' },
      { catalogo_id: 'Leg_Press' },
    ]);
    expect(urls.length).toBe(2);
  });

  it('ignora filas sin catalogo_id (ejercicio sin vínculo al catálogo)', () => {
    const urls = urlsParaWarming([
      { catalogo_id: null },
      { catalogo_id: undefined },
      { catalogo_id: '' },
      {},
    ]);
    expect(urls).toEqual([]);
  });

  it('combina varias rutinas: dedup entre filas de distinta rutina, orden estable', () => {
    const filasRutina1 = [{ catalogo_id: 'Leg_Press' }, { catalogo_id: 'Butterfly' }];
    const filasRutina2 = [{ catalogo_id: 'Butterfly' }, { catalogo_id: 'Bench_Press' }];
    const urls = urlsParaWarming([...filasRutina1, ...filasRutina2]);

    expect(urls).toEqual([
      ...Object.values(rutasImagenCatalogo('Leg_Press')),
      ...Object.values(rutasImagenCatalogo('Butterfly')),
      ...Object.values(rutasImagenCatalogo('Bench_Press')),
    ]);
  });

  it('lista vacía sin lanzar', () => {
    expect(urlsParaWarming([])).toEqual([]);
  });
});

describe('normalizarTexto', () => {
  it('quita acentos y baja a minúsculas', () => {
    expect(normalizarTexto('Jalón al Pecho')).toBe('jalon al pecho');
    expect(normalizarTexto('  FLEXIÓN  ')).toBe('flexion');
  });
});

describe('buscarEnCatalogo — búsqueda bilingüe', () => {
  it('"press" (inglés) encuentra "Prensa de pierna" (español) via nombre_en', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { texto: 'press', limit: 200 });
    const nombres = resultados.map(e => e.nombre_es);
    expect(nombres).toContain('Prensa de pierna');
  });

  it('"dominadas" encuentra las dominadas aunque el original sea pull-up', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { texto: 'dominadas' });
    expect(resultados.length).toBeGreaterThan(0);
    expect(resultados[0].nombre_es.toLowerCase()).toContain('dominada');
  });

  it('"remo" devuelve múltiples variantes ordenadas por relevancia', () => {
    const { resultados, total } = buscarEnCatalogo(CATALOGO, { texto: 'remo' });
    expect(total).toBeGreaterThan(5);
    for (const e of resultados.slice(0, 5)) {
      const enAlguno = normalizarTexto(e.nombre_es).includes('remo')
        || normalizarTexto(e.nombre_en).includes('row');
      expect(enAlguno, `${e.nombre_es} / ${e.nombre_en}`).toBe(true);
    }
  });

  it('la búsqueda es insensible a acentos ("jalon" encuentra "Jalón al pecho")', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { texto: 'jalon al pecho' });
    expect(resultados.length).toBeGreaterThan(0);
    expect(normalizarTexto(resultados[0].nombre_es)).toContain('jalon');
  });

  it('filtra por grupo muscular', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { grupo: 'PECHO', limit: 500 });
    expect(resultados.length).toBeGreaterThan(0);
    for (const e of resultados) expect(e.grupo_muscular).toBe('PECHO');
  });

  it('filtra por equipo', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { equipo: 'mancuerna', limit: 500 });
    expect(resultados.length).toBeGreaterThan(0);
    for (const e of resultados) expect(e.equipo_es).toBe('mancuerna');
  });

  it('combina texto + grupo + equipo', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { texto: 'curl', grupo: 'BRAZO', equipo: 'mancuerna' });
    expect(resultados.length).toBeGreaterThan(0);
    for (const e of resultados) {
      expect(e.grupo_muscular).toBe('BRAZO');
      expect(e.equipo_es).toBe('mancuerna');
    }
  });

  it('respeta limit y offset sin solapamiento', () => {
    const pagina1 = buscarEnCatalogo(CATALOGO, { grupo: 'PIERNA', limit: 10, offset: 0 });
    const pagina2 = buscarEnCatalogo(CATALOGO, { grupo: 'PIERNA', limit: 10, offset: 10 });
    expect(pagina1.resultados.length).toBe(10);
    expect(pagina2.resultados.length).toBe(10);
    expect(pagina1.total).toBe(pagina2.total);
    const ids1 = new Set(pagina1.resultados.map(e => e.fuente_id));
    for (const e of pagina2.resultados) expect(ids1.has(e.fuente_id)).toBe(false);
  });

  it('sin texto devuelve orden alfabético por nombre_es', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { limit: 20 });
    const nombres = resultados.map(e => e.nombre_es);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b)));
  });

  it('texto sin coincidencias devuelve vacío con total 0', () => {
    const { resultados, total } = buscarEnCatalogo(CATALOGO, { texto: 'zzzxxyy inexistente' });
    expect(resultados).toEqual([]);
    expect(total).toBe(0);
  });
});

describe('mejorMatch — sugerencias de retrofit', () => {
  it('nombre idéntico al catálogo matchea exacto', () => {
    const m = mejorMatch(CATALOGO, 'Prensa de pierna');
    expect(m?.fuente_id).toBe('Leg_Press');
  });

  it('nombre de usuario aproximado encuentra candidato razonable', () => {
    const m = mejorMatch(CATALOGO, 'press banca');
    expect(m).not.toBeNull();
    expect(normalizarTexto(m.nombre_es)).toContain('press');
  });

  it('devuelve null para nombres sin match razonable', () => {
    expect(mejorMatch(CATALOGO, 'mi ejercicio raro inventado 99')).toBeNull();
    expect(mejorMatch(CATALOGO, '')).toBeNull();
  });
});

describe('candidatosMatch — ciclado de imagen', () => {
  it('"sentadilla" devuelve varias variantes rankeadas, no solo una', () => {
    const candidatos = candidatosMatch(CATALOGO, 'sentadilla');
    expect(candidatos.length).toBeGreaterThan(1);
    for (const c of candidatos) {
      expect(normalizarTexto(c.nombre_es)).toContain('sentadilla');
    }
  });

  it('respeta el límite de candidatos', () => {
    expect(candidatosMatch(CATALOGO, 'sentadilla', 3).length).toBeLessThanOrEqual(3);
    expect(candidatosMatch(CATALOGO, 'press', 5).length).toBeLessThanOrEqual(5);
  });

  it('mejorMatch coincide con el primer candidato (sin duplicar lógica)', () => {
    for (const nombre of ['sentadilla', 'prensa de pierna', 'press banca']) {
      expect(mejorMatch(CATALOGO, nombre)?.fuente_id)
        .toBe(candidatosMatch(CATALOGO, nombre)[0]?.fuente_id);
    }
  });

  it('devuelve lista vacía si nada supera el umbral', () => {
    expect(candidatosMatch(CATALOGO, 'xyz inventado 99')).toEqual([]);
    expect(candidatosMatch(CATALOGO, '')).toEqual([]);
  });
});

// Nombres reales de ejercicios que existían antes del catálogo y no encontraban
// coincidencia: fallaban por plurales, por palabras vacías o por argot.
describe('matching de ejercicios preexistentes (regresiones reportadas)', () => {
  it('"Cruces de Polea Baja" encuentra "Cruce de polea baja" (plural)', () => {
    expect(mejorMatch(CATALOGO, 'Cruces de Polea Baja')?.nombre_es).toBe('Cruce de polea baja');
  });

  it('"Fondos de tricep" encuentra "Fondos versión tríceps" (palabra vacía "de")', () => {
    expect(mejorMatch(CATALOGO, 'Fondos de tricep')?.nombre_es).toBe('Fondos versión tríceps');
  });

  it('"Peck Deck" encuentra "Mariposa" (argot, sin solapamiento léxico)', () => {
    expect(mejorMatch(CATALOGO, 'Peck Deck')?.nombre_es).toBe('Mariposa');
  });

  it('"Aperturas de pecho" encuentra "Mariposa" (argot + plural)', () => {
    expect(mejorMatch(CATALOGO, 'Aperturas de pecho')?.nombre_es).toBe('Mariposa');
  });

  it('el argot también funciona en el buscador del modal', () => {
    const { resultados } = buscarEnCatalogo(CATALOGO, { texto: 'peck deck' });
    expect(resultados[0]?.nombre_es).toBe('Mariposa');
  });

  it('el plural no pierde la coincidencia (stemming)', () => {
    // No se exige el mismo id: con "sentadilla" decenas de entradas empatan por
    // prefijo. Lo que importa es que ambas formas caigan en el mismo ejercicio.
    for (const [singular, plural] of [['sentadilla', 'sentadillas'], ['dominada', 'dominadas'], ['cruce', 'cruces']]) {
      for (const forma of [singular, plural]) {
        const m = mejorMatch(CATALOGO, forma);
        expect(m, `sin match para "${forma}"`).not.toBeNull();
        expect(normalizarTexto(m.nombre_es)).toContain(normalizarTexto(singular));
      }
    }
  });

  it('las palabras vacías no cambian el resultado', () => {
    expect(mejorMatch(CATALOGO, 'press de banca')?.fuente_id)
      .toBe(mejorMatch(CATALOGO, 'press banca')?.fuente_id);
  });

  it('un nombre sin relación real sigue sin dar coincidencias', () => {
    expect(mejorMatch(CATALOGO, 'Mi ejercicio inventado xyz')).toBeNull();
  });
});

// El panel de detalles reconstruye sus candidatos buscando por NOMBRE. Si el
// usuario vinculó a mano (con [ BUSCAR EN CATÁLOGO ]) una entrada que no sale en
// esa búsqueda —el caso típico: fue a buscarla justamente porque las sugerencias
// no servían—, el vínculo guardado debe seguir mandando al reabrir el panel.
describe('vínculo manual fuera de las sugerencias por nombre', () => {
  it('la entrada vinculada no aparece entre los candidatos por nombre', async () => {
    _inyectarCatalogo(CATALOGO);
    const candidatos = await getCandidatos('Fondo tricep');
    expect(candidatos.length).toBeGreaterThan(0);
    // "Mariposa" no tiene relación léxica con "Fondo tricep"
    expect(candidatos.some(c => c.fuente_id === 'Butterfly')).toBe(false);
  });

  it('getEntradaCatalogo la recupera para anteponerla a los candidatos', async () => {
    _inyectarCatalogo(CATALOGO);
    const vinculada = await getEntradaCatalogo('Butterfly');
    expect(vinculada).not.toBeNull();

    const candidatos = await getCandidatos('Fondo tricep');
    const conVinculo = [vinculada, ...candidatos.filter(c => c.fuente_id !== 'Butterfly')];

    // El vínculo guardado queda primero y es localizable → el panel lo mostrará
    expect(conVinculo[0].fuente_id).toBe('Butterfly');
    expect(conVinculo.findIndex(c => c.fuente_id === 'Butterfly')).toBe(0);
  });
});

describe('instrucciones (asset lazy)', () => {
  it('getInstrucciones devuelve los pasos en español del ejercicio', async () => {
    _inyectarInstrucciones({ Leg_Press: ['Siéntate en la máquina.', 'Empuja la plataforma.'] });
    const pasos = await getInstrucciones('Leg_Press');
    expect(pasos).toEqual(['Siéntate en la máquina.', 'Empuja la plataforma.']);
  });

  it('devuelve [] para ids desconocidos o nulos, sin lanzar', async () => {
    _inyectarInstrucciones({ Leg_Press: ['Siéntate.'] });
    expect(await getInstrucciones('No_Existe')).toEqual([]);
    expect(await getInstrucciones(null)).toEqual([]);
  });
});

describe('equiposDeCatalogo', () => {
  it('devuelve los equipos únicos en español, sin duplicados', () => {
    const equipos = equiposDeCatalogo(CATALOGO);
    expect(equipos).toContain('mancuerna');
    expect(equipos).toContain('barra');
    expect(equipos).toContain('peso corporal');
    expect(new Set(equipos).size).toBe(equipos.length);
  });

  it('el equipo de uso frecuente encabeza la lista, en su orden', () => {
    const equipos = equiposDeCatalogo(CATALOGO);
    expect(equipos.slice(0, 5)).toEqual(['mancuerna', 'máquina', 'barra', 'polea', 'barra Z']);
  });

  it('el resto queda alfabético detrás de los prioritarios', () => {
    const resto = equiposDeCatalogo(CATALOGO).slice(5);
    expect(resto).toEqual([...resto].sort((a, b) => a.localeCompare(b)));
    expect(resto).toContain('peso corporal');
  });

  it('no inventa equipos que no estén en el catálogo', () => {
    const soloMancuerna = CATALOGO.filter(e => e.equipo_es === 'mancuerna');
    expect(equiposDeCatalogo(soloMancuerna)).toEqual(['mancuerna']);
  });
});

describe('wrappers con caché (via _inyectarCatalogo)', () => {
  it('buscarCatalogo / sugerirMatch / getEntradaCatalogo usan el catálogo inyectado', async () => {
    _inyectarCatalogo(CATALOGO);
    const { resultados } = await buscarCatalogo({ texto: 'dominada', limit: 5 });
    expect(resultados.length).toBeGreaterThan(0);

    const sugerencia = await sugerirMatch('prensa de pierna');
    expect(sugerencia?.fuente_id).toBe('Leg_Press');

    const entrada = await getEntradaCatalogo('Leg_Press');
    expect(entrada?.nombre_es).toBe('Prensa de pierna');
    expect(await getEntradaCatalogo('No_Existe_123')).toBeNull();
  });
});
