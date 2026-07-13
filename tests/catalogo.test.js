import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizarTexto, buscarEnCatalogo, mejorMatch, equiposDeCatalogo,
  _inyectarCatalogo, buscarCatalogo, sugerirMatch, getEntradaCatalogo,
} from '../js/catalogo.js';

// Catálogo real generado en public/assets — los tests validan contra los datos
// que la app efectivamente sirve, no contra un fixture inventado.
const CATALOGO = JSON.parse(readFileSync(
  fileURLToPath(new URL('../public/assets/catalogo/catalogo.json', import.meta.url)),
  'utf-8',
));

describe('catálogo real (integridad del asset)', () => {
  it('tiene 873 entradas con todos los campos', () => {
    expect(CATALOGO.length).toBe(873);
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

describe('equiposDeCatalogo', () => {
  it('devuelve los equipos únicos en español, ordenados', () => {
    const equipos = equiposDeCatalogo(CATALOGO);
    expect(equipos).toContain('mancuerna');
    expect(equipos).toContain('barra');
    expect(equipos).toContain('peso corporal');
    expect(new Set(equipos).size).toBe(equipos.length);
    expect(equipos).toEqual([...equipos].sort((a, b) => a.localeCompare(b)));
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
