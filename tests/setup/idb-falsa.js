// IndexedDB mínima en memoria, para poder probar la capa de PERSISTENCIA del
// motor sin navegador ni dependencias nuevas.
//
// Por qué existe: vitest corre en entorno `node` y todos los demás tests usan
// `memory://`, donde guardar()/guardarAhora() son no-op. Ese hueco es justo
// donde vivía el bug de "restaurar backup no restaura nada": el COMMIT tocaba
// solo la base en memoria y nadie escribía el snapshot.
//
// Cubre exactamente la superficie que usa js/motor.js y nada más: open() con
// onupgradeneeded/onsuccess, objectStoreNames.contains(), createObjectStore(),
// transaction() con oncomplete/onerror, y get()/put() del almacén. No pretende
// ser una IndexedDB: pretende ser suficiente para que el motor no note la
// diferencia.

// Los callbacks de IndexedDB son siempre asíncronos; resolverlos en el mismo
// tick escondería errores de orden que en el navegador sí aparecen.
const luego = fn => setTimeout(fn, 0);

// El structured clone real copia los bytes. Devolver la misma referencia dejaría
// que el motor mutara "el disco" desde memoria, que es lo contrario de lo que se
// quiere verificar.
const clonar = valor =>
  valor instanceof Uint8Array ? new Uint8Array(valor) : valor;

class AlmacenFalso {
  constructor(datos) { this.datos = datos; }

  get(clave) {
    const peticion = {};
    luego(() => {
      peticion.result = clonar(this.datos.get(clave));
      peticion.onsuccess?.();
    });
    return peticion;
  }

  put(valor, clave) {
    const peticion = {};
    this.datos.set(clave, clonar(valor));
    luego(() => peticion.onsuccess?.());
    return peticion;
  }
}

class TransaccionFalsa {
  constructor(base) {
    this.base = base;
    // oncomplete se asigna DESPUÉS de encolar las operaciones, igual que en el
    // código real: el timeout garantiza que ya esté puesto cuando se dispare.
    luego(() => this.oncomplete?.());
  }

  objectStore(nombre) {
    const almacen = this.base.almacenes.get(nombre);
    if (!almacen) throw new Error(`almacén inexistente: ${nombre}`);
    return new AlmacenFalso(almacen);
  }
}

class BaseFalsa {
  constructor(nombre) {
    this.name = nombre;
    this.almacenes = new Map();
    this.objectStoreNames = { contains: n => this.almacenes.has(n) };
    // Cuenta las conexiones vivas. Es lo que decide si un deleteDatabase se
    // bloquea, que es el corazón del bug del «BORRAR TODO»: el motor dejaba su
    // conexión abierta y el borrado no ocurría nunca.
    this.conexionesAbiertas = 0;
  }

  createObjectStore(nombre) {
    this.almacenes.set(nombre, new Map());
    return new AlmacenFalso(this.almacenes.get(nombre));
  }

  transaction(_nombre, _modo) { return new TransaccionFalsa(this); }

  close() {
    if (this.conexionesAbiertas > 0) this.conexionesAbiertas -= 1;
  }
}

/**
 * @param {{conDatabases?: boolean}} opciones - `conDatabases: false` simula un
 *   navegador sin indexedDB.databases() (Safari < 14), donde el borrado tiene
 *   que caer a la lista de nombres conocidos.
 */
export function crearIndexedDBFalsa({ conDatabases = true } = {}) {
  const bases = new Map();

  const falsa = {
    open(nombre, _version) {
      const peticion = {};
      const nueva = !bases.has(nombre);
      if (nueva) bases.set(nombre, new BaseFalsa(nombre));
      const base = bases.get(nombre);
      base.conexionesAbiertas += 1;
      peticion.result = base;

      luego(() => {
        if (nueva) peticion.onupgradeneeded?.();
        peticion.onsuccess?.();
      });
      return peticion;
    },

    // Fiel al comportamiento real: con una conexión abierta el borrado NO ocurre
    // y se dispara onblocked. Es exactamente el caso que rompía el «BORRAR TODO».
    deleteDatabase(nombre) {
      const peticion = {};
      const base = bases.get(nombre);

      luego(() => {
        if (base && base.conexionesAbiertas > 0) {
          peticion.onblocked?.();
          return;
        }
        bases.delete(nombre);
        peticion.onsuccess?.();
      });
      return peticion;
    },

    // Utilidad de test: qué bases quedan realmente en el "disco".
    _nombres() { return [...bases.keys()]; },
  };

  if (conDatabases)
    falsa.databases = async () => [...bases.keys()].map(name => ({ name }));

  return falsa;
}
