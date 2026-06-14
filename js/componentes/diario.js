// Componente Diario: acordeones de ejercicios, precarga inteligente y guardado de series
import { store, navigateTo } from '../app.js';
import asciiFinArt from '/icons/ascii-end.txt?raw';
import {
  getRutinas, getRutinaEjercicios,
  getSesionDelDia, saveSesion,
  saveSerie, getUltimaSerie, getSeriesDeSesionEjercicio,
  saveEjercicio, updateEjercicioNombre, deleteEjercicio,
  updateActivoHoy, linkEjercicioToRutina, swapOrden,
} from '../db.js';

export const MAX_ROUTINE_SLOTS = 8;

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

  // Rutina del día (por día de semana: 0=Dom … 6=Sáb)
  const diaSemana = new Date().getDay();
  const rutinas = await getRutinas();
  const rutinaHoy = rutinas.find(r => r.dia_sugerido === diaSemana) ?? null;

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

  // Ejercicios activos (máx MAX_ROUTINE_SLOTS) + suplentes para swap
  let ejercicios = [];
  let suplentesSwap = [];
  if (rutinaHoy) {
    const todos = await getRutinaEjercicios(rutinaHoy.id);
    const activos = todos.filter(e => e.activo_hoy);
    ejercicios = activos.slice(0, MAX_ROUTINE_SLOTS);
    // Suplentes = inactivos + activos que no caben en los 8 slots visibles
    const inactivos    = todos.filter(e => !e.activo_hoy);
    const activosExtra = activos.slice(MAX_ROUTINE_SLOTS);
    suplentesSwap = [...inactivos, ...activosExtra];
  }

  const lista = cel('div', 'diario-lista');
  container.appendChild(lista);

  const hasSuplentes = suplentesSwap.length > 0;
  for (let i = 0; i < ejercicios.length; i++) {
    lista.appendChild(await construirBloque(ejercicios[i], i, sesion, hasSuplentes));
  }
  // Un slot extra para añadir el siguiente ejercicio
  lista.appendChild(await construirBloque(null, ejercicios.length, sesion, false));

  // Botón fin
  const finBtn = cel('button', 'btn-fin-entrenamiento', '[ FIN DEL ENTRENAMIENTO ]');
  finBtn.dataset.action = 'fin';
  container.appendChild(finBtn);

  // Delegación de eventos — AbortController descarta el listener del render anterior
  clickAbort?.abort();
  clickAbort = new AbortController();

  container.addEventListener('click', async e => {
    const btnGuardar = e.target.closest('.btn-guardar');
    if (btnGuardar && sesion) { await handleGuardar(btnGuardar, sesion.id); return; }

    if (e.target.closest('[data-action="fin"]')) { mostrarPantallaFin(container); return; }

    const suplanteItem = e.target.closest('.suplente-item');
    if (suplanteItem && rutinaHoy) {
      const nuevoReId    = parseInt(suplanteItem.dataset.reId);
      const anteriorReId = parseInt(suplanteItem.dataset.anteriorReId);
      await updateActivoHoy(nuevoReId, true);
      await updateActivoHoy(anteriorReId, false);
      await swapOrden(nuevoReId, anteriorReId);
      await render(state);
      return;
    }

    const btnSwap = e.target.closest('.btn-swap');
    if (btnSwap && rutinaHoy) {
      await handleSuplentesDropdown(btnSwap, suplentesSwap);
      return;
    }

    const btnConfirmar = e.target.closest('.btn-confirmar-eliminar');
    if (btnConfirmar) {
      await deleteEjercicio(parseInt(btnConfirmar.dataset.ejId));
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

function marcarComoGuardada(fila, peso, reps) {
  const inputPeso = fila.querySelector('.input-peso');
  const inputReps = fila.querySelector('.input-reps');
  const btn       = fila.querySelector('.btn-guardar');

  btn.textContent  = '[✓]';
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
}

async function construirBloque(ej, idx, sesion, hasSuplentes) {
  const details = document.createElement('details');
  details.className = 'ejercicio-bloque';

  const summary = document.createElement('summary');
  summary.className = 'ejercicio-summary';

  const numSpan = cel('span', 'ejercicio-num', `${idx + 1}. `);
  const nombreSpan = cel('span', 'ejercicio-nombre', ej ? ej.nombre : '[ + Añadir Ejercicio ]');
  if (ej) {
    nombreSpan.dataset.reId   = ej.id;
    nombreSpan.dataset.ejId   = ej.ejercicio_id;
    nombreSpan.dataset.nombre = ej.nombre;
  }

  summary.appendChild(numSpan);
  summary.appendChild(nombreSpan);

  if (ej && hasSuplentes) {
    const btnSwap = cel('button', 'btn-swap', '[ ⇄ ]');
    btnSwap.dataset.reId = ej.id;
    summary.appendChild(btnSwap);
  }

  if (ej) {
    const btnEdit = cel('button', 'btn-edit', '[ ✎ ]');
    btnEdit.dataset.ejId = ej.ejercicio_id;
    summary.appendChild(btnEdit);

    const btnDelete = cel('button', 'btn-delete', '[ ✕ ]');
    btnDelete.dataset.ejId   = ej.ejercicio_id;
    btnDelete.dataset.nombre = ej.nombre;
    summary.appendChild(btnDelete);
  }

  details.appendChild(summary);

  if (ej && sesion) {
    const cuerpo = cel('div', 'ejercicio-cuerpo');

    // Series ya guardadas hoy para este ejercicio
    const seriesHoy = await getSeriesDeSesionEjercicio(sesion.id, ej.ejercicio_id);

    // Placeholder = última serie de hoy, o última de sesiones anteriores si no hay ninguna hoy
    const ref = seriesHoy.length > 0
      ? seriesHoy[seriesHoy.length - 1]
      : await getUltimaSerie(ej.ejercicio_id);
    const phPeso = ref ? (Number(ref.peso) === 0 ? 'BW' : String(ref.peso)) : '';
    const phReps = ref ? String(ref.repeticiones) : '';

    const filaWrapper = cel('div', 'serie-filas');
    filaWrapper.dataset.ejId = ej.ejercicio_id;
    filaWrapper.dataset.reId = ej.id;

    // Hidratar series guardadas
    for (const serie of seriesHoy) {
      const displayPeso = Number(serie.peso) === 0 ? 'BW' : String(serie.peso);
      const fila = construirFilaSerie(serie.numero_serie, displayPeso, String(serie.repeticiones));
      marcarComoGuardada(fila, Number(serie.peso), serie.repeticiones);
      filaWrapper.appendChild(fila);
    }

    // Fila vacía para la siguiente serie
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

  const btn = cel('button', 'btn-guardar', '[ GUARDAR SERIE ]');
  btn.dataset.numSerie = num;
  fila.appendChild(btn);

  return fila;
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

  await saveSerie(sesionId, ejId, numSerie, peso, reps);

  const displayPeso = peso === 0 ? 'BW' : String(peso);
  const displayReps = String(reps);

  marcarComoGuardada(fila, peso, reps);
  filaWrapper.appendChild(construirFilaSerie(numSerie + 1, displayPeso, displayReps));
}

async function handleSuplentesDropdown(btnSwap, suplentes) {
  const details = btnSwap.closest('details');
  const existente = details?.querySelector('.suplentes-dropdown');
  if (existente) { existente.remove(); return; }
  if (suplentes.length === 0) return;

  if (details) details.open = true; // abre el acordeón si estaba colapsado

  const reId = parseInt(btnSwap.dataset.reId);
  const dropdown = cel('div', 'suplentes-dropdown');
  dropdown.appendChild(cel('p', 'suplentes-titulo', 'Suplentes:'));

  for (const sup of suplentes) {
    const btn = cel('button', 'suplente-item', sup.nombre);
    btn.dataset.reId = sup.id;
    btn.dataset.anteriorReId = reId;
    dropdown.appendChild(btn);
  }

  const cuerpo = details?.querySelector('.ejercicio-cuerpo');
  if (cuerpo) details.insertBefore(dropdown, cuerpo);
  else details?.appendChild(dropdown);
}

function handleAñadirEjercicio(nombreEl, rutinaHoy, state) {
  const nombreActual = nombreEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ejercicio-nombre-input';
  input.placeholder = 'Nombre del ejercicio...';
  nombreEl.replaceWith(input);
  input.focus();

  const guardar = async () => {
    const nuevoNombre = input.value.trim();
    if (!nuevoNombre || !rutinaHoy) {
      const span = cel('span', 'ejercicio-nombre', nombreActual);
      input.replaceWith(span);
      return;
    }
    const nuevoEj = await saveEjercicio(nuevoNombre, 'General');
    const todos = await getRutinaEjercicios(rutinaHoy.id);
    await linkEjercicioToRutina(rutinaHoy.id, nuevoEj.id, todos.length + 1);
    await render(state);
  };

  input.addEventListener('blur', guardar);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      const span = cel('span', 'ejercicio-nombre', nombreActual);
      input.replaceWith(span);
    }
  });
}

function handleRenombrar(btnEdit, state) {
  const details = btnEdit.closest('details');
  if (details) details.open = true;

  const existente = details?.querySelector('.rename-panel');
  details?.querySelector('.confirm-delete-panel')?.remove();
  if (existente) { existente.remove(); return; }

  const ejId = parseInt(btnEdit.dataset.ejId);
  const nombreActual = details?.querySelector('.ejercicio-nombre')?.textContent ?? '';

  const panel = cel('div', 'rename-panel');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-rename-ejercicio';
  input.value = nombreActual;
  input.setAttribute('aria-label', 'Nuevo nombre del ejercicio');
  panel.appendChild(input);

  const btnGuardar = cel('button', 'btn-panel-accion', '[ GUARDAR ]');
  const btnCancelar = cel('button', 'btn-panel-cancel', '[ CANCELAR ]');
  panel.appendChild(btnGuardar);
  panel.appendChild(btnCancelar);

  const guardar = async () => {
    const nuevoNombre = input.value.trim();
    if (!nuevoNombre || nuevoNombre === nombreActual) { panel.remove(); return; }
    await updateEjercicioNombre(ejId, nuevoNombre);
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

function mostrarPantallaFin(container) {
  container.textContent = '';

  const finDiv = cel('div', 'diario-fin');
  finDiv.id = 'diario-fin';

  finDiv.appendChild(cel('h2', 'fin-titulo', '¡Entrenamiento Registrado!'));

  const arte = cel('pre', 'fin-arte');
  arte.textContent = asciiFinArt;
  finDiv.appendChild(arte);

  finDiv.appendChild(cel('p', 'fin-msg', 'Descansa. Recupera. Vuelve mañana.'));

  const countdown = cel('p', 'fin-countdown', 'Volviendo en 5...');
  finDiv.appendChild(countdown);

  container.appendChild(finDiv);

  let secs = 5;
  const timer = setInterval(() => {
    secs--;
    if (secs <= 0) {
      clearInterval(timer);
      if (document.getElementById('diario-fin')) navigateTo('diario');
    } else {
      if (countdown.isConnected) countdown.textContent = `Volviendo en ${secs}...`;
    }
  }, 1000);
}
