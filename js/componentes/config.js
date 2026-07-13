// Componente Config: administración de rutinas, unidades kg/lb y gestión CSV
import { dispatch, aplicarAcento, ACENTOS } from '../app.js';
import {
  getRutinas, saveRutina,
  getRutinasDias, addRutinaDia, removeRutinaDia, assignRutinaDiaExclusivo,
  updateRutinaNombre, deleteRutina,
  getConf, updatePrefUnit, updatePrefAcento,
  getDB, getAllDataForExport,
  getEjerciciosPendientesRevision, vincularEjercicioCatalogo, descartarSugerenciaCatalogo,
} from '../db.js';
import { exportarBackup, importarBackup } from '../csv.js';
import { getCandidatos } from '../catalogo.js';
import { abrirPreviewEjercicio } from './previewModal.js';

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

    const btnEdit = cel('button', 'btn-edit', '✎');
    btnEdit.dataset.rutinaId = rutina.id;
    btnEdit.dataset.nombre   = rutina.nombre;
    btnEdit.setAttribute('aria-label', 'Renombrar rutina');
    fila.appendChild(btnEdit);

    const btnDel = cel('button', 'btn-delete', '✕');
    btnDel.dataset.rutinaId = rutina.id;
    btnDel.dataset.nombre   = rutina.nombre;
    btnDel.setAttribute('aria-label', 'Eliminar rutina');
    fila.appendChild(btnDel);

    item.appendChild(fila);
    listaRutinas.appendChild(item);
  }

  secAdmin.appendChild(listaRutinas);

  const nuevaWrapper = cel('div', 'config-nueva-rutina');
  const inputNueva = document.createElement('input');
  inputNueva.type = 'text';
  inputNueva.className = 'input-nueva-rutina';
  inputNueva.placeholder = 'Nueva rutina...';
  nuevaWrapper.appendChild(inputNueva);
  const btnNueva = cel('button', 'btn-nueva-rutina', '[+ CREAR]');
  nuevaWrapper.appendChild(btnNueva);
  secAdmin.appendChild(nuevaWrapper);

  // Retrofit: vincular ejercicios existentes al catálogo (sugerencia + confirmación,
  // nunca automático; jamás modifica grupo_muscular). Best-effort: si el catálogo
  // aún no está en caché (primera carga offline), la sección simplemente no aparece.
  try {
    const retrofitEl = await construirSeccionRetrofit();
    if (retrofitEl) secAdmin.appendChild(retrofitEl);
  } catch { /* catálogo no disponible — sin sección */ }

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

  // ── 3. Color de acento ───────────────────────────────────────────────────
  const secAcento = cel('section', 'config-seccion');
  secAcento.appendChild(cel('h3', 'config-titulo', '[3. COLOR DE ACENTO]'));

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

  // ── 4. Actualizar app ────────────────────────────────────────────────────
  const secApp = cel('section', 'config-seccion');
  secApp.appendChild(cel('h3', 'config-titulo', '[4. ACTUALIZAR APP]'));
  secApp.appendChild(cel('p', 'reset-advertencia',
    'Borra el caché del navegador y recarga la versión más reciente de la app.'));
  const btnActualizar = cel('button', 'btn-actualizar-app', '[ ↻ ACTUALIZAR APP ]');
  secApp.appendChild(btnActualizar);
  container.appendChild(secApp);

  // ── 5. Gestión de datos ──────────────────────────────────────────────────
  const secDatos = cel('section', 'config-seccion');
  secDatos.appendChild(cel('h3', 'config-titulo', '[5. GESTIÓN DE DATOS]'));

  const btnExportar = cel('button', 'btn-exportar-csv',
    '[ EXPORTAR BACKUP (.json.gz) ]');
  secDatos.appendChild(btnExportar);

  // Input nativo oculto — activado desde btnElegir para control total del estilo
  const inputArchivo = document.createElement('input');
  inputArchivo.type = 'file';
  inputArchivo.className = 'input-archivo';
  inputArchivo.accept = '.json,.json.gz,.gz';

  const btnElegir = cel('button', 'btn-elegir-archivo', '[ SELECCIONAR ARCHIVO ]');
  const archivoNombre = cel('p', 'archivo-nombre-selec', '—');
  secDatos.appendChild(btnElegir);
  secDatos.appendChild(archivoNombre);
  secDatos.appendChild(inputArchivo);

  const btnImportar = cel('button', 'btn-importar-csv',
    '[ RESTAURAR DESDE BACKUP (.json.gz / .json) ]');
  secDatos.appendChild(btnImportar);

  const resultadoEl = cel('p', 'resultado-importacion');
  secDatos.appendChild(resultadoEl);

  secDatos.appendChild(cel('hr', 'config-separador'));

  secDatos.appendChild(cel('p', 'reset-advertencia',
    '⚠ Los datos son tuyos y viven en tu dispositivo. ' +
    'Esta acción elimina toda la base de datos, caché y datos de la app. ' +
    'Recomendamos exportar un backup .json.gz antes de continuar.'));
  const btnReset = cel('button', 'btn-reset-datos', '[ ⚠ ELIMINAR DATOS ]');
  secDatos.appendChild(btnReset);

  container.appendChild(secDatos);

  // ── 6. Donativo ──────────────────────────────────────────────────────────
  const BTC_ADDRESS = 'bc1qg3j6r0uf4lyqw6l3q08mc7d2wvn25mt3e5huyx';

  const secDonativo = cel('section', 'config-seccion');
  secDonativo.appendChild(cel('h3', 'config-titulo', '[6. DONATIVO]'));

  const donDesc = cel('p', 'reset-advertencia donativo-desc',
    'GymLog es un proyecto personal de código abierto, sin anuncios ni suscripciones. ' +
    'Si te resulta útil, puedes apoyar el desarrollo vía Bitcoin o MercadoPago.');

  const donRepo = cel('p', 'reset-advertencia donativo-desc');
  donRepo.appendChild(document.createTextNode('¿Tienes una sugerencia? Abre un issue en '));
  const repoLink = document.createElement('a');
  repoLink.href = 'https://github.com/IanCardosoP/GymlogPWA';
  repoLink.textContent = 'github.com/IanCardosoP/GymlogPWA';
  repoLink.target = '_blank';
  repoLink.rel = 'noopener noreferrer';
  repoLink.className = 'config-footer-link donativo-link';
  donRepo.appendChild(repoLink);

  const donAddrLabel = cel('p', 'donativo-addr-label', '₿ Bitcoin (Native SegWit — bc1q...):');
  const donAddr = cel('p', 'donativo-addr', BTC_ADDRESS);

  const donBtns = cel('div', 'donativo-btns');
  const btnDonar = cel('button', 'btn-donar-btc', '[ ₿ BITCOIN ]');
  const btnMercado = cel('button', 'btn-donar-btc', '[ $ MERCADOPAGO ]');
  donBtns.appendChild(btnDonar);
  donBtns.appendChild(btnMercado);

  secDonativo.appendChild(donDesc);
  secDonativo.appendChild(donRepo);
  secDonativo.appendChild(donAddrLabel);
  secDonativo.appendChild(donAddr);
  secDonativo.appendChild(donBtns);
  container.appendChild(secDonativo);

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
    const badge = e.target.closest('.rutina-dia-badge');
    if (badge) {
      const item = badge.closest('.rutina-item');
      const picker = item.querySelector('.dia-picker');
      item.querySelector('.rename-panel')?.remove();
      item.querySelector('.confirm-delete-panel')?.remove();
      if (picker) { picker.remove(); return; }

      const rutinaId    = parseInt(badge.dataset.rutinaId);
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

    const chip = e.target.closest('.dia-chip');
    if (chip) {
      const rutinaId = parseInt(chip.dataset.rutinaId);
      const dia      = parseInt(chip.dataset.dia);
      if (chip.classList.contains('is-active')) {
        await removeRutinaDia(rutinaId, dia);
      } else {
        await assignRutinaDiaExclusivo(rutinaId, dia);
      }
      await render(state);
      return;
    }

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

    const btnConf = e.target.closest('.btn-confirmar-eliminar');
    if (btnConf && btnConf.dataset.rutinaId) {
      await deleteRutina(parseInt(btnConf.dataset.rutinaId));
      await render(state);
      return;
    }

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

  btnActualizar.addEventListener('click', async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.update()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    location.reload();
  });

  btnElegir.addEventListener('click', () => inputArchivo.click());

  inputArchivo.addEventListener('change', () => {
    const archivo = inputArchivo.files?.[0];
    archivoNombre.textContent = archivo ? archivo.name : '—';
  });

  btnExportar.addEventListener('click', async () => {
    const datos = await getAllDataForExport();
    const json = exportarBackup(datos);

    const jsonBytes = new TextEncoder().encode(json);
    const compressedStream = new Blob([jsonBytes]).stream()
      .pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(compressedStream).blob();

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gymlog-backup-${new Date().toLocaleDateString('en-CA')}.json.gz`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  btnImportar.addEventListener('click', async () => {
    const archivo = inputArchivo.files?.[0];
    if (!archivo) { resultadoEl.textContent = 'Selecciona un archivo primero.'; return; }

    const buf = await archivo.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let texto;

    if (bytes[0] === 0x1F && bytes[1] === 0x8B) {
      const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      texto = await new Response(stream).text();
    } else {
      texto = new TextDecoder().decode(buf);
    }

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
    const existente = secDatos.querySelector('.confirm-delete-panel');
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

    secDatos.appendChild(panel);
  });

  btnDonar.addEventListener('click', async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(BTC_ADDRESS);
      copied = true;
    } catch (_) {}

    const link = document.createElement('a');
    link.href = `bitcoin:${BTC_ADDRESS}`;
    link.click();

    btnDonar.textContent = copied
      ? '[ ✓ DIRECCIÓN COPIADA AL PORTAPAPELES ]'
      : '[ ₿ ABRIENDO WALLET... ]';
    setTimeout(() => { btnDonar.textContent = '[ ₿ BITCOIN ]'; }, 3000);
  });

  btnMercado.addEventListener('click', () => {
    window.open('https://link.mercadopago.com.mx/gymlog', '_blank', 'noopener,noreferrer');
  });
}

// ── Retrofit de catálogo ──────────────────────────────────────────────────────
// <details> con los ejercicios del usuario aún sin revisar que tienen alguna
// coincidencia razonable en el catálogo. Tap en la fila abre la vista previa
// (imagen grande + instrucciones), donde se cicla entre sugerencias y se confirma
// la vinculación; ✕ descarta para siempre. El grupo muscular nunca se toca.

async function construirSeccionRetrofit() {
  const pendientes = await getEjerciciosPendientesRevision();
  if (pendientes.length === 0) return null;

  const sugerencias = [];
  for (const ej of pendientes) {
    const candidatos = await getCandidatos(ej.nombre); // catálogo se cachea al primer await
    if (candidatos.length > 0) sugerencias.push({ ejercicio: ej, candidatos });
  }
  if (sugerencias.length === 0) return null;

  // La preview necesita los candidatos completos; la fila solo lleva el ejId.
  const sugerenciasPorEj = new Map(sugerencias.map(s => [s.ejercicio.id, s]));

  const detalles = cel('details', 'retrofit-detalles');
  const resumen = cel('summary', 'retrofit-summary',
    `[ ▤ ${sugerencias.length} EJERCICIO${sugerencias.length === 1 ? '' : 'S'} PUEDEN VINCULARSE A IMÁGENES ]`);
  detalles.appendChild(resumen);

  const listaEl = cel('div', 'retrofit-lista');
  for (const { ejercicio, candidatos } of sugerencias) {
    listaEl.appendChild(construirFilaRetrofit(ejercicio, candidatos));
  }
  detalles.appendChild(listaEl);

  // Delegación: un solo listener para toda la lista
  const quitarFila = (fila) => {
    fila.remove();
    const restantes = listaEl.querySelectorAll('.retrofit-fila').length;
    if (restantes === 0) {
      detalles.remove();
    } else {
      resumen.textContent =
        `[ ▤ ${restantes} EJERCICIO${restantes === 1 ? '' : 'S'} PUEDEN VINCULARSE A IMÁGENES ]`;
    }
  };

  listaEl.addEventListener('click', async (e) => {
    const fila = e.target.closest('.retrofit-fila');
    if (!fila) return;
    const ejId = Number(fila.dataset.ejId);

    // ✕ descarta sin abrir nada
    if (e.target.closest('button[data-accion="descartar"]')) {
      await descartarSugerenciaCatalogo(ejId);
      quitarFila(fila);
      return;
    }

    // Tap en la fila: vista previa con todas las sugerencias, ciclables ahí dentro
    const { ejercicio, candidatos } = sugerenciasPorEj.get(ejId);
    abrirPreviewEjercicio({
      candidatos,
      nombreUsuario: ejercicio.nombre,
      etiquetaConfirmar: '[ ✓ VINCULAR ]',
      onConfirmar: async (entrada) => {
        await vincularEjercicioCatalogo(ejId, entrada.fuente_id);
        quitarFila(fila);
      },
    });
  });

  return detalles;
}

// La fila solo previsualiza la mejor sugerencia; ver el resto, compararlas y
// confirmar ocurre en la vista previa que abre al tocarla.
function construirFilaRetrofit(ejercicio, candidatos) {
  const primera = candidatos[0];

  const fila = cel('div', 'retrofit-fila');
  fila.dataset.ejId = ejercicio.id;
  fila.setAttribute('role', 'button');
  fila.setAttribute('tabindex', '0');
  fila.setAttribute('aria-label',
    `Ver sugerencias para ${ejercicio.nombre}: ${primera.nombre_es}` +
    (candidatos.length > 1 ? ` y ${candidatos.length - 1} más` : ''));

  const thumb = cel('div', 'catalogo-thumb');
  const imgA = document.createElement('img');
  const imgB = document.createElement('img');
  imgA.src = primera.imagen_a;
  imgB.src = primera.imagen_b;
  imgA.alt = '';
  imgB.alt = '';
  imgA.loading = 'lazy';
  imgB.loading = 'lazy';
  imgA.className = 'catalogo-thumb-a';
  imgB.className = 'catalogo-thumb-b';
  thumb.appendChild(imgA);
  thumb.appendChild(imgB);
  fila.appendChild(thumb);

  const info = cel('div', 'retrofit-info');
  info.appendChild(cel('span', 'retrofit-nombre-usuario', ejercicio.nombre));
  info.appendChild(cel('span', 'retrofit-sugerencia', candidatos.length > 1
    ? `→ ${primera.nombre_es} · +${candidatos.length - 1} sugerencias`
    : `→ ${primera.nombre_es}`));
  fila.appendChild(info);

  const btnNo = cel('button', 'btn-add-cancel', '✕');
  btnNo.dataset.accion = 'descartar';
  btnNo.setAttribute('aria-label', `Descartar sugerencia para ${ejercicio.nombre}`);
  fila.appendChild(btnNo);

  // Teclado: la fila es un role=button, Enter/Espacio la activan como un tap
  fila.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fila.click();
    }
  });

  return fila;
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
