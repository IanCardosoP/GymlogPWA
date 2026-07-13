// Argot de gimnasio → términos del catálogo. Datos puros, editables a mano:
// cuando aparezca una jerga nueva que no encuentre su ejercicio, se añade aquí.
//
// Solo hacen falta grupos que NO se resuelven léxicamente. El catálogo ya se
// busca en español e inglés (nombre_es / nombre_en), así que términos como
// "pulldown" o "leg press" funcionan solos y no necesitan entrada aquí.
//
// Cada grupo es un conjunto de frases equivalentes: si la consulta contiene una,
// se expande a las demás y se puntúa contra todas (gana el mejor puntaje).

export const GRUPOS_SINONIMOS = [
  // Máquina de aperturas de pecho: el catálogo la llama solo "Mariposa"
  ['mariposa', 'peck deck', 'pec deck', 'contractora', 'aperturas de pecho', 'apertura de pecho'],

  ['fondos', 'fondo', 'dips'],

  // Deltoides posterior
  ['pajaros', 'vuelos posteriores', 'deltoides posterior', 'deltoide posterior'],
  ['vuelos laterales', 'elevaciones laterales'],

  // Tríceps
  ['copa', 'frances', 'extension de triceps', 'extension triceps'],
  ['jalon de triceps', 'extension de triceps con polea'],

  // Pierna
  ['camilla', 'extension de cuadriceps', 'extension de piernas'],
  ['femoral', 'isquiotibiales', 'curl femoral'],
  ['gemelos', 'pantorrillas', 'elevacion de talones'],
  ['prensa', 'leg press'],

  // Espalda
  ['jalon', 'polea alta', 'jalon al pecho'],
  ['remo bajo', 'remo sentado'],

  // Equipamiento (sinónimos regionales)
  ['pesa', 'mancuerna'],
  ['cable', 'polea'],
  ['barra z', 'barra ez'],
];

// Devuelve el conjunto de variantes de la consulta (incluida la original).
// La consulta debe venir ya normalizada (minúsculas, sin acentos).
export function expandirConSinonimos(consultaNorm) {
  const variantes = new Set([consultaNorm]);

  for (const grupo of GRUPOS_SINONIMOS) {
    for (const termino of grupo) {
      if (!consultaNorm.includes(termino)) continue;
      for (const equivalente of grupo) {
        if (equivalente !== termino) {
          variantes.add(consultaNorm.replace(termino, equivalente));
        }
      }
    }
  }

  return [...variantes];
}
