# Sprints.md — GymLog PWA · Tablero Kanban Global

> **Protocolo de operación con Claude Code CLI:**
> - Cada ticket = una sesión o un checkpoint explícito.
> - Abre cada sesión con: `"Lee CLAUDE.md y Agent.md. El ticket activo es X.X: [título]"`
> - El agente codifica + ejecuta `pnpm test`. Tú revisas los archivos y el output.
> - Solo marca `[DONE]` y avanza al siguiente ticket cuando `pnpm test` termina en verde.
> - Tú eres el PM. El agente es el Dev. No existe el rol `[Agente PM]` en el CLI.

---

## LEYENDA DE ESTADOS

| Símbolo | Estado      |
|---------|-------------|
| `[ ]`   | Pendiente   |
| `[WIP]` | En progreso |
| `[DONE]`| Completado  |
| `[BLOCKED]` | Bloqueado por dependencia |

---

## 📦 SPRINT 1 — El Cascarón e Infraestructura Base

**Objetivo:** Ecosistema PWA operativo, layout de 450px sólido y entorno de tests funcional con `pnpm test` corriendo en verde antes de tocar datos.

---

### Ticket 1.0 — Prueba de Humo: PGLite en Vitest `[DONE]`

**Por qué existe este ticket:** Antes de escribir cualquier código de aplicación, verificar que PGLite puede importarse y ejecutar SQL desde un test Vitest con instancia `memory://`. Si esto falla, los hitos de control de todos los sprints siguientes se rompen.

**Criterios de aceptación:**
- [ ] `pnpm init` ejecutado; `package.json` creado con `"type": "module"`.
- [ ] Vitest instalado: `pnpm add -D vitest`.
- [ ] PGLite instalado: `pnpm add @electric-sql/pglite`.
- [ ] `vitest.config.js` creado con `environment: 'node'` y `transformIgnorePatterns` configurado para ESM de PGLite.
- [ ] Archivo `tests/smoke.test.js` creado que: importa `PGlite` de `@electric-sql/pglite`, instancia `new PGlite('memory://')`, ejecuta `SELECT 1+1 AS result` y assert que `result === 2`.
- [ ] `pnpm test` termina en verde con ese único test.
- [ ] Script `"test": "vitest run"` presente en `package.json`.

**Comando de verificación:** `pnpm test` → 1 test passed.

---

### Ticket 1.1 — Estructura de Carpetas y Archivos Vacíos `[DONE]`

**Dependencia:** Ticket 1.0 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Árbol de directorios creado exactamente según Sección 7.3-D de `Agent.md`:
  ```
  gymlog-pwa/
  ├── index.html
  ├── sw.js
  ├── css/styles.css
  ├── js/app.js
  ├── js/db.js
  ├── js/componentes/diario.js
  ├── js/componentes/progreso.js
  ├── js/componentes/config.js
  └── tests/  (ya existe del ticket 1.0)
  ```
- [ ] Cada archivo contiene únicamente un comentario de cabecera con su responsabilidad (sin lógica aún).
- [ ] `pnpm test` sigue en verde (el smoke test no se rompe).

---

### Ticket 1.2 — `index.html`: App Shell y Navegación SPA `[DONE]`

**Dependencia:** Ticket 1.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `index.html` con estructura HTML5 semántica completa: `<meta charset>`, `<meta viewport>`, `<meta name="theme-color">`, `<link rel="manifest">`.
- [ ] Contenedor raíz `<div id="app-wrapper">` con `max-width: 450px` aplicado desde CSS (no inline).
- [ ] 3 pestañas fijas superiores: `[ DIARIO ]` | `[ PROGRESO ]` | `[ CONFIG ]` con atributos `data-tab`.
- [ ] 3 contenedores de contenido: `#diario-container`, `#progreso-container`, `#config-container`. Dos ocultos, uno visible por defecto.
- [ ] El JS de navegación SPA en `js/app.js`: al hacer click en una pestaña → oculta los 3 contenedores → muestra el correspondiente → actualiza clase `is-active` en la pestaña. Sin librerías de routing.
- [ ] La navegación funciona manualmente en el browser (verificación visual).
- [ ] No se usa `innerHTML` con variables de usuario en ningún punto.

---

### Ticket 1.3 — `css/styles.css`: Estética Terminal Oscura `[DONE]`

**Dependencia:** Ticket 1.2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Variables CSS nativas definidas en `:root`: `--color-fondo`, `--color-fondo-alt`, `--color-acento`, `--color-texto`, `--color-texto-dim`, `--font-mono`.
- [ ] `--color-fondo: #000000`, fondo alternativo `#121212`, fuente monoespaciada.
- [ ] `body` y `#app-wrapper`: fondo oscuro, fuente mono, `max-width: 450px`, `margin: 0 auto`.
- [ ] En mobile (< 480px): `#app-wrapper` ocupa `100vw`, sin bordes.
- [ ] En desktop (≥ 480px): `#app-wrapper` muestra borde sutil o `box-shadow` para simular columna flotante.
- [ ] Pestañas de navegación: estilo sticky/fijo en la parte superior, pestaña `.is-active` diferenciada visualmente con `--color-acento`.
- [ ] Estilos base para inputs numéricos: tamaño generoso, fondo oscuro, borde monocromo.
- [ ] No hay `!important` innecesarios. No hay estilos inline en HTML.

---

### Ticket 1.4 — `sw.js`: Service Worker Cache-First `[DONE]`

**Dependencia:** Ticket 1.2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `sw.js` implementa estrategia **Cache-First** estricta.
- [ ] Array `ASSETS_TO_CACHE` incluye: `'/'`, `'/index.html'`, `'/css/styles.css'`, `'/js/app.js'`, `'/js/db.js'`, y los 3 componentes.
- [ ] Evento `install`: pre-cachea todos los assets del array. `skipWaiting()` llamado.
- [ ] Evento `activate`: limpia caches antiguas por nombre de versión. `clients.claim()` llamado.
- [ ] Evento `fetch`: intenta cache primero; si no encuentra, va a la red y cachea la respuesta clonada.
- [ ] `index.html` registra el SW: `navigator.serviceWorker.register('/sw.js')` dentro de `DOMContentLoaded`.
- [ ] Verificación manual: en DevTools → Application → Service Workers → estado "Activated and running".

---

### Ticket 1.5 — `package.json` y `vitest.config.js` finales + tests del Sprint 1 `[DONE]`

**Dependencia:** Tickets 1.1–1.4 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `package.json` tiene scripts: `"test": "vitest run"`, `"dev": "..."` (servidor local de tu elección, ej. `vite` o `serve`).
- [ ] `vitest.config.js` configurado correctamente para ESM + PGLite.
- [ ] Test de navegación en `tests/navegacion.test.js`: verifica que la función de routing de `app.js` exportada cambia correctamente las clases `is-active` y la visibilidad de contenedores (usando JSDOM o lógica pura).
- [ ] `pnpm test` termina en verde con todos los tests del sprint.

**Comando de verificación:** `pnpm test` → todos los tests passed.

---

## 🗄️ SPRINT 2 — El Motor de Datos Local (Capa de Persistencia)

**Objetivo:** `db.js` inicializado con DDL completo, funciones de servicio puras y tests de integración en memoria pasando. Sin conectar UI todavía.

---

### Ticket 2.1 — `db.js`: Inicialización PGLite + DDL completo `[DONE]`

**Dependencia:** Sprint 1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `db.js` exporta una función `initDB(uri = 'idb://gym-log-db')` que acepta URI como parámetro (permite inyectar `'memory://'` en tests).
- [ ] Ejecuta el DDL completo de la Sección 4 de `Agent.md` usando `CREATE TABLE IF NOT EXISTS` para idempotencia.
- [ ] Incluye tabla `conf` con `INSERT ... ON CONFLICT DO NOTHING` para el seed inicial.
- [ ] Exporta instancia singleton `db` accesible por otros módulos.
- [ ] No hay SQL concatenado con variables. Toda query futura usará `$1, $2...`.

---

### Ticket 2.2 — `db.js`: Funciones de servicio — Módulo `ejercicios` y `rutinas` `[DONE]`

**Dependencia:** Ticket 2.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `getEjercicios()` → `SELECT id, nombre, grupo_muscular FROM ejercicios ORDER BY nombre`.
- [ ] `saveEjercicio(nombre, grupoMuscular)` → INSERT parametrizado. Retorna el registro insertado.
- [ ] `getRutinas()` → `SELECT * FROM rutinas`.
- [ ] `saveRutina(nombre, diaSugerido)` → INSERT parametrizado.
- [ ] `getRutinaEjercicios(rutinaId)` → JOIN de `rutina_ejercicios` con `ejercicios` filtrando por `rutina_id`.
- [ ] `updateActivoHoy(rutinaEjercicioId, activoHoy)` → UPDATE parametrizado del booleano.
- [ ] Todas las funciones usan `async/await` y prefijos verbales (`get`, `save`, `update`).
- [ ] Cero concatenaciones de SQL.

---

### Ticket 2.3 — `db.js`: Funciones de servicio — Módulo `sesiones` y `series` `[DONE]`

**Dependencia:** Ticket 2.2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `saveSesion(fechaLocal, rutinaId, energiaSueno)` → INSERT. `fechaLocal` se recibe como string `'YYYY-MM-DD'` desde JS (regla Timezone de Sección 3.6). Nunca depende de `DEFAULT CURRENT_DATE`.
- [ ] `getSesionDelDia(fechaLocal)` → SELECT de la sesión del día específico.
- [ ] `saveSerie(sesionId, ejercicioId, numeroSerie, peso, repeticiones)` → INSERT parametrizado.
- [ ] `getUltimaSerie(ejercicioId)` → SELECT de la serie más reciente para precarga de inputs.
- [ ] `getSeriesPorEjercicio(ejercicioId)` → SELECT con JOIN a `sesiones` para el módulo de Progreso.
- [ ] Todas las funciones retornan promesas. No hay side effects fuera del scope de la función.

---

### Ticket 2.4 — `db.js`: Funciones de servicio — Módulo `conf` `[DONE]`

**Dependencia:** Ticket 2.2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `getConf()` → `SELECT * FROM conf WHERE id = 1`. Retorna el objeto de configuración.
- [ ] `updatePrefUnit(unit)` → `UPDATE conf SET pref_unit = $1 WHERE id = 1`. Valida que `unit` sea `'kg'` o `'lb'` antes del query (doble capa de protección).
- [ ] No existe ninguna función `deleteConf()` ni método de borrado sobre esta tabla.
- [ ] Estos métodos son los ÚNICOS puntos de acceso a la tabla `conf` en todo el codebase.

---

### Ticket 2.5 — Tests de integración: Módulo DB completo `[DONE]`

**Dependencia:** Tickets 2.1–2.4 en `[DONE]`.

> **Hito de Control del Sprint 2.** El agente no puede avanzar al Sprint 3 sin que este ticket esté en verde.

**Criterios de aceptación:**
- [ ] `tests/db.test.js` usa `initDB('memory://')` en `beforeEach` y hace `DROP TABLE` / re-init para aislamiento.
- [ ] Test: insertar un ejercicio y verificar que `getEjercicios()` lo retorna correctamente.
- [ ] Test: `saveSerie` con `peso = 0` (BW) persiste sin error y se recupera como `0` numérico.
- [ ] Test: restricción de tabla `conf` — intentar insertar segunda fila lanza error de constraint.
- [ ] Test: `updatePrefUnit('invalid')` es rechazado antes de llegar a SQL.
- [ ] Test: verificar que las funciones usan prepared statements (no hay queries sin parámetros cuando hay input de usuario).
- [ ] `pnpm test` → todos los tests passed, incluyendo los del Sprint 1.

---

## ⚙️ SPRINT 3 — Lógica de Negocio Pura (Analítica y CSV)

**Objetivo:** Módulos de lógica pura (sin DOM) con cobertura de tests completa antes de renderizar nada.

---

### Ticket 3.1 — `js/analitico.js`: Fórmula de Epley y motor de métricas `[ ]`

**Dependencia:** Sprint 2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Archivo `js/analitico.js` creado (módulo puro, sin imports de DOM ni de db).
- [ ] `const METRICAS_REGISTRY` exportado con al menos la clave `'1rm_epley'`.
- [ ] `calculateEpley1RM(peso, reps)` implementado: retorna `peso * (1 + reps / 30)`.
- [ ] Regla BW aplicada: si `peso === 0`, retorna `0` inmediatamente (sin calcular).
- [ ] `calcularBarraProgreso(valor1RM, maxAbsoluto1RM, anchoTotal = 20)` → retorna string de 20 chars con `█` y `░`.
- [ ] `prepararDatosProgreso(seriesArray)` → recibe array de series de DB, agrupa por sesión, calcula 1RM por sesión, identifica el máximo absoluto, retorna array listo para renderizar con valores normalizados.

---

### Ticket 3.2 — `js/csv.js`: Exportación e Importación con contrato estricto `[ ]`

**Dependencia:** Ticket 3.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Constante `CSV_HEADERS` exportada: `'fecha,rutina_nombre,ejercicio_nombre,grupo_muscular,numero_serie,peso,repeticiones,peso_corporal,energia_sueno'`.
- [ ] `exportarCSV(datos)` → recibe array de objetos de DB, serializa a string CSV con `CSV_HEADERS` como primera línea, genera `Blob` y dispara descarga en el browser.
- [ ] `importarCSV(archivoTexto, dbInstance)` → parsea el string, valida que la primera línea sea exactamente `CSV_HEADERS` (error explícito si no coincide), valida tipos de cada columna (`peso` y `repeticiones` son numéricos ≥ 0), ejecuta inserciones dentro de `BEGIN; ... COMMIT;`, hace `ROLLBACK` si cualquier fila falla.
- [ ] La función de importación retorna `{ exitosas: N, fallidas: M, error: null | string }`.

---

### Ticket 3.3 — Tests: Analítica y CSV `[ ]`

**Dependencia:** Tickets 3.1 y 3.2 en `[DONE]`.

> **Hito de Control del Sprint 3.** El agente no puede avanzar al Sprint 4 sin este ticket en verde.

**Criterios de aceptación:**
- [ ] `tests/analitico.test.js`:
  - [ ] `calculateEpley1RM(100, 10)` → `≈ 133.33` (tolerancia float).
  - [ ] `calculateEpley1RM(0, 10)` → exactamente `0` (regla BW, no `Infinity`, no `NaN`).
  - [ ] `calculateEpley1RM(80, 0)` → exactamente `80` (0 reps = 1RM = el propio peso).
  - [ ] `calcularBarraProgreso(76, 80)` → string de exactamente 20 chars con proporción correcta.
  - [ ] `calcularBarraProgreso(80, 80)` → `'████████████████████'` (100% lleno).
- [ ] `tests/csv.test.js`:
  - [ ] Exportar array de datos → primera línea del CSV es exactamente `CSV_HEADERS`.
  - [ ] Importar CSV con headers incorrectos → error explícito, cero inserciones en DB.
  - [ ] Importar CSV con fila corrupta (peso = `'abc'`) → `ROLLBACK` ejecutado, DB intacta.
  - [ ] Importar CSV válido → `{ exitosas: N, fallidas: 0, error: null }`.
- [ ] `pnpm test` → todos los tests passed, incluyendo Sprints 1 y 2.

---

## 📱 SPRINT 4 — Hidratación de la UI y Eventos Táctiles

**Objetivo:** Conectar el Estado Global, los servicios de DB y el HTML dinámico. La app es usable de principio a fin.

---

### Ticket 4.1 — `js/app.js`: Estado Global (Store) y orquestador `[ ]`

**Dependencia:** Sprint 3 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Objeto `const store` exportado con claves iniciales: `currentTab`, `activeRoutineId`, `loadedExercises`, `currentSesionId`, `prefUnit`.
- [ ] Función `dispatch(action, payload)` que muta el store y llama al componente `.render(store)` correspondiente según `currentTab`.
- [ ] `initApp()` llamado en `DOMContentLoaded`: inicializa DB, carga configuración, renderiza pestaña inicial.
- [ ] El routing SPA actualiza `store.currentTab` antes de renderizar.

---

### Ticket 4.2 — `js/componentes/diario.js`: Acordeones, precarga y guardado de series `[ ]`

**Dependencia:** Ticket 4.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `render(state)` es idempotente: limpia `#diario-container` antes de reconstruir.
- [ ] Fecha del día renderizada desde `new Date().toLocaleDateString('es-MX', {...})`.
- [ ] Máximo `MAX_ROUTINE_SLOTS = 8` bloques `<details>` renderizados.
- [ ] Cada `<details>` muestra el nombre del ejercicio en `<summary>`.
- [ ] Inputs de serie usan `inputmode="decimal"` y `pattern="[0-9]*"`.
- [ ] **Precarga inteligente:** inputs tienen `placeholder` con `peso x reps` de la última serie via `getUltimaSerie()`.
- [ ] Botón `[ GUARDAR SERIE ]`: llama `saveSerie()` con valores de inputs. Marca `[✓]` en el DOM usando `textContent`.
- [ ] **Single Tap** sobre nombre de ejercicio: muestra dropdown de suplentes (`activo_hoy = FALSE`). Al seleccionar, llama `updateActivoHoy()` y re-renderiza.
- [ ] **Tap Sostenido** sobre nombre de ejercicio: convierte `<summary>` en `<input type="text">`. Al `blur`/Enter: llama `saveEjercicio()` + vincula a rutina + re-renderiza.
- [ ] Ningún `innerHTML` con variables de usuario. Todo via `textContent` o `createElement`.
- [ ] Delegación de eventos en `#diario-container`, no en nodos dinámicos.

---

### Ticket 4.3 — `js/componentes/progreso.js`: Gráfica de barras ASCII `[ ]`

**Dependencia:** Ticket 4.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `render(state)` es idempotente.
- [ ] `<select id="select-ejercicio">` poblado con ejercicios ordenados por `MAX(sesiones.fecha)` DESC.
- [ ] `<select id="select-metrica">` con opciones de `METRICAS_REGISTRY`.
- [ ] Al cambiar ejercicio: consulta `getSeriesPorEjercicio()`, procesa con `prepararDatosProgreso()`, renderiza gráfica.
- [ ] Gráfica de barras: últimas 5 sesiones, fecha + valor 1RM + barra de 20 chars (`█`/`░`).
- [ ] Historial reciente: lista descendente por fecha, formato `"DD MMM: Xkg x R1, R2 (1RM Est: Ykg)"`.
- [ ] La etiqueta de unidad (`kg`/`lb`) se lee de `store.prefUnit`.
- [ ] Si `peso === 0` (BW), la barra no se renderiza para esa sesión (regla de exclusión BW).

---

### Ticket 4.4 — `js/componentes/config.js`: Rutinas, unidades y CSV `[ ]`

**Dependencia:** Ticket 4.1 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `render(state)` es idempotente.
- [ ] 7 selectores (Lunes–Domingo) poblados con `getRutinas()`. Al cambiar: `updateRutinaDia()`.
- [ ] Botón `[+ Crear nueva rutina]`: input de texto → `saveRutina()` → re-renderiza selectores.
- [ ] Radio buttons KG/LB: al cambiar → `updatePrefUnit()` → `dispatch` actualiza `store.prefUnit` globalmente.
- [ ] Botón `[ Respaldar CSV ]`: llama `exportarCSV()` con datos de DB completos.
- [ ] Input de archivo + botón `[ Importar CSV ]`: llama `importarCSV()`, muestra resultado `{ exitosas, fallidas }` con `textContent`.
- [ ] Ningún `innerHTML` con variables de usuario.

---

### Ticket 4.5 — Pantalla de Fin de Entrenamiento (HU 9) `[ ]`

**Dependencia:** Ticket 4.2 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Botón `[ FIN DEL ENTRENAMIENTO ]` al fondo de `#diario-container`.
- [ ] Al presionar: oculta acordeones, muestra `#diario-fin` con mensaje "¡Entrenamiento Registrado!" y arte ASCII/SVG minimalista.
- [ ] La navegación entre pestañas sigue funcionando desde esta pantalla.
- [ ] La pestaña Diario recupera su estado de registro normal al día siguiente (verificar por fecha).

---

### Ticket 4.6 — PWA Manifest y prueba de instalación `[ ]`

**Dependencia:** Tickets 4.1–4.5 en `[DONE]`.

**Criterios de aceptación:**
- [ ] `manifest.json` creado: `name`, `short_name`, `start_url`, `display: standalone`, `background_color: #000000`, `theme_color`, `icons` (al menos 192x192 y 512x512).
- [ ] `<link rel="manifest" href="/manifest.json">` en `index.html`.
- [ ] En Chrome DevTools → Lighthouse → PWA: puntuación de instalabilidad correcta.
- [ ] App instalable desde Chrome en Android/iOS (o simulada en DevTools).

---

### Ticket 4.7 — `_headers` (Cloudflare Pages) o `vercel.json`: Cabeceras de Seguridad `[ ]`

**Dependencia:** Ticket 4.6 en `[DONE]`.

**Criterios de aceptación:**
- [ ] Archivo `_headers` (para Cloudflare Pages) creado con:
  - `Content-Security-Policy`: `default-src 'self'; script-src 'self'; connect-src 'self' idb://*; style-src 'self' 'unsafe-inline';`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
- [ ] Alternativa `vercel.json` con el mismo set de headers si el deploy target es Vercel.
- [ ] Verificación en browser: DevTools → Network → response headers del `index.html` muestran la CSP activa.

---

### Ticket 4.8 — `pnpm test` final: Suite E2E de humo + regresión completa `[ ]`

**Dependencia:** Todos los tickets del Sprint 4 en `[DONE]`.

> **Hito de Control Final.** El proyecto no se considera en MVP funcional sin este ticket.

**Criterios de aceptación:**
- [ ] Todos los tests de Sprints 1, 2 y 3 siguen en verde (no hay regresiones).
- [ ] Test de integración completo en `tests/integracion.test.js`:
  - [ ] Flujo completo: `initDB('memory://')` → `saveRutina` → `saveEjercicio` → `saveSesion` → `saveSerie` → `getSeriesPorEjercicio` → `calculateEpley1RM` → valor correcto.
  - [ ] Flujo CSV: exportar → corromper una fila → importar → verificar ROLLBACK → DB intacta.
- [ ] `pnpm test` → **todos los tests passed**. Output limpio, cero warnings de ESM.

---

## 📊 RESUMEN DE PROGRESO

| Sprint | Tickets | Done | Pendiente |
|--------|---------|------|-----------|
| Sprint 1 — Cascarón | 6 (1.0–1.5) | 6 | 0 |
| Sprint 2 — Datos | 5 (2.1–2.5) | 5 | 0 |
| Sprint 3 — Lógica | 3 (3.1–3.3) | 0 | 3 |
| Sprint 4 — UI | 8 (4.1–4.8) | 0 | 8 |
| **Total** | **22** | **0** | **22** |

---

_Creado en Sprint 0 (Setup) · Actualizar estado de tickets conforme avanza el proyecto_
