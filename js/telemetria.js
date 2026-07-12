// Beacon anónimo de uso (fire-and-forget). El device_id llega desde app.js.
const TELEMETRY_URL = 'https://gymlog-analytics.iancardosop.workers.dev';

export const registrarUso = (deviceId, evt = 'open') => {
  if (!navigator.onLine) return;                 // offline-first: sin red, no molesta
  if (location.hostname === 'localhost') return; // no contaminar datos con el dev server
  const payload = JSON.stringify({ id: deviceId, evt, v: '1.0' });
  // type: 'text/plain' (NO 'application/json') — mantiene la petición como
  // "simple request" cross-origin y evita el preflight OPTIONS, que el
  // Worker no maneja (solo responde POST).
  const blob = new Blob([payload], { type: 'text/plain' });
  navigator.sendBeacon(TELEMETRY_URL, blob);
};
