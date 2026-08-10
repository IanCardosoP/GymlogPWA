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
  }

  createObjectStore(nombre) {
    this.almacenes.set(nombre, new Map());
    return new AlmacenFalso(this.almacenes.get(nombre));
  }

  transaction(_nombre, _modo) { return new TransaccionFalsa(this); }

  close() {}
}

export function crearIndexedDBFalsa() {
  const bases = new Map();

  return {
    open(nombre, _version) {
      const peticion = {};
      const nueva = !bases.has(nombre);
      if (nueva) bases.set(nombre, new BaseFalsa(nombre));
      peticion.result = bases.get(nombre);

      luego(() => {
        if (nueva) peticion.onupgradeneeded?.();
        peticion.onsuccess?.();
      });
      return peticion;
    },

    // Utilidad de test: borrar el "disco" sin tocar el resto del estado.
    _borrarTodo() { bases.clear(); },
  };
}
