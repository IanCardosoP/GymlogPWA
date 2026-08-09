// Temporizador de descanso entre series (issue #26): burbuja flotante y
// arrastrable — solo se monta en Diario — con un wheel picker vertical de
// minutos (1–5, cíclico) estilo UIPickerView dentro de la propia burbuja, y
// un anillo circular de progreso alrededor del ícono. Componente compartido
// fuera del sistema RENDERS/dispatch de app.js, mismo patrón imperativo que
// previewModal.js/catalogoModal.js: estado en closures del módulo, nunca en
// `store` — el loop de requestAnimationFrame corre a ~60fps y pasar por
// dispatch() forzaría un render() completo de Diario (queries SQL + rebuild
// del DOM) en cada frame.
//
// Gesto (dos toques, sin cronómetro activo):
//   tap 1 (clic simple, sin arrastre real) → abre el wheel.
//   tap 2 (otro clic simple sobre el wheel ya abierto) → confirma el número
//     centrado y arranca el descanso. Si en vez de un tap2 limpio el usuario
//     arrastra, el wheel gira en vivo y CUALQUIER suelte lo confirma.
//   tap sostenido (≥HOLD_ARRASTRAR_MS, sin abrir el wheel) → arrastra la
//     burbuja; se asienta en el borde más cercano al soltar.
// Con un descanso activo, un tap simple lo cancela — abrir el wheel no es
// una opción disponible en ese estado (solo cancelar o arrastrar).
//
// El wheel NO usa scroll nativo: el arrastre de la burbuja hace
// burbuja.setPointerCapture() en cada pointerdown, así que un <div> con
// overflow-y/scroll-snap nunca recibiría su propio scroll táctil bajo este
// gesto — el wheel se posiciona a mano (transform: translateY) en cada
// pointermove, igual que ya hace el arrastre de la burbuja con su propia
// posición.

const SVG_NS = 'http://www.w3.org/2000/svg';

const CLAVE_MINUTOS   = 'gymlog:descanso-minutos';
const MINUTOS_DEFECTO = 2;
const RADIO_ANILLO    = 24;
const CIRCUNFERENCIA_ANILLO = 2 * Math.PI * RADIO_ANILLO;

const ARIA_LABEL_INACTIVO = 'Temporizador de descanso entre series';
const ARIA_LABEL_ACTIVO   = 'Cancelar descanso en curso';

const ALTURA_ITEM_WHEEL = 36; // debe coincidir con .temporizador-wheel-item en CSS
const HOLD_ARRASTRAR_MS = 500; // tap sostenido (sin abrir el wheel): arrastra la burbuja

// Rango de duración REAL (para clampMinutos/iniciarDescanso/localStorage):
// solo 1-5, nunca 0 — un descanso de "0 minutos" no existe como tal.
const MINUTOS_MIN    = 1;
const MINUTOS_MAX    = 5;

// Rango del WHEEL (lo que se puede ver/elegir al girar): 0-5, un valor más
// que el rango real. El "0m" es un sentinel de "cancelar la selección", no
// una duración — finalizarGesto() lo intercepta y no llama iniciarDescanso().
// El wheel es cíclico (se repite sin fin en ambas direcciones, ver
// crearWheelViewport/minutoDesdeTranslate) — se renderizan varias vueltas
// completas como buffer de arrastre; ninguna es "la" vuelta canónica.
const WHEEL_MIN      = 0;
const WHEEL_MAX      = MINUTOS_MAX;
const RANGO_WHEEL    = WHEEL_MAX - WHEEL_MIN + 1; // 6
const VUELTAS_WHEEL  = 5; // impar: deja una vuelta central clara
const VUELTA_MEDIA   = Math.floor(VUELTAS_WHEEL / 2); // 2
const TOTAL_ITEMS_WHEEL = RANGO_WHEEL * VUELTAS_WHEEL; // 30

// Única fuente de verdad para "qué translateY centra el ítem de índice i":
// el viewport mide 108px (3 filas de 36px, ver .temporizador-wheel-viewport
// en CSS), centro del viewport en 54px. Un ítem de índice i (0-based, sin
// transform) ocupa track-y [i·36, (i+1)·36), centro = i·36+18. Para que ese
// centro caiga en 54: T = 54 − (i·36+18) = 36 − i·36 = −(i−1)·36. Definida
// una sola vez acá — translateDesdeMinuto/TRANSLATE_MIN/TRANSLATE_MAX la
// reusan en vez de repetir la fórmula (repetirla fue justamente cómo se
// coló el bug del picker desfasado un ítem: dos copias de la cuenta que
// dejaron de coincidir con la geometría real del CSS).
function translateDesdeIndice(indice) {
  return -(indice - 1) * ALTURA_ITEM_WHEEL;
}

const TRANSLATE_MAX = translateDesdeIndice(0);                      // primer ítem renderizado, centrado
const TRANSLATE_MIN = translateDesdeIndice(TOTAL_ITEMS_WHEEL - 1);  // último ítem renderizado, centrado

function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function celSvg(tag, atributos) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(atributos)) e.setAttribute(k, v);
  return e;
}

// ── Helpers puros (testeables sin DOM) ─────────────────────────────────────

export function clampMinutos(n) {
  const entero = Math.round(Number(n));
  if (!Number.isFinite(entero)) return MINUTOS_DEFECTO;
  return Math.min(MINUTOS_MAX, Math.max(MINUTOS_MIN, entero));
}

export function calcularProgreso(finEn, ahora, duracionTotalMs) {
  if (duracionTotalMs <= 0) return 0;
  return Math.min(1, Math.max(0, (finEn - ahora) / duracionTotalMs));
}

// Formatea el tiempo restante para la burbuja mientras el descanso corre.
// Con un minuto o más: "M:SS" (minutos sin ceros a la izquierda — el rango
// elegible es 1-5, nunca hace falta más de un dígito — segundos siempre a 2
// dígitos, es la notación estándar de reloj). Por debajo de un minuto: "Ns"
// sin ceros a la izquierda en ningún lado (9s, no 09s) — se deja caer el
// "0:" de minutos en vez de arrastrarlo como dígito irrelevante.
export function formatearRestante(msRestantes) {
  const segundosTotales = Math.max(0, Math.ceil(msRestantes / 1000));
  const minutos = Math.floor(segundosTotales / 60);
  const segundos = segundosTotales % 60;
  if (minutos >= 1) return `${minutos}:${String(segundos).padStart(2, '0')}`;
  return `${segundos}s`;
}

// Centra el minuto `m` (1-5, siempre una duración real — el wheel nunca abre
// centrado en "0") en la vuelta MEDIA del wheel — orden ASCENDENTE dentro de
// cada vuelta (0 arriba…5 abajo, la vuelta siguiente vuelve a empezar en 0):
// un tramo contiguo del wheel lee, p.ej., 2,3,4,5,0,1,2… Usa
// translateDesdeIndice (la misma fórmula que TRANSLATE_MIN/MAX) — no repite
// la cuenta a mano.
function translateDesdeMinuto(minutos) {
  const m = clampMinutos(minutos);
  const indice = VUELTA_MEDIA * RANGO_WHEEL + (m - WHEEL_MIN);
  return translateDesdeIndice(indice);
}

// Pura y testeable — translateY ya es un número que tenemos en JS, no algo
// que haya que releer del layout. Inversa exacta de translateDesdeIndice
// (T = −(indice−1)·alturaItem  ⇒  indice = 1 − T/alturaItem). Cíclica por
// diseño: cualquier translateY (incluso fuera del rango realmente
// renderizado) resuelve a un valor válido vía módulo, así que el wheel "se
// repite" sin bordes especiales. Devuelve 0-5 (RANGO_WHEEL, no RANGO de
// duración real) — NO pasa por clampMinutos: el "0" (cancelar) tiene que
// poder salir de acá tal cual, clampMinutos lo subiría a 1 y lo taparía.
// Un empate exacto a mitad de dos ítems redondea hacia el valor siguiente
// (Math.round redondea los .5 hacia +Infinity) — no es un bug.
export function minutoDesdeTranslate(translateY, alturaItem) {
  const indice = Math.round(1 - translateY / alturaItem);
  const posEnVuelta = ((indice % RANGO_WHEEL) + RANGO_WHEEL) % RANGO_WHEEL;
  return WHEEL_MIN + posEnVuelta;
}

export function leerUltimaDuracion() {
  try {
    const raw = localStorage.getItem(CLAVE_MINUTOS);
    if (raw === null) return MINUTOS_DEFECTO;
    return clampMinutos(JSON.parse(raw));
  } catch {
    return MINUTOS_DEFECTO; // modo privado, cuota agotada o valor corrupto
  }
}

export function guardarUltimaDuracion(minutos) {
  try {
    localStorage.setItem(CLAVE_MINUTOS, JSON.stringify(clampMinutos(minutos)));
  } catch { /* modo privado o cuota agotada */ }
}

// ── Persistencia del descanso activo (sobrevive recargas/cierres) ──────────

const CLAVE_ESTADO = 'gymlog:descanso-estado';

function guardarEstadoActivo(finEnGuardar, duracionTotalMsGuardar) {
  try {
    localStorage.setItem(CLAVE_ESTADO, JSON.stringify({ finEn: finEnGuardar, duracionTotalMs: duracionTotalMsGuardar }));
  } catch { /* modo privado o cuota agotada */ }
}

function borrarEstadoActivo() {
  try { localStorage.removeItem(CLAVE_ESTADO); } catch { /* modo privado */ }
}

// Pura y testeable: valida estructura (números finitos, duración positiva).
// No decide si sigue vigente — eso depende del momento de la lectura
// (Date.now() en el momento en que se llama), así que lo resuelve quien la
// use, no esta función.
export function leerEstadoActivo() {
  try {
    const raw = localStorage.getItem(CLAVE_ESTADO);
    if (raw === null) return null;
    const { finEn: finEnLeido, duracionTotalMs: duracionLeida } = JSON.parse(raw);
    if (!Number.isFinite(finEnLeido) || !Number.isFinite(duracionLeida) || duracionLeida <= 0) return null;
    return { finEn: finEnLeido, duracionTotalMs: duracionLeida };
  } catch {
    return null; // corrupto o no disponible
  }
}

// ── Anuncio de fin de descanso ──────────────────────────────────────────────

let audioCtx = null;

// Debe llamarse dentro del mismo gesto de usuario que arranca el descanso: las
// políticas de autoplay exigen crear/desbloquear el AudioContext en un gesto
// real, aunque el beep en sí suene minutos después.
function asegurarAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx ??= new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* Web Audio no disponible */ }
}

function reproducirBeep() {
  if (!audioCtx) return;
  try {
    const osc  = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.4);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch { /* Web Audio no disponible */ }
}

// Debe llamarse dentro del mismo gesto de usuario que arranca el descanso.
function pedirPermisoNotificacion() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

// new Notification() directo falla en algunas PWA instaladas de Android Chrome
// ("Illegal constructor" — exige ServiceWorkerRegistration.showNotification());
// se intenta el camino directo primero y se cae al del Service Worker.
async function mostrarNotificacion() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const opciones = {
    body: 'Tu descanso terminó — a la siguiente serie.',
    tag: 'gymlog-descanso',
    renotify: true,
  };
  try {
    new Notification('GymLog', opciones);
  } catch {
    try {
      const reg = await navigator.serviceWorker?.ready;
      await reg?.showNotification('GymLog', opciones);
    } catch { /* sin Service Worker activo */ }
  }
}

function anunciarFin() {
  navigator.vibrate?.([200, 100, 200, 100, 400]);
  reproducirBeep();
  mostrarNotificacion();
}

// ── Estado del módulo (DOM singletons + timer) ──────────────────────────────

let burbujaEl        = null;
let wheelTrackEl      = null;
let anilloProgresoEl = null;
let cuentaEl          = null;

let rafId           = null;
let timeoutFinId     = null;
let terminadoTimerId = null;
let finEn           = 0;
let duracionTotalMs = 0;

// ── Estado "terminado" (latido, sin ícono propio — vuelve a mostrar ⏱) ─────

const DURACION_TERMINADO_MS = 2000;

function ocultarTerminado() {
  if (terminadoTimerId !== null) { clearTimeout(terminadoTimerId); terminadoTimerId = null; }
  burbujaEl?.classList.remove('is-terminado');
}

function mostrarTerminado() {
  if (!burbujaEl) return;
  ocultarTerminado(); // por si ya había uno corriendo
  burbujaEl.classList.add('is-terminado');
  terminadoTimerId = setTimeout(ocultarTerminado, DURACION_TERMINADO_MS);
}

// ── Timer (reloj de pared) ───────────────────────────────────────────────────
//
// La detección de "se acabó" NUNCA depende de requestAnimationFrame: los
// navegadores lo PAUSAN por completo (no solo lo throttlean) en cuanto
// document.hidden es true — pantalla bloqueada, cambio de app, pestaña en
// segundo plano — que es exactamente cuándo más importa que el descanso siga
// contando. timeoutFinId es la única fuente de verdad de "cuándo termina";
// setTimeout sí sigue disparando en segundo plano (throttleado, pero nunca
// pausado del todo). tick()/rAF quedan solo para animar el anillo mientras
// la pantalla SÍ está visible — no tiene sentido animar lo que no se ve, y
// ya no llaman a finalizarDescanso() por su cuenta.
function tick() {
  const ahora = Date.now();
  const progreso = calcularProgreso(finEn, ahora, duracionTotalMs); // 1 → 0, restante
  anilloProgresoEl.style.setProperty('--descanso-anillo-offset', String(CIRCUNFERENCIA_ANILLO * progreso));
  const texto = formatearRestante(finEn - ahora);
  if (cuentaEl.textContent !== texto) cuentaEl.textContent = texto; // evita escribir el DOM si no cambió
  if (progreso > 0) rafId = requestAnimationFrame(tick);
}

export function iniciarDescanso(minutos) {
  cancelarDescanso(); // evita timers superpuestos si se reinicia a mitad
  ocultarTerminado();

  const min = clampMinutos(minutos);
  guardarUltimaDuracion(min);
  asegurarAudioContext();
  pedirPermisoNotificacion();

  duracionTotalMs = min * 60_000;
  finEn = Date.now() + duracionTotalMs;
  guardarEstadoActivo(finEn, duracionTotalMs);

  burbujaEl.classList.add('is-activo');
  burbujaEl.setAttribute('aria-label', ARIA_LABEL_ACTIVO);
  anilloProgresoEl.style.setProperty('--descanso-anillo-offset', String(CIRCUNFERENCIA_ANILLO));
  cuentaEl.textContent = formatearRestante(duracionTotalMs); // pintado inicial, no espera al primer tick()
  rafId = requestAnimationFrame(tick);
  timeoutFinId = setTimeout(finalizarDescanso, duracionTotalMs);
}

export function cancelarDescanso() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  if (timeoutFinId !== null) { clearTimeout(timeoutFinId); timeoutFinId = null; }
  duracionTotalMs = 0;
  finEn = 0;
  borrarEstadoActivo();
  if (burbujaEl) {
    burbujaEl.classList.remove('is-activo');
    burbujaEl.setAttribute('aria-label', ARIA_LABEL_INACTIVO);
  }
  if (anilloProgresoEl) {
    anilloProgresoEl.style.setProperty('--descanso-anillo-offset', String(CIRCUNFERENCIA_ANILLO));
  }
}

function finalizarDescanso() {
  cancelarDescanso();
  anunciarFin();
  mostrarTerminado();
}

// Si al abrir la app hay un descanso persistido: si sigue vigente, retoma el
// conteo exacto donde iba; si ya venció mientras la app estaba cerrada (no
// hay forma de haber avisado en su momento — nada estaba corriendo), destella
// el estado "terminado". No reusa iniciarDescanso() completo a propósito:
// asegurarAudioContext()/pedirPermisoNotificacion() dependen de un gesto de
// usuario real (política de autoplay), y acá no medió ningún tap todavía.
function reanudarSiCorresponde() {
  const estado = leerEstadoActivo();
  if (!estado) return;

  if (estado.finEn <= Date.now()) {
    borrarEstadoActivo();
    mostrarTerminado();
    return;
  }

  duracionTotalMs = estado.duracionTotalMs;
  finEn = estado.finEn;
  burbujaEl.classList.add('is-activo');
  burbujaEl.setAttribute('aria-label', ARIA_LABEL_ACTIVO);
  cuentaEl.textContent = formatearRestante(finEn - Date.now()); // pintado inicial, no espera al primer tick()
  rafId = requestAnimationFrame(tick);
  timeoutFinId = setTimeout(finalizarDescanso, Math.max(0, finEn - Date.now()));
}

// ── Wheel picker (dentro de la burbuja, manejado 100% por puntero) ─────────

// Varias vueltas de 0..5 seguidas (ascendente dentro de cada vuelta) — un
// tramo contiguo del wheel lee, p.ej., 2,3,4,5,0,1,2… El "0m" es la opción
// para cancelar la selección sin arrancar nada (ver finalizarGesto). Sin
// spacers: las vueltas de más arriba/abajo ya hacen de buffer de arrastre.
function crearWheelViewport() {
  const viewport = cel('div', 'temporizador-wheel-viewport');

  const track = cel('div', 'temporizador-wheel-track');
  for (let i = 0; i < TOTAL_ITEMS_WHEEL; i++) {
    const valor = WHEEL_MIN + (i % RANGO_WHEEL);
    track.appendChild(cel('div', 'temporizador-wheel-item', `${valor}m`));
  }
  viewport.appendChild(track);

  wheelTrackEl = track;
  return viewport;
}

// ── Burbuja: anillo + ícono + wheel, y el gesto que decide cuál se muestra ─

// Los "bordes" del arrastre/asentado son los de la COLUMNA visible de la app
// (#app-wrapper, acotada por --max-width y centrada en pantallas anchas), no
// los del viewport completo — si no, en desktop la burbuja se va al margen
// negro sobrante fuera de la app. En móvil #app-wrapper ya ocupa todo el
// ancho, así que esto coincide con el viewport y no cambia nada.
function limitesApp() {
  const appEl = document.getElementById('app-wrapper');
  if (appEl) {
    const rect = appEl.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }
  return { left: 0, right: window.innerWidth }; // fallback defensivo
}

function asentarEnBorde(burbuja) {
  const rect   = burbuja.getBoundingClientRect();
  const margen = 16;
  const { left: limiteIzq, right: limiteDer } = limitesApp();
  const centro = rect.left + rect.width / 2;
  const xDestino = centro < (limiteIzq + limiteDer) / 2
    ? limiteIzq + margen
    : limiteDer - rect.width - margen;

  burbuja.classList.add('is-settling');
  burbuja.style.left = `${xDestino}px`;
  burbuja.addEventListener('transitionend', () => {
    burbuja.classList.remove('is-settling');
  }, { once: true });
}

// Posición inicial (antes de cualquier arrastre): a la derecha de la fecha y
// el nombre de la rutina, alineada verticalmente con ese bloque — se calcula
// una sola vez, al crear la burbuja (montarBurbuja ya la llama solo dentro
// del "if (!burbujaEl)"), así que arrastrarla después no se pisa en el
// siguiente render.
function posicionarBurbujaInicial(burbuja, container) {
  const margen = 16;
  const anchoBurbuja = 52; // coincide con .temporizador-burbuja en CSS
  const { right: limiteDer } = limitesApp();

  const header = container.querySelector('.diario-header');
  let top = margen;
  if (header) {
    const rectHeader = header.getBoundingClientRect();
    top = rectHeader.top + rectHeader.height / 2 - anchoBurbuja / 2;
  }

  burbuja.style.left = `${limiteDer - margen - anchoBurbuja}px`;
  burbuja.style.top  = `${Math.max(margen, top)}px`;
}

function crearBurbuja() {
  const burbuja = cel('button', 'temporizador-burbuja');
  burbuja.type = 'button';
  burbuja.setAttribute('aria-label', ARIA_LABEL_INACTIVO);

  const svg = celSvg('svg', { class: 'temporizador-anillo', viewBox: '0 0 56 56' });
  svg.appendChild(celSvg('circle', {
    class: 'temporizador-anillo-track', cx: '28', cy: '28', r: String(RADIO_ANILLO),
  }));
  const progresoCirculo = celSvg('circle', {
    class: 'temporizador-anillo-progreso', cx: '28', cy: '28', r: String(RADIO_ANILLO),
  });
  svg.appendChild(progresoCirculo);
  burbuja.appendChild(svg);
  anilloProgresoEl = progresoCirculo;

  const icono = cel('span', 'temporizador-icono', '⏱');
  icono.setAttribute('aria-hidden', 'true');
  burbuja.appendChild(icono);

  const cuenta = cel('span', 'temporizador-cuenta');
  cuenta.setAttribute('aria-hidden', 'true');
  burbuja.appendChild(cuenta);
  cuentaEl = cuenta;

  burbuja.appendChild(crearWheelViewport());

  let pointerId            = null;
  let startY               = 0;
  let lastClientX          = 0;
  let lastClientY          = 0;
  let timerArrastrar       = null;
  let arrastrando          = false;
  let eligiendo            = false;
  let suprimirTap          = false;
  let offsetX              = 0;
  let offsetY              = 0;
  let translateAlPointerdown = 0;
  let translateYActual     = 0;
  let limitesAlArrastrar   = { left: 0, right: window.innerWidth };

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  const aplicarTranslate = t => {
    translateYActual = clamp(t, TRANSLATE_MIN, TRANSLATE_MAX);
    wheelTrackEl.style.transform = `translateY(${translateYActual}px)`;
  };

  const cerrarWheel = () => {
    eligiendo = false;
    burbuja.classList.remove('is-eligiendo');
  };

  // Tap 1: la burbuja estaba inactiva y con el wheel cerrado — lo abre,
  // centrado en la última duración recordada, sin arrancar nada todavía.
  const abrirWheel = () => {
    ocultarTerminado(); // un tap durante el destello de "terminado" lo corta
    eligiendo = true;
    burbuja.classList.add('is-eligiendo');
    aplicarTranslate(translateDesdeMinuto(leerUltimaDuracion()));
  };

  // Dispara a los HOLD_ARRASTRAR_MS si el puntero sigue abajo — solo se arma
  // cuando el wheel está cerrado (ver pointerdown): con el wheel abierto,
  // sostener no tiene un modo de arrastre propio, cualquier suelte confirma.
  const entrarArrastre = () => {
    timerArrastrar = null;
    arrastrando = true;
    suprimirTap = true;
    limitesAlArrastrar = limitesApp(); // una sola lectura de layout por arrastre, no por frame
    const rect = burbuja.getBoundingClientRect();
    offsetX = lastClientX - rect.left;
    offsetY = lastClientY - rect.top;
    burbuja.classList.add('is-dragging');
    burbuja.style.right  = '';
    burbuja.style.bottom = '';
    burbuja.style.left   = `${rect.left}px`;
    burbuja.style.top    = `${rect.top}px`;
  };

  burbuja.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return;
    pointerId   = e.pointerId;
    startY      = e.clientY;
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    suprimirTap = false;
    translateAlPointerdown = translateYActual;
    try { burbuja.setPointerCapture(pointerId); } catch { /* puntero ya inactivo */ }
    if (!eligiendo) timerArrastrar = setTimeout(entrarArrastre, HOLD_ARRASTRAR_MS);
  });

  burbuja.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    lastClientX = e.clientX;
    lastClientY = e.clientY;

    if (arrastrando) {
      const x = clamp(e.clientX - offsetX, limitesAlArrastrar.left, limitesAlArrastrar.right - burbuja.offsetWidth);
      const y = clamp(e.clientY - offsetY, 0, window.innerHeight - burbuja.offsetHeight);
      burbuja.style.left = `${x}px`;
      burbuja.style.top  = `${y}px`;
      return;
    }

    if (eligiendo) {
      aplicarTranslate(translateAlPointerdown + (e.clientY - startY));
      return;
    }

    // Ni arrastrando ni eligiendo todavía: solo se registra la posición, sin
    // abortar nada por distancia — el gesto se decide por tiempo, no por
    // cuánto se movió el dedo mientras tanto.
  });

  const finalizarGesto = e => {
    if (e.pointerId !== pointerId) return;
    try { burbuja.releasePointerCapture(pointerId); } catch { /* ya liberado */ }
    pointerId = null;
    if (timerArrastrar !== null) { clearTimeout(timerArrastrar); timerArrastrar = null; }

    if (arrastrando) {
      arrastrando = false;
      burbuja.classList.remove('is-dragging');
      asentarEnBorde(burbuja);
      return;
    }

    if (eligiendo) {
      // Tap 2 (sin mover) o soltar tras girar: cualquiera de los dos
      // confirma el valor que haya quedado centrado.
      const valor = minutoDesdeTranslate(translateYActual, ALTURA_ITEM_WHEEL);
      cerrarWheel();
      suprimirTap = true;
      // "0m" cancela la selección: cierra el wheel sin arrancar nada — se
      // puede volver a abrir con otro tap.
      if (valor > 0) iniciarDescanso(valor);
      return;
    }

    // Ni arrastre ni wheel: tap limpio, lo resuelve el 'click' nativo del
    // <button> que el navegador dispara solo.
  };
  burbuja.addEventListener('pointerup', finalizarGesto);
  burbuja.addEventListener('pointercancel', finalizarGesto);

  burbuja.addEventListener('click', () => {
    if (suprimirTap) { suprimirTap = false; return; } // click sintético post-arrastre/wheel: no cuenta
    if (duracionTotalMs > 0) { cancelarDescanso(); return; } // activo: solo cancelar o arrastrar, nunca abrir
    abrirWheel(); // tap 1: inactivo y wheel cerrado → lo abre
  });

  return burbuja;
}

// Se llama desde diario.js render() — idempotente: la burbuja se crea y se
// atan los listeners una única vez (nunca dentro de esta función), y luego
// solo se re-adjunta al container en cada render. Como el nodo ya existente
// sobrevive a container.textContent = '' (eso solo lo desengancha del árbol,
// no destruye el objeto JS ni sus listeners), reinsertarlo aquí conserva
// posición/estado entre renders sin duplicar nada.
export function montarBurbuja(container) {
  if (!burbujaEl) {
    burbujaEl = crearBurbuja();
    posicionarBurbujaInicial(burbujaEl, container);
    reanudarSiCorresponde();
  }
  container.appendChild(burbujaEl);
}
