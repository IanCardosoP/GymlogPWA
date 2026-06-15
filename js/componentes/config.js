// Componente Config: administración de rutinas, unidades kg/lb y gestión CSV
import { dispatch, aplicarAcento, ACENTOS } from '../app.js';
import {
  getRutinas, saveRutina,
  getRutinasDias, addRutinaDia, removeRutinaDia,
  updateRutinaNombre, deleteRutina,
  getConf, updatePrefUnit, updatePrefAcento,
  getDB, getAllDataForExport,
} from '../db.js';
import { exportarBackup, importarBackup } from '../csv.js';

const ACENTOS_LABELS = {
  verde:  'Verde terminal',
  morado: 'Morado ciberpunk',
  rosa:   'Rosa eléctrico',
  cian:   'Azul cian',
};

const DIAS_CORTO = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];

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

  const [rutinas, rutinasDias, conf] = await Promise.all([
    getRutinas(), getRutinasDias(), getConf(),
  ]);

  // ── 1. Administración de rutinas / días ──────────────────────────────────
  const secAdmin = cel('section', 'config-seccion');
  secAdmin.appendChild(cel('h3', 'config-titulo', '[1. ADMINISTRACIÓN DE RUTINAS / DÍAS]'));

  const listaRutinas = cel('div', 'rutinas-lista');

  for (const rutina of rutinas) {
    const diasRutina = rutinasDias
      .filter(rd => rd.rutina_id === rutina.id)
      .map(rd => rd.dia)
      .sort((a, b) => a - b);

    const badgeTexto = diasRutina.length === 0
      ? 'LIBRE'
      : diasRutina.map(d => DIAS_CORTO[d]).join('·');

    const item = cel('div', 'rutina-item');
    item.dataset.rutinaId = rutina.id;

    const fila = cel('div', 'rutina-fila');

    const nombreSpan = cel('span', 'rutina-nombre', rutina.nombre);
    fila.appendChild(nombreSpan);

    const badge = cel('button', 'rutina-dia-badge', badgeTexto);
    if (diasRutina.length > 0) badge.classList.add('is-assigned');
    badge.dataset.rutinaId = rutina.id;
    badge.dataset.dias = JSON.stringify(diasRutina);
    fila.appendChild(badge);

    const btnEdit = cel('button', 'btn-edit', '[ ✎ ]');
    btnEdit.dataset.rutinaId = rutina.id;
    btnEdit.dataset.nombre   = rutina.nombre;
    fila.appendChild(btnEdit);

    const btnDel = cel('button', 'btn-delete', '[ ✕ ]');
    btnDel.dataset.rutinaId = rutina.id;
    btnDel.dataset.nombre   = rutina.nombre;
    fila.appendChild(btnDel);

    item.appendChild(fila);
    listaRutinas.appendChild(item);
  }

  secAdmin.appendChild(listaRutinas);

  // Crear nueva rutina
  const nuevaWrapper = cel('div', 'config-nueva-rutina');
  const inputNueva = document.createElement('input');
  inputNueva.type = 'text';
  inputNueva.className = 'input-nueva-rutina';
  inputNueva.placeholder = 'Nueva rutina...';
  nuevaWrapper.appendChild(inputNueva);
  const btnNueva = cel('button', 'btn-nueva-rutina', '[+ CREAR]');
  nuevaWrapper.appendChild(btnNueva);
  secAdmin.appendChild(nuevaWrapper);

  container.appendChild(secAdmin);

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

  // ── 3. Gestión de datos ──────────────────────────────────────────────────
  const secCSV = cel('section', 'config-seccion');
  secCSV.appendChild(cel('h3', 'config-titulo', '[3. GESTIÓN DE DATOS]'));

  const btnExportar = cel('button', 'btn-exportar-csv',
    '[ Exportar backup completo (.json) ]');
  secCSV.appendChild(btnExportar);

  const inputArchivo = document.createElement('input');
  inputArchivo.type = 'file';
  inputArchivo.className = 'input-archivo';
  inputArchivo.accept = '.json';
  secCSV.appendChild(inputArchivo);

  const btnImportar = cel('button', 'btn-importar-csv',
    '[ Restaurar desde backup (.json) ]');
  secCSV.appendChild(btnImportar);

  const resultadoEl = cel('p', 'resultado-importacion');
  secCSV.appendChild(resultadoEl);

  container.appendChild(secCSV);

  // ── 4. Color de acento ───────────────────────────────────────────────────
  const secAcento = cel('section', 'config-seccion');
  secAcento.appendChild(cel('h3', 'config-titulo', '[4. COLOR DE ACENTO]'));

  const selectorEl = cel('div', 'acento-selector');
  const acentoActual = conf.pref_acento ?? 'verde';
  for (const key of Object.keys(ACENTOS)) {
    const btn = cel('button', `acento-swatch acento-swatch-${key}`);
    btn.dataset.acento = key;
    btn.title = ACENTOS_LABELS[key];
    if (key === acentoActual) btn.classList.add('is-active');
    selectorEl.appendChild(btn);
  }
  secAcento.appendChild(selectorEl);
  container.appendChild(secAcento);

  // ── 5. Eliminar datos ────────────────────────────────────────────────────
  const secReset = cel('section', 'config-seccion');
  secReset.appendChild(cel('h3', 'config-titulo', '[5. ELIMINAR DATOS]'));
  secReset.appendChild(cel('p', 'reset-advertencia',
    '⚠ Esta acción elimina toda la base de datos, caché y datos de la app. ' +
    'Recomendamos exportar un backup .json antes de continuar.'));
  const btnReset = cel('button', 'btn-reset-datos', '[ ⚠ REINICIO DE FÁBRICA ]');
  secReset.appendChild(btnReset);
  container.appendChild(secReset);

  // Footer — versión derivada dinámicamente del CACHE_NAME activo del SW
  const footer = document.createElement('footer');
  footer.className = 'config-footer';
  const versionNode = document.createTextNode('gymlog-wasm | DB: idb://gym-log-db (Postgres)');
  footer.appendChild(versionNode);
  if ('caches' in window) {
    caches.keys().then(keys => {
      const v = keys.find(k => k.startsWith('gymlog')) ?? 'gymlog';
      versionNode.nodeValue = `${v}-wasm | DB: idb://gym-log-db (Postgres)`;
    });
  }
  footer.appendChild(document.createElement('br'));
  const credLink = document.createElement('a');
  credLink.href = 'https://github.com/IanCardosoP';
  credLink.textContent = 'Ian Cardoso - 2026';
  credLink.target = '_blank';
  credLink.rel = 'noopener noreferrer';
  credLink.className = 'config-footer-link';
  footer.appendChild(credLink);
  container.appendChild(footer);

  // ── Eventos ──────────────────────────────────────────────────────────────

  secAdmin.addEventListener('click', async e => {
    // Badge de días → toggle day picker
    const badge = e.target.closest('.rutina-dia-badge');
    if (badge) {
      const item = badge.closest('.rutina-item');
      const picker = item.querySelector('.dia-picker');
      item.querySelector('.rename-panel')?.remove();
      item.querySelector('.confirm-delete-panel')?.remove();
      if (picker) { picker.remove(); return; }

      const rutinaId  = parseInt(badge.dataset.rutinaId);
      const diasActivos = JSON.parse(badge.dataset.dias || '[]');

      const pickerEl = cel('div', 'dia-picker');
      for (let d = 0; d < 7; d++) {
        const chip = cel('button', 'dia-chip', DIAS_CORTO[d]);
        chip.dataset.rutinaId = rutinaId;
        chip.dataset.dia = d;
        if (diasActivos.includes(d)) chip.classList.add('is-active');
        pickerEl.appendChild(chip);
      }
      item.appendChild(pickerEl);
      return;
    }

    // Chip de día → toggle asignación
    const chip = e.target.closest('.dia-chip');
    if (chip) {
      const rutinaId = parseInt(chip.dataset.rutinaId);
      const dia      = parseInt(chip.dataset.dia);
      if (chip.classList.contains('is-active')) {
        await removeRutinaDia(rutinaId, dia);
      } else {
        await addRutinaDia(rutinaId, dia);
      }
      await render(state);
      return;
    }

    // [ ✎ ] renombrar rutina
    const btnEdit = e.target.closest('.btn-edit');
    if (btnEdit && btnEdit.dataset.rutinaId) {
      const item = btnEdit.closest('.rutina-item');
      const existente = item.querySelector('.rename-panel');
      item.querySelector('.confirm-delete-panel')?.remove();
      item.querySelector('.dia-picker')?.remove();
      if (existente) { existente.remove(); return; }

      const rutinaId     = parseInt(btnEdit.dataset.rutinaId);
      const nombreActual = btnEdit.dataset.nombre ?? '';

      const panel = cel('div', 'rename-panel');
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input-rename-ejercicio';
      input.value = nombreActual;
      panel.appendChild(input);

      const btnGuardar = cel('button', 'btn-panel-accion btn-guardar-nombre-rutina', '[ GUARDAR ]');
      btnGuardar.dataset.rutinaId = rutinaId;
      const btnCancel  = cel('button', 'btn-panel-cancel', '[ CANCELAR ]');
      panel.appendChild(btnGuardar);
      panel.appendChild(btnCancel);

      const guardar = async () => {
        const nuevo = input.value.trim();
        if (!nuevo || nuevo === nombreActual) { panel.remove(); return; }
        await updateRutinaNombre(rutinaId, nuevo);
        await render(state);
      };
      btnGuardar.addEventListener('click', guardar);
      btnCancel.addEventListener('click', () => panel.remove());
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter')  { ev.preventDefault(); guardar(); }
        if (ev.key === 'Escape') panel.remove();
      });

      item.appendChild(panel);
      input.focus();
      input.select();
      return;
    }

    // [ ✕ ] eliminar rutina
    const btnDel = e.target.closest('.btn-delete');
    if (btnDel && btnDel.dataset.rutinaId) {
      const item = btnDel.closest('.rutina-item');
      const existente = item.querySelector('.confirm-delete-panel');
      item.querySelector('.rename-panel')?.remove();
      item.querySelector('.dia-picker')?.remove();
      if (existente) { existente.remove(); return; }

      const rutinaId = parseInt(btnDel.dataset.rutinaId);
      const nombre   = btnDel.dataset.nombre ?? '?';

      const panel = cel('div', 'confirm-delete-panel');
      panel.appendChild(cel('span', 'confirm-delete-msg',
        `¿Eliminar rutina "${nombre}"? Se perderán sus ejercicios configurados.`));

      const btnConf   = cel('button', 'btn-confirmar-eliminar', '[ ELIMINAR ]');
      btnConf.dataset.rutinaId = rutinaId;
      const btnCancel = cel('button', 'btn-cancelar-eliminar', '[ CANCELAR ]');
      panel.appendChild(btnConf);
      panel.appendChild(btnCancel);

      item.appendChild(panel);
      return;
    }

    // Confirmar eliminación
    const btnConf = e.target.closest('.btn-confirmar-eliminar');
    if (btnConf && btnConf.dataset.rutinaId) {
      await deleteRutina(parseInt(btnConf.dataset.rutinaId));
      await render(state);
      return;
    }

    // Cancelar panel
    const btnCancel = e.target.closest('.btn-cancelar-eliminar');
    if (btnCancel) {
      btnCancel.closest('.confirm-delete-panel')?.remove();
      return;
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

  secAcento.addEventListener('click', async e => {
    const btn = e.target.closest('.acento-swatch');
    if (!btn) return;
    const key = btn.dataset.acento;
    await updatePrefAcento(key);
    dispatch('SET_ACENTO', key);
    selectorEl.querySelectorAll('.acento-swatch').forEach(b =>
      b.classList.toggle('is-active', b.dataset.acento === key)
    );
  });

  btnExportar.addEventListener('click', async () => {
    const datos = await getAllDataForExport();
    exportarBackup(datos);
  });

  btnImportar.addEventListener('click', async () => {
    const archivo = inputArchivo.files?.[0];
    if (!archivo) { resultadoEl.textContent = 'Selecciona un archivo .json primero.'; return; }
    const texto = await archivo.text();
    const r = await importarBackup(texto, getDB());
    if (r.error) {
      resultadoEl.textContent = `Error: ${r.error}`;
    } else {
      resultadoEl.textContent =
        `Restaurado: ${r.rutinas} rutinas, ${r.ejercicios} ejercicios, ${r.sesiones} sesiones, ${r.series} series.`;
      location.reload();
    }
  });

  btnReset.addEventListener('click', () => {
    const existente = secReset.querySelector('.confirm-delete-panel');
    if (existente) { existente.remove(); return; }

    const panel = cel('div', 'confirm-delete-panel');
    panel.appendChild(cel('span', 'confirm-delete-msg',
      '¿Confirmas el borrado total? Esta acción es IRREVERSIBLE.'));
    const btnConf   = cel('button', 'btn-confirmar-eliminar', '[ SÍ, BORRAR TODO ]');
    const btnCancel = cel('button', 'btn-cancelar-eliminar', '[ CANCELAR ]');
    panel.appendChild(btnConf);
    panel.appendChild(btnCancel);

    btnConf.addEventListener('click', resetearTodo);
    btnCancel.addEventListener('click', () => panel.remove());

    secReset.appendChild(panel);
  });
}

async function resetearTodo() {
  if (typeof indexedDB.databases === 'function') {
    const dbs = await indexedDB.databases();
    await Promise.all(dbs.map(d => indexedDB.deleteDatabase(d.name)));
  } else {
    indexedDB.deleteDatabase('/gym-log-db');
    indexedDB.deleteDatabase('gym-log-db');
  }

  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
  }

  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }

  window.location.reload();
}
