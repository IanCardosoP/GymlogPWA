// Componente Progreso: gráfica de barras ASCII por 1RM estimado (Fórmula de Epley)
import { getRutinas, getRutinaEjercicios, getSeriesPorEjercicio } from '../db.js';
import { METRICAS_REGISTRY, prepararDatosProgreso } from '../analitico.js';

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export async function render(state) {
  const container = document.getElementById('progreso-container');
  if (!container) return;
  container.textContent = '';

  const rutinas = await getRutinas();

  // ── Select Rutina ──────────────────────────────────────────────────────────
  const rutLabel = document.createElement('label');
  rutLabel.setAttribute('for', 'select-rutina');
  rutLabel.textContent = 'Rutina: ';
  rutLabel.className = 'progreso-label';
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

  // ── Select Ejercicio (deshabilitado hasta elegir rutina) ───────────────────
  const ejLabel = document.createElement('label');
  ejLabel.setAttribute('for', 'select-ejercicio');
  ejLabel.textContent = 'Ejercicio: ';
  ejLabel.className = 'progreso-label';
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
  const metLabel = document.createElement('label');
  metLabel.setAttribute('for', 'select-metrica');
  metLabel.textContent = 'Métrica: ';
  metLabel.className = 'progreso-label';
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

  function actualizarInfoMetrica() {
    metricaBody.textContent = '';
    const metrica = METRICAS_REGISTRY[selectMet.value];
    if (!metrica?.descripcion) return;
    for (const linea of metrica.descripcion) {
      metricaBody.appendChild(cel('p', 'metrica-info-p', linea));
    }
  }
  actualizarInfoMetrica();

  container.appendChild(document.createElement('hr'));

  const graficaArea = cel('div', 'grafica-area');
  graficaArea.id = 'grafica-area';
  container.appendChild(graficaArea);

  const historialArea = cel('div', 'historial-area');
  historialArea.id = 'historial-area';
  container.appendChild(historialArea);

  // ── Cascada Rutina → Ejercicio ─────────────────────────────────────────────
  selectRut.addEventListener('change', async () => {
    selectEj.textContent = '';
    selectEj.appendChild(optEjVacio.cloneNode(true));
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

  // ── Render gráfica/historial ───────────────────────────────────────────────
  async function actualizarGrafica() {
    graficaArea.textContent = '';
    historialArea.textContent = '';
    const ejId = parseInt(selectEj.value);
    if (!ejId) return;

    const series  = await getSeriesPorEjercicio(ejId);
    const datos   = prepararDatosProgreso(series);
    const unit    = state.prefUnit || 'lb';

    graficaArea.appendChild(cel('p', 'grafica-titulo', 'Evolución últimas 5 sesiones:'));

    const ultimas5 = datos.slice(-5).filter(d => d.barra !== null);

    if (ultimas5.length === 0) {
      graficaArea.appendChild(cel('p', 'grafica-sin-datos', 'Sin datos con peso registrado.'));
    }

    for (const d of ultimas5) {
      const fila = cel('div', 'grafica-fila');
      const fecha = new Date(d.fecha + 'T00:00:00')
        .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
      fila.appendChild(cel('span', 'grafica-fecha', `${fecha}: `));
      fila.appendChild(cel('span', 'grafica-valor',
        `${Math.round(d.max1RM)} ${unit}  `));
      fila.appendChild(cel('span', 'grafica-barra', `|${d.barra}|`));
      graficaArea.appendChild(fila);
    }

    historialArea.appendChild(cel('p', 'historial-titulo', 'Historial Reciente:'));
    const lista = cel('ul', 'historial-lista');

    for (const d of [...datos].reverse()) {
      const fecha = new Date(d.fecha + 'T00:00:00')
        .toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
      const pesoRef = d.series[0] ? Number(d.series[0].peso) : null;
      const pesoStr = pesoRef === 0 ? 'BW' : pesoRef !== null ? `${pesoRef} ${unit}` : '';
      const repsStr = d.series.map(s => s.repeticiones).join(', ');
      const rm1Str  = d.max1RM > 0 ? ` (1RM Est: ${Math.round(d.max1RM)} ${unit})` : '';

      const li = cel('li', 'historial-item',
        `* ${fecha}: ${pesoStr} × ${repsStr}${rm1Str}`);
      lista.appendChild(li);
    }
    historialArea.appendChild(lista);
  }

  selectEj.addEventListener('change', actualizarGrafica);
  selectMet.addEventListener('change', () => {
    actualizarInfoMetrica();
    actualizarGrafica();
  });
}
