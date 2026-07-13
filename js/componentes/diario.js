// Componente Diario: acordeones de ejercicios, precarga inteligente y guardado de series
import html2canvas from 'html2canvas';
import { store, navigateTo } from '../app.js';
import { abrirCatalogoModal } from './catalogoModal.js';
import { calculateEpley1RM } from '../analitico.js';
import asciiFinArt  from '/icons/ascii-end.txt?raw';
import motivArt     from '/icons/motiv.txt?raw';
import {
  getRutinas, getRutinasDias, getRutinaEjercicios,
  getSesionDelDia, saveSesion,
  saveSerie, deleteSerie, renumerarSeries, touchSesionTiempo, resetSesionTiempoIfVacia,
  getTodasSeriesDeHoy, getUltimasSeriesPorEjercicio,
  getSeriesConEjerciciosBySesion,
  getOrCreateEjercicio, vincularEjercicioCatalogo,
  updateEjercicioNombre, deleteEjercicio, removeEjercicioDeRutina,
  linkEjercicioToRutina, reordenarEjercicios,
} from '../db.js';
import { getCandidatos, getInstrucciones, getEntradaCatalogo } from '../catalogo.js';

export const MAX_ROUTINE_SLOTS = 8;

let clickAbort = null;
let dragAbort  = null;


function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function renderSkeleton() {
  const wrap = cel('div', 'diario-skeleton');
  for (let i = 0; i < 9; i++) wrap.appendChild(cel('div', 'diario-skeleton-bloque'));
  return wrap;
}

export async function render(state) {
  const container = document.getElementById('diario-container');
  if (!container) return;

  // OPT-5: Skeleton inmediato — feedback visual antes de cualquier query
  container.textContent = '';
  container.appendChild(renderSkeleton());

  const fechaLocal = new Date().toLocaleDateString('en-CA');
  const fechaDisplay = new Date()
    .toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase();

  // OPT-2: getSesionDelDia corre en paralelo con getRutinas+getRutinasDias
  // (la fecha es conocida antes de las queries, no hay dependencia)
  const diaSemana = new Date().getDay();
  const [[rutinas, rutinaDias], sesionExistente] = await Promise.all([
    Promise.all([getRutinas(), getRutinasDias()]),
    getSesionDelDia(fechaLocal),
  ]);
  const asignacion  = rutinaDias.find(rd => rd.dia === diaSemana);
  const rutinaHoy   = asignacion
    ? rutinas.find(r => r.id === asignacion.rutina_id) ?? null
    : null;

  // Sesión del día (sesionExistente ya disponible — saveSesion solo si falta)
  let sesion = sesionExistente;
  if (!sesion && rutinaHoy) sesion = await saveSesion(fechaLocal, rutinaHoy.id, null);
  if (sesion)    store.currentSesionId = sesion.id;
  if (rutinaHoy) store.activeRoutineId  = rutinaHoy.id;

  // Reemplazar skeleton con contenido real
  container.textContent = '';

  // Cabecera
  const header = cel('header', 'diario-header');
  header.appendChild(cel('h2', 'diario-fecha', fechaDisplay));
  const rutinaLabel = rutinaHoy
    ? `[ DIA DE ${rutinaHoy.nombre.toUpperCase()} ]`
    : '[ SIN RUTINA ASIGNADA ]';
  header.appendChild(cel('p', 'diario-rutina-titulo', rutinaLabel));
  container.appendChild(header);

  // Sin rutina asignada → pantalla de descanso
  if (!rutinaHoy) {
    mostrarPantallaDescanso(container);
    return;
  }

  // OPT-3: getRutinaEjercicios y getTodasSeriesDeHoy en paralelo
  // (sesion?.id ya disponible desde OPT-2; getTodasSeriesDeHoy tiene guard para null)
  const [todos, todasSeriesHoy] = await Promise.all([
    getRutinaEjercicios(rutinaHoy.id),
    getTodasSeriesDeHoy(sesion?.id ?? null),
  ]);

  const lista = cel('div', 'diario-lista');
  container.appendChild(lista);

  // getUltimasSeriesPorEjercicio necesita ejIds de todos (dependencia secuencial mínima)
  const ejIds = todos.map(e => e.ejercicio_id);
  const ultimasPorEj = await getUltimasSeriesPorEjercicio(ejIds);
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

  // OPT-4: DocumentFragment — inserta todos los bloques en un solo reflow
  const frag = document.createDocumentFragment();
  for (let i = 0; i < slots.length; i++) {
    frag.appendChild(construirBloque(slots[i], i, sesion, datosSlots[i]));
  }
  lista.appendChild(frag);

  initDragAndDrop(lista, rutinaHoy, state);

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
      await resetSesionTiempoIfVacia(sesion.id);

      filaToRemove.remove();
      filaWrapper.querySelectorAll('.serie-fila').forEach((fila, i) => {
        const num = i + 1;
        fila.dataset.numSerie = num;
        const esGuardada = fila.classList.contains('is-saved');
        const label = fila.querySelector('.serie-label');
        if (label) label.textContent = esGuardada ? `S${num}` : '+';
        const guardarBtn = fila.querySelector('.btn-guardar');
        if (guardarBtn) guardarBtn.dataset.numSerie = num;
      });
      actualizarConectores(filaWrapper);
      actualizarProgreso(filaWrapper.closest('.ejercicio-bloque'));
      return;
    }

    if (e.target.closest('[data-action="fin"]')) { await mostrarPantallaFin(container, sesion, rutinaHoy, todos); return; }
    if (e.target.closest('[data-action="volver-diario"]')) { navigateTo('diario'); return; }

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
      handleDetalles(btnEdit, state);
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
  const label     = fila.querySelector('.serie-label');

  btn.hidden       = true; // serie guardada: solo queda el botón de eliminar
  inputPeso.disabled = true;
  inputReps.disabled = true;
  inputPeso.classList.add('is-saved');
  inputReps.classList.add('is-saved');

  fila.classList.add('is-saved');
  if (label) {
    label.textContent = `S${fila.dataset.numSerie}`;
    label.setAttribute('aria-label', `Serie ${fila.dataset.numSerie} guardada`);
  }

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

function actualizarConectores(filaWrapper) {
  const filas = [...filaWrapper.querySelectorAll('.serie-fila')];
  filas.forEach((fila, i) => {
    const siguiente = filas[i + 1];
    const conecta = fila.classList.contains('is-saved') &&
                    !!siguiente && siguiente.classList.contains('is-saved');
    fila.classList.toggle('has-connector', conecta);
  });
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
    details.dataset.reId      = ej.id;
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
    const btnEdit = cel('button', 'btn-edit', '✎');
    btnEdit.dataset.ejId      = ej.ejercicio_id;
    btnEdit.dataset.catalogoId = ej.catalogo_id ?? '';
    btnEdit.setAttribute('aria-label', 'Ver detalles y editar ejercicio');
    summary.appendChild(btnEdit);

    const btnDelete = cel('button', 'btn-delete', '✕');
    btnDelete.dataset.ejId   = ej.ejercicio_id;
    btnDelete.dataset.nombre = ej.nombre;
    btnDelete.setAttribute('aria-label', 'Eliminar ejercicio');
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
    actualizarConectores(filaWrapper);
    cuerpo.appendChild(filaWrapper);
    details.appendChild(cuerpo);
  }

  return details;
}

function construirFilaSerie(num, phPeso, phReps) {
  const fila = cel('div', 'serie-fila');
  fila.dataset.numSerie = num;

  const label = cel('span', 'serie-label', '+');
  label.setAttribute('aria-label', `Serie ${num}`);
  fila.appendChild(label);

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

  const btn = cel('button', 'btn-guardar', '✓');
  btn.dataset.numSerie = num;
  btn.setAttribute('aria-label', 'Guardar serie');
  fila.appendChild(btn);

  const btnX = cel('button', 'btn-delete-serie', '✕');
  btnX.hidden = true;
  btnX.setAttribute('aria-label', 'Eliminar serie');
  fila.appendChild(btnX);

  return fila;
}

function actualizarProgreso(bloqueEl) {
  if (!bloqueEl) return;
  const guardadas = bloqueEl.querySelectorAll('.btn-delete-serie:not([hidden])').length;
  bloqueEl.dataset.progreso = Math.min(guardadas, 4);
}

// ── Drag & Drop de ejercicios (long-press + Pointer Events) ───────────────────

const LONG_PRESS_MS   = 350; // espera para "levantar" el bloque
const DRAG_TOLERANCE  = 8;   // px de movimiento que cancelan el long-press (scroll/tap)
const SCROLL_ZONE     = 60;  // px desde el borde del viewport que activan auto-scroll
const SCROLL_MAX_STEP = 12;  // px máximos de auto-scroll por frame

function renumerarBloques(lista) {
  lista.querySelectorAll('.ejercicio-bloque[data-re-id]').forEach((b, i) => {
    const num = b.querySelector('.ejercicio-num');
    if (num) num.textContent = `${i + 1}. `;
  });
}

function initDragAndDrop(lista, rutinaHoy, state) {
  dragAbort?.abort();
  dragAbort = new AbortController();
  const { signal } = dragAbort;

  let pressTimer    = null;  // timeout del long-press pendiente
  let candidato     = null;  // bloque bajo el dedo antes de levantar
  let dragging      = null;  // <details> levantado
  let pointerId     = null;
  let startX        = 0;
  let startY        = 0;
  let grabDY        = 0;     // distancia dedo → top del bloque al levantar
  let translateY    = 0;     // translate actual aplicado al bloque
  let lastClientY   = 0;
  let rafId         = null;
  let suprimirClick = false; // consume el click sintético posterior al drop

  const bloquearTouchScroll = e => e.preventDefault();

  const cancelarTimer = () => {
    if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    candidato = null;
  };

  // Mantiene el bloque bajo el dedo: translate = destino visual − posición natural
  const aplicarTransform = () => {
    const rect = dragging.getBoundingClientRect();
    const naturalTop = rect.top - translateY;
    translateY = (lastClientY - grabDY) - naturalTop;
    dragging.style.transform = `translateY(${translateY}px)`;
  };

  // Reinserta el bloque cuando su centro cruza el punto medio de un vecino (FLIP)
  const recolocar = () => {
    const otros = [...lista.querySelectorAll('.ejercicio-bloque[data-re-id]')]
      .filter(b => b !== dragging);
    if (otros.length === 0) return;

    const rect   = dragging.getBoundingClientRect();
    const centro = rect.top + rect.height / 2;

    let destino = null; // insertar antes de este bloque; null = después del último
    for (const b of otros) {
      const r = b.getBoundingClientRect();
      if (centro < r.top + r.height / 2) { destino = b; break; }
    }
    const ref = destino ?? otros[otros.length - 1].nextElementSibling;
    if (ref === dragging || dragging.nextElementSibling === ref) return;

    // FLIP: medir posición visual → mover en el DOM → animar la diferencia
    const animables = [...lista.children].filter(el => el !== dragging);
    const antes = new Map(animables.map(el => [el, el.getBoundingClientRect().top]));

    lista.insertBefore(dragging, ref);
    aplicarTransform(); // la reinserción movió su posición natural: recalcular

    for (const el of animables) {           // limpiar transforms en vuelo
      el.style.transition = 'none';
      el.style.transform  = '';
    }
    void lista.offsetHeight;                // reflow: posiciones naturales nuevas
    for (const el of animables) {           // invertir al punto visual de partida
      const delta = antes.get(el) - el.getBoundingClientRect().top;
      if (delta) el.style.transform = `translateY(${delta}px)`;
    }
    void lista.offsetHeight;                // reflow: fija el estado inicial
    for (const el of animables) {           // play: transición base los asienta
      el.style.transition = '';
      el.style.transform  = '';
    }
  };

  // Auto-scroll cuando el dedo se acerca al borde del viewport
  const autoScroll = () => {
    if (!dragging) return;
    const vh = window.innerHeight;
    let paso = 0;
    if (lastClientY < SCROLL_ZONE) {
      paso = -Math.ceil(((SCROLL_ZONE - lastClientY) / SCROLL_ZONE) * SCROLL_MAX_STEP);
    } else if (lastClientY > vh - SCROLL_ZONE) {
      paso = Math.ceil(((lastClientY - (vh - SCROLL_ZONE)) / SCROLL_ZONE) * SCROLL_MAX_STEP);
    }
    if (paso !== 0) {
      window.scrollBy(0, paso);
      aplicarTransform(); // el scroll movió el layout bajo el dedo
      recolocar();
    }
    rafId = requestAnimationFrame(autoScroll);
  };

  const levantar = () => {
    pressTimer = null;
    dragging   = candidato;
    candidato  = null;
    navigator.vibrate?.(15);

    grabDY     = lastClientY - dragging.getBoundingClientRect().top;
    translateY = 0;

    dragging.classList.add('is-dragging');
    lista.classList.add('is-drag-active');
    try { lista.setPointerCapture(pointerId); } catch { /* puntero ya inactivo */ }
    // No pasivo: bloquea el scroll de página mientras dura el arrastre
    document.addEventListener('touchmove', bloquearTouchScroll, { passive: false, signal });
    rafId = requestAnimationFrame(autoScroll);
  };

  const soltar = async () => {
    cancelAnimationFrame(rafId);
    rafId = null;
    document.removeEventListener('touchmove', bloquearTouchScroll);
    if (lista.hasPointerCapture?.(pointerId)) lista.releasePointerCapture(pointerId);

    const bloque  = dragging;
    dragging      = null;
    pointerId     = null;
    suprimirClick = true;

    bloque.classList.remove('is-dragging');
    bloque.style.transform = '';          // la transición base lo asienta en su slot
    lista.classList.remove('is-drag-active');

    const ordenados = [...lista.querySelectorAll('.ejercicio-bloque[data-re-id]')]
      .map(b => parseInt(b.dataset.reId));
    try {
      await reordenarEjercicios(rutinaHoy.id, ordenados);
      // fixup in-place: sin re-render, preserva acordeones e inputs
      renumerarBloques(lista);
    } catch {
      await render(state);                // fallo de BD: re-render restaura la verdad
    }
  };

  lista.addEventListener('pointerdown', e => {
    suprimirClick = false;
    if (!e.isPrimary || dragging) return;
    const summary = e.target.closest('.ejercicio-summary');
    if (!summary) return;
    if (e.target.closest('button, input, .rename-panel, .confirm-delete-panel')) return;
    const bloque = summary.closest('.ejercicio-bloque');
    if (!bloque?.dataset.reId) return;

    candidato   = bloque;
    pointerId   = e.pointerId;
    startX      = e.clientX;
    startY      = e.clientY;
    lastClientY = e.clientY;
    pressTimer  = setTimeout(levantar, LONG_PRESS_MS);
  }, { signal });

  lista.addEventListener('pointermove', e => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    lastClientY = e.clientY;
    if (dragging) {
      aplicarTransform();
      recolocar();
      return;
    }
    // Antes del long-press: movimiento = scroll o tap normal, no arrastre
    if (pressTimer !== null &&
        Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_TOLERANCE) {
      cancelarTimer();
    }
  }, { signal });

  const finalizar = e => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    if (dragging) { soltar(); return; }
    cancelarTimer();
    pointerId = null;
  };
  lista.addEventListener('pointerup', finalizar, { signal });
  lista.addEventListener('pointercancel', finalizar, { signal });

  // El long-press móvil puede disparar el menú contextual — suprimir durante el gesto
  lista.addEventListener('contextmenu', e => {
    if (dragging || pressTimer !== null) e.preventDefault();
  }, { signal });

  // Consume el click sintético tras el drop (evita alternar el <details>)
  lista.addEventListener('click', e => {
    if (!suprimirClick) return;
    suprimirClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, { capture: true, signal });
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
  actualizarConectores(filaWrapper);
  actualizarProgreso(filaWrapper.closest('.ejercicio-bloque'));
}

function handleAñadirEjercicio(nombreEl, rutinaHoy, state) {
  const vincular = async (nombre, grupo, catalogoId = null) => {
    const ej = await getOrCreateEjercicio(nombre, grupo, catalogoId);
    const todos = await getRutinaEjercicios(rutinaHoy.id);
    await linkEjercicioToRutina(rutinaHoy.id, ej.id, todos.length + 1);
    await render(state);
  };

  abrirCatalogoModal({
    onSeleccionar: ({ nombre_es, grupo_muscular, fuente_id }) =>
      vincular(nombre_es, grupo_muscular, fuente_id),
    onCrearPersonalizado: ({ nombre, grupo }) =>
      vincular(nombre, grupo),
  });
}

// Panel de detalles y edición (botón ✎): nombre editable + imagen crossfade +
// instrucciones. El grupo muscular ya no se edita a mano — lo determina el
// catálogo al crear el ejercicio. Tap en la imagen cicla entre las coincidencias
// del catálogo para ese nombre; se persiste al guardar.
async function handleDetalles(btnEdit, state) {
  const details = btnEdit.closest('details');
  if (details) details.open = true;

  const existente = details?.querySelector('.rename-panel');
  details?.querySelector('.confirm-delete-panel')?.remove();
  if (existente) { existente.remove(); return; }

  const ejId         = parseInt(btnEdit.dataset.ejId);
  const nombreActual = details?.querySelector('.ejercicio-nombre')?.textContent ?? '';
  const catalogoIdActual = btnEdit.dataset.catalogoId || null;

  const panel = cel('div', 'rename-panel');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input-rename-ejercicio';
  input.value = nombreActual;
  input.setAttribute('aria-label', 'Nuevo nombre del ejercicio');
  panel.appendChild(input);

  const zonaDetalle = cel('div', 'detalle-zona');
  panel.appendChild(zonaDetalle);

  // Vía de escape: siempre hay nombres sin relación léxica con el catálogo.
  // Elegir aquí NO renombra el ejercicio ni cambia su grupo — solo su imagen.
  const btnBuscar = cel('button', 'btn-panel-buscar', '[ BUSCAR EN CATÁLOGO ]');
  panel.appendChild(btnBuscar);

  const acciones = cel('div', 'detalle-acciones');
  const btnGuardar  = cel('button', 'btn-panel-accion',  '[ GUARDAR ]');
  const btnCancelar = cel('button', 'btn-panel-cancel', '[ CANCELAR ]');
  acciones.appendChild(btnGuardar);
  acciones.appendChild(btnCancelar);
  panel.appendChild(acciones);

  const cuerpo = details?.querySelector('.ejercicio-cuerpo');
  if (cuerpo) details.insertBefore(panel, cuerpo);
  else details?.appendChild(panel);

  input.focus();
  input.select();

  // ── Candidatos del catálogo (best-effort: sin catálogo, el panel es solo rename)
  let candidatos = [];
  try {
    candidatos = await getCandidatos(nombreActual);

    // El vínculo guardado manda, aunque no salga al buscar por nombre: si el
    // usuario lo eligió con [ BUSCAR EN CATÁLOGO ] fue justamente porque ninguna
    // sugerencia por nombre le servía. Sin esto, el panel lo ignoraría al reabrir
    // y volvería a mostrar la primera sugerencia descartada.
    if (catalogoIdActual && !candidatos.some(c => c.fuente_id === catalogoIdActual)) {
      const vinculada = await getEntradaCatalogo(catalogoIdActual);
      if (vinculada) candidatos = [vinculada, ...candidatos];
    }
  } catch { /* catálogo no disponible */ }

  // Punto de partida: el vínculo guardado si existe; si no, la mejor coincidencia.
  const idxGuardado = candidatos.findIndex(c => c.fuente_id === catalogoIdActual);
  let indice = idxGuardado >= 0 ? idxGuardado : 0;

  const pintarDetalle = async () => {
    zonaDetalle.textContent = '';
    const entrada = candidatos[indice];

    if (!entrada) {
      zonaDetalle.appendChild(cel('p', 'detalle-vacio',
        'Sin coincidencias en el catálogo para este nombre.'));
      return;
    }

    const btnImg = cel('button', 'detalle-imagen catalogo-thumb');
    btnImg.setAttribute('aria-label',
      `Cambiar imagen: ${entrada.nombre_es} (coincidencia ${indice + 1} de ${candidatos.length})`);
    const imgA = document.createElement('img');
    const imgB = document.createElement('img');
    imgA.src = entrada.imagen_a;
    imgB.src = entrada.imagen_b;
    imgA.alt = '';
    imgB.alt = '';
    imgA.className = 'catalogo-thumb-a';
    imgB.className = 'catalogo-thumb-b';
    btnImg.appendChild(imgA);
    btnImg.appendChild(imgB);
    zonaDetalle.appendChild(btnImg);

    if (candidatos.length > 1) {
      btnImg.addEventListener('click', () => {
        indice = (indice + 1) % candidatos.length; // cicla
        pintarDetalle();
      });
      zonaDetalle.appendChild(cel('p', 'detalle-contador',
        `${entrada.nombre_es} · ${indice + 1}/${candidatos.length} — toca la imagen para cambiarla`));
    } else {
      btnImg.disabled = true;
      zonaDetalle.appendChild(cel('p', 'detalle-contador', entrada.nombre_es));
    }

    let pasos = [];
    try {
      pasos = await getInstrucciones(entrada.fuente_id);
    } catch { /* instrucciones no disponibles offline */ }

    if (pasos.length > 0) {
      const ol = cel('ol', 'detalle-instrucciones');
      for (const paso of pasos) ol.appendChild(cel('li', null, paso));
      zonaDetalle.appendChild(ol);
    }
  };

  await pintarDetalle();

  // La entrada elegida a mano pasa a ser el candidato del panel; como el resto
  // de cambios, se persiste al GUARDAR (no al elegirla).
  btnBuscar.addEventListener('click', () => {
    abrirCatalogoModal({
      onSeleccionar: (entrada) => {
        // Al frente, sin descartar el resto: el usuario sigue pudiendo ciclar.
        candidatos = [entrada, ...candidatos.filter(c => c.fuente_id !== entrada.fuente_id)];
        indice = 0;
        pintarDetalle();
      },
    });
  });

  const guardar = async () => {
    const nuevoNombre = input.value.trim();
    if (!nuevoNombre) { panel.remove(); return; }
    await updateEjercicioNombre(ejId, nuevoNombre);
    const elegido = candidatos[indice];
    if (elegido && elegido.fuente_id !== catalogoIdActual) {
      await vincularEjercicioCatalogo(ejId, elegido.fuente_id);
    }
    await render(state);
  };

  btnGuardar.addEventListener('click', guardar);
  btnCancelar.addEventListener('click', () => panel.remove());
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); guardar(); }
    if (e.key === 'Escape') panel.remove();
  });
}

function handleEliminar(btnDelete, state) {
  const details = btnDelete.closest('details');

  // Con el panel de detalles abierto, la ✕ hace de [ CANCELAR ]: lo cierra en vez
  // de eliminar el ejercicio. Eliminar exige que el panel esté cerrado — así la
  // ✕ nunca destruye datos mientras el usuario está editando.
  const panelDetalles = details?.querySelector('.rename-panel');
  if (panelDetalles) { panelDetalles.remove(); return; }

  if (details) details.open = true;

  const existente = details?.querySelector('.confirm-delete-panel');
  if (existente) { existente.remove(); return; }

  const ejId   = parseInt(btnDelete.dataset.ejId);
  const nombre = btnDelete.dataset.nombre ?? '?';

  const panel = cel('div', 'confirm-delete-panel');
  panel.appendChild(cel('span', 'confirm-delete-msg',
    `¿Eliminar "${nombre}"? Se quitará de la rutina. `));

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
      // Resolución dinámica igual al dispositivo: la densidad de píxeles real
      // (devicePixelRatio) y las dimensiones on-screen del wrapper garantizan
      // que la imagen compartida se vea idéntica a lo que ve el usuario (issue #18).
      const canvas = await html2canvas(wrapper, {
        scale: window.devicePixelRatio || 1,
        backgroundColor: '#000000',
        useCORS: false,
        logging: false,
        width: wrapper.offsetWidth,
        height: wrapper.offsetHeight,
        windowWidth: document.documentElement.clientWidth,
        windowHeight: document.documentElement.clientHeight,
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

  finDiv.appendChild(cel('h2', 'fin-titulo', '¡Entrenamiento Finalizado!'));

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
