// Modal picker del catálogo de ejercicios: búsqueda bilingüe + chips de filtro
// + lista con miniatura crossfade. Componente compartido (no es pestaña).
// Importa catalogo.js (lógica pura); nunca db.js — quien persiste es el caller.
import { buscarCatalogo, getEquiposCatalogo, getInstrucciones } from '../catalogo.js';

export const GRUPOS_MUSCULARES = ['PECHO', 'ESPALDA', 'PIERNA', 'HOMBRO', 'BRAZO', 'CORE', 'GENERAL'];

const TAMANO_PAGINA = 30;
const DEBOUNCE_MS = 250;

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function construirThumb(entrada) {
  const thumb = cel('div', 'catalogo-thumb');
  const imgA = document.createElement('img');
  const imgB = document.createElement('img');
  imgA.src = entrada.imagen_a;
  imgB.src = entrada.imagen_b;
  imgA.alt = '';
  imgB.alt = '';
  imgA.loading = 'lazy';
  imgB.loading = 'lazy';
  imgA.className = 'catalogo-thumb-a';
  imgB.className = 'catalogo-thumb-b';
  thumb.appendChild(imgA);
  thumb.appendChild(imgB);
  return thumb;
}

// onSeleccionar(entrada) — entrada completa del catálogo al elegir una fila.
// onCrearPersonalizado({ nombre, grupo }) — ejercicio custom con grupo elegido
// en el selector interno del modal (única vía de alta manual desde el Diario).
// onCerrar() — siempre que el modal se cierra (antes de los otros callbacks).
export function abrirCatalogoModal({ onSeleccionar, onCrearPersonalizado, onCerrar }) {
  const filtros = { texto: '', grupo: null, equipo: null };
  let offset = 0;
  let debounceTimer = null;

  const scrim = cel('div', 'catalogo-scrim');
  const modal = cel('div', 'catalogo-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Catálogo de ejercicios');

  // ── Header: búsqueda + cerrar ──
  const header = cel('div', 'catalogo-header');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'catalogo-buscar';
  input.placeholder = 'Buscar ejercicio (es/en)...';
  input.setAttribute('aria-label', 'Buscar ejercicio en el catálogo');
  const btnCerrar = cel('button', 'catalogo-cerrar', '✕');
  btnCerrar.setAttribute('aria-label', 'Cerrar catálogo');
  header.appendChild(input);
  header.appendChild(btnCerrar);

  // ── Chips de filtro ──
  const filaGrupos = cel('div', 'catalogo-chips-fila');
  const filaEquipos = cel('div', 'catalogo-chips-fila');

  const construirChips = (fila, valores, clave) => {
    fila.textContent = '';
    const chipTodos = cel('button', 'catalogo-chip', 'TODOS');
    chipTodos.classList.toggle('is-active', filtros[clave] === null);
    chipTodos.dataset[clave] = '';
    fila.appendChild(chipTodos);
    for (const v of valores) {
      const chip = cel('button', 'catalogo-chip', clave === 'equipo' ? v.toUpperCase() : v);
      chip.classList.toggle('is-active', filtros[clave] === v);
      chip.dataset[clave] = v;
      fila.appendChild(chip);
    }
  };

  // ── Lista de resultados ──
  const lista = cel('div', 'catalogo-resultados');
  const entradasVisibles = new Map(); // fuente_id → entrada renderizada

  const renderResultados = async (acumular = false) => {
    const { resultados, total } = await buscarCatalogo({
      ...filtros, limit: TAMANO_PAGINA, offset,
    });

    if (!acumular) {
      lista.textContent = '';
      entradasVisibles.clear();
    }
    lista.querySelector('.catalogo-ver-mas')?.remove();
    lista.querySelector('.catalogo-vacio')?.remove();
    lista.querySelector('.catalogo-crear')?.remove();
    lista.querySelector('.catalogo-grupo-picker')?.remove();

    for (const entrada of resultados) {
      entradasVisibles.set(entrada.fuente_id, entrada);
      const item = cel('button', 'catalogo-item');
      item.dataset.fuenteId = entrada.fuente_id;
      item.appendChild(construirThumb(entrada));
      const info = cel('div', 'catalogo-item-info');
      info.appendChild(cel('span', 'catalogo-item-nombre', entrada.nombre_es));
      info.appendChild(cel('span', 'catalogo-item-meta',
        `${entrada.grupo_muscular} · ${entrada.equipo_es}`));
      item.appendChild(info);
      lista.appendChild(item);
    }

    const mostrados = offset + resultados.length;
    if (mostrados < total) {
      lista.appendChild(cel('button', 'catalogo-ver-mas', `Ver más (${total - mostrados})`));
    }

    if (total === 0) {
      const vacio = cel('div', 'catalogo-vacio');
      vacio.appendChild(cel('p', 'catalogo-vacio-texto', 'Sin resultados en el catálogo.'));
      lista.appendChild(vacio);
    }

    // El alta manual vive aquí: siempre que hay texto, se puede crear tal cual.
    if (filtros.texto) {
      lista.appendChild(cel('button', 'catalogo-crear', `+ Crear «${filtros.texto}»`));
    }
  };

  // Sustituye el botón crear por el selector de grupo muscular (dentro del modal).
  const mostrarPickerGrupo = (btnCrear) => {
    const nombre = filtros.texto;
    const picker = cel('div', 'catalogo-grupo-picker');
    picker.appendChild(cel('span', 'catalogo-grupo-picker-label', `GRUPO PARA «${nombre}»:`));
    const filaBtns = cel('div', 'catalogo-grupo-picker-btns');
    for (const grupo of GRUPOS_MUSCULARES) {
      const btn = cel('button', 'catalogo-chip', grupo);
      btn.addEventListener('click', () => {
        cerrar();
        onCrearPersonalizado?.({ nombre, grupo });
      });
      filaBtns.appendChild(btn);
    }
    picker.appendChild(filaBtns);
    btnCrear.replaceWith(picker);
  };

  const refrescar = () => {
    offset = 0;
    renderResultados(false);
  };

  // ── Cierre y limpieza ──
  // Escape cierra primero la vista previa (si está abierta), no todo el modal.
  const onKeydown = (e) => {
    if (e.key !== 'Escape') return;
    const preview = document.querySelector('.preview-scrim');
    if (preview) { preview.remove(); return; }
    cerrar();
  };
  const cerrar = () => {
    clearTimeout(debounceTimer);
    document.removeEventListener('keydown', onKeydown);
    document.querySelector('.preview-scrim')?.remove();
    scrim.remove();
    onCerrar?.();
  };

  // Segunda capa sobre el modal: el ejercicio en grande + instrucciones, para
  // confirmar antes de comprometerlo a la rutina. Volver deja el listado intacto
  // (búsqueda, filtros y scroll siguen como estaban).
  const abrirPreview = async (entrada) => {
    const pScrim = cel('div', 'preview-scrim');
    const pModal = cel('div', 'preview-modal');
    pModal.setAttribute('role', 'dialog');
    pModal.setAttribute('aria-modal', 'true');
    pModal.setAttribute('aria-label', `Vista previa: ${entrada.nombre_es}`);

    const cerrarPreview = () => pScrim.remove();

    const pHeader = cel('div', 'preview-header');
    pHeader.appendChild(cel('h3', 'preview-titulo', entrada.nombre_es));
    const btnVolver = cel('button', 'preview-volver', '✕');
    btnVolver.setAttribute('aria-label', 'Volver al catálogo');
    pHeader.appendChild(btnVolver);
    pModal.appendChild(pHeader);

    const pCuerpo = cel('div', 'preview-cuerpo');

    const imagen = construirThumb(entrada);
    imagen.classList.add('preview-imagen');
    pCuerpo.appendChild(imagen);

    const meta = cel('div', 'preview-meta');
    meta.appendChild(cel('span', 'preview-tag', entrada.grupo_muscular));
    meta.appendChild(cel('span', 'preview-tag', entrada.equipo_es.toUpperCase()));
    pCuerpo.appendChild(meta);

    const instruccionesEl = cel('div', 'preview-instrucciones-zona');
    pCuerpo.appendChild(instruccionesEl);
    pModal.appendChild(pCuerpo);

    const pPie = cel('div', 'preview-pie');
    const btnCancelar = cel('button', 'preview-cancelar', '[ VOLVER ]');
    const btnAgregar  = cel('button', 'preview-agregar', '[ + AGREGAR ]');
    pPie.appendChild(btnCancelar);
    pPie.appendChild(btnAgregar);
    pModal.appendChild(pPie);

    pScrim.appendChild(pModal);
    document.body.appendChild(pScrim);
    btnAgregar.focus();

    btnVolver.addEventListener('click', cerrarPreview);
    btnCancelar.addEventListener('click', cerrarPreview);
    pScrim.addEventListener('click', (e) => {
      if (e.target === pScrim) cerrarPreview();
    });

    btnAgregar.addEventListener('click', () => {
      cerrar(); // cierra preview + catálogo
      onSeleccionar?.(entrada);
    });

    // Las instrucciones son un asset aparte con carga diferida: se piden aquí,
    // no al abrir el modal ni al listar.
    let pasos = [];
    try {
      pasos = await getInstrucciones(entrada.fuente_id);
    } catch { /* asset no disponible offline */ }

    if (pasos.length > 0) {
      const ol = cel('ol', 'detalle-instrucciones');
      for (const paso of pasos) ol.appendChild(cel('li', null, paso));
      instruccionesEl.appendChild(ol);
    } else {
      instruccionesEl.appendChild(
        cel('p', 'detalle-vacio', 'Este ejercicio no trae instrucciones.'));
    }
  };

  // ── Eventos (delegación en el modal) ──
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      filtros.texto = input.value.trim();
      refrescar();
    }, DEBOUNCE_MS);
  });

  btnCerrar.addEventListener('click', cerrar);
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) cerrar();
  });
  document.addEventListener('keydown', onKeydown);

  const onChipClick = (fila, clave) => (e) => {
    const chip = e.target.closest('.catalogo-chip');
    if (!chip) return;
    const valor = chip.dataset[clave];
    filtros[clave] = valor === '' ? null : valor;
    for (const c of fila.children) {
      c.classList.toggle('is-active', (c.dataset[clave] || null) === filtros[clave]);
    }
    refrescar();
  };
  filaGrupos.addEventListener('click', onChipClick(filaGrupos, 'grupo'));
  filaEquipos.addEventListener('click', onChipClick(filaEquipos, 'equipo'));

  lista.addEventListener('click', async (e) => {
    const verMas = e.target.closest('.catalogo-ver-mas');
    if (verMas) {
      offset += TAMANO_PAGINA;
      verMas.remove();
      await renderResultados(true);
      return;
    }
    const crear = e.target.closest('.catalogo-crear');
    if (crear) {
      mostrarPickerGrupo(crear);
      return;
    }
    const item = e.target.closest('.catalogo-item');
    if (item) {
      const entrada = entradasVisibles.get(item.dataset.fuenteId);
      if (!entrada) return;
      // No se compromete a la rutina todavía: primero la vista previa confirma.
      await abrirPreview(entrada);
    }
  });

  // ── Montaje ──
  modal.appendChild(header);
  modal.appendChild(filaGrupos);
  modal.appendChild(filaEquipos);
  modal.appendChild(lista);
  scrim.appendChild(modal);
  document.body.appendChild(scrim);
  input.focus();

  construirChips(filaGrupos, GRUPOS_MUSCULARES, 'grupo');
  construirChips(filaEquipos, [], 'equipo'); // placeholder hasta que cargue el catálogo
  getEquiposCatalogo().then(equipos => construirChips(filaEquipos, equipos, 'equipo'));
  refrescar();

  return { cerrar };
}
