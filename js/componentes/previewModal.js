// Vista previa de un ejercicio del catálogo: imagen grande, metadatos e
// instrucciones, con confirmación explícita. Componente compartido — lo usan el
// modal del catálogo (para agregar a la rutina) y Config (para vincular imagen a
// un ejercicio existente). Importa catalogo.js; nunca db.js — persiste el caller.
import { getInstrucciones } from '../catalogo.js';

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function construirImagen(entrada) {
  const wrap = cel('div', 'catalogo-thumb preview-imagen');
  const imgA = document.createElement('img');
  const imgB = document.createElement('img');
  imgA.src = entrada.imagen_a;
  imgB.src = entrada.imagen_b;
  imgA.alt = '';
  imgB.alt = '';
  imgA.decoding = 'async';
  imgB.decoding = 'async';
  imgA.className = 'catalogo-thumb-a';
  imgB.className = 'catalogo-thumb-b';
  wrap.appendChild(imgA);
  wrap.appendChild(imgB);
  return wrap;
}

// candidatos      — lista de entradas del catálogo; si trae más de una, aparece
//                   el botón de "siguiente sugerencia" para ciclar entre ellas.
// nombreUsuario   — si viene, el modal entra en modo "vinculando": el título es
//                   fijo y se explica qué ejercicio propio se está vinculando.
//                   Si no, es una vista previa normal (título = nombre del ejercicio).
// etiquetaConfirmar — texto del botón de confirmación.
// onConfirmar(entrada) — la entrada visible al confirmar. La preview se cierra sola.
// onCerrar()      — al salir sin confirmar.
export function abrirPreviewEjercicio({
  candidatos,
  indice = 0,
  nombreUsuario = null,
  etiquetaConfirmar = '[ + AGREGAR ]',
  onConfirmar,
  onCerrar,
}) {
  if (!candidatos || candidatos.length === 0) return null;

  const vinculando = Boolean(nombreUsuario);
  let actual = indice;

  const scrim = cel('div', 'preview-scrim');
  const modal = cel('div', 'preview-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const header = cel('div', 'preview-header');
  const titulo = cel('h3', 'preview-titulo');
  if (vinculando) titulo.textContent = 'VINCULANDO EJERCICIO';
  header.appendChild(titulo);
  const btnCerrar = cel('button', 'preview-volver', '✕');
  btnCerrar.setAttribute('aria-label', 'Cerrar vista previa');
  header.appendChild(btnCerrar);
  modal.appendChild(header);

  const cuerpo = cel('div', 'preview-cuerpo');
  modal.appendChild(cuerpo);

  // Máximo 2 botones en el pie (caben cómodos en 450px): con varias sugerencias
  // el hueco lo ocupa "siguiente"; el ✕ de la cabecera siempre permite salir.
  const pie = cel('div', 'preview-pie');
  const btnSiguiente = cel('button', 'preview-siguiente');
  const btnVolver    = cel('button', 'preview-cancelar', '[ VOLVER ]');
  const btnConfirmar = cel('button', 'preview-agregar', etiquetaConfirmar);
  pie.appendChild(candidatos.length > 1 ? btnSiguiente : btnVolver);
  pie.appendChild(btnConfirmar);
  modal.appendChild(pie);

  scrim.appendChild(modal);
  document.body.appendChild(scrim);

  const cerrar = ({ confirmado = false } = {}) => {
    document.removeEventListener('keydown', onKeydown);
    scrim.remove();
    if (!confirmado) onCerrar?.();
  };

  const onKeydown = (e) => {
    if (e.key === 'Escape') cerrar();
  };
  document.addEventListener('keydown', onKeydown);

  const pintar = async () => {
    const entrada = candidatos[actual];
    cuerpo.textContent = '';

    if (vinculando) {
      modal.setAttribute('aria-label',
        `Vinculando ${nombreUsuario} con ${entrada.nombre_es}, sugerencia ${actual + 1} de ${candidatos.length}`);

      // "Tu ejercicio «X» se puede vincular con:" → nombre de la sugerencia → contador
      const explicacion = cel('p', 'preview-explicacion');
      explicacion.appendChild(document.createTextNode('Tu ejercicio '));
      explicacion.appendChild(cel('strong', 'preview-nombre-usuario', `«${nombreUsuario}»`));
      explicacion.appendChild(document.createTextNode(' se puede vincular con:'));
      cuerpo.appendChild(explicacion);

      cuerpo.appendChild(cel('p', 'preview-sugerencia-nombre', entrada.nombre_es));
      if (candidatos.length > 1) {
        cuerpo.appendChild(cel('p', 'preview-contador',
          `Sugerencia ${actual + 1}/${candidatos.length}`));
      }
    } else {
      modal.setAttribute('aria-label', `Vista previa: ${entrada.nombre_es}`);
      titulo.textContent = entrada.nombre_es;
    }

    cuerpo.appendChild(construirImagen(entrada));

    const meta = cel('div', 'preview-meta');
    meta.appendChild(cel('span', 'preview-tag', entrada.grupo_muscular));
    meta.appendChild(cel('span', 'preview-tag', entrada.equipo_es.toUpperCase()));
    cuerpo.appendChild(meta);

    if (candidatos.length > 1) {
      btnSiguiente.textContent = '[ SIG. SUGERENCIA ]';
      btnSiguiente.setAttribute('aria-label',
        `Ver otra sugerencia. Actual: ${actual + 1} de ${candidatos.length}`);
    }

    const zonaInstr = cel('div', 'preview-instrucciones-zona');
    cuerpo.appendChild(zonaInstr);

    // Asset con carga diferida: se pide aquí, no al abrir el catálogo ni al listar.
    let pasos = [];
    try {
      pasos = await getInstrucciones(entrada.fuente_id);
    } catch { /* instrucciones no disponibles offline */ }

    if (pasos.length > 0) {
      const ol = cel('ol', 'detalle-instrucciones');
      for (const paso of pasos) ol.appendChild(cel('li', null, paso));
      zonaInstr.appendChild(ol);
    } else {
      zonaInstr.appendChild(
        cel('p', 'detalle-vacio', 'Este ejercicio no trae instrucciones.'));
    }
  };

  btnSiguiente.addEventListener('click', () => {
    actual = (actual + 1) % candidatos.length; // cicla
    cuerpo.scrollTop = 0;
    pintar();
  });

  btnConfirmar.addEventListener('click', () => {
    const entrada = candidatos[actual];
    cerrar({ confirmado: true });
    onConfirmar?.(entrada);
  });

  btnCerrar.addEventListener('click', () => cerrar());
  btnVolver.addEventListener('click', () => cerrar());
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) cerrar();
  });

  pintar();
  btnConfirmar.focus();

  return { cerrar };
}
