// Componente Progreso: 3 tabs — Global, Ejercicios, Récords
import {
  getRutinas, getRutinaEjercicios, getSeriesPorEjercicio,
  getEstadisticasGlobales, getActividadSemanal, getVolumenPorGrupoMuscular,
  getPR1RMPorEjercicio, getVolumenPorSesion,
} from '../db.js';
import {
  METRICAS_REGISTRY, prepararDatosProgreso, calcularTendencia, calcularRacha,
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
  const tabNames = ['GLOBAL', 'EJERCICIOS', 'RÉCORDS'];
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
}

// ── Vista GLOBAL ──────────────────────────────────────────────────────────────

async function renderGlobal(container, state) {
  const fechaHoy = new Date().toLocaleDateString('en-CA');
  const [stats, actividad, distribucion] = await Promise.all([
    getEstadisticasGlobales(fechaHoy),
    getActividadSemanal(fechaHoy, 8),
    getVolumenPorGrupoMuscular(fechaHoy, 4),
  ]);

  const racha   = calcularRacha(stats.fechas, fechaHoy);
  const frecSem = stats.sesiones_4_sem > 0 ? (stats.sesiones_4_sem / 4).toFixed(1) : '0';
  const volFmt  = formatVolumen(stats.volumen_total);

  // ── Stat chips 2×2 ────────────────────────────────────────────────────────
  const grid = cel('div', 'global-chips');
  grid.appendChild(crearChip(String(stats.total_sesiones), 'SESIONES TOTALES'));
  grid.appendChild(crearChip(`${racha}D`,                 'RACHA ACTIVA'));
  grid.appendChild(crearChip(volFmt,                      'VOL. ACUMULADO'));
  grid.appendChild(crearChip(`${frecSem}/SEM`,            'PROM. SEMANAL — 4 SEM'));
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
  const prs  = await getPR1RMPorEjercicio();

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
    if (!actual || pr.pr_1rm > actual.pr_1rm) mejorPorGrupo.set(g, pr);
  }

  const cardGrupo = crearSeccion('MEJOR POR GRUPO MUSCULAR');
  const listaGrupo = cel('div', 'records-lista');
  for (const grupo of GRUPOS_ORDEN) {
    const fila = cel('div', 'records-fila');
    const best = mejorPorGrupo.get(grupo);
    fila.appendChild(cel('span', 'records-grupo', grupo));
    if (best) {
      fila.appendChild(cel('span', 'records-nombre-dim', best.nombre));
      fila.appendChild(cel('span', 'records-valor', `~${Math.round(best.pr_1rm)} ${unit}`));
    } else {
      fila.appendChild(cel('span', 'records-vacio', '—'));
    }
    listaGrupo.appendChild(fila);
  }
  cardGrupo.appendChild(listaGrupo);
  container.appendChild(cardGrupo);

  // ── Sección 2: TOP 5 LIFTS ─────────────────────────────────────────────────
  const top5 = [...prs].sort((a, b) => b.pr_1rm - a.pr_1rm).slice(0, 5);
  const cardTop = crearSeccion('TOP 5 LIFTS');
  const listaTop = cel('div', 'records-lista');
  top5.forEach((pr, i) => {
    const fila = cel('div', 'records-fila');
    fila.appendChild(cel('span', 'records-rank', String(i + 1)));
    fila.appendChild(cel('span', 'records-nombre', pr.nombre));
    fila.appendChild(cel('span', 'records-valor', `~${Math.round(pr.pr_1rm)} ${unit}`));
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
    for (const pr of recientes) {
      const fila = cel('div', 'records-fila is-destacado');
      fila.appendChild(cel('span', 'records-nombre', pr.nombre));
      fila.appendChild(cel('span', 'records-valor', `~${Math.round(pr.pr_1rm)} ${unit}`));
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
