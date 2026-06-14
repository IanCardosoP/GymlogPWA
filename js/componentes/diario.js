// Componente Diario: acordeones de ejercicios, precarga inteligente y guardado de series
import { store } from '../app.js';
import {
  getRutinas, getRutinaEjercicios, getRutinaEjerciciosSuplentes,
  getSesionDelDia, saveSesion,
  saveSerie, getUltimaSerie,
  saveEjercicio, updateActivoHoy, linkEjercicioToRutina,
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

  // Cabecera
  const header = cel('header', 'diario-header');
  header.appendChild(cel('h2', 'diario-fecha', fechaDisplay));
  container.appendChild(header);

  // Rutina del día (por día de semana: 0=Dom … 6=Sáb)
  const diaSemana = new Date().getDay();
  const rutinas = await getRutinas();
  const rutinaHoy = rutinas.find(r => r.dia_sugerido === diaSemana) ?? null;

  const rutinaRow = cel('div', 'diario-rutina-row');
  rutinaRow.appendChild(cel('span', 'diario-rutina-nombre',
    `Rutina: ${rutinaHoy?.nombre ?? '— Sin rutina asignada —'}`));
  container.appendChild(rutinaRow);

  // Sesión del día
  let sesion = await getSesionDelDia(fechaLocal);
  if (!sesion && rutinaHoy) sesion = await saveSesion(fechaLocal, rutinaHoy.id, null);
  if (sesion)    store.currentSesionId = sesion.id;
  if (rutinaHoy) store.activeRoutineId  = rutinaHoy.id;

  // Ejercicios activos (máx MAX_ROUTINE_SLOTS)
  let ejercicios = [];
  if (rutinaHoy) {
    const todos = await getRutinaEjercicios(rutinaHoy.id);
    ejercicios = todos.filter(e => e.activo_hoy).slice(0, MAX_ROUTINE_SLOTS);
  }

  const lista = cel('div', 'diario-lista');
  container.appendChild(lista);

  for (let i = 0; i < MAX_ROUTINE_SLOTS; i++) {
    lista.appendChild(await construirBloque(ejercicios[i], i, sesion, state));
  }

  // Botón fin
  const finBtn = cel('button', 'btn-fin-entrenamiento', '[ FIN DEL ENTRENAMIENTO ]');
  finBtn.dataset.action = 'fin';
  container.appendChild(finBtn);

  // Delegación de eventos — AbortController descarta el listener del render anterior
  clickAbort?.abort();
  clickAbort = new AbortController();

  let tapTimer = null;
  let lastTapTarget = null;

  container.addEventListener('click', async e => {
    const btnGuardar = e.target.closest('.btn-guardar');
    if (btnGuardar && sesion) { await handleGuardar(btnGuardar, sesion.id); return; }

    if (e.target.closest('[data-action="fin"]')) { mostrarPantallaFin(container); return; }

    const suplanteItem = e.target.closest('.suplente-item');
    if (suplanteItem && rutinaHoy) {
      await updateActivoHoy(parseInt(suplanteItem.dataset.reId), true);
      await updateActivoHoy(parseInt(suplanteItem.dataset.anteriorReId), false);
      await render(state);
      return;
    }

    const nombreEl = e.target.closest('.ejercicio-nombre');
    if (!nombreEl) return;

    if (lastTapTarget === nombreEl && tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      lastTapTarget = null;
      handleDoubleTap(nombreEl, rutinaHoy, state);
    } else {
      lastTapTarget = nombreEl;
      tapTimer = setTimeout(async () => {
        tapTimer = null;
        lastTapTarget = null;
        if (rutinaHoy) await handleSingleTap(nombreEl, rutinaHoy);
      }, 280);
    }
  }, { signal: clickAbort.signal });
}

async function construirBloque(ej, idx, sesion) {
  const details = document.createElement('details');
  details.className = 'ejercicio-bloque';

  const summary = document.createElement('summary');
  summary.className = 'ejercicio-summary';

  const numSpan = cel('span', 'ejercicio-num', `${idx + 1}. `);
  const nombreSpan = cel('span', 'ejercicio-nombre', ej ? ej.nombre : '[ + Añadir Ejercicio ]');
  if (ej) {
    nombreSpan.dataset.reId  = ej.id;
    nombreSpan.dataset.ejId  = ej.ejercicio_id;
    nombreSpan.dataset.nombre = ej.nombre;
  }

  summary.appendChild(numSpan);
  summary.appendChild(nombreSpan);
  details.appendChild(summary);

  if (ej && sesion) {
    const cuerpo = cel('div', 'ejercicio-cuerpo');

    const ultima = await getUltimaSerie(ej.ejercicio_id);
    const phPeso = ultima ? (Number(ultima.peso) === 0 ? 'BW' : String(ultima.peso)) : '';
    const phReps = ultima ? String(ultima.repeticiones) : '';

    if (ultima) {
      cuerpo.appendChild(cel('p', 'ejercicio-historial',
        `Último: ${phPeso} × ${phReps} reps`));
    }

    const filaWrapper = cel('div', 'serie-filas');
    filaWrapper.dataset.ejId = ej.ejercicio_id;
    filaWrapper.dataset.reId = ej.id;
    filaWrapper.appendChild(construirFilaSerie(1, phPeso, phReps));
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

  const peso = parseFloat(inputPeso.value) || 0;
  const reps = parseInt(inputReps.value, 10) || 0;

  await saveSerie(sesionId, ejId, numSerie, peso, reps);

  btnGuardar.textContent = '[✓]';
  btnGuardar.disabled = true;
  inputPeso.disabled = true;
  inputReps.disabled = true;

  const nextPh = `${inputPeso.value || inputPeso.placeholder}`;
  const nextPhR = `${inputReps.value || inputReps.placeholder}`;
  filaWrapper.appendChild(construirFilaSerie(numSerie + 1, nextPh, nextPhR));
}

async function handleSingleTap(nombreEl, rutinaHoy) {
  const details = nombreEl.closest('details');
  const existente = details?.querySelector('.suplentes-dropdown');
  if (existente) { existente.remove(); return; }

  const reId = parseInt(nombreEl.dataset.reId);
  const suplentes = await getRutinaEjerciciosSuplentes(rutinaHoy.id);
  if (suplentes.length === 0) return;

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

function handleDoubleTap(nombreEl, rutinaHoy, state) {
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

function mostrarPantallaFin(container) {
  container.textContent = '';

  const finDiv = cel('div', 'diario-fin');
  finDiv.id = 'diario-fin';

  finDiv.appendChild(cel('h2', 'fin-titulo', '¡Entrenamiento Registrado!'));

  const arte = cel('pre', 'fin-arte');
  arte.textContent = [
    '     \\o/',
    '      |',
    '     / \\',
    '',
    ' ___________',
    '|  GymLog  |',
    '|___________|',
  ].join('\n');
  finDiv.appendChild(arte);

  finDiv.appendChild(cel('p', 'fin-msg', 'Descansa. Recupera. Vuelve mañana.'));

  container.appendChild(finDiv);
}
