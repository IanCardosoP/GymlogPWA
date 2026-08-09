// Nombres legibles para los device_id que importan seguir de cerca.
//
// Vive SOLO en el monitor (herramienta local del PM, nunca se despliega) y no en
// D1: la telemetría es anónima por diseño y no tiene por qué guardar quién es
// quién. Esta es la libreta de direcciones del PM, no un dato del producto.
//
// Para añadir a alguien: en el dashboard, hacé clic sobre su celda de usuario o
// de ID (la tabla los muestra abreviados) — el clic copia el UUID completo al
// portapapeles. Pegalo acá y refrescá.
export const ETIQUETAS = {
  'ef99724b-cc34-44b5-9863-d9f6cd824d6f': 'Diego',
  '919452d9-bba7-41b4-b45c-7ae4481fc564': 'Alex',
  '9a7681d4-cf76-4b6a-b35e-e353ec847b57': 'Ian',
  '62bd546e-2edf-47b8-aabd-531d5d61f962': 'Frankie',
};

// Devuelve la etiqueta o null. Acepta el id completo o un prefijo (la tabla del
// dashboard muestra ids recortados).
export function etiquetaDe(deviceId) {
  if (!deviceId) return null;
  if (ETIQUETAS[deviceId]) return ETIQUETAS[deviceId];
  const clave = Object.keys(ETIQUETAS).find(id => id.startsWith(deviceId));
  return clave ? ETIQUETAS[clave] : null;
}
