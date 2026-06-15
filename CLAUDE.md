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
| `js/db.js` | Toda interacción con PGLite — solo SQL, solo promesas, cero DOM |
| `js/componentes/*.js` | Un módulo por pestaña; expone `.render(store)` idempotente, cero SQL |
| `js/analitico.js` | Lógica pura (Epley 1RM, barras ASCII) — sin imports de DOM ni de db |
| `js/csv.js` | Backup JSON completo (export/import) — transacciones obligatorias |
| `sw.js` | Service Worker Cache-First — sin lógica de negocio |

**IDs de contenedores clave (inmutables):** `#diario-container`, `#progreso-container`, `#config-container`.

**Modelo de datos (6 tablas PGLite):**
- `ejercicios` — diccionario global de movimientos
- `rutinas` — plantillas semanales
- `rutina_ejercicios` — tabla puente; `activo_hoy=TRUE` = en pantalla, `FALSE` = banco de suplentes
- `sesiones` — cada entrenamiento real (fecha capturada en JS, no en SQL)
- `series` — cada set individual; `peso=0` = peso corporal (BW)
- `conf` — singleton de configuración (una sola fila, `id=1`, jamás DELETE)

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
- **DB:** PGLite (PostgreSQL en WebAssembly) · persistido en `IndexedDB` bajo `idb://gym-log-db`
- **Offline:** Service Worker `sw.js` con estrategia **Cache-First** estricta
- **Routing:** Manipulación nativa del DOM. Prohibido usar librerías de enrutamiento.
- **Testing:** Vitest · instancia PGLite en **`memory://`** para todos los tests (nunca `idb://`)

---

## 2. ESTRUCTURA DE ARCHIVOS INMUTABLE

```
gymlog-pwa/
├── CLAUDE.md
├── Agent.md
├── Sprints.md
├── index.html
├── sw.js
├── css/
│   └── styles.css
├── js/
│   ├── app.js          ← Orquestador, Estado Global, routing DOM
│   ├── db.js           ← Instancia PGLite, SOLO SQL, SOLO promesas
│   └── componentes/
│       ├── diario.js
│       ├── progreso.js
│       └── config.js
└── tests/
    ├── db.test.js
    ├── analitico.test.js
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
| Constantes globales         | `UPPER_SNAKE_CASE`      | `MAX_ROUTINE_SLOTS`            |
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

- `MAX_ROUTINE_SLOTS = 8` — máximo de ejercicios visibles en el Diario.
- Contenedor: `max-width: 450px`, `margin: 0 auto` en pantallas > 480px.
- Colores base: fondo `#000000` / `#121212`, fuentes monoespaciadas.
- Gráfica de progreso: 20 caracteres de ancho fijo (`█` + `░`).

---

_Última actualización sincronizada con `Agent.md` — Sprint 0 (Setup)_
