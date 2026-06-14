// Componente Config: asignación de rutinas semanales, unidades kg/lb y gestión CSV
import { dispatch } from '../app.js';
import {
  getRutinas, saveRutina, updateRutinaDia, clearRutinaDia,
  getConf, updatePrefUnit,
  getDB, getAllSeriesForExport,
} from '../db.js';
import { exportarCSV, importarCSV } from '../csv.js';

const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export async function render(state) {
  const container = document.getElementById('config-container');
  if (!container) return;
  container.textContent = '';

  const [rutinas, conf] = await Promise.all([getRutinas(), getConf()]);

  // ── 1. Asignación de rutinas / días ──────────────────────────────────────
  const secDias = cel('section', 'config-seccion');
  secDias.appendChild(cel('h3', 'config-titulo', '[1. ASIGNACIÓN DE RUTINAS / DÍAS]'));

  for (let dia = 0; dia < 7; dia++) {
    const fila = cel('div', 'config-dia-fila');

    const label = document.createElement('label');
    label.textContent = `${DIAS[dia]}: `;
    label.setAttribute('for', `select-dia-${dia}`);
    fila.appendChild(label);

    const select = document.createElement('select');
    select.id = `select-dia-${dia}`;
    select.className = 'config-dia-select';
    select.dataset.dia = dia;

    const optDescanso = document.createElement('option');
    optDescanso.value = '';
    optDescanso.textContent = 'Descanso';
    select.appendChild(optDescanso);

    for (const rutina of rutinas) {
      const opt = document.createElement('option');
      opt.value = rutina.id;
      opt.textContent = rutina.nombre;
      if (rutina.dia_sugerido === dia) opt.selected = true;
      select.appendChild(opt);
    }

    fila.appendChild(select);
    secDias.appendChild(fila);
  }

  // Nueva rutina
  const nuevaWrapper = cel('div', 'config-nueva-rutina');

  const inputNueva = document.createElement('input');
  inputNueva.type = 'text';
  inputNueva.id = 'input-nueva-rutina';
  inputNueva.className = 'input-nueva-rutina';
  inputNueva.placeholder = 'Nombre de la nueva rutina...';
  nuevaWrapper.appendChild(inputNueva);

  const btnNueva = cel('button', 'btn-nueva-rutina', '[+ Crear nueva rutina]');
  nuevaWrapper.appendChild(btnNueva);

  secDias.appendChild(nuevaWrapper);
  container.appendChild(secDias);

  // ── 2. Unidad de medida ──────────────────────────────────────────────────
  const secUnidad = cel('section', 'config-seccion');
  secUnidad.appendChild(cel('h3', 'config-titulo', '[2. UNIDAD DE MEDIDA GLOBAL]'));

  for (const unit of ['kg', 'lb']) {
    const label = document.createElement('label');
    label.className = 'config-radio-label';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'pref-unit';
    radio.value = unit;
    radio.className = 'config-radio';
    if (conf.pref_unit === unit) radio.checked = true;

    label.appendChild(radio);
    label.appendChild(document.createTextNode(` ${unit.toUpperCase()}`));
    secUnidad.appendChild(label);
  }

  container.appendChild(secUnidad);

  // ── 3. Gestión de datos CSV ──────────────────────────────────────────────
  const secCSV = cel('section', 'config-seccion');
  secCSV.appendChild(cel('h3', 'config-titulo', '[3. GESTIÓN DE DATOS HISTÓRICOS]'));

  const btnExportar = cel('button', 'btn-exportar-csv',
    '[ Respaldar todo a un archivo CSV (Exportar) ]');
  secCSV.appendChild(btnExportar);

  const inputArchivo = document.createElement('input');
  inputArchivo.type = 'file';
  inputArchivo.id = 'input-csv-file';
  inputArchivo.className = 'input-archivo';
  inputArchivo.accept = '.csv';
  secCSV.appendChild(inputArchivo);

  const btnImportar = cel('button', 'btn-importar-csv',
    '[ Importar y Combinar CSV (Restaurar) ]');
  secCSV.appendChild(btnImportar);

  const resultadoEl = cel('p', 'resultado-importacion');
  resultadoEl.id = 'resultado-importacion';
  secCSV.appendChild(resultadoEl);

  container.appendChild(secCSV);

  // Footer
  const footer = cel('footer', 'config-footer',
    'GymLog v1.0.0-wasm | DB: idb://gym-log-db (Postgres)');
  container.appendChild(footer);

  // ── Eventos ──────────────────────────────────────────────────────────────

  secDias.addEventListener('change', async e => {
    const select = e.target.closest('.config-dia-select');
    if (!select) return;
    const dia = parseInt(select.dataset.dia);
    const rutinaId = select.value ? parseInt(select.value) : null;
    if (rutinaId) {
      await updateRutinaDia(rutinaId, dia);
    } else {
      await clearRutinaDia(dia);
    }
  });

  btnNueva.addEventListener('click', async () => {
    const nombre = inputNueva.value.trim();
    if (!nombre) return;
    await saveRutina(nombre, null);
    inputNueva.value = '';
    await render(state);
  });

  secUnidad.addEventListener('change', async e => {
    const radio = e.target.closest('.config-radio');
    if (!radio) return;
    await updatePrefUnit(radio.value);
    dispatch('SET_PREF_UNIT', radio.value);
  });

  btnExportar.addEventListener('click', async () => {
    const datos = await getAllSeriesForExport();
    exportarCSV(datos);
  });

  btnImportar.addEventListener('click', async () => {
    const archivo = inputArchivo.files?.[0];
    if (!archivo) {
      resultadoEl.textContent = 'Selecciona un archivo CSV primero.';
      return;
    }
    const texto   = await archivo.text();
    const dbInst  = getDB();
    const resultado = await importarCSV(texto, dbInst);
    if (resultado.error) {
      resultadoEl.textContent = `Error: ${resultado.error}`;
    } else {
      resultadoEl.textContent =
        `Importación completada: ${resultado.exitosas} series, ${resultado.fallidas} fallidas.`;
    }
  });
}
