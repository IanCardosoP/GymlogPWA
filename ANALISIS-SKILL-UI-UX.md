# Análisis de viabilidad: integración de `ui-ux-pro-max-skill` en GymLogPWA

**Rama de análisis**: `gh/ui-ux-skill-analysis`  
**Fecha de análisis**: 2026-07-05  
**Scope**: Evaluación de herramienta, **sin modificación de código de producto**

---

## 1. Resumen ejecutivo

### Veredicto
**VIABLE** con restricciones claras. La skill `ui-ux-pro-max-skill` es útil **como generador de sistema de diseño en texto** (paleta, tipografía, spacing, accesibilidad), no como generador automático de código. Proporciona recomendaciones razonadas que deben filtrarse manualmente a través de las restricciones vanilla/offline-first del proyecto.

### Recomendación de uso
Usar la skill **solo para Fase 0** (generación de tokens/sistema de diseño) como insumo para decisiones visuales posteriores. No confiar en que genere directamente markup HTML o JS que sea aplicable al patrón `createElement` + delegación de eventos de GymLogPWA. La reestructuración visual debe hacerse de forma manual e incremental, priorizando cambios CSS-only en las fases iniciales.

---

## 2. Sobre la skill: qué es y qué no es

### ¿Qué es?

`ui-ux-pro-max-skill` es un **motor de razonamiento de diseño**, no un generador de componentes.

- **Entrada**: prompt en lenguaje natural describiendo el tipo de producto, audiencia, estética deseada, stack tecnológico.
- **Salida**: reporte Markdown con un **sistema de diseño razonado** — paleta de colores (con justificación por industria), escala tipográfica, sistema de spacing, radio de bordes, sombras, animaciones, guías de accesibilidad, anti-patrones a evitar.
- **Base de conocimiento**: 161 reglas de razonamiento por industria/contexto, 67 estilos visuales (Glassmorphism, Brutalism, Minimalism, etc.), 57 combinaciones tipográficas de Google Fonts, 161 paletas de color mapeadas a categorías de producto, 25 recomendaciones de gráficos, 99 reglas de UX/A11y.
- **Motor interno**: búsqueda semántica BM25 + aplicación de reglas de decisión en JSON — no hay ML/IA generativa dentro de la skill, son heurísticas deterministas basadas en los datos CSV/JSON cuidadosamente curados.

### ¿Qué no es?

- ❌ No genera código HTML/CSS/JS automático.
- ❌ No reestructura layouts ni renombra clases existentes.
- ❌ No es un generador de componentes visuales como Storybook.
- ❌ No genera asset gráficos (iconos, ilustraciones, imágenes).
- ❌ No reemplaza la toma de decisiones humana — es una herramienta de asesoría que hay que traducir manualmente a implementación.

---

## 3. Compatibilidad con GymLogPWA

### ✅ Perfectamente compatible

1. **Agnóstica de framework**: el output es guías en Markdown + recomendaciones de CSS/tipografía. No fuerza dependencias npm, no toca `package.json` ni `pnpm-lock.yaml`.
2. **Instalación limpia**: `npm install -g ui-ux-pro-max-cli` (CLI global, fuera del proyecto) + `uipro init --ai claude` crea `.claude/skills/ui-ux-pro-max/` — un artefacto de Claude Code, no del proyecto. No ensucia la estructura del repo.
3. **Soporta HTML/vanilla**: entre sus 22+ guías de stack, tiene soporte para "html plano" (aunque es el más genérico de los 22+).
4. **Respeta la regla de "pnpm exclusivamente"** del `CLAUDE.md`: la skill nunca entra en el gestor de paquetes del proyecto.

### ⚠️ Fricción a filtrar manualmente

#### 1. **Tipografía vs. offline-first**
La skill propone 57 combinaciones tipográficas de **Google Fonts** — todas vía CDN externo. **Incompatible con la estrategia Cache-First de GymLogPWA** sin modificaciones.

**Opciones**:
- Descartar sugerencias de Google Fonts, mantener `Courier New` (monoespaciado) o adoptar una fuente del sistema como fallback.
- Auto-hospedar una fuente elegida en `/public/fonts/`, importarla vía `@font-face` en `css/styles.css`, asegurar que el Service Worker la cachea (comprobar `sw.js`).

#### 2. **Guías de stack genéricas para vanilla HTML**
Las recomendaciones de la skill para "html plano" son genéricas (estructura semántica, variables CSS, media queries). GymLogPWA usa un patrón muy específico:
- 100% `document.createElement` (cero template strings).
- Delegación de eventos con `AbortController`.
- Patrón "destruir y reconstruir" (`container.textContent = ''` + rebuild).

La skill **no sabe nada de esto** — sus ejemplos de "cómo aplicar" son estándar (BEM, media queries, CSS custom properties). La traducción a esta arquitectura específica es **responsabilidad del equipo de desarrollo**, no de la skill.

#### 3. **Requisito: Python3 en el entorno**
El motor de búsqueda de la skill requiere Python 3.x local para ejecutar `search.py`. No es problema si el dev tiene Python instalado, pero es un pre-requisito a verificar. No es una dependencia del proyecto (no se instala vía `pnpm`), es tooling del asistente.

---

## 4. Arquitectura actual de GymLogPWA: análisis de riesgo

### Estructura de código UI/UX actual

| Componente | Líneas | Complejidad | Riesgo de rediseño |
|---|---|---|---|
| `js/app.js` | 99 | Baja | ✅ Bajo — orquestador/router puro, casi ningún markup |
| `js/componentes/config.js` | 504 | Media | 🟡 Medio-bajo — paneles repetitivos, poco acoplamiento a clases CSS |
| `js/componentes/progreso.js` | 558 | Media-alta | 🟡 Medio — 3 sub-vistas con tablas/gráficos, selects encadenados |
| `js/componentes/diario.js` | 791 | **Alta** | 🔴 **Riesgo alto** — acordeones, autocompletado, captura html2canvas |
| `css/styles.css` | 1372 | — | — |

**Total JS de UI: ~1950 líneas** de código generador de DOM.

### Características del patrón de renderizado

#### A. **100% `document.createElement` + helper `cel()`**
```js
// Patrón repetido en los 3 componentes
function cel(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}
```

**Implicación para rediseño**: No hay separación template/lógica. La estructura HTML se genera línea a línea entrelazada con lectura/escritura de datos (`dataset.*`, `.value`, `.textContent`). Cambiar el árbol DOM (agregar wrappers, cambiar tags, renombrar clases) requiere editar estas funciones directamente, no un archivo `.html`/`.css` aislado.

#### B. **Delegación de eventos con un solo listener por contenedor**
```js
container.addEventListener('click', async e => {
  const btnGuardar = e.target.closest('.btn-guardar');
  if (btnGuardar && sesion) { 
    await handleGuardar(btnGuardar, sesion.id); 
    return; 
  }
  const btnDeleteSerie = e.target.closest('.btn-delete-serie');
  // ... más handlers
}, { signal: clickAbort.signal });
```

**Implicación clave**: Los nombres de clase CSS **son también hooks de comportamiento** (`closest('.clase-x')`). Renombrar una clase visual sin actualizar el `closest()` correspondiente **rompe la interacción silenciosamente** — no hay error visible, simplemente el handler nunca dispara.

**Ejemplo de riesgo**: si un rediseño renombra `.btn-guardar` a `.save-btn`, el listener delegado sigue buscando `closest('.btn-guardar')` y nada pasa cuando se hace clic.

#### C. **Patrón idempotente: "destruir y reconstruir todo"**
```js
const container = document.getElementById('diario-container');
container.textContent = '';        // limpia el subárbol completo
// ... reconstruye desde cero con createElement
```

**Implicación**: es simple (evita duplicación de nodos por construcción), pero costoso en reflow. La app usa `DocumentFragment` para optimizar, pero no hay Virtual DOM ni reconciliación granular. Cualquier cambio de estado requiere un re-render completo de la pestaña activa.

### Inventario actual de tokens CSS

**En `:root` (línea 3-12 de `css/styles.css`)**:
```css
--color-fondo: #000000;           /* negro puro */
--color-fondo-alt: #121212;       /* gris muy oscuro */
--color-acento: #00ff88;          /* verde neon — dinámico en runtime */
--color-texto: #e0e0e0;           /* gris claro */
--color-texto-dim: #c0c0c0;       /* gris medio */
--font-mono: 'Courier New', Courier, monospace;
--max-width: 450px;
color-scheme: dark;
```

**Variables ausentes** (hardcodeadas por selector en toda la hoja):
- ❌ Spacing (padding, margin, gap) — valores entre 4px y 16px dispersos, sin escala.
- ❌ Radio de bordes — valores entre 0 (sin radio) y 4px, inconsistentes.
- ❌ Sombras — prácticamente ninguna, solo un `box-shadow: 0 0 0 1px` en desktop.
- ❌ Transiciones — solo `transition: color 0.15s, background-color 0.15s`.
- ❌ Escala tipográfica — ~20 tamaños ad hoc entre 9px y 22px sin escala matemática.

**Acento dinámico** (línea 8 de `js/app.js`):
```js
export const ACENTOS = {
  verde:  '#00ff88',
  morado: '#bf00ff',
  rosa:   '#ff0080',
  cian:   '#00d4ff',
};

export function aplicarAcento(key) {
  document.documentElement.style.setProperty('--color-acento', ACENTOS[key] ?? ACENTOS.verde);
}
```

El mismo acento está **duplicado como hardcode** en varias clases CSS (`.metrica-info.acento-*`, `.acento-swatch-*`), fragmentando la fuente de verdad.

**Otro color hardcodeado fuera de variables**: `#ff4444` (rojo de "peligro/eliminar"), usado en 6+ selectores sin variable.

### Componentes visuales clave (riesgo de reestructuración)

#### 1. **Acordeones (`<details>/<summary>`)**
- **Ubicación**: `diario.js`, sección `construirBloque()`.
- **Patrón**: HTML nativo `<details><summary>...</summary><div>...</div></details>`.
- **Riesgo bajo**: el toggle abierto/cerrado lo maneja HTML5 nativo, no JS.
- **Riesgo medio**: si un rediseño reemplaza `<details>` por un componente custom (para más control visual), hay que reimplementar el toggle de apertura/cierre, detectar `open` attribute, etc.

#### 2. **Autocompletado**
- **Ubicación**: `diario.js`, sección `handleAñadirEjercicio()`.
- **Complejidad**: el más intrincado de todos — input con lista filtrada, navegación por teclado (arriba/abajo/enter/escape), selector de grupo muscular, manejo cuidadoso de `blur` vs `click` con flags (`eligiendo`) para evitar conflictos móvil/desktop.
- **Riesgo alto**: cualquier cambio en la estructura (input + lista) requiere ajustes delicados en los handlers de teclado y el timing de blur/click.

#### 3. **Captura de pantalla a imagen**
- **Ubicación**: `diario.js`, sección `mostrarPantallaFin()`.
- **Cómo funciona**: usa la librería `html2canvas` para generar un PNG del resumen de sesión y compartirlo vía `navigator.share` o descarga.
- **Acoplamiento a CSS**: las clases `fin-capture-hidden` (para ocultar el botón de compartir antes de capturar) y `fin-capture-wrapper` son **esperadas por html2canvas**.
- **Riesgo alto**: cualquier cambio de layout en la pantalla "fin" debe probarse específicamente en la captura; no es evidente en el navegador normal.

#### 4. **Inputs numéricos (series: peso/reps)**
- **Ubicación**: `diario.js`, función `construirFilaSerie()`.
- **Patrón**: `<input type="number">` con `inputmode="decimal"`, binding a `.dataset.reId`/`.dataset.ejId`/`.dataset.numSerie` para identificación.
- **Riesgo medio**: los datos se asocian vía `dataset` (atributos data-*), cambiar esto requiere sincronizar JS + HTML generado.

#### 5. **Gráficos de progreso (barras)**
- **Tipos**:
  1. Barras ASCII (caracteres monoespaciados, generadas como texto en JS).
  2. Barras reales con `<div>` + CSS custom property de porcentaje (`--fill-pct`).
- **Riesgo bajo**: si es CSS custom property, cambiar solo requiere ajustar la variable, no la lógica de JS.

#### 6. **Navegación por tabs**
- **Ubicación**: `js/app.js`, función `navigateTo()`.
- **Patrón**: manipulación nativa de `hidden` attribute + clase `.is-active` en botones + ARIA (`aria-selected`).
- **Riesgo bajo**: el cambio de tab no toca la estructura de componentes, solo alterna visibilidad.

### Matriz de riesgo por tipo de cambio

| Tipo de cambio | Ejemplos | Riesgo | Esfuerzo JS |
|---|---|---|---|
| **CSS-only** | Paleta, tipografía, spacing, radios, sombras, transiciones | ✅ Bajo | 0 líneas |
| **CSS + variables** | Expandir `:root` con nuevas custom properties | ✅ Bajo | 0 líneas |
| **CSS + data-attributes** | Cambiar colores/estilos vía `[data-progreso]`, `[data-tipo]` | ✅ Bajo | 0 líneas |
| **Renombrar clases sin tocar JS** | `.btn-guardar` → `.guardar-btn` | 🔴 **ROMPE** | Selectors `closest()` |
| **Reestructurar DOM** | Agregar wrappers, cambiar tags, mover controles | 🟡 Medio-alto | Editar `createElement` + datos |
| **Reemplazar `<details>`** | Custom accordion con div + JS toggle | 🟡 Medio-alto | Reimplementar toggle + estado |
| **Cambiar estructura de inputs** | Pasar de input directo a controles personalizados | 🟡 Medio-alto | Mapear `.dataset` correctamente |

---

## 5. Recomendación de implementación (fases)

### Fase 0: Generación de sistema de diseño (sin riesgo)
**Objetivo**: usar la skill (o el prompt maestro, ver sección 6) para generar recomendaciones de tokens en texto.

**Salida esperada**: documento Markdown con paleta expandida (colores + estados), escala tipográfica, sistema de spacing, sistema de radios, sistema de sombra/glow, sistema de motion, checklist de accesibilidad.

**Riesgo**: ✅ Ninguno — es solo análisis en texto, sin tocar código.

### Fase 1: Expansión de tokens en CSS (bajo riesgo)
**Objetivo**: agregar nuevas custom properties en `:root` sin renombrar clases existentes.

**Cambios esperados**:
```css
:root {
  /* Tokens existentes */
  --color-fondo: #000000;
  --color-acento: #00ff88;
  /* NUEVOS tokens */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  --spacing-xl: 24px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 8px;
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.2);
  --shadow-md: 0 4px 8px rgba(0, 0, 0, 0.3);
  --shadow-lg: 0 8px 16px rgba(0, 0, 0, 0.4);
  --motion-duration: 150ms;
  --motion-timing: cubic-bezier(0.4, 0, 0.2, 1);
  /* ... más tokens */
}
```

**Riesgo**: ✅ Bajo — no toca código JS, no renombra clases.

**Testing**: `pnpm test` debe pasar (tests no dependen de CSS).

### Fase 2: Refinar componentes existentes (riesgo medio)
**Objetivo**: ajustar propiedades CSS sobre las clases YA existentes, sin renombrar.

**Cambios esperados**:
- Actualizar `.btn-guardar`, `.btn-delete-serie`, etc. para usar las nuevas variables de spacing (`--spacing-sm` en vez de hardcode `8px`).
- Agregar radius a botones: `border-radius: var(--radius-sm);`.
- Agregar transiciones suaves a hovers: `transition: background-color var(--motion-duration) var(--motion-timing);`.
- Mejorar contraste de colores en estados focus/hover.
- Agregar micro-interacciones (glow en acento, shadow elevado en active, etc.).

**Riesgo**: 🟡 Medio — cambios visuales puros en CSS, pero hay que verificar que no se rompan interacciones visuales. Ejemplo: si se agrega una sombra a `.btn-guardar` en hover, asegurarse de que no afecte la captura de html2canvas.

**Testing**: `pnpm run dev` + navegación manual en las 3 pestañas. Verificar que los botones responden, que los acordeones abren/cierran, que la captura de pantalla del resumen se ve bien.

### Fase 3: Cambios estructurales (riesgo alto, opt-in para futuro)
**Objetivo**: reestructurar componentes que requieran cambios en el árbol DOM o renombres de clases.

**Ejemplos**:
- Reemplazar acordeones `<details>` por custom component con control visual más fino.
- Renombrar clases de botones para alinearse con nuevo naming convention.
- Agregar wrapper divs para layouts más sofisticados.
- Cambiar estructura de inputs para componentes custom.

**Riesgo**: 🔴 Alto — requiere editar los ~1950 líneas de JS de UI, con especial cuidado:
1. `config.js` (504 líneas): piloto inicial, menor complejidad.
2. `progreso.js` (558 líneas): intermedio, sub-vistas múltiples.
3. `diario.js` (791 líneas): último, mayor complejidad (acordeones + autocompletado + captura html2canvas).

**Regla dura**: todo rename de clase debe actualizar en el **mismo commit** el `closest()` correspondiente. Ejemplo:
```js
// ANTES
const btnGuardar = e.target.closest('.btn-guardar');

// DESPUÉS
const btnGuardar = e.target.closest('.guardar-btn');
```

**Testing**: `pnpm test` + `pnpm run dev` + navegación exhaustiva en las 3 pestañas, incluyendo pruebas de captura de pantalla en `diario.js`.

### Cada fase futura sigue la regla de ramas por sprint
La presente rama `gh/ui-ux-skill-analysis` es un análisis. Cuando la implementación real comience (futura), seguirá la regla del `CLAUDE.md`:
```bash
git checkout -b sprint-N  # N = número del sprint
# ... implementar fases 1, 2, 3 ...
```

---

## 6. Prompt maestro (plantilla reutilizable)

Este prompt está diseñado para:
1. Usarse directamente con la skill `ui-ux-pro-max-skill` (si se instala en el futuro).
2. Servir como especificación de diseño para el equipo de desarrollo.
3. Ser pasado a Claude Code en futuras sesiones de implementación (Fases 1, 2, 3).

### Prompt maestro en español

```markdown
# Rediseño UI/UX de GymLogPWA — Especificación de diseño

## Contexto

GymLogPWA es una **Progressive Web App offline-first** para registro de entrenamiento en gimnasio.

**Stack tecnológico**:
- Frontend: HTML5 semántico vanilla + CSS3 puro + JavaScript ES6+ vanilla (sin frameworks).
- Base de datos: PGLite (PostgreSQL en WebAssembly), persistido en IndexedDB bajo `idb://gym-log-db`.
- Offline: Service Worker con estrategia Cache-First estricta.
- Routing: manipulación nativa del DOM (no hay librería de router).
- Testing: Vitest con instancias en memory:// para tests.

**Estética actual**: dark CLI minimalista.
- Colores: `#000000` (fondo), `#121212` (fondo alt), `#e0e0e0` (texto), acento dinámico verde/morado/rosa/cian.
- Tipografía: monoespaciado (Courier New).
- Layout: max-width 450px centrado, mobile-first, sin cambios estructurales en desktop (≥480px).
- Motion: mínima — solo shimmer de skeleton y transiciones de 150ms en color.

**Objetivo del rediseño**: mantener la esencia minimalista y dark, pero hacerlo más moderno, llamativo y friendly para el usuario. Mejorar visual hierarchy, micro-interacciones, accesibilidad, y aprovechamiento de espacio en pantallas grandes sin romper mobile-first.

## Restricciones no negociables

1. ✅ **Cero frameworks UI**: la solución es 100% vanilla HTML/CSS/JS. Prohibido React, Vue, etc.
2. ✅ **Cero fuentes CDN externas**: todo debe funcionar offline. Si se propone tipografía, debe ser:
   - Sistema (serif, sans-serif, monospace).
   - Auto-hospedada en `/public/fonts/` con `@font-face` + cacheable por Service Worker.
3. ✅ **Una sola hoja CSS** (`css/styles.css`): no separar en parciales SCSS/LESS. Usar variables CSS custom en `:root` para tokens.
4. ✅ **Conservar acento dinámico**: los 4 acentos (verde/morado/rosa/cian) deben seguir siendo intercambiables en runtime. No hardcodear colores de acento en selectores.
5. ✅ **No renombrar clases sin mapear JS**: cada clase CSS también es un hook de comportamiento (usada en `e.target.closest('...')`). Cambiar nombre = actualizar listeners delegados en el mismo commit.
6. ✅ **Conservar `<details>/<summary>` nativos**: los acordeones de ejercicios del Diario usan HTML5 nativo. Si el rediseño los toca, debe mantener la semántica (no reemplazar por div + custom toggle sin justificación).
7. ✅ **Mobile-first**: layout base para 450px. En ≥480px, mejorar aprovechamiento de espacio (ej: sidebar, multi-columna) sin romper mobile.
8. ✅ **Sin cambios a lógica de renderizado**: el patrón actual es `container.textContent = ''; ... createElement()`. No requiere cambio, pero las propuestas de diseño no deben asumir otras arquitecturas (ej: Virtual DOM, componentes Lit, etc.).

## Qué proponer

### 1. Paleta expandida
- Colores base (fondo, fondo-alt, texto, texto-dim): opciones más sofisticadas que pure #000 y #e0e0e0.
- Variantes de acentos: mejora visual de los 4 colores existentes (verde/morado/rosa/cian) con derivados (tints/shades para estados).
- Colores de estado: éxito, advertencia, error, info — con contraste mínimo 4.5:1 para WCAG AA.
- Colores semánticos: fondo hover, fondo focus, fondo active, overlay/backdrop, skeleton.

**Formato de entrega**: variables CSS custom en `:root`.

### 2. Escala tipográfica consolidada
Reemplazar los ~20 tamaños ad hoc (9px-22px) por una escala matemática (ej: 1.125x, 1.25x, Fibonacci).

**Propuesta ejemplo**:
```css
--fs-xs: 11px;     /* labels, breadcrumbs */
--fs-sm: 13px;     /* body, tabs, labels */
--fs-md: 15px;     /* body base */
--fs-lg: 17px;     /* subheaders */
--fs-xl: 19px;     /* headers */
--fs-2xl: 22px;    /* page title */
```

**Restricción**: monoespaciado sigue siendo obligatorio (offline-first). Opciones: Courier New (sistema) o auto-hospedar JetBrains Mono / IBM Plex Mono (más moderno, misma categoría).

**Formato de entrega**: variables CSS custom + `font-family` única (cambiar en `:root` y no en cada selector).

### 3. Sistema de spacing
Reemplazar valores hardcodeados (4px, 8px, 12px, 14px, 16px, 24px) por escala consistente.

**Propuesta**:
```css
--sp-1: 4px;
--sp-2: 8px;
--sp-3: 12px;
--sp-4: 16px;
--sp-5: 20px;
--sp-6: 24px;
--sp-7: 28px;
--sp-8: 32px;
```

**Aplicación**: padding, margin, gap, widths (ej: `padding: var(--sp-3) var(--sp-4);` en vez de `padding: 12px 16px;`).

**Formato de entrega**: variables CSS custom.

### 4. Sistema de radius
Crear escalas para bordes redondeados, desde sharp hasta heavily rounded.

**Propuesta**:
```css
--radius-0: 0;      /* sharp */
--radius-sm: 2px;   /* subtle */
--radius-md: 4px;   /* default */
--radius-lg: 8px;   /* rounded */
--radius-xl: 12px;  /* very rounded */
--radius-full: 9999px; /* pill */
```

**Aplicación**: inputs, botones, cards, acordeones.

**Restricción**: los acordeones (`<details>`) tienen radius en `details` + `summary` + contenido; verificar que los valores propuestos no choquen con el look nativo esperado.

### 5. Sistema de sombra/glow
Crear escala de sombras sutiles (respetando dark mode) y un glow basado en el acento.

**Propuesta de sombras** (en dark mode):
```css
--shadow-sm:   0 1px 2px rgba(255, 255, 255, 0.05);
--shadow-md:   0 4px 6px rgba(0, 0, 0, 0.3);
--shadow-lg:   0 8px 16px rgba(0, 0, 0, 0.4);
--shadow-xl:   0 16px 32px rgba(0, 0, 0, 0.5);
```

**Propuesta de glow** (basado en `--color-acento`):
```css
--glow-sm:     0 0 8px rgba(var(--color-acento), 0.3);
--glow-md:     0 0 16px rgba(var(--color-acento), 0.5);
--glow-lg:     0 0 24px rgba(var(--color-acento), 0.7);
```

**Aplicación**: botones en hover/focus, inputs en focus, efectos de activación.

**Restricción**: cuidado con `rgba()` y variables CSS — algunas versiones de CSS no soportan color-vars en `rgba()` directamente. Solución: usar `color-mix(in srgb, var(--color-acento) 30%, transparent)` o definir variables de color como HSL separables.

### 6. Sistema de motion (animaciones/transiciones)
Reemplazar transiciones duras por duraciones/timing-functions consistentes, respetando `prefers-reduced-motion`.

**Propuesta**:
```css
--duration-fast: 100ms;
--duration-base: 150ms;
--duration-slow: 250ms;
--timing-ease-in:  cubic-bezier(0.4, 0, 1, 1);
--timing-ease-out: cubic-bezier(0, 0, 0.2, 1);
--timing-ease-inout: cubic-bezier(0.4, 0, 0.2, 1);

@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 1ms !important;
    transition-duration: 1ms !important;
  }
}
```

**Aplicación**:
- Hovers de botones: color change en 150ms ease-out.
- Focus de inputs: glow + border-color en 150ms ease-out.
- Transiciones de tab: fade in/out en 150ms (si se agrega).
- Transiciones de acordeón: open/close animation (nativo en algunos navegadores con `max-height` + transition; ver `<details>` native open behavior).
- Micro-interacciones: pulso de guardado (éxito), shake en error (opcional).

**Restricción**: la app actual usa 150ms para casi todo. Proponer incremento a 150ms-250ms para mejor percepción de movimiento sin sacrificar responsividad.

### 7. Checklist de accesibilidad
Verificar contraste, touch targets, states, reducción de motion.

**Criterios WCAG AA mínimos**:
- Contraste texto/fondo: 4.5:1 para texto normal, 3:1 para texto grande.
- Touch targets: mínimo 44×44px (botones, inputs).
- Estados interactivos: distinguibles visualmente (focus, hover, active, disabled).
- Reducción de motion: respetar `prefers-reduced-motion: reduce`.
- Semántica: labels en inputs, buttons con texto, headings jerarquizados.
- Color como único diferenciador: evitar información solo en color (ej: usar bordes + color para estados).

**Aplicación al proyecto**:
- Inputs número del Diario (`peso`, `reps`): deben tener labels asociados, 44×44px mínimo (ahora 64px width, bien).
- Botones de ícono (guardar, eliminar, mover): si son solo símbolo, agregar `title` o `aria-label`.
- Acordeones: `<details>` + `<summary>` son semánticos, está bien. Verificar que el botón toggle visual es clara cuando está abierto/cerrado.
- Tab navigation: ya usan `role="tab"`, `aria-selected`, verificar `role="tabpanel"`.
- Colores de error/éxito: no usar solo rojo/verde, agregar símbolos o iconografía.

**Formato de entrega**: checklist de verificación por componente (Diario, Progreso, Config, pantalla "fin").

### 8. Plan de aplicación por fases
Entregar un roadmap concreto para implementación:

**Fase 1 (bajo riesgo)**: Expandir `:root` con nuevas variables, sin renombrar clases existentes.  
**Fase 2 (riesgo medio)**: Refinar CSS de componentes existentes, aplicar nuevas variables, mejorar hovers/focus.  
**Fase 3 (riesgo alto, opt-in)**: Cambios estructurales si los hay (renombres de clase, reestructuración DOM).

Especificar qué archivo(s) se tocan en cada fase, con estimación de esfuerzo en líneas de código.

## Notas adicionales

- **Diario.js** es el componente más crítico (acordeones, autocompletado, captura html2canvas). Dejar al final de Fase 3.
- **Desktop improvement** (≥480px): explorar sidebar, layout multi-columna, o expansion de componentes sin cambiar estructura base.
- **Animación de acordeón**: `<details>` nativo soporta `::details-marker` y estilos, pero no tiene transición suave de altura nativa. Se puede agregar manualmente con max-height transition, pero requiere cuidado con contenido dinámico.
- **Captura html2canvas**: verificar que nuevas clases CSS (especialmente de layout/positioning) no rompan la generación de imagen. Probar manualmente.

## Entregable final

1. **Documento de sistema de diseño** (Markdown): paleta, tipografía, spacing, radius, shadows, motion, accesibilidad — con variables CSS completas, listos para copiar a `:root` de `css/styles.css`.
2. **Guía de aplicación** (Markdown): checklist de cambios por componente, con ejemplos de antes/después en CSS.
3. **Prompt de implementación** (para uso futuro): instrucciones claras para cada fase de desarrollo, incluyendo regla de "no renombrar sin actualizar JS".

---

**Fecha de especificación**: 2026-07-05  
**Branch de análisis**: `gh/ui-ux-skill-analysis`
```

---

## 7. Comparativa: skill vs. prompt maestro

| Aspecto | `ui-ux-pro-max-skill` | Prompt maestro |
|---|---|---|
| **Instalación** | `npm install -g` + `uipro init --ai claude` | Ninguna — copiar/pegar en chat de Claude |
| **Dependencias** | Python3 local + npm global | Ninguna |
| **Customización** | Limitada — reglas internas predefinidas | Total — prompt editablede |
| **Output** | Recomendaciones de sistema de diseño genéricas | Sistema de diseño específico a GymLogPWA |
| **Tiempo de ejecución** | ~30-60 segundos (búsqueda BM25 + aplicación de reglas) | Depende del modelo de Claude (minutos) |
| **Cuándo usarla** | Fase 0, para inspiración rápida si ya hay Python3 | Fase 0, siempre disponible, sin pre-requisitos |
| **Recomendación** | Opcional, si hay Python3 disponible | Recomendado, es el insumo principal |

---

## 8. Conclusiones y próximos pasos

### ✅ Recomendaciones

2. **Usar el prompt maestro** (sección 6) como especificación de diseño cuando se inicie Fase 1 de implementación (futura sprint).
3. **Priorizar Fase 1 y 2** (solo CSS, bajo riesgo) — son los que aportan más valor visual con menor riesgo de regresiones.
4. **Postergar Fase 3** a cuando el equipo tenga confianza en el patrón de refactorización — es donde está la mayoría del riesgo.
5. **Testing manual exhaustivo** antes de mergear cualquier cambio en la rama principal — especialmente verificar Diario (acordeones, autocompletado, captura html2canvas).

### 📋 Próximos pasos (cuando se apruebe el rediseño)

1. **Crear rama `sprint-X`** (según próximo sprint disponible).
2. **Ejecutar Fase 0**: generar sistema de diseño en texto (usar skill o prompt maestro).
3. **Ejecutar Fases 1 y 2**: expandir CSS, refinar componentes existentes.
4. **Testing**: `pnpm test` + `pnpm run dev`, navegación manual en las 3 pestañas.
5. **Code review**: verificar que no se rompan listeners delegados, que todos los `closest()` sigan siendo válidos.


---

**Reporte completado**: 2026-07-05  
**Rama**: `gh/ui-ux-skill-analysis`  
**Estado**: Listo para revisión por PM y equipo de desarrollo
