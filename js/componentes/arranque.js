// Estado de arranque VISIBLE. Antes, si initDB() fallaba (típicamente porque el
// wasm del motor no estaba en caché y no había red), initApp() rechazaba sin
// catch: bindNav() y navigateTo() nunca corrían, y el usuario se quedaba con la
// nav pintada y los tres paneles vacíos, sin un solo mensaje. Ese silencio es lo
// que hizo que el bug sobreviviera cinco intentos de arreglo.
//
// Este módulo se importa de forma ESTÁTICA desde app.js, a propósito: si viviera
// en un chunk aparte, el fallo que tiene que reportar podría ser justamente que
// ese chunk no carga.
//
// Sin SQL, sin fetch: solo pinta lo que app.js le dice.

import { hayServiceWorker, repararPrecache } from '../swPuente.js';

const cel = (tag, clase, texto) => {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

// Estado del módulo: lo que haya que pintar cuando se llame a render(). Que viva
// acá permite repintarlo en cualquier pestaña que el usuario abra mientras la app
// no está lista, en vez de dejar el panel vacío.
let estado = null;

export const setCargando = mensaje => { estado = { tipo: 'cargando', mensaje }; };

export const setFallo = detalle => { estado = { tipo: 'fallo', ...detalle }; };

export const limpiar = () => { estado = null; };

export const hayEstado = () => estado !== null;

// Idempotente (CLAUDE.md §5): limpia y reconstruye, así que correrla N veces no
// duplica nodos ni listeners. Los botones se recrean en cada render, de ahí que
// los listeners directos no puedan acumularse.
export function render(contenedorId = 'diario-container') {
  const contenedor = document.getElementById(contenedorId);
  if (!contenedor || !estado) return;

  contenedor.textContent = '';
  contenedor.appendChild(estado.tipo === 'cargando' ? panelCargando() : panelFallo());
}

function panelCargando() {
  const panel = cel('div', 'arranque');
  panel.appendChild(cel('p', 'arranque-mensaje', estado.mensaje));

  // Reutiliza el skeleton del Diario: misma sensación visual que una carga
  // normal, porque en el caso feliz esto es exactamente eso.
  const skeleton = cel('div', 'diario-skeleton');
  for (let i = 0; i < 3; i++) skeleton.appendChild(cel('div', 'diario-skeleton-bloque'));
  panel.appendChild(skeleton);

  return panel;
}

function panelFallo() {
  const panel = cel('div', 'arranque arranque-fallo');

  panel.appendChild(cel('h2', 'arranque-titulo', estado.titulo));
  panel.appendChild(cel('p', 'arranque-mensaje', estado.mensaje));

  if (!navigator.onLine) {
    panel.appendChild(cel('p', 'arranque-pista',
      'Estás sin conexión. Conéctate una vez a internet para completar la ' +
      'descarga; después la app vuelve a abrirse sin datos.'));
  }

  const acciones = cel('div', 'arranque-acciones');

  const btnReintentar = cel('button', 'arranque-btn', '[ ↻ REINTENTAR ]');
  btnReintentar.addEventListener('click', () => location.reload());
  acciones.appendChild(btnReintentar);

  // El remedio de verdad cuando el navegador desalojó parte de la caché: pedirle
  // al SW que reponga lo que falte, sin esperar a un deploy nuevo.
  if (estado.permitirReparar !== false && hayServiceWorker()) {
    const btnReparar = cel('button', 'arranque-btn', '[ ⇩ COMPLETAR DESCARGA ]');
    const feedback = cel('p', 'arranque-pista');

    btnReparar.addEventListener('click', async () => {
      btnReparar.disabled = true;
      feedback.textContent = 'Descargando lo que falta…';
      try {
        await repararPrecache();
        feedback.textContent = 'Listo. Reiniciando…';
        location.reload();
      } catch (error) {
        btnReparar.disabled = false;
        feedback.textContent = `No se pudo completar: ${error.message}`;
      }
    });

    acciones.appendChild(btnReparar);
    panel.appendChild(acciones);
    panel.appendChild(feedback);
  } else {
    panel.appendChild(acciones);
  }

  if (estado.detalle) {
    // Detalle técnico: es lo que convierte "no carga" en un reporte accionable
    // cuando el PM pregunta por WhatsApp qué pasó.
    const detalle = cel('details', 'arranque-detalle');
    detalle.appendChild(cel('summary', undefined, 'Detalle técnico'));
    detalle.appendChild(cel('pre', 'arranque-detalle-texto', estado.detalle));
    panel.appendChild(detalle);
  }

  return panel;
}
