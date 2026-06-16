// Componente Diario: acordeones de ejercicios, precarga inteligente y guardado de series
import { store, navigateTo } from '../app.js';
import { calculateEpley1RM } from '../analitico.js';
import asciiFinArt  from '/icons/ascii-end.txt?raw';
import motivArt     from '/icons/motiv.txt?raw';
import {
  getRutinas, getRutinasDias, getRutinaEjercicios,
  getSesionDelDia, saveSesion,
  saveSerie, deleteSerie, renumerarSeries, getUltimaSerie, getSeriesDeSesionEjercicio,
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

  // Ejercicios activos (máx MAX_ROUTINE_SLOTS) + suplentes para swap
  const todos = await getRutinaEjercicios(rutinaHoy.id);
  let activos   = todos.filter(e => e.activo_hoy);
  let inactivos = todos.filter(e => !e.activo_hoy);

  // Auto-promover inactivos si hay slots libres bajo MAX_ROUTINE_SLOTS
  const slotsLibres = MAX_ROUTINE_SLOTS - activos.length;
  if (slotsLibres > 0 && inactivos.length > 0) {
    const aPromover = inactivos.slice(0, slotsLibres);
    await Promise.all(aPromover.map(e => updateActivoHoy(e.id, true)));
    activos   = [...activos, ...aPromover];
    inactivos = inactivos.slice(aPromover.length);
  }

  const ejercicios    = activos.slice(0, MAX_ROUTINE_SLOTS);
  const activosExtra  = activos.slice(MAX_ROUTINE_SLOTS);
  const suplentesSwap = [...inactivos, ...activosExtra];

  const lista = cel('div', 'diario-lista');
  container.appendChild(lista);

  // Pre-fetch todos los datos en paralelo — evita el efecto "uno a uno"
  const hasSuplentes = suplentesSwap.length > 0;
  const slots = [...ejercicios, null]; // null = slot vacío de añadir
  const datosSlots = await Promise.all(slots.map(ej => fetchDatosBloque(ej, sesion)));

  for (let i = 0; i < slots.length; i++) {
    lista.appendChild(construirBloque(slots[i], i, sesion, hasSuplentes, datosSlots[i]));
  }

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

    if (e.target.closest('[data-action="fin"]')) { await mostrarPantallaFin(container, sesion, rutinaHoy, ejercicios); return; }
    if (e.target.closest('[data-action="volver-diario"]')) { navigateTo('diario'); return; }

    const btnDeleteSuplente = e.target.closest('.btn-delete-suplente');
    if (btnDeleteSuplente) {
      handleEliminarSuplente(btnDeleteSuplente);
      return;
    }

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

// Pre-fetcha los datos de DB para un bloque — se llaman todos en paralelo desde render()
async function fetchDatosBloque(ej, sesion) {
  if (!ej || !sesion) return { seriesHoy: [], ref: null };
  const [seriesHoy, ultimaSerie] = await Promise.all([
    getSeriesDeSesionEjercicio(sesion.id, ej.ejercicio_id),
    getUltimaSerie(ej.ejercicio_id),
  ]);
  const ref = seriesHoy.length > 0 ? seriesHoy[seriesHoy.length - 1] : ultimaSerie;
  return { seriesHoy, ref };
}

// Construcción DOM síncrona — recibe datos ya cargados, no hace queries
function construirBloque(ej, idx, sesion, hasSuplentes, { seriesHoy = [], ref = null } = {}) {
  const details = document.createElement('details');
  details.className = 'ejercicio-bloque';
  if (ej) details.dataset.progreso = Math.min(seriesHoy.length, 4);

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

  const displayPeso = peso === 0 ? 'BW' : String(peso);
  const displayReps = String(reps);

  marcarComoGuardada(fila, peso, reps, serie.id);
  filaWrapper.appendChild(construirFilaSerie(numSerie + 1, displayPeso, displayReps));
  actualizarProgreso(filaWrapper.closest('.ejercicio-bloque'));
}

async function handleSuplentesDropdown(btnSwap, suplentes) {
  const details = btnSwap.closest('details');
  const existente = details?.querySelector('.suplentes-dropdown');
  if (existente) { existente.remove(); return; }
  if (suplentes.length === 0) return;

  if (details) details.open = true;

  const reId = parseInt(btnSwap.dataset.reId);
  const dropdown = cel('div', 'suplentes-dropdown');
  dropdown.appendChild(cel('p', 'suplentes-titulo', 'Suplentes:'));

  for (const sup of suplentes) {
    const fila = cel('div', 'suplente-fila');

    const btn = cel('button', 'suplente-item', sup.nombre);
    btn.dataset.reId = sup.id;
    btn.dataset.anteriorReId = reId;
    fila.appendChild(btn);

    const btnDel = cel('button', 'btn-delete-suplente', '[ ✕ ]');
    btnDel.dataset.ejId   = sup.ejercicio_id;
    btnDel.dataset.nombre = sup.nombre;
    fila.appendChild(btnDel);

    dropdown.appendChild(fila);
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

function handleEliminarSuplente(btn) {
  const fila = btn.closest('.suplente-fila');
  const existente = fila.querySelector('.confirm-delete-panel');
  if (existente) { existente.remove(); return; }

  const ejId  = parseInt(btn.dataset.ejId);
  const nombre = btn.dataset.nombre ?? '?';

  const panel = cel('div', 'confirm-delete-panel');
  panel.appendChild(cel('span', 'confirm-delete-msg', `¿Eliminar "${nombre}"?`));

  const btnSi = cel('button', 'btn-confirmar-eliminar', '[ ELIMINAR ]');
  btnSi.dataset.ejId = ejId;
  const btnNo = cel('button', 'btn-cancelar-eliminar', '[ CANCELAR ]');
  panel.appendChild(btnSi);
  panel.appendChild(btnNo);

  fila.appendChild(panel);
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
  container.addEventListener('click', e => {
    if (e.target.closest('[data-action="volver-diario"]')) {
      document.querySelector('.tab-btn[data-tab="diario"]')?.click();
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

  const todasSeries = sesion
    ? await Promise.all(ejercicios.map(ej => getSeriesDeSesionEjercicio(sesion.id, ej.ejercicio_id)))
    : ejercicios.map(() => []);

  const conSeries  = ejercicios.filter((_, i) => todasSeries[i].length > 0);
  const seriesFilt = todasSeries.filter(s => s.length > 0);

  const tabla = cel('div', 'fin-tabla');
  tabla.appendChild(cel('span', 'fin-th', 'EJERCICIO'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', 'SERIES'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', 'PESO'));
  tabla.appendChild(cel('span', 'fin-th fin-th-r', '1RM'));
  tabla.appendChild(cel('div', 'fin-sep'));

  let totalSeries = 0;
  conSeries.forEach((ej, i) => {
    const series    = seriesFilt[i];
    totalSeries    += series.length;
    const mejorPeso = Math.max(...series.map(s => s.peso));
    const mejorReps = series.find(s => s.peso === mejorPeso)?.repeticiones ?? 0;
    const isBW      = mejorPeso === 0;
    const unidad    = store.prefUnit ?? 'kg';
    const orm       = isBW ? '——' : `~${Math.round(calculateEpley1RM(mejorPeso, mejorReps))}${unidad}`;
    const pesoStr   = isBW ? 'BW' : `${mejorPeso}${unidad}`;

    tabla.appendChild(cel('span', 'fin-td', ej.nombre));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', `×${series.length}`));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', pesoStr));
    tabla.appendChild(cel('span', 'fin-td fin-td-r', orm));
  });

  tabla.appendChild(cel('div', 'fin-sep'));
  const totalesEl = cel('div', 'fin-totales');
  totalesEl.textContent = `${conSeries.length} EJERC · ${totalSeries} SERIES`;
  tabla.appendChild(totalesEl);
  finDiv.appendChild(tabla);

  const cta = cel('div', 'fin-cta');
  const qr  = document.createElement('img');
  qr.src    = import.meta.env.BASE_URL + 'assets/appUrl.jpg';
  qr.alt    = 'QR GymLog PWA';
  qr.className = 'fin-qr';
  cta.appendChild(qr);
  const texto = cel('div', 'fin-cta-texto');
  texto.appendChild(cel('p', 'fin-cta-titulo', 'GYMLOG PWA'));
  texto.appendChild(cel('p', null, 'Sin cuenta · Offline · Gratis para siempre'));
  texto.appendChild(cel('p', null, 'Lleva tu registro de entrenamiento en el móvil'));
  cta.appendChild(texto);
  finDiv.appendChild(cta);

  const btnVolver = cel('button', 'btn-fin-volver', '[ VOLVER AL DIARIO ]');
  btnVolver.dataset.action = 'volver-diario';
  finDiv.appendChild(btnVolver);

  container.appendChild(finDiv);
}
