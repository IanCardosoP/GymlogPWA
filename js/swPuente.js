// Puente de mensajes con el Service Worker. Lógica pura de mensajería: sin DOM,
// sin SQL. El SW es el único que conoce los manifiestos de precache sellados por
// el build, así que cualquier pregunta sobre "¿está la app completa para
// funcionar offline?" tiene que ir a él.

const TIMEOUT_CONSULTA = 8_000;
const TIMEOUT_REPARACION = 180_000; // reponer el motor son ~16 MB

// Un MessageChannel por consulta: da respuesta punto a punto sin tener que
// correlacionar mensajes ni dejar listeners globales colgando.
function preguntarAlSW(mensaje, timeoutMs) {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return Promise.reject(new Error('sin-service-worker'));

  return new Promise((resolver, rechazar) => {
    const canal = new MessageChannel();
    const reloj = setTimeout(() => {
      canal.port1.close();
      rechazar(new Error('timeout'));
    }, timeoutMs);

    canal.port1.onmessage = evento => {
      clearTimeout(reloj);
      canal.port1.close();
      if (evento.data?.error) rechazar(new Error(evento.data.error));
      else resolver(evento.data);
    };

    sw.postMessage(mensaje, [canal.port2]);
  });
}

export const consultarEstadoOffline = () =>
  preguntarAlSW({ tipo: 'estado-offline' }, TIMEOUT_CONSULTA);

export const repararPrecache = () =>
  preguntarAlSW({ tipo: 'reparar-precache' }, TIMEOUT_REPARACION);

export const hayServiceWorker = () => Boolean(navigator.serviceWorker?.controller);

// Uso de almacenamiento del origen. En iOS es el número que importa: WebKit
// desaloja las cachés del origen completo bajo presión de cuota, y este proyecto
// mantiene ~26 MB entre el motor de la base y el catálogo.
export async function medirAlmacenamiento() {
  if (!navigator.storage?.estimate) return null;
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usados: usage ?? null, cuota: quota ?? null };
  } catch {
    return null;
  }
}
