// Componente Diario: acordeones de ejercicios, precarga inteligente y guardado de series
import html2canvas from 'html2canvas';
import { store, navigateTo } from '../app.js';
import { calculateEpley1RM } from '../analitico.js';
import asciiFinArt  from '/icons/ascii-end.txt?raw';
import motivArt     from '/icons/motiv.txt?raw';
import {
  getRutinas, getRutinasDias, getRutinaEjercicios,
  getSesionDelDia, saveSesion,
  saveSerie, deleteSerie, renumerarSeries, touchSesionTiempo,
  getTodasSeriesDeHoy, getUltimasSeriesPorEjercicio,
  getSeriesConEjerciciosBySesion,
  saveEjercicio, getOrCreateEjercicio, getEjercicios,
  updateEjercicioNombre, deleteEjercicio, removeEjercicioDeRutina,
  linkEjercicioToRutina, moverEjercicioAlFondo, moverEjercicioArriba,
} from '../db.js';

export const MAX_ROUTINE_SLOTS = 8;

const GRUPOS_MUSCULARES = ['PECHO', 'ESPALDA', 'PIERNA', 'HOMBRO', 'BRAZO', 'CORE', 'GENERAL'];

let clickAbort = null;


function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

export async function render(state) {
  const container = document.getElementById('diario-container');
  if (!container) return;
  container.textContent = ''; // idempotente

  const fechaLocal = new Date().toLocaleDateString('en-CA');
  const fechaDisplay = new Date()
    .toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase();

  // Rutina del día (por día de semana: 0=Dom … 6=Sáb) via tabla rutina_dias
  const diaSemana = new Date().getDay();
  const [rutinas, rutinaDias] = await Promise.all([getRutinas(), getRutinasDias()]);
  const asignacion  = rutinaDias.find(rd => rd.dia === diaSemana);
  const rutinaHoy   = asignacion
    ? rutinas.find(r => r.id === asignacion.rutina_id) ?? null
    : null;

  // Cabecera
  const header = cel('header', 'diario-header');
  header.appendChild(cel('h2', 'diario-fecha', fechaDisplay));
  const rutinaLabel = rutinaHoy
    ? `[ DIA DE ${rutinaHoy.nombre.toUpperCase()} ]`
    : '[ SIN RUTINA ASIGNADA ]';
  header.appendChild(cel('p', 'diario-rutina-titulo', rutinaLabel));
  container.appendChild(header);

  // Sesión del día
  let sesion = await getSesionDelDia(fechaLocal);
  if (!sesion && rutinaHoy) sesion = await saveSesion(fechaLocal, rutinaHoy.id, null);
  if (sesion)    store.currentSesionId = sesion.id;
  if (rutinaHoy) store.activeRoutineId  = rutinaHoy.id;

  // Sin rutina asignada → pantalla de descanso
  if (!rutinaHoy) {
    mostrarPantallaDescanso(container);
    return;
  }

  // Todos los ejercicios de la rutina, sin límite de slots
  const todos = await getRutinaEjercicios(rutinaHoy.id);

  const lista = cel('div', 'diario-lista');
  container.appendChild(lista);

  // Batch fetch — 2 queries para todos los ejercicios
  const ejIds = todos.map(e => e.ejercicio_id);
  const [todasSeriesHoy, ultimasPorEj] = await Promise.all([
    getTodasSeriesDeHoy(sesion?.id ?? null),
    getUltimasSeriesPorEjercicio(ejIds),
  ]);
  const seriesHoyMap = new Map();
  for (const s of todasSeriesHoy) {
    if (!seriesHoyMap.has(s.ejercicio_id)) seriesHoyMap.set(s.ejercicio_id, []);
    seriesHoyMap.get(s.ejercicio_id).push(s);
  }
  const ultimaMap = new Map(ultimasPorEj.map(s => [s.ejercicio_id, s]));

  const slots = [...todos, null]; // null = slot vacío de añadir
  const datosSlots = slots.map(ej => {
    if (!ej || !sesion) return { seriesHoy: [], ref: null };
    const seriesHoy = seriesHoyMap.get(ej.ejercicio_id) ?? [];
    const ref = seriesHoy.length > 0
      ? seriesHoy[seriesHoy.length - 1]
      : (ultimaMap.get(ej.ejercicio_id) ?? null);
    return { seriesHoy, ref };
  });

  for (let i = 0; i < slots.length; i++) {
    if (i === 8 && todos.length > 8) {
      const sep = document.createElement('hr');
      sep.className = 'diario-separador';
      lista.appendChild(sep);
    }
    lista.appendChild(construirBloque(slots[i], i, sesion, datosSlots[i]));
  }

  // Botón fin
  const finBtn = cel('button', 'btn-fin-entrenamiento', '[ RESUMEN DE LA SESIÓN ]');
  finBtn.dataset.action = 'fin';
  container.appendChild(finBtn);

  // Delegación de eventos — AbortController descarta el listener del render anterior
  clickAbort?.abort();
  clickAbort = new AbortController();

  container.addEventListener('click', async e => {
    const btnGuardar = e.target.closest('.btn-guardar');
    if (btnGuardar && sesion) { await handleGuardar(btnGuardar, sesion.id); return; }

    const btnDeleteSerie = e.target.closest('.btn-delete-serie');
    if (btnDeleteSerie && sesion) {
      const serieId      = parseInt(btnDeleteSerie.dataset.serieId);
      const filaToRemove = btnDeleteSerie.closest('.serie-fila');
      const filaWrapper  = filaToRemove.closest('.serie-filas');
      const ejId         = parseInt(filaWrapper.dataset.ejId);

      await deleteSerie(serieId);
      await renumerarSeries(sesion.id, ejId);

      filaToRemove.remove();
      filaWrapper.querySelectorAll('.serie-fila').forEach((fila, i) => {
        const num = i + 1;
        fila.dataset.numSerie = num;
        const label = fila.querySelector('.serie-label');
        if (label) label.textContent = `S${num}: `;
        const guardarBtn = fila.querySelector('.btn-guardar');
        if (guardarBtn) guardarBtn.dataset.numSerie = num;
      });
      actualizarProgreso(filaWrapper.closest('.ejercicio-bloque'));
      return;
    }

    if (e.target.closest('[data-action="fin"]')) { await mostrarPantallaFin(container, sesion, rutinaHoy, todos); return; }
    if (e.target.closest('[data-action="volver-diario"]')) { navigateTo('diario'); return; }

    const btnAbajo = e.target.closest('.btn-mover-abajo');
    if (btnAbajo && rutinaHoy) {
      await moverEjercicioAlFondo(rutinaHoy.id, parseInt(btnAbajo.dataset.reId));
      await render(state);
      return;
    }

    const btnArriba = e.target.closest('.btn-mover-arriba');
    if (btnArriba && rutinaHoy) {
      await moverEjercicioArriba(rutinaHoy.id, parseInt(btnArriba.dataset.reId));
      await render(state);
      return;
    }

    const btnConfirmar = e.target.closest('.btn-confirmar-eliminar');
    if (btnConfirmar) {
      await removeEjercicioDeRutina(rutinaHoy.id, parseInt(btnConfirmar.dataset.ejId));
      await render(state);
      return;
    }

    const btnCancelar = e.target.closest('.btn-cancelar-eliminar');
    if (btnCancelar) {
      btnCancelar.closest('.confirm-delete-panel')?.remove();
      return;
    }

    const btnEdit = e.target.closest('.btn-edit');
    if (btnEdit) {
      handleRenombrar(btnEdit, state);
      return;
    }

    const btnDelete = e.target.closest('.btn-delete');
    if (btnDelete) {
      handleEliminar(btnDelete, state);
      return;
    }

    const nombreEl = e.target.closest('.ejercicio-nombre');
    if (!nombreEl) return;

    // Slot "[ + Añadir Ejercicio ]" — 1 tap activa el input
    if (!nombreEl.dataset.ejId && rutinaHoy) {
      handleAñadirEjercicio(nombreEl, rutinaHoy, state);
    }
    // Ejercicio existente: <details> maneja el acordeón nativamente
  }, { signal: clickAbort.signal });
}

function marcarComoGuardada(fila, peso, reps, serieId) {
  const inputPeso = fila.querySelector('.input-peso');
  const inputReps = fila.querySelector('.input-reps');
  const btn       = fila.querySelector('.btn-guardar');
  const btnX      = fila.querySelector('.btn-delete-serie');

  btn.textContent  = '[ ✓ ]';
  btn.disabled     = true;
  inputPeso.disabled = true;
  inputReps.disabled = true;
  inputPeso.classList.add('is-saved');
  inputReps.classList.add('is-saved');

  if (peso === 0) {
    inputPeso.placeholder = 'BW';
  } else {
    inputPeso.value = String(peso);
  }
  inputReps.value = String(reps);

  if (btnX && serieId) {
    btnX.dataset.serieId = serieId;
    btnX.hidden = false;
  }
}


// Construcción DOM síncrona — recibe datos ya cargados, no hace queries
function construirBloque(ej, idx, sesion, { seriesHoy = [], ref = null } = {}) {
  const details = document.createElement('details');
  details.className = 'ejercicio-bloque';
  if (ej) details.dataset.progreso = Math.min(seriesHoy.length, 4);

  const summary = document.createElement('summary');
  summary.className = 'ejercicio-summary';

  const nombreSpan = cel('span', 'ejercicio-nombre', ej ? ej.nombre : '[ + Añadir Ejercicio ]');
  if (ej) {
    nombreSpan.dataset.reId   = ej.id;
    nombreSpan.dataset.ejId   = ej.ejercicio_id;
    nombreSpan.dataset.nombre = ej.nombre;
    const numSpan = cel('span', 'ejercicio-num', `${idx + 1}. `);
    summary.appendChild(numSpan);
  } else {
    nombreSpan.classList.add('is-acento');
  }

  summary.appendChild(nombreSpan);

  if (ej) {
    const btnMover = cel('button', idx < 8 ? 'btn-mover-abajo' : 'btn-mover-arriba',
                                   idx < 8 ? '[ ↓ ]' : '[ ↑ ]');
    btnMover.dataset.reId = ej.id;
    summary.appendChild(btnMover);
  }

  if (ej) {
    const btnEdit = cel('button', 'btn-edit', '[ ✎ ]');
    btnEdit.dataset.ejId  = ej.ejercicio_id;
    btnEdit.dataset.grupo = ej.grupo_muscular ?? 'GENERAL';
    summary.appendChild(btnEdit);

    const btnDelete = cel('button', 'btn-delete', '[ ✕ ]');
    btnDelete.dataset.ejId   = ej.ejercicio_id;
    btnDelete.dataset.nombre = ej.nombre;
    summary.appendChild(btnDelete);
  }

  details.appendChild(summary);

  if (ej && sesion) {
    const cuerpo = cel('div', 'ejercicio-cuerpo');
    const phPeso = ref ? (Number(ref.peso) === 0 ? 'BW' : String(ref.peso)) : '';
    const phReps = ref ? String(ref.repeticiones) : '';

    const filaWrapper = cel('div', 'serie-filas');
    filaWrapper.dataset.ejId = ej.ejercicio_id;
    filaWrapper.dataset.reId = ej.id;

    for (const serie of seriesHoy) {
      const displayPeso = Number(serie.peso) === 0 ? 'BW' : String(serie.peso);
      const fila = construirFilaSerie(serie.numero_serie, displayPeso, String(serie.repeticiones));
      marcarComoGuardada(fila, Number(serie.peso), serie.repeticiones, serie.id);
      filaWrapper.appendChild(fila);
    }

    filaWrapper.appendChild(construirFilaSerie(seriesHoy.length + 1, phPeso, phReps));
    cuerpo.appendChild(filaWrapper);
    details.appendChild(cuerpo);
  }

  return details;
}

function construirFilaSerie(num, phPeso, phReps) {
  const fila = cel('div', 'serie-fila');
  fila.dataset.numSerie = num;

  fila.appendChild(cel('span', 'serie-label', `S${num}: `));

  const inputPeso = document.createElement('input');
  inputPeso.type = 'number';
  inputPeso.className = 'input-peso';
  inputPeso.setAttribute('inputmode', 'decimal');
  inputPeso.setAttribute('pattern', '[0-9]*');
  inputPeso.setAttribute('aria-label', 'Peso');
  inputPeso.min = '0';
  inputPeso.placeholder = phPeso || '0';
  fila.appendChild(inputPeso);

  const unitLabel = cel('span', 'serie-unit');
  unitLabel.textContent = ` ${store.prefUnit} × `;
  fila.appendChild(unitLabel);

  const inputReps = document.createElement('input');
  inputReps.type = 'number';
  inputReps.className = 'input-reps';
  inputReps.setAttribute('inputmode', 'decimal');
  inputReps.setAttribute('pattern', '[0-9]*');
  inputReps.setAttribute('aria-label', 'Repeticiones');
  inputReps.min = '0';
  inputReps.placeholder = phReps || '0';
  fila.appendChild(inputReps);

  fila.appendChild(cel('span', 'serie-unit', ' reps'));

  const btn = cel('button', 'btn-guardar', '[ ✓ ]');
  btn.dataset.numSerie = num;
  fila.appendChild(btn);

  const btnX = cel('button', 'btn-delete-serie', '[ ✕ ]');
  btnX.hidden = true;
  fila.appendChild(btnX);

  return fila;
}

function actualizarProgreso(bloqueEl) {
  if (!bloqueEl) return;
  const guardadas = bloqueEl.querySelectorAll('.btn-delete-serie:not([hidden])').length;
  bloqueEl.dataset.progreso = Math.min(guardadas, 4);
}

async function handleGuardar(btnGuardar, sesionId) {
  const fila = btnGuardar.closest('.serie-fila');
  const filaWrapper = fila.closest('.serie-filas');
  const ejId    = parseInt(filaWrapper.dataset.ejId);
  const numSerie = parseInt(fila.dataset.numSerie);
  const inputPeso = fila.querySelector('.input-peso');
  const inputReps = fila.querySelector('.input-reps');

  const pesoStr = inputPeso.value || inputPeso.placeholder;
  const repsStr = inputReps.value || inputReps.placeholder;
  const peso = parseFloat(pesoStr) || 0;  // 'BW' → NaN → 0 (regla BW)
  const reps = parseInt(repsStr, 10)  || 0;

  const serie = await saveSerie(sesionId, ejId, numSerie, peso, reps);
  await touchSesionTiempo(sesionId);

  const displayPeso = peso === 0 ? 'BW' : String(peso);
  const displayReps = String(reps);

  marcarComoGuardada(fila, peso, reps, serie.id);
  filaWrapper.appendChild(construirFilaSerie(numSerie + 1, displayPeso, displayReps));
  actualizarProgreso(filaWrapper.closest('.ejercicio-bloque'));
}

async function handleAñadirEjercicio(nombreEl, rutinaHoy, state) {
  const nombreActual = nombreEl.textContent;
  const ejerciciosExistentes = await getEjercicios();

  const wrapper   = cel('div', 'autocomplete-wrapper');
  const fila      = cel('div', 'autocomplete-fila');
  const input     = document.createElement('input');
  input.type        = 'text';
  input.className   = 'ejercicio-nombre-input';
  input.placeholder = 'Nombre del ejercicio...';

  const btnOk     = cel('button', 'btn-add-ok',     '✓');
  const btnCancel = cel('button', 'btn-add-cancel',  '✕');
  const lista     = cel('div',   'autocomplete-lista');

  fila.appendChild(input);
  fila.appendChild(btnOk);
  fila.appendChild(btnCancel);
  wrapper.appendChild(fila);
  wrapper.appendChild(lista);
  nombreEl.replaceWith(wrapper);
  input.focus();

  let itemActivo = -1;
  let eligiendo  = false;

  const cancelar = () => {
    ocultarLista();
    wrapper.replaceWith(cel('span', 'ejercicio-nombre', nombreActual));
  };

  const ocultarLista = () => {
    lista.classList.remove('is-visible');
    itemActivo = -1;
  };

  const actualizarLista = () => {
    const query = input.value.trim();
    while (lista.firstChild) lista.removeChild(lista.firstChild);
    itemActivo = -1;
    if (!query) { ocultarLista(); return; }

    const filtrados = ejerciciosExistentes.filter(
      e => e.nombre.toLowerCase().includes(query.toLowerCase())
    );
    if (filtrados.length === 0) { ocultarLista(); return; }

    filtrados.slice(0, 8).forEach(ej => {
      const item = cel('div', 'autocomplete-item', ej.nombre);
      item.addEventListener('mousedown', e => { e.preventDefault(); }); // evita blur en desktop
      item.addEventListener('touchstart', () => { eligiendo = true; }, { passive: true });
      item.addEventListener('click', () => {
        eligiendo = false;
        ocultarLista();
        vincular(ej.nombre, ej.grupo_muscular || 'GENERAL');
      });
      lista.appendChild(item);
    });
    lista.classList.add('is-visible');
  };

  const vincular = async (nombre, grupo) => {
    ocultarLista();
    const ej = await getOrCreateEjercicio(nombre, grupo);
    const todos = await getRutinaEjercicios(rutinaHoy.id);
    await linkEjercicioToRutina(rutinaHoy.id, ej.id, todos.length + 1);
    await render(state);
  };

  const mostrarSelectorGrupo = (nombre) => {
    ocultarLista();
    const selector    = cel('div', 'grupo-muscular-selector');
    selector.appendChild(cel('span', 'grupo-muscular-label', 'GRUPO:'));
    const filaBtns = cel('div', 'grupo-muscular-btns');
    GRUPOS_MUSCULARES.forEach(grupo => {
      const btn = cel('button', 'btn-grupo-muscular', grupo);
      if (grupo === 'GENERAL') btn.classList.add('is-active');
      btn.addEventListener('click', () => vincular(nombre, grupo));
      filaBtns.appendChild(btn);
    });
    selector.appendChild(filaBtns);
    const btnCancelGrupo = cel('button', 'btn-add-cancel', '✕');
    btnCancelGrupo.addEventListener('click', () => {
      selector.replaceWith(cel('span', 'ejercicio-nombre', nombreActual));
    });
    selector.appendChild(btnCancelGrupo);
    wrapper.replaceWith(selector);
  };

  const procesarNombre = () => {
    if (eligiendo) return;
    ocultarLista();
    const nuevoNombre = input.value.trim();
    if (!nuevoNombre || !rutinaHoy) {
      wrapper.replaceWith(cel('span', 'ejercicio-nombre', nombreActual));
      return;
    }
    const existente = ejerciciosExistentes.find(
      e => e.nombre.toLowerCase() === nuevoNombre.toLowerCase()
    );
    if (existente) {
      vincular(nuevoNombre, existente.grupo_muscular || 'GENERAL');
    } else {
      mostrarSelectorGrupo(nuevoNombre);
    }
  };

  // Botones OK y Cancelar: mousedown.preventDefault() evita blur en desktop;
  // touchstart con flag evita que blur dispare procesarNombre antes que click en móvil.
  [btnOk, btnCancel].forEach(btn => {
    btn.addEventListener('mousedown', e => { e.preventDefault(); });
    btn.addEventListener('touchstart', () => { eligiendo = true; }, { passive: true });
  });
  btnOk.addEventListener('click', () => { eligiendo = false; procesarNombre(); });
  btnCancel.addEventListener('click', () => { eligiendo = false; cancelar(); });

  input.addEventListener('input', actualizarLista);
  input.addEventListener('blur', procesarNombre);
  input.addEventListener('keydown', e => {
    const items = lista.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      itemActivo = Math.min(itemActivo + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('is-active', i === itemActivo));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itemActivo = Math.max(itemActivo - 1, -1);
      items.forEach((el, i) => el.classList.toggle('is-active', i === itemActivo));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (itemActivo >= 0 && items[itemActivo]) {
        items[itemActivo].click();
      } else {
        input.blur();
      }
    } else if (e.key === 'Escape') {
      cancelar();
    }
  });
}

function handleRenombrar(btnEdit, state) {
  const details = btnEdit.closest('details');
  if (details) details.open = true;

  const existente = details?.querySelector('.rename-panel');
  details?.querySelector('.confirm-delete-panel')?.remove();
  if (existente) { existente.remove(); return; }

  const ejId        = parseInt(btnEdit.dataset.ejId);
  const nombreActual = details?.querySelector('.ejercicio-nombre')?.textContent ?? '';
  const grupoActual  = btnEdit.dataset.grupo ?? 'GENERAL';

  const panel = cel('div', 'rename-panel');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-rename-ejercicio';
  input.value = nombreActual;
  input.setAttribute('aria-label', 'Nuevo nombre del ejercicio');
  panel.appendChild(input);

  let grupoSeleccionado = grupoActual;
  const selectorDiv = cel('div', 'grupo-muscular-selector');
  selectorDiv.appendChild(cel('span', 'grupo-muscular-label', 'GRUPO:'));
  const filaGrupos = cel('div', 'grupo-muscular-btns');
  GRUPOS_MUSCULARES.forEach(g => {
    const btn = cel('button', 'btn-grupo-muscular', g);
    if (g === grupoActual) btn.classList.add('is-active');
    btn.addEventListener('click', () => {
      filaGrupos.querySelectorAll('.btn-grupo-muscular').forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      grupoSeleccionado = g;
    });
    filaGrupos.appendChild(btn);
  });
  selectorDiv.appendChild(filaGrupos);
  panel.appendChild(selectorDiv);

  const btnGuardar  = cel('button', 'btn-panel-accion',  '[ GUARDAR ]');
  const btnCancelar = cel('button', 'btn-panel-cancel', '[ CANCELAR ]');
  panel.appendChild(btnGuardar);
  panel.appendChild(btnCancelar);

  const guardar = async () => {
    const nuevoNombre = input.value.trim();
    if (!nuevoNombre) { panel.remove(); return; }
    const grupoFinal = grupoSeleccionado !== grupoActual ? grupoSeleccionado : null;
    await updateEjercicioNombre(ejId, nuevoNombre, grupoFinal);
    await render(state);
  };

  btnGuardar.addEventListener('click', guardar);
  btnCancelar.addEventListener('click', () => panel.remove());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); guardar(); }
    if (e.key === 'Escape') panel.remove();
  });

  const cuerpo = details?.querySelector('.ejercicio-cuerpo');
  if (cuerpo) details.insertBefore(panel, cuerpo);
  else details?.appendChild(panel);

  input.focus();
  input.select();
}

function handleEliminar(btnDelete, state) {
  const details = btnDelete.closest('details');
  if (details) details.open = true;

  const existente = details?.querySelector('.confirm-delete-panel');
  details?.querySelector('.rename-panel')?.remove();
  if (existente) { existente.remove(); return; }

  const ejId   = parseInt(btnDelete.dataset.ejId);
  const nombre = btnDelete.dataset.nombre ?? '?';

  const panel = cel('div', 'confirm-delete-panel');
  panel.appendChild(cel('span', 'confirm-delete-msg',
    `¿Eliminar "${nombre}"? Se borrarán todas las series registradas.`));

  const btnConfirmar = cel('button', 'btn-confirmar-eliminar', '[ ELIMINAR ]');
  btnConfirmar.dataset.ejId = ejId;
  const btnCancelar = cel('button', 'btn-cancelar-eliminar', '[ CANCELAR ]');
  panel.appendChild(btnConfirmar);
  panel.appendChild(btnCancelar);

  const cuerpo = details?.querySelector('.ejercicio-cuerpo');
  if (cuerpo) details.insertBefore(panel, cuerpo);
  else details?.appendChild(panel);
}


function mostrarPantallaDescanso(container) {
  const div = cel('div', 'diario-descanso');

  const arte = cel('pre', 'descanso-arte');
  arte.textContent = motivArt;
  div.appendChild(arte);

  div.appendChild(cel('p', 'descanso-msg', 'No hay rutina asignada para hoy.'));

  const enlace = cel('button', 'btn-ir-config', '[ CONFIGURAR RUTINA PARA HOY ]');
  enlace.dataset.action = 'ir-config';
  div.appendChild(enlace);

  div.appendChild(cel('p', 'descanso-descanso', '— o disfruta tu día de descanso —'));

  container.appendChild(div);

  // El click en ir-config lo captura el listener global de app.js
  // pero como aún no hay listener aquí, lo añadimos localmente
  clickAbort?.abort();
  clickAbort = new AbortController();
  container.addEventListener('click', e => {
    if (e.target.closest('[data-action="ir-config"]')) navigateTo('config');
  }, { signal: clickAbort.signal });
}

async function mostrarPantallaFin(container, sesion, rutinaHoy, ejercicios) {
  container.textContent = '';

  // Listener dedicado para la pantalla de fin — mismo patrón que render()
  clickAbort?.abort();
  clickAbort = new AbortController();
  container.addEventListener('click', async e => {
    if (e.target.closest('[data-action="volver-diario"]')) {
      document.querySelector('.tab-btn[data-tab="diario"]')?.click();
    }
    if (e.target.closest('[data-action="compartir"]')) {
      actionsRow.classList.add('fin-capture-hidden');
      const wrapper = document.createElement('div');
      wrapper.classList.add('fin-capture-wrapper');
      finDiv.parentNode.insertBefore(wrapper, finDiv);
      wrapper.appendChild(finDiv);
      const canvas = await html2canvas(wrapper, {
        scale: 2,
        backgroundColor: '#000000',
        useCORS: false,
        logging: false,
      });
      wrapper.parentNode.insertBefore(finDiv, wrapper);
      wrapper.parentNode.removeChild(wrapper);
      actionsRow.classList.remove('fin-capture-hidden');

      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      const file = new File([blob], 'gymlog-entrenamiento.png', { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Mi entrenamiento — GymLog' });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'gymlog-entrenamiento.png';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }
  }, { signal: clickAbort.signal });

  const finDiv = cel('div', 'diario-fin');
  finDiv.id = 'diario-fin';

  finDiv.appendChild(cel('h2', 'fin-titulo', '¡ Entrenamiento Finalizado !'));

  const arte = cel('pre', 'fin-arte');
  arte.textContent = asciiFinArt;
  finDiv.appendChild(arte);

  const fecha = new Date().toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  finDiv.appendChild(cel('p', 'fin-fecha', fecha));
  if (rutinaHoy) finDiv.appendChild(cel('p', 'fin-rutina', rutinaHoy.nombre.toUpperCase()));

  // Re-fetch sesión para obtener hora_inicio y hora_fin actualizadas (el objeto closure puede ser stale)
  const sesionFresh = sesion
    ? await getSesionDelDia(new Date().toLocaleDateString('en-CA'))
    : null;

  // Traer TODAS las series de la sesión (incluyendo ejercicios intercambiados en caliente)
  const todasLasFilas = sesion ? await getSeriesConEjerciciosBySesion(sesion.id) : [];

  // Agrupar por ejercicio_id preservando el orden de aparición
  const porEjercicio = new Map();
  for (const fila of todasLasFilas) {
    if (!porEjercicio.has(fila.ejercicio_id)) {
      porEjercicio.set(fila.ejercicio_id, { nombre: fila.nombre, series: [] });
    }
    porEjercicio.get(fila.ejercicio_id).series.push(fila);
  }

  const conSeries = [...porEjercicio.values()];

  const tabla = cel('div', 'fin-tabla');
  tabla.appendChild(cel('span', 'fin-th', 'EJERCICIO'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', 'SETS'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', 'PESO'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', '1RM'));
  tabla.appendChild(cel('div', 'fin-sep'));

  let totalSeries = 0;
  conSeries.forEach(({ nombre, series }) => {
    totalSeries    += series.length;
    const mejorPeso = Math.max(...series.map(s => s.peso));
    const isBW      = mejorPeso === 0;
    const unidad    = store.prefUnit ?? 'kg';
    const max1RM    = Math.max(...series.map(s => calculateEpley1RM(Number(s.peso), Number(s.repeticiones))));
    const orm       = max1RM === 0 ? '——' : `~${Math.round(max1RM)}${unidad}`;
    const pesoStr   = isBW ? 'BW' : `${mejorPeso}${unidad}`;

    tabla.appendChild(cel('span', 'fin-td', nombre));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', `×${series.length}`));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', pesoStr));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', orm));
  });

  tabla.appendChild(cel('div', 'fin-sep'));
  const totalesEl = cel('div', 'fin-totales');
  let duracionStr = '';
  if (sesionFresh?.hora_inicio && sesionFresh?.hora_fin) {
    const diffMs   = new Date(sesionFresh.hora_fin) - new Date(sesionFresh.hora_inicio);
    const totalMin = Math.floor(diffMs / 60000);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, '0');
    const mm = String(totalMin % 60).padStart(2, '0');
    duracionStr = ` · ${hh}h:${mm}m`;
  }
  totalesEl.textContent = `${conSeries.length} EJERC · ${totalSeries} SERIES${duracionStr}`;
  tabla.appendChild(totalesEl);
  finDiv.appendChild(tabla);

  const cta = cel('div', 'fin-cta');
  const qr  = document.createElement('img');
  qr.src    = import.meta.env.BASE_URL + 'assets/appUrl.png';
  qr.alt    = 'QR GymLog PWA';
  qr.className = 'fin-qr';
  cta.appendChild(qr);
  const texto = cel('div', 'fin-cta-texto');
  texto.appendChild(cel('p', 'fin-cta-titulo', 'GYMLOG PWA'));
  texto.appendChild(cel('p', null, 'Gratis siempre · Soberanía y Privacidad'));
  texto.appendChild(cel('p', null, 'Multiplataforma · Sin cuenta · Offline'));
  texto.appendChild(cel('p', null, 'Lleva tu registro de entrenamiento en el móvil'));
  cta.appendChild(texto);
  finDiv.appendChild(cta);

  const actionsRow = cel('div', 'btn-fin-actions');

  const btnVolver = cel('button', 'btn-fin-volver', '[ VOLVER AL DIARIO ]');
  btnVolver.dataset.action = 'volver-diario';
  actionsRow.appendChild(btnVolver);

  const btnCompartir = cel('button', 'btn-fin-compartir');
  btnCompartir.dataset.action = 'compartir';
  btnCompartir.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;
  actionsRow.appendChild(btnCompartir);

  finDiv.appendChild(actionsRow);

  container.appendChild(finDiv);
}
