// Beacon anónimo de uso (fire-and-forget). El device_id llega desde app.js.
const TELEMETRY_URL = 'https://gymlog-analytics.iancardosop.workers.dev';

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
    v: '1.0',
    pwa: esPWAInstalada(),
    os: detectOS(navigator.userAgent),
  });
  // type: 'text/plain' (NO 'application/json') — mantiene la petición como
  // "simple request" cross-origin y evita el preflight OPTIONS, que el
  // Worker no maneja (solo responde POST).
  const blob = new Blob([payload], { type: 'text/plain' });
  navigator.sendBeacon(TELEMETRY_URL, blob);
};
