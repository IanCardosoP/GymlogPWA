// Beacon anónimo de uso (fire-and-forget). El device_id llega desde app.js.
const TELEMETRY_URL = 'https://gymlog-d1-h3d9b5g1l5.iancardosop.workers.dev';

// Versión real de la app, inyectada por el build (`define` en vite.config.js) con
// el mismo sello que el CACHE_NAME del SW: `<semver>+<sha corto>`.
// Antes esto era el literal '1.0', así que la columna `v` de D1 no servía para
// nada: era imposible saber qué versión estaba abriendo cada dispositivo, que es
// justo el dato que hace falta para saber si un iPhone ya recibió un arreglo.
// El typeof cubre los tests y el dev server, donde `define` no aplica.
const VERSION_APP = typeof __GYMLOG_VERSION__ !== 'undefined' ? __GYMLOG_VERSION__ : 'dev';

// Función pura — solo familia de OS, nunca el user-agent completo (evita huella digital).
export const detectOS = (userAgent = '') => {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  return 'other';
};

const esPWAInstalada = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

export const registrarUso = (deviceId, evt = 'open') => {
  if (!navigator.onLine) return;                 // offline-first: sin red, no molesta
  if (location.hostname === 'localhost') return; // no contaminar datos con el dev server
  const payload = JSON.stringify({
    id: deviceId,
    evt,
    v: VERSION_APP,
    pwa: esPWAInstalada(),
    os: detectOS(navigator.userAgent),
  });
  // type: 'text/plain' (NO 'application/json') — mantiene la petición como
  // "simple request" cross-origin y evita el preflight OPTIONS, que el
  // Worker no maneja (solo responde POST).
  const blob = new Blob([payload], { type: 'text/plain' });
  navigator.sendBeacon(TELEMETRY_URL, blob);
};

// Códigos permitidos para un fallo de arranque. Conjunto cerrado a propósito:
// mismo criterio que el whitelist del worker — nunca se manda a la red un string
// que venga de un mensaje de error arbitrario.
const MOTIVOS_FALLO = ['sin-red', 'motor', 'chunk', 'db', 'timeout'];

// El arranque puede fallar ANTES de que exista la base, así que acá no hay
// device_id que mandar (el worker acepta id vacío). Sin este evento, un iPhone
// que no arranca es indistinguible de un iPhone que nadie abrió.
export const registrarFalloArranque = motivo => {
  if (!navigator.onLine) return;                 // sin red no hay a dónde mandarlo
  if (location.hostname === 'localhost') return; // no contaminar datos con el dev server

  const codigo = MOTIVOS_FALLO.includes(motivo) ? motivo : 'db';
  const payload = JSON.stringify({
    id: '',
    evt: `boot_fail:${codigo}`,
    v: VERSION_APP,
    pwa: esPWAInstalada(),
    os: detectOS(navigator.userAgent),
  });
  const blob = new Blob([payload], { type: 'text/plain' });
  navigator.sendBeacon(TELEMETRY_URL, blob);
};
