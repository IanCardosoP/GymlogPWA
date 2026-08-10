// Componente Progreso: 3 tabs — Global, Ejercicios, Récords
import {
  getRutinas, getRutinaEjercicios, getSeriesPorEjercicio,
  getEstadisticasGlobales, getActividadSemanal, getVolumenPorGrupoMuscular,
  getPesoMaxPorEjercicio, getVolumenPorSesion, getUltimasSesionesConSeries,
  getFechasConSesiones, getSesionesConSeriesEnRango,
} from '../db.js';
import {
  METRICAS_REGISTRY, prepararDatosProgreso, calcularTendencia, calcularRacha,
  calculateEpley1RM,
} from '../analitico.js';

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

let tabActivo = 'GLOBAL';
let progresoAbort = null;

export async function render(state) {
  const container = document.getElementById('progreso-container');
  if (!container) return;
  container.textContent = '';

  progresoAbort?.abort();
  progresoAbort = new AbortController();

  // ── Tab bar ────────────────────────────────────────────────────────────────
  const tabBar = cel('div', 'progreso-tabs');
  const tabNames = ['GLOBAL', 'EJERCICIOS', 'RÉCORDS', 'HISTORIAL'];
  for (const nombre of tabNames) {
    const btn = cel('button', 'progreso-tab-btn', nombre);
    if (nombre === tabActivo) btn.classList.add('is-active');
    btn.dataset.tab = nombre;
    tabBar.appendChild(btn);
  }
  container.appendChild(tabBar);
  container.appendChild(cel('div', 'progreso-tab-sep'));

  const tabContent = cel('div', 'progreso-tab-content');
  container.appendChild(tabContent);

  tabBar.addEventListener('click', e => {
    const btn = e.target.closest('.progreso-tab-btn');
    if (!btn) return;
    tabActivo = btn.dataset.tab;
    tabBar.querySelectorAll('.progreso-tab-btn').forEach(b => {
      b.classList.toggle('is-active', b.dataset.tab === tabActivo);
    });
    renderTabContent(tabContent, state);
  }, { signal: progresoAbort.signal });

  await renderTabContent(tabContent, state);
}

async function renderTabContent(container, state) {
  container.textContent = '';
  if (tabActivo === 'GLOBAL')     await renderGlobal(container, state);
  if (tabActivo === 'EJERCICIOS') await renderEjercicios(container, state);
  if (tabActivo === 'RÉCORDS')    await renderRecords(container, state);
  if (tabActivo === 'HISTORIAL')  await renderHistorial(container, state);
}

// ── Vista GLOBAL ──────────────────────────────────────────────────────────────

async function renderGlobal(container, state) {
  const fechaHoy = new Date().toLocaleDateString('en-CA');
  const [stats, actividad, distribucion, filasSes] = await Promise.all([
    getEstadisticasGlobales(fechaHoy),
    getActividadSemanal(fechaHoy, 8),
    getVolumenPorGrupoMuscular(fechaHoy, 4),
    getUltimasSesionesConSeries(2),
  ]);

  const racha   = calcularRacha(stats.fechas, fechaHoy);
  const frecSem = stats.sesiones_4_sem > 0 ? (stats.sesiones_4_sem / 4).toFixed(1) : '0';
  const volFmt  = formatVolumen(stats.volumen_total);

  // ── Stat chips 2×2 ────────────────────────────────────────────────────────
  const grid = cel('div', 'global-chips');
  grid.appendChild(crearChip(String(stats.total_sesiones), 'SESIONES TOTALES'));
  grid.appendChild(crearChip(`${racha}D`,                 'RACHA ACTIVA'));
  grid.appendChild(crearChip(volFmt,                      'VOL. ACUMULADO'));
  grid.appendChild(crearChip(`${frecSem}/SEM`,            'FREC. PROMEDIO — 4 SEM'));
  container.appendChild(grid);

  // ── Frecuencia semanal ─────────────────────────────────────────────────────
  const cardFraq = crearSeccion('FRECUENCIA SEMANAL — ÚLTIMAS 8 SEMANAS');
  if (actividad.length === 0) {
    cardFraq.appendChild(cel('p', 'global-vacio', 'Sin sesiones registradas.'));
  } else {
    const maxSes = Math.max(...actividad.map(r => r.sesiones));
    for (const semana of actividad) {
      const pct = maxSes > 0 ? semana.sesiones / maxSes : 0;
      cardFraq.appendChild(crearFilaBarra(
        formatSemana(semana.semana_lunes),
        pct,
        `${semana.sesiones} ses`,
        'global-barra-fecha',
      ));
    }
  }
  container.appendChild(cardFraq);

  // ── Distribución muscular ──────────────────────────────────────────────────
  const cardMus = crearSeccion('GRUPOS MUSCULARES — ÚLTIMAS 4 SEMANAS');
  if (distribucion.length === 0) {
    cardMus.appendChild(cel('p', 'global-vacio', 'Sin series en las últimas 4 semanas.'));
  } else {
    const totalVol = distribucion.reduce((sum, r) => sum + r.volumen, 0);
    const maxVol   = distribucion[0].volumen;
    for (const grupo of distribucion) {
      const pct    = maxVol > 0 ? grupo.volumen / maxVol : 0;
      const pctStr = totalVol > 0 ? `${Math.round((grupo.volumen / totalVol) * 100)}%` : '0%';
      cardMus.appendChild(crearFilaBarra(
        grupo.grupo_muscular,
        pct,
        pctStr,
        'global-barra-grupo',
      ));
    }
  }
  container.appendChild(cardMus);

  // ── Últimas 2 sesiones ─────────────────────────────────────────────────────
  renderSeccionUltimasSesiones(container, filasSes, state);
}

// Agrupa filas planas (join sesión+ejercicio+serie) en sesiones con sus
// ejercicios y series anidados — usado por la vista GLOBAL y por HISTORIAL.
function agruparFilasPorSesion(filas) {
  const sesionesMap = new Map();
  for (const fila of filas) {
    if (!sesionesMap.has(fila.sesion_id)) {
      sesionesMap.set(fila.sesion_id, {
        sesion_id: fila.sesion_id,
        fecha: fila.fecha,
        hora_inicio: fila.hora_inicio,
        hora_fin: fila.hora_fin,
        rutina_id: fila.rutina_id ?? null,
        rutina_nombre: fila.rutina_nombre,
        ejercicios: new Map(),
      });
    }
    if (fila.ejercicio_id != null) {
      const ses = sesionesMap.get(fila.sesion_id);
      if (!ses.ejercicios.has(fila.ejercicio_id)) {
        ses.ejercicios.set(fila.ejercicio_id, { nombre: fila.ejercicio_nombre, series: [] });
      }
      ses.ejercicios.get(fila.ejercicio_id).series.push(fila);
    }
  }
  return [...sesionesMap.values()];
}

// Duración total de una sesión ya agrupada (ver agruparFilasPorSesion), o null si
// falta hora_inicio/hora_fin — única fuente de verdad para mostrar y para ordenar.
function calcularDuracionMin(ses) {
  if (!ses.hora_inicio || !ses.hora_fin) return null;
  const diffMs = new Date(ses.hora_fin) - new Date(ses.hora_inicio);
  const mins = Math.floor(diffMs / 60000);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return { mins, texto: `${hh}h:${mm}m` };
}

function renderSeccionUltimasSesiones(container, filas, state) {
  const unit = state.prefUnit || 'lb';

  const sesiones = agruparFilasPorSesion(filas);
  if (sesiones.length === 0) return;

  const card = crearSeccion('ÚLTIMAS 2 SESIONES');

  sesiones.forEach((ses, idx) => {
    if (idx > 0) {
      const sep = document.createElement('hr');
      sep.className = 'sesresumen-sep';
      card.appendChild(sep);
    }

    const fechaStr = new Date(ses.fecha + 'T12:00:00Z')
      .toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
      .toUpperCase();

    const hdr = cel('div', 'sesresumen-header');
    hdr.appendChild(cel('span', 'sesresumen-fecha', fechaStr));
    if (ses.rutina_nombre) {
      hdr.appendChild(cel('span', 'sesresumen-rutina', ses.rutina_nombre.toUpperCase()));
    }
    card.appendChild(hdr);

    const tabla = cel('div', 'sesresumen-tabla');
    tabla.appendChild(cel('span', 'sesresumen-th', 'EJERCICIO'));
    tabla.appendChild(cel('span', 'sesresumen-th sesresumen-th-r', 'SETS'));
    tabla.appendChild(cel('span', 'sesresumen-th sesresumen-th-r', 'PESO'));
    tabla.appendChild(cel('span', 'sesresumen-th sesresumen-th-r', '1RM EST.'));

    const ejercs = [...ses.ejercicios.values()];
    let totalSeries = 0;

    for (const { nombre, series } of ejercs) {
      totalSeries += series.length;
      const mejorPeso = Math.max(...series.map(s => Number(s.peso)));
      const isBW = mejorPeso === 0;
      const max1RM = Math.max(...series.map(s =>
        calculateEpley1RM(Number(s.peso), Number(s.repeticiones))
      ));
      const ormStr  = max1RM === 0 ? '——' : `~${Math.round(max1RM)}${unit}`;
      const pesoStr = isBW ? 'BW' : `${mejorPeso}${unit}`;

      tabla.appendChild(cel('span', 'sesresumen-td', nombre));
      tabla.appendChild(cel('span', 'sesresumen-td sesresumen-td-r', `×${series.length}`));
      tabla.appendChild(cel('span', 'sesresumen-td sesresumen-td-r', pesoStr));
      tabla.appendChild(cel('span', 'sesresumen-td sesresumen-td-r', ormStr));
    }
    card.appendChild(tabla);

    const dur = calcularDuracionMin(ses);
    const footer = cel('div', 'sesresumen-footer');
    footer.textContent = `${ejercs.length} EJERC · ${totalSeries} SERIES${dur ? ` · ${dur.texto}` : ''}`;
    card.appendChild(footer);
  });

  container.appendChild(card);
}

function crearChip(valor, etiqueta) {
  const chip = cel('div', 'global-chip');
  chip.appendChild(cel('div', 'global-chip-valor', valor));
  chip.appendChild(cel('div', 'global-chip-label', etiqueta));
  return chip;
}

function crearSeccion(titulo) {
  const card = cel('div', 'global-seccion');
  card.appendChild(cel('p', 'global-seccion-titulo', titulo));
  return card;
}

function crearFilaBarra(label, pct, numStr, labelClass) {
  const fila = cel('div', 'global-barra-fila');
  fila.appendChild(cel('span', labelClass, label));
  const track = cel('div', 'global-barra-track');
  const fill  = cel('div', 'global-barra-fill');
  fill.dataset.pct = Math.round(pct * 100);
  track.appendChild(fill);
  fila.appendChild(track);
  fila.appendChild(cel('span', 'global-barra-num', numStr));

  // Width via CSS custom property (dato dinámico, no estilo)
  fill.style.setProperty('--fill-pct', `${Math.round(pct * 100)}%`);
  return fila;
}

function formatVolumen(kg) {
  if (kg >= 1000) return `${(kg / 1000).toFixed(1)}T`;
  return `${Math.round(kg)} KG`;
}

function formatSemana(lunes) {
  const d = new Date(lunes + 'T12:00:00Z');
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).toUpperCase();
}

// ── Vista EJERCICIOS ──────────────────────────────────────────────────────────

async function renderEjercicios(container, state) {
  const rutinas = await getRutinas();
  const unit = state.prefUnit || 'lb';

  // ── Select Rutina ──────────────────────────────────────────────────────────
  const rutLabel = cel('label', 'progreso-label', 'Rutina: ');
  rutLabel.setAttribute('for', 'select-rutina');
  container.appendChild(rutLabel);

  const selectRut = document.createElement('select');
  selectRut.id = 'select-rutina';
  selectRut.className = 'select-rutina';
  const optRutVacio = document.createElement('option');
  optRutVacio.value = '';
  optRutVacio.textContent = '— Seleccionar rutina —';
  selectRut.appendChild(optRutVacio);
  for (const r of rutinas) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.nombre;
    selectRut.appendChild(opt);
  }
  container.appendChild(selectRut);

  // ── Select Ejercicio ───────────────────────────────────────────────────────
  const ejLabel = cel('label', 'progreso-label', 'Ejercicio: ');
  ejLabel.setAttribute('for', 'select-ejercicio');
  container.appendChild(ejLabel);

  const selectEj = document.createElement('select');
  selectEj.id = 'select-ejercicio';
  selectEj.className = 'select-ejercicio';
  selectEj.disabled = true;
  const optEjVacio = document.createElement('option');
  optEjVacio.value = '';
  optEjVacio.textContent = '— Seleccionar ejercicio —';
  selectEj.appendChild(optEjVacio);
  container.appendChild(selectEj);

  // ── Select Métrica ─────────────────────────────────────────────────────────
  const metLabel = cel('label', 'progreso-label', 'Métrica: ');
  metLabel.setAttribute('for', 'select-metrica');
  container.appendChild(metLabel);

  const selectMet = document.createElement('select');
  selectMet.id = 'select-metrica';
  selectMet.className = 'select-metrica';
  for (const [key, val] of Object.entries(METRICAS_REGISTRY)) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = val.nombre;
    selectMet.appendChild(opt);
  }
  container.appendChild(selectMet);

  // ── Panel info de métrica ──────────────────────────────────────────────────
  const metricaInfo = document.createElement('details');
  metricaInfo.className = `metrica-info acento-${state.acentoKey ?? 'verde'}`;
  const metricaSummary = document.createElement('summary');
  metricaSummary.textContent = '¿Qué es esto?';
  metricaInfo.appendChild(metricaSummary);
  const metricaBody = cel('div', 'metrica-info-body');
  metricaInfo.appendChild(metricaBody);
  container.appendChild(metricaInfo);

  const actualizarInfoMetrica = () => {
    metricaBody.textContent = '';
    const metrica = METRICAS_REGISTRY[selectMet.value];
    if (!metrica?.descripcion) return;
    for (const linea of metrica.descripcion) {
      metricaBody.appendChild(cel('p', 'metrica-info-p', linea));
    }
  };
  actualizarInfoMetrica();
  container.appendChild(document.createElement('hr'));

  const ejHeaderArea = cel('div', 'ej-header-area');
  container.appendChild(ejHeaderArea);

  const graficaArea = cel('div', 'grafica-area');
  container.appendChild(graficaArea);

  const historialArea = cel('div', 'historial-area');
  container.appendChild(historialArea);

  // ── Cascada Rutina → Ejercicio ─────────────────────────────────────────────
  selectRut.addEventListener('change', async () => {
    selectEj.textContent = '';
    selectEj.appendChild(optEjVacio.cloneNode(true));
    ejHeaderArea.textContent = '';
    graficaArea.textContent  = '';
    historialArea.textContent = '';
    const rutinaId = selectRut.value;
    if (!rutinaId) { selectEj.disabled = true; return; }
    const ejercicios = await getRutinaEjercicios(parseInt(rutinaId));
    for (const ej of ejercicios) {
      const opt = document.createElement('option');
      opt.value = ej.ejercicio_id;
      opt.textContent = ej.nombre;
      selectEj.appendChild(opt);
    }
    selectEj.disabled = false;
  });

  const actualizarGrafica = async () => {
    ejHeaderArea.textContent  = '';
    graficaArea.textContent   = '';
    historialArea.textContent = '';
    const ejId = parseInt(selectEj.value);
    if (!ejId) return;

    const series = await getSeriesPorEjercicio(ejId);
    const metricaKey = selectMet.value;
    const metrica = METRICAS_REGISTRY[metricaKey];
    const datos = metrica.calcular(series);

    // ── Cabecera del ejercicio ─────────────────────────────────────────────
    const nombre = selectEj.options[selectEj.selectedIndex]?.textContent ?? '';
    ejHeaderArea.appendChild(cel('p', 'ej-header-nombre', nombre.toUpperCase()));

    const datosEpley = prepararDatosProgreso(series);
    const tendencia  = calcularTendencia(datosEpley);
    const prDato     = datosEpley.length > 0
      ? datosEpley.reduce((m, d) => d.max1RM > m.max1RM ? d : m)
      : null;

    const meta = cel('div', 'ej-header-meta');
    if (prDato) {
      const prRow = cel('div', 'ej-header-fila');
      prRow.appendChild(cel('span', 'ej-header-key', 'PR 1RM EST.'));
      prRow.appendChild(cel('span', 'ej-header-val',
        `~${Math.round(prDato.max1RM)} ${unit}  ${tendencia ? tendencia.icono : ''}`));
      meta.appendChild(prRow);
    }
    if (series.length > 0) {
      const ultima = series[series.length - 1];
      const fechaISO = ultima.fecha instanceof Date
        ? ultima.fecha.toISOString().slice(0, 10)
        : String(ultima.fecha).slice(0, 10);
      const fechaStr = new Date(fechaISO + 'T12:00:00Z')
        .toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
        .toUpperCase();
      const ultimaRow = cel('div', 'ej-header-fila');
      ultimaRow.appendChild(cel('span', 'ej-header-key', 'ÚLTIMA SESIÓN'));
      ultimaRow.appendChild(cel('span', 'ej-header-val', fechaStr));
      meta.appendChild(ultimaRow);
    }
    if (tendencia) {
      const tendRow = cel('div', 'ej-header-fila');
      tendRow.appendChild(cel('span', 'ej-header-key', 'TENDENCIA 4 SEM'));
      const tendVal = cel('span', `ej-header-val ej-tendencia-${tendencia.clase}`,
        `${tendencia.icono} ${tendencia.texto}`);
      tendRow.appendChild(tendVal);
      meta.appendChild(tendRow);
    }
    const totalRow = cel('div', 'ej-header-fila');
    totalRow.appendChild(cel('span', 'ej-header-key', 'SESIONES TOTALES'));
    totalRow.appendChild(cel('span', 'ej-header-val', String(datosEpley.length)));
    meta.appendChild(totalRow);
    ejHeaderArea.appendChild(meta);

    // ── Gráfico últimas 10 sesiones ────────────────────────────────────────
    graficaArea.appendChild(cel('p', 'grafica-titulo',
      `Evolución últimas 10 sesiones · ${metrica.nombre}:`));

    const ultimas10 = datos.slice(-10).filter(d => d.barra !== null);
    if (ultimas10.length === 0) {
      graficaArea.appendChild(cel('p', 'grafica-sin-datos', 'Sin datos con peso registrado.'));
    }
    for (const d of ultimas10) {
      const fila = cel('div', 'grafica-fila');
      const fecha = new Date(d.fecha + 'T00:00:00')
        .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
      const valorDisplay = d.max1RM !== undefined
        ? `${Math.round(d.max1RM)} ${unit}`
        : `${Math.round(d.valor)} ${unit}`;
      fila.appendChild(cel('span', 'grafica-fecha', `${fecha}: `));
      fila.appendChild(cel('span', 'grafica-valor', `${valorDisplay}  `));
      fila.appendChild(cel('span', 'grafica-barra', `|${d.barra}|`));
      graficaArea.appendChild(fila);
    }

    // ── Historial últimas 15 entradas ──────────────────────────────────────
    historialArea.appendChild(cel('p', 'historial-titulo', 'Historial Reciente:'));
    const lista = cel('ul', 'historial-lista');
    for (const d of [...datosEpley].reverse().slice(0, 15)) {
      const fecha = new Date(d.fecha + 'T00:00:00')
        .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
      const pesoRef = d.series[0] ? Number(d.series[0].peso) : null;
      const pesoStr = pesoRef === 0 ? 'BW' : pesoRef !== null ? `${pesoRef} ${unit}` : '';
      const repsStr = d.series.map(s => s.repeticiones).join(', ');
      const rm1Str  = d.max1RM > 0 ? ` (1RM Est: ${Math.round(d.max1RM)} ${unit})` : '';
      lista.appendChild(cel('li', 'historial-item',
        `* ${fecha}: ${pesoStr} × ${repsStr}${rm1Str}`));
    }
    historialArea.appendChild(lista);
  };

  selectEj.addEventListener('change', actualizarGrafica);
  selectMet.addEventListener('change', () => { actualizarInfoMetrica(); actualizarGrafica(); });
}

// ── Vista RÉCORDS ─────────────────────────────────────────────────────────────

const GRUPOS_ORDEN = ['PECHO', 'ESPALDA', 'PIERNA', 'HOMBRO', 'BRAZO', 'CORE', 'GENERAL'];

async function renderRecords(container, state) {
  const unit = state.prefUnit || 'lb';
  const prs  = await getPesoMaxPorEjercicio();

  if (prs.length === 0) {
    container.appendChild(cel('p', 'global-vacio', 'Aún no hay series registradas.'));
    return;
  }

  const hoy = new Date();
  hoy.setDate(hoy.getDate() - 28);
  const limiteReciente = hoy.toLocaleDateString('en-CA');

  // ── Sección 1: MEJOR POR GRUPO MUSCULAR ───────────────────────────────────
  const mejorPorGrupo = new Map();
  for (const pr of prs) {
    const g = (pr.grupo_muscular ?? 'GENERAL').toUpperCase();
    const actual = mejorPorGrupo.get(g);
    if (!actual || pr.peso_max > actual.peso_max) mejorPorGrupo.set(g, pr);
  }

  const cardGrupo = crearSeccion('MEJOR POR GRUPO MUSCULAR');
  const listaGrupo = cel('div', 'records-lista');
  const hdrGrupo = cel('div', 'records-fila records-header');
  hdrGrupo.appendChild(cel('span', 'records-grupo', 'GRUPO'));
  hdrGrupo.appendChild(cel('span', 'records-nombre-dim', 'EJERCICIO'));
  hdrGrupo.appendChild(cel('span', 'records-valor', 'PESO MÁX.'));
  listaGrupo.appendChild(hdrGrupo);
  for (const grupo of GRUPOS_ORDEN) {
    const fila = cel('div', 'records-fila');
    const best = mejorPorGrupo.get(grupo);
    fila.appendChild(cel('span', 'records-grupo', grupo));
    if (best) {
      fila.appendChild(cel('span', 'records-nombre-dim', best.nombre));
      fila.appendChild(cel('span', 'records-valor', `${Math.round(best.peso_max)} ${unit}`));
    } else {
      fila.appendChild(cel('span', 'records-vacio', '—'));
    }
    listaGrupo.appendChild(fila);
  }
  cardGrupo.appendChild(listaGrupo);
  container.appendChild(cardGrupo);

  // ── Sección 2: TOP 5 LIFTS ─────────────────────────────────────────────────
  const top5 = [...prs].sort((a, b) => b.peso_max - a.peso_max).slice(0, 5);
  const cardTop = crearSeccion('TOP 5 LIFTS');
  const listaTop = cel('div', 'records-lista');
  const hdrTop = cel('div', 'records-fila records-header');
  hdrTop.appendChild(cel('span', 'records-rank', '#'));
  hdrTop.appendChild(cel('span', 'records-nombre', 'EJERCICIO'));
  hdrTop.appendChild(cel('span', 'records-valor', 'PESO MÁX.'));
  hdrTop.appendChild(cel('span', 'records-fecha', 'FECHA'));
  listaTop.appendChild(hdrTop);
  top5.forEach((pr, i) => {
    const fila = cel('div', 'records-fila');
    fila.appendChild(cel('span', 'records-rank', String(i + 1)));
    fila.appendChild(cel('span', 'records-nombre', pr.nombre));
    fila.appendChild(cel('span', 'records-valor', `${Math.round(pr.peso_max)} ${unit}`));
    fila.appendChild(cel('span', 'records-fecha', formatFechaPR(pr.fecha_pr)));
    listaTop.appendChild(fila);
  });
  cardTop.appendChild(listaTop);
  container.appendChild(cardTop);

  // ── Sección 3: NUEVOS PRs RECIENTES (máx 5) ───────────────────────────────
  const recientes = prs
    .filter(r => r.fecha_pr >= limiteReciente)
    .sort((a, b) => b.fecha_pr.localeCompare(a.fecha_pr))
    .slice(0, 5);

  if (recientes.length > 0) {
    const cardRec = crearSeccion('↑ NUEVOS PRs — ÚLTIMAS 4 SEMANAS');
    const listaRec = cel('div', 'records-lista');
    const hdrRec = cel('div', 'records-fila records-header');
    hdrRec.appendChild(cel('span', 'records-nombre', 'EJERCICIO'));
    hdrRec.appendChild(cel('span', 'records-valor', 'PESO MÁX.'));
    hdrRec.appendChild(cel('span', 'records-fecha', 'FECHA'));
    listaRec.appendChild(hdrRec);
    for (const pr of recientes) {
      const fila = cel('div', 'records-fila is-destacado');
      fila.appendChild(cel('span', 'records-nombre', pr.nombre));
      fila.appendChild(cel('span', 'records-valor', `${Math.round(pr.peso_max)} ${unit}`));
      fila.appendChild(cel('span', 'records-fecha', formatFechaPR(pr.fecha_pr)));
      listaRec.appendChild(fila);
    }
    cardRec.appendChild(listaRec);
    container.appendChild(cardRec);
  }
}

function formatFechaPR(fechaStr) {
  return new Date(fechaStr + 'T12:00:00Z')
    .toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
    .toUpperCase();
}

// ── Vista HISTORIAL ───────────────────────────────────────────────────────────

const HISTORIAL_PAGINA_TAM = 10;
const DIAS_SEMANA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const HISTORIAL_ORDEN_OPCIONES = [
  { value: 'recientes',      label: 'Recientes primero' },
  { value: 'duracion-desc',  label: 'Duración: mayor a menor' },
  { value: 'duracion-asc',   label: 'Duración: menor a mayor' },
];

async function renderHistorial(container, state) {
  const [fechas, rutinas] = await Promise.all([getFechasConSesiones(), getRutinas()]); // fechas DESC

  if (fechas.length === 0) {
    container.appendChild(cel('p', 'global-vacio', 'Aún no hay sesiones registradas.'));
    return;
  }

  const fechasSet = new Set(fechas);

  // root es un nodo nuevo por cada visita a la tab (renderTabContent limpia
  // el container antes de llamar aquí), así que el listener delegado de abajo
  // no necesita AbortController: muere con el nodo al cambiar de tab.
  const root = cel('div', 'historial-root');
  container.appendChild(root);

  const cardCal = crearSeccion('EXPLORAR POR RANGO DE FECHAS');
  const rangoResumen = cel('p', 'historial-rango-resumen');
  cardCal.appendChild(rangoResumen);
  root.appendChild(cardCal);

  // ── Filtros: rutina + orden ────────────────────────────────────────────────
  const cardFiltros = cel('div', 'historial-filtros');

  const selectRutinaFiltro = document.createElement('select');
  selectRutinaFiltro.setAttribute('aria-label', 'Filtrar por rutina');
  const optTodas = document.createElement('option');
  optTodas.value = '';
  optTodas.textContent = 'Todas las rutinas';
  selectRutinaFiltro.appendChild(optTodas);
  for (const r of rutinas) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.nombre;
    selectRutinaFiltro.appendChild(opt);
  }
  cardFiltros.appendChild(selectRutinaFiltro);

  const selectOrden = document.createElement('select');
  selectOrden.setAttribute('aria-label', 'Ordenar por');
  for (const { value, label } of HISTORIAL_ORDEN_OPCIONES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    selectOrden.appendChild(opt);
  }
  cardFiltros.appendChild(selectOrden);
  root.appendChild(cardFiltros);

  const detalle = cel('div', 'historial-detalle');
  root.appendChild(detalle);

  // Rango inicial: los últimos hasta 10 días con sesión — misma sensación que
  // antes (mostrar lo más reciente sin que el usuario tenga que elegir nada).
  let rangoInicio = fechas[Math.min(HISTORIAL_PAGINA_TAM - 1, fechas.length - 1)];
  let rangoFin    = fechas[0];
  let pagina      = 0;
  let sesionesRango = []; // cache en memoria del rango actual — filtro/orden/página no reconsultan la BD

  const [yInit, mInit] = fechas[0].split('-').map(Number);
  let mesActual = new Date(Date.UTC(yInit, mInit - 1, 1));

  const refrescarCalendario = () => {
    cardCal.querySelector('.historial-cal')?.remove();
    cardCal.appendChild(construirCalendario(mesActual, fechasSet, rangoInicio, rangoFin));
    rangoResumen.textContent = !rangoInicio
      ? 'Elige la fecha de inicio'
      : !rangoFin
        ? `DESDE ${formatFechaCorta(rangoInicio)} · elige la fecha final`
        : `DESDE ${formatFechaCorta(rangoInicio)} · HASTA ${formatFechaCorta(rangoFin)}`;
  };

  // Repinta la lista a partir de sesionesRango ya cargado — sin tocar la BD,
  // así que filtrar/ordenar/paginar se siente instantáneo.
  const refrescarResultados = () => {
    detalle.textContent = '';

    if (!rangoInicio || !rangoFin) {
      detalle.appendChild(cel('p', 'global-vacio', 'Selecciona la fecha final del rango.'));
      return;
    }

    const rutinaId = selectRutinaFiltro.value ? Number(selectRutinaFiltro.value) : null;
    const sesionesFiltradas = rutinaId
      ? sesionesRango.filter(ses => ses.rutina_id === rutinaId)
      : sesionesRango;

    if (sesionesFiltradas.length === 0) {
      detalle.appendChild(cel('p', 'global-vacio', 'No hay sesiones en el rango y filtros seleccionados.'));
      return;
    }

    const ordenadas = ordenarSesiones(sesionesFiltradas, selectOrden.value);

    const totalPaginas = Math.ceil(ordenadas.length / HISTORIAL_PAGINA_TAM);
    if (pagina >= totalPaginas) pagina = totalPaginas - 1;
    const desde = pagina * HISTORIAL_PAGINA_TAM;
    const sesionesPagina = ordenadas.slice(desde, desde + HISTORIAL_PAGINA_TAM);

    for (const ses of sesionesPagina) {
      renderSesionDetalleCompleto(detalle, ses, state.prefUnit || 'lb');
    }

    if (totalPaginas > 1) {
      detalle.appendChild(construirPaginacion(pagina, totalPaginas, ordenadas.length));
    }
  };

  // Trae el rango completo en una sola query y cachea en sesionesRango.
  const cargarRango = async () => {
    if (!rangoInicio || !rangoFin) {
      sesionesRango = [];
      refrescarResultados();
      return;
    }
    const filas = await getSesionesConSeriesEnRango(rangoInicio, rangoFin);
    sesionesRango = agruparFilasPorSesion(filas);
    refrescarResultados();
  };

  root.addEventListener('click', e => {
    const diaBtn = e.target.closest('.historial-cal-dia');
    if (diaBtn) {
      const fecha = diaBtn.dataset.fecha;
      if (rangoInicio && rangoFin) {
        // rango ya completo — un nuevo click empieza otro rango
        rangoInicio = fecha;
        rangoFin = null;
      } else if (rangoInicio && !rangoFin) {
        // segundo click cierra el rango, ordenando si tocaron antes del inicio
        if (fecha < rangoInicio) { rangoFin = rangoInicio; rangoInicio = fecha; }
        else { rangoFin = fecha; }
      } else {
        rangoInicio = fecha;
      }
      pagina = 0;
      refrescarCalendario();
      cargarRango();
      return;
    }

    const navBtn = e.target.closest('.historial-cal-nav-btn');
    if (navBtn) {
      const delta = Number(navBtn.dataset.delta);
      mesActual = new Date(Date.UTC(mesActual.getUTCFullYear(), mesActual.getUTCMonth() + delta, 1));
      refrescarCalendario();
      return;
    }

    const pagBtn = e.target.closest('.historial-pag-btn');
    if (pagBtn) {
      pagina = Math.max(0, pagina + Number(pagBtn.dataset.delta));
      refrescarResultados();
    }
  });

  selectRutinaFiltro.addEventListener('change', () => { pagina = 0; refrescarResultados(); });
  selectOrden.addEventListener('change', () => { pagina = 0; refrescarResultados(); });

  refrescarCalendario();
  await cargarRango();
}

// 'recientes' (default): fecha DESC, sesion_id DESC como desempate. Los órdenes
// por duración mandan al final las sesiones sin hora_inicio/hora_fin en vez de
// romper el sort (calcularDuracionMin puede devolver null).
function ordenarSesiones(sesiones, orden) {
  const arr = [...sesiones];
  if (orden === 'duracion-desc' || orden === 'duracion-asc') {
    const signo = orden === 'duracion-desc' ? -1 : 1;
    arr.sort((a, b) => {
      const da = calcularDuracionMin(a)?.mins;
      const db = calcularDuracionMin(b)?.mins;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return signo * (da - db);
    });
    return arr;
  }
  arr.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.sesion_id - a.sesion_id);
  return arr;
}

function formatFechaCorta(fecha) {
  return new Date(fecha + 'T12:00:00Z')
    .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
    .toUpperCase();
}

// Calendario de un mes con selección de rango (inicio/fin) por clicks y un
// punto de acento bajo los días que sí tienen sesión registrada.
function construirCalendario(mesDate, fechasSet, rangoInicio, rangoFin) {
  const cal = cel('div', 'historial-cal');

  const nav = cel('div', 'historial-cal-nav');
  const btnPrev = cel('button', 'historial-cal-nav-btn', '‹');
  btnPrev.type = 'button';
  btnPrev.dataset.delta = '-1';
  const label = cel('span', 'historial-cal-mes', mesDate
    .toLocaleDateString('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .toUpperCase());
  const btnNext = cel('button', 'historial-cal-nav-btn', '›');
  btnNext.type = 'button';
  btnNext.dataset.delta = '1';
  nav.appendChild(btnPrev);
  nav.appendChild(label);
  nav.appendChild(btnNext);
  cal.appendChild(nav);

  const grid = cel('div', 'historial-cal-grid');
  for (const d of DIAS_SEMANA) grid.appendChild(cel('span', 'historial-cal-dow', d));

  const year  = mesDate.getUTCFullYear();
  const month = mesDate.getUTCMonth();
  const primerDiaSemana = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // 0 = lunes
  const diasEnMes = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  for (let i = 0; i < primerDiaSemana; i++) grid.appendChild(cel('span', 'historial-cal-spacer'));

  for (let d = 1; d <= diasEnMes; d++) {
    const fecha = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const celda = cel('button', 'historial-cal-dia', String(d));
    celda.type = 'button';
    celda.dataset.fecha = fecha;
    if (fechasSet.has(fecha)) celda.classList.add('has-sesion');
    if (rangoInicio && rangoFin && fecha >= rangoInicio && fecha <= rangoFin) {
      celda.classList.add('is-in-range');
    }
    if (fecha === rangoInicio) celda.classList.add('is-rango-inicio');
    if (fecha === rangoFin)    celda.classList.add('is-rango-fin');
    grid.appendChild(celda);
  }

  cal.appendChild(grid);
  return cal;
}

function construirPaginacion(pagina, totalPaginas, totalSesiones) {
  const nav = cel('div', 'historial-pag');

  const btnPrev = cel('button', 'historial-pag-btn', '‹ ANTERIOR');
  btnPrev.type = 'button';
  btnPrev.dataset.delta = '-1';
  btnPrev.disabled = pagina === 0;

  const btnNext = cel('button', 'historial-pag-btn', 'SIGUIENTE ›');
  btnNext.type = 'button';
  btnNext.dataset.delta = '1';
  btnNext.disabled = pagina >= totalPaginas - 1;

  nav.appendChild(btnPrev);
  nav.appendChild(cel('span', 'historial-pag-info', `${pagina + 1} / ${totalPaginas} · ${totalSesiones} SESIONES`));
  nav.appendChild(btnNext);
  return nav;
}

// Detalle completo de una sesión ya agrupada (ver agruparFilasPorSesion): una
// tarjeta colapsada por defecto (fecha/rutina/duración/conteo en una línea), que
// al abrirse muestra sus ejercicios — cada uno también colapsado, y al abrirse
// muestra sus sets como tabla SERIE/PESO/REPS.
function renderSesionDetalleCompleto(container, ses, unit) {
  const fechaStr = new Date(ses.fecha + 'T12:00:00Z')
    .toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })
    .toUpperCase();

  const ejercs = [...ses.ejercicios.values()];
  const totalSeries = ejercs.reduce((sum, e) => sum + e.series.length, 0);
  const dur = calcularDuracionMin(ses);

  const bloque = document.createElement('details');
  bloque.className = 'historial-sesion-bloque';

  const summary = cel('summary', 'historial-sesion-summary');
  const linea1 = cel('div', 'sesresumen-header');
  linea1.appendChild(cel('span', 'sesresumen-fecha', fechaStr));
  if (ses.rutina_nombre) {
    linea1.appendChild(cel('span', 'sesresumen-rutina', ses.rutina_nombre.toUpperCase()));
  }
  summary.appendChild(linea1);

  const metaTexto = `${ejercs.length} EJERC · ${totalSeries} SERIES${dur ? ` · ${dur.texto}` : ''}`;
  summary.appendChild(cel('div', 'historial-sesion-meta', metaTexto));
  bloque.appendChild(summary);

  const cuerpo = cel('div', 'historial-sesion-cuerpo');
  for (const { nombre, series } of ejercs) {
    const details = document.createElement('details');
    details.className = 'historial-ej-fila';

    const ejSummary = cel('summary', 'historial-ej-summary');
    ejSummary.appendChild(cel('span', 'historial-ej-nombre', nombre));
    ejSummary.appendChild(cel('span', 'historial-ej-sets', `×${series.length}`));
    details.appendChild(ejSummary);

    const tabla = cel('div', 'historial-sets-tabla');
    tabla.appendChild(cel('span', 'historial-sets-th', 'SERIE'));
    tabla.appendChild(cel('span', 'historial-sets-th historial-sets-th-r', 'PESO'));
    tabla.appendChild(cel('span', 'historial-sets-th historial-sets-th-r', 'REPS'));
    for (const s of series) {
      const pesoStr = Number(s.peso) === 0 ? 'BW' : `${s.peso}${unit}`;
      tabla.appendChild(cel('span', 'historial-sets-td', `S${s.numero_serie}`));
      tabla.appendChild(cel('span', 'historial-sets-td historial-sets-td-r', pesoStr));
      tabla.appendChild(cel('span', 'historial-sets-td historial-sets-td-r', String(s.repeticiones)));
    }
    details.appendChild(tabla);
    cuerpo.appendChild(details);
  }
  bloque.appendChild(cuerpo);

  container.appendChild(bloque);
}
