# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Para el contexto completo del proyecto (historias de usuario, mockups, DDL, arquitectura), lee `Agent.md`.
> Para el estado del tablero Kanban y tickets activos, lee `Sprints.md`.

---

## GIT — REGLA DE RAMAS POR SPRINT

Al iniciar cada sprint, **antes de escribir cualquier código**, el agente debe:

1. Hacer commit del estado actual en la rama vigente.
2. Crear y cambiar a una rama nueva: `git checkout -b sprint-N` (donde N = número del sprint).
3. Al terminar el sprint, los cambios quedan en esa rama como checkpoint de seguridad.

Esta regla es **automática** — el agente no espera que el PM la recuerde.

---

## COMANDOS ESENCIALES

```bash
pnpm install          # instalar dependencias
pnpm test             # correr todos los tests (debe terminar en verde antes de marcar DONE)
pnpm run dev          # servidor local de desarrollo
```

**Añadir un ejercicio al catálogo:**
```bash
pnpm run catalogo:add     # CLI interactiva: nombres, grupo, equipo, instrucciones, 2 imágenes
```
Procesa las imágenes (192px de ancho → WebP) y actualiza `catalogo.json` +
`instrucciones.json`. Deja los cambios en el working tree: revisa, corre `pnpm test`
y commitea. El caché se invalida solo en el deploy (ver §Versionado).

**Correr un solo archivo de test:**
```bash
pnpm vitest run tests/db.test.js
pnpm vitest run tests/analitico.test.js
pnpm vitest run tests/csv.test.js
```

> `pnpm test` debe pasar en verde al final de **cada ticket** antes de avanzar al siguiente.

---

## ARQUITECTURA

La app sigue un flujo de datos unidireccional (estilo Flux minimalista):

```
Tap del usuario → db.js (SQL puro) → actualizar Store → componente.render(store)
```

**Tres capas estrictas — ninguna puede cruzar límites:**

| Archivo | Responsabilidad única |
|---|---|
| `js/app.js` | Store global (`const store`), `dispatch(action, payload)`, routing SPA por DOM |
| `js/db.js` | Todo el SQL — solo SQL, solo promesas, cero DOM |
| `js/motor.js` | Motor SQLite (WASM) y persistencia del snapshot en IndexedDB — cero SQL de dominio |
| `js/componentes/*.js` | Un módulo por pestaña; expone `.render(store)` idempotente, cero SQL |
| `js/analitico.js` | Lógica pura (Epley 1RM, barras ASCII) — sin imports de DOM ni de db |
| `js/catalogo.js` | Catálogo de ejercicios: carga y búsqueda bilingüe — lógica pura, sin DOM ni db |
| `js/sinonimos.js` | Diccionario de argot de gimnasio (datos puros, editable a mano) |
| `js/csv.js` | Backup JSON completo (export/import) — transacciones obligatorias |
| `sw.js` | Service Worker Cache-First — sin lógica de negocio |

**Catálogo de ejercicios (regla no negociable):** el catálogo (873 ejercicios de
`free-exercise-db`, Unlicense) es **dato de referencia estático** en
`public/assets/catalogo/` — **jamás se inserta en la base del usuario**, que solo
contiene sus datos (rutinas, sesiones, series). El único vínculo permitido es un
puntero opaco `ejercicios.catalogo_id` (TEXT, sin FK). `instrucciones.json` (~670 KB)
se carga **de forma diferida**: solo al abrir un panel de detalles, nunca al arrancar.

**IDs de contenedores clave (inmutables):** `#diario-container`, `#progreso-container`, `#config-container`.

**Modelo de datos (7 tablas SQLite):**
- `ejercicios` — diccionario global de movimientos
- `rutinas` — plantillas semanales
- `rutina_ejercicios` — tabla puente rutina↔ejercicio (`orden` define la posición).
  `activo_hoy` es **legado**: el banco de suplentes se retiró y la columna ya no se
  consulta (ver §Deuda técnica)
- `sesiones` — cada entrenamiento real (fecha capturada en JS, no en SQL)
- `series` — cada set individual; `peso=0` = peso corporal (BW)
- `conf` — singleton de configuración (una sola fila, `id=1`, jamás DELETE)

---

## VERSIONADO Y CACHÉ DEL SERVICE WORKER

**Nunca se escribe un `CACHE_NAME` a mano.** `public/sw.js` lleva el placeholder
`__APP_VERSION__`; el plugin `sello-de-version` de `vite.config.js` lo reemplaza
al construir por `<version de package.json>+<sha corto del commit>`
(ej. `gymlog-v1.0.19+a691bee`). Si el placeholder no está, **el build falla a
propósito** — es el seguro contra volver a fijarlo a mano.

Consecuencia: **cada push a `main` genera un `SHELL_CACHE` nuevo** (el sha cambia),
así que la copia de `index.html` de los clientes se invalida sola en cada deploy. No
hay nada que recordar por ticket.

**Tres cachés, partidas por MUTABILIDAD del contenido — no por tipo de archivo:**

| Caché | Contenido | En `activate()` |
|---|---|---|
| `gymlog-shell-v<sello>` | Nombres fijos que cambian por deploy: `index.html`, `manifest.json`, iconos (~30 KB) | se borra entera |
| `gymlog-assets` | Todo lo que Vite emite con hash de contenido: JS, CSS, `.wasm`, `.woff2` | **se PODA** contra el manifiesto |
| `gymlog-catalogo` | Datos de referencia del catálogo (~9 MB) | nunca se toca |

La poda es la regla no negociable de esta sección: los assets de Vite llevan hash de
contenido, así que son **inmutables** y su caché tiene que sobrevivir los deploys. La
versión anterior los metía en la caché versionada por sha y `activate()` los borraba
en cada push — incluidos los 16 MB del motor de la base. Eso es lo que dejaba a los
iPhone sin poder arrancar sin red. **Nunca versiones `gymlog-assets`.**

El manifiesto de precache se arma con una **denylist**, nunca con una allowlist de
extensiones: el bug original nació de un `.filter(k => k.endsWith('.js') || ...)` que
se olvidó de los `.wasm`. `tests/precache.test.js` y `tests/sw-ciclo-deploy.test.js`
son los guards — el segundo ejecuta el `dist/sw.js` sellado contra una Cache API falsa
y simula dos deploys seguidos.

La versión semántica de `package.json` se sube solo cuando *significa* algo:

```bash
pnpm version patch   # 1.0.19 → 1.0.20  (fix)   · crea commit + tag de git
pnpm version minor   # 1.0.19 → 1.1.0   (feature)
git push --follow-tags
```

---

## 0. GESTOR DE PAQUETES OBLIGATORIO

**Se usa exclusivamente `pnpm`. Está prohibido usar `npm` o `yarn` en cualquier comando.**

| Operación          | Comando correcto         |
|--------------------|--------------------------|
| Instalar deps      | `pnpm install`           |
| Añadir paquete     | `pnpm add <pkg>`         |
| Añadir dev dep     | `pnpm add -D <pkg>`      |
| Ejecutar script    | `pnpm run <script>`      |
| Ejecutar tests     | `pnpm test`              |
| Ejecutar dev       | `pnpm run dev`           |

Razón: `pnpm` usa hard-links y un store global, evita hoisting no-determinista de `npm`
y provee aislamiento estricto de dependencias por diseño.

---

## 1. STACK — FUENTES DE VERDAD (NO NEGOCIABLES)

- **UI:** HTML5 semántico nativo · CSS3 puro con variables nativas · JS ES6+ Vanilla
- **DB:** SQLite compilado a WebAssembly (`@sqlite.org/sqlite-wasm`, 845 KB) · base en
  memoria, persistida como archivo serializado en `IndexedDB` (`gymlog-motor`)
  - **Sin OPFS y sin Web Worker, a propósito.** `opfs-sahpool` exige
    `createSyncAccessHandle()` (solo existe en workers) y OPFS en iOS tiene bugs
    propios; el VFS `opfs` clásico necesita `SharedArrayBuffer`, o sea cabeceras
    COOP/COEP que GitHub Pages no permite fijar. El criterio manda: **menos piezas
    móviles específicas de iOS**.
  - Sustituyó a PGLite, cuyos 16.2 MB de artefactos tenían que estar en caché antes
    de poder pintar nada — y ese volumen era en sí mismo la causa del fallo offline
    en iOS (WebKit desaloja las cachés del origen bajo presión de cuota).
- **Offline:** Service Worker `sw.js` con estrategia **Cache-First** estricta
- **Routing:** Manipulación nativa del DOM. Prohibido usar librerías de enrutamiento.
- **Testing:** Vitest · `initDB('memory://')` en todos los tests (nunca `idb://`) — el
  contrato se mantuvo al cambiar de motor: `memory://` da una base efímera sin tocar
  IndexedDB

---

## 2. ESTRUCTURA DE ARCHIVOS INMUTABLE

```
gymlog-pwa/
├── CLAUDE.md
├── Agent.md
├── Sprints.md
├── index.html
├── public/
│   ├── sw.js
│   └── assets/catalogo/    ← Catálogo estático (NUNCA en la base del user)
│       ├── catalogo.json       · 873 ejercicios (nombre es/en, grupo, equipo)
│       ├── instrucciones.json  · pasos en español (carga diferida)
│       ├── img/*.webp          · 2 por ejercicio → crossfade
│       └── ATTRIBUTION.md      · free-exercise-db (Unlicense)
├── css/
│   └── styles.css
├── js/
│   ├── app.js          ← Orquestador, Estado Global, routing DOM
│   ├── db.js           ← SOLO SQL, SOLO promesas
│   ├── motor.js        ← SQLite WASM + snapshot en IndexedDB
│   ├── analitico.js    ← Lógica pura (1RM, barras)
│   ├── catalogo.js     ← Lógica pura (búsqueda bilingüe en el catálogo)
│   ├── sinonimos.js    ← Argot de gimnasio (datos puros)
│   ├── csv.js
│   └── componentes/
│       ├── diario.js
│       ├── progreso.js
│       ├── config.js
│       ├── catalogoModal.js  ← Picker del catálogo (compartido, no es pestaña)
│       └── previewModal.js   ← Vista previa + confirmación (compartido)
└── tests/
    ├── db.test.js
    ├── analitico.test.js
    ├── catalogo.test.js
    └── csv.test.js
```

---

## 3. REGLAS OWASP — PROHIBICIONES ABSOLUTAS

### A03 · SQL Injection — Prepared Statements SIEMPRE

```js
// ✅ CORRECTO — obligatorio
await pg.query(
  'INSERT INTO ejercicios (nombre, grupo_muscular) VALUES ($1, $2)',
  [nombreInput, grupoInput]
);

// ❌ PROHIBIDO — concatenación directa
await pg.query(`SELECT * FROM ejercicios WHERE nombre = '${input}'`);
```

### A01 · XSS — Manipulación segura del DOM SIEMPRE

```js
// ✅ CORRECTO — obligatorio
const span = document.createElement('span');
span.textContent = ejercicio.nombre;
contenedor.appendChild(span);

// ❌ PROHIBIDO — innerHTML con variables de usuario
elemento.innerHTML = `<span>${ejercicio.nombre}</span>`;
// ❌ PROHIBIDO — eval() en cualquier contexto
```

### A08 · Integridad de datos — Transacciones obligatorias en importación

Toda importación de backup JSON debe ejecutarse dentro de `BEGIN; ... COMMIT;`.
Si cualquier registro falla → `ROLLBACK;` automático. Sin excepciones.

### A05 · Configuración — Tabla `conf` protegida

- La tabla `conf` solo tiene UNA fila (`id = 1`). Nunca hacer `DELETE` sobre ella.
- Las mutaciones sobre `conf` deben estar aisladas en métodos dedicados de `db.js`.

---

## 4. CONVENCIONES DE CÓDIGO

| Contexto                    | Convención              | Ejemplo                        |
|-----------------------------|-------------------------|--------------------------------|
| Variables y funciones JS    | `camelCase`             | `loadedExercises`              |
| Clases y módulos JS         | `PascalCase`            | `DBService`, `DiarioComponent` |
| Constantes globales         | `UPPER_SNAKE_CASE`      | `GRUPOS_MUSCULARES`, `BACKUP_VERSION` |
| Funciones DB asíncronas     | Verbo + sustantivo      | `saveRealSerie()`, `getEjercicios()` |
| Clases CSS                  | BEM con guiones         | `.diario-acordeon`, `.btn-guardar` |

- Prohibido `var`. Usar `const` por defecto, `let` solo cuando haya reasignación.
- Funciones flecha (`const fn = () => {}`) en módulos de UI para preservar `this`.
- Prohibido `inline styles` desde JS. Usar `classList.add('is-active')`.

---

## 5. REGLAS DE RENDERIZADO

- `<details>` y `<summary>` para acordeones de ejercicios (sin JS pesado).
- Inputs numéricos: `inputmode="decimal"` + `pattern="[0-9]*"`.
- La función `.render(state)` de cada componente debe ser **idempotente**: ejecutable N veces sin duplicar nodos ni event listeners.
- Usar delegación de eventos en el contenedor principal, no en nodos dinámicos.
- IDs de contenedores clave: `#diario-container`, `#progreso-container`, `#config-container`.

---

## 6. REGLA DE TIMEZONE

La fecha de sesión **nunca** depende de `DEFAULT CURRENT_DATE` de SQL.
JavaScript captura y formatea la fecha local antes del INSERT:

```js
const fechaLocal = new Date().toLocaleDateString('en-CA'); // → "YYYY-MM-DD"
await db.saveSesion(fechaLocal, rutinaId, ...);
```

---

## 7. CICLO DE CALIDAD OBLIGATORIO (por ticket)

```
[ Codificar ] → [ pnpm test ] → ¿Fallo? → [ Depurar ] → [ pnpm test ]
                                                                ↓ Verde
                                               [ Revisar OWASP + Estilo ]
                                                       ↓
                                               [ Ticket: DONE ]
```

**Ningún ticket se marca como completo si `pnpm test` no termina en verde.**
El agente tiene **prohibido** avanzar al siguiente ticket con tests fallando.

---

## 8. REGLA BW (PESO CORPORAL)

- El valor `0` en la columna `peso` de la tabla `series` = ejercicio de peso corporal (BW).
- La fórmula de Epley retorna `0` si `peso === 0`. Nunca `Infinity`, nunca `NaN`.
- El frontend renderiza `"BW"` cuando `peso === 0`. La base de datos siempre guarda `0` (numérico).

---

## 9. LÍMITES DE DISEÑO

- **El Diario no tiene límite de ejercicios visibles.** El concepto de "8 visibles
  + banco de suplentes" queda **retirado**: la rutina se muestra completa, sin
  separador ni corte. (Pendiente de limpieza en código: la constante
  `MAX_ROUTINE_SLOTS` de `js/componentes/diario.js` y la columna `activo_hoy` de
  `rutina_ejercicios` ya no se usan — ver §Deuda técnica.)
- Contenedor: `max-width: 450px`, `margin: 0 auto` en pantallas > 480px.
- Colores base: fondo `#000000` / `#121212`, fuentes monoespaciadas.
- Gráfica de progreso: 20 caracteres de ancho fijo (`█` + `░`).

---

## 10. DEUDA TÉCNICA (pendiente)

### Retirar PGLite (bloqueado por un release)

El motor es SQLite desde el cambio de `js/motor.js`, pero PGLite **sigue en
`dependencies`** y `js/migracion/desdePglite.js` lo importa de forma dinámica para
migrar a quien venga de una versión anterior. Pendiente, y en este orden:

1. Esperar a que el PM confirme que nadie perdió datos en la migración.
2. `pnpm remove @electric-sql/pglite`, borrar `js/migracion/`, y borrar la IndexedDB
   legada (`gym-log-db`) — **no se toca hasta entonces**, es la red de seguridad.
3. Quitar `esMotorLegado` y el manifiesto `ASSETS_LEGADO` de `vite.config.js` y
   `public/sw.js`.

Ojo con el orden: `ASSETS_LEGADO` existe para que la poda **no** borre los artefactos
de PGLite de quien todavía no ha migrado. Retirarlo antes de tiempo deja a ese usuario
sin poder leer su base vieja hasta tener conexión.

### Retirar el concepto "8 visibles + banco de suplentes"

Decidido por el PM: **el Diario muestra la rutina completa, sin corte ni suplentes.**
El separador visual ya se eliminó; falta la limpieza del código:

- `MAX_ROUTINE_SLOTS = 8` (`js/componentes/diario.js`) — ya no lo usa nadie; solo
  queda su declaración (está exportado, verificar consumidores antes de borrar).
- `rutina_ejercicios.activo_hoy` — **nadie la lee ya** para decidir qué se muestra,
  pero `reordenarEjercicios()` (`js/db.js`) **sigue escribiéndola**. Se portó tal cual
  a SQLite (como INTEGER) en vez de eliminarla: quitarla toca `csv.js`, `diario.js` y
  el formato de backup, y acumular eso en el release que reescribe la base de todos
  los usuarios multiplicaba el riesgo sin necesidad.
  **No basta con un `DROP COLUMN`:** hay que revisar `updateActivoHoy()` y
  `getRutinaEjerciciosSuplentes()` en `js/db.js`, y la serialización de `js/csv.js`
  (los backups antiguos traen la columna → el import debe seguir aceptándolos).
- Migración: la DDL es idempotente y corre en el dispositivo de cada usuario, así que
  el cambio debe ser retrocompatible con bases ya existentes.

_Última actualización: arquitectura offline — precache por mutabilidad, arranque
observable y motor SQLite (845 KB) en lugar de PGLite (16.2 MB) — julio 2026_
