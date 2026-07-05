# Sistema de Diseño — GymLog PWA

**Fase 0 del plan de `ANALISIS-SKILL-UI-UX.md`** · Sprint 5 · 2026-07-05
**Fuente**: skill `ui-ux-pro-max` v2.10.1 (`--design-system`, dials: variance 3 / motion 3 / density 7) + dominios `style` y `ux`, filtrado por las restricciones no negociables del proyecto.

---

## 1. Veredicto de la skill y filtrado aplicado

La skill clasificó el proyecto y recomendó; se aceptó/rechazó así:

| Recomendación de la skill | Decisión | Razón |
|---|---|---|
| Estilo **Dark Mode (OLED)**: `#000000`/`#121212`, acentos neón, glow mínimo, contraste 7:1+, WCAG AAA | ✅ Adoptado | Es la estética actual de GymLog — se refina, no se reemplaza |
| Estilo Terminal CLI (mono, ascii, OLED black) | ✅ Adoptado | Coincide con la identidad existente |
| JetBrains Mono vía **Google Fonts CDN** | 🟡 Adaptada | El CDN viola offline-first → se **auto-hospeda** en `css/fonts/` (woff2 Light 300 + Regular 400, SIL OFL 1.1). Same-origin ⇒ el SW la cachea al vuelo (cache-on-fetch, validado en `sw.js`, bump a `gymlog-v12`). `font-display: swap` + fallback al stack de monos del sistema (`ui-monospace` → SF Mono/Cascadia/Menlo/Consolas) si aún no cargó |
| Paleta fija naranja `#F97316` primary | ❌ Rechazado | Chocaría con el **acento dinámico** de 4 colores (restricción §6.4 del análisis) |
| Destructive `#EF4444` | 🟡 Parcial | Se conserva el `#ff4444` actual pero **tokenizado** (`--color-peligro`) — una sola fuente de verdad |
| Focus rings visibles, touch targets 44px, `prefers-reduced-motion`, press feedback 80-150ms, transiciones 150-300ms | ✅ Adoptado | Reglas CRITICAL/HIGH de la skill, compatibles CSS-only |
| GSAP para transiciones | ❌ Rechazado | Cero dependencias nuevas; CSS transitions bastan |

## 2. Tokens (Fase 1 — `:root` de `css/styles.css`)

### Color

| Token | Valor | Uso |
|---|---|---|
| `--color-fondo` | `#000000` | fondo base (existente) |
| `--color-fondo-alt` | `#121212` | superficies (existente) |
| `--color-acento` | dinámico | seteado en runtime por `aplicarAcento()` (existente) |
| `--color-texto` | `#e0e0e0` | texto principal (existente) |
| `--color-texto-dim` | `#c0c0c0` | texto secundario (existente) |
| `--color-texto-faint` | `#767676` | placeholders/vacíos — reemplaza `#444` (contraste 4.5:1 AA, antes 2.2:1 ✗) |
| `--color-borde` | `#2a2a2a` | bordes de cards/separadores pasivos (antes hardcode disperso) |
| `--color-linea` | `#1e1e1e` | hairlines de filas (antes `#222`/`#1e1e1e`) |
| `--color-peligro` | `#ff4444` | destructivo (antes 8 hardcodes) |
| `--color-exito` | `#00ff88` | éxito semántico fijo (tendencia positiva) — NO sigue al acento |
| `--color-alerta` | `#ffb020` | reservado (sin uso aún) |
| `--color-info` | `#00d4ff` | reservado (sin uso aún) |
| `--acento-verde/morado/rosa/cian` | 4 hex | fuente única para swatches y `.metrica-info.acento-*` |
| `--velo-acento` | `color-mix(acento 12%, transparent)` | fondos hover/selección que siguen al acento |
| `--skeleton-a/-b` | `#1a1a1a`/`#252525` | shimmer |

> Regla dura conservada: jamás `rgba(var(--color-acento))` — siempre `color-mix(in srgb, …)`.

### Tipografía

- `--font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, 'Roboto Mono', 'Courier New', monospace` — JetBrains Mono auto-hospedada (local-first) con fallback en cascada a monos del sistema.
- Escala tokenizada 1:1 con los tamaños existentes (cero salto visual, consolidación futura = editar 1 línea):
  `--fs-micro:10px` (antes 9px — único bump, legibilidad) · `--fs-caption:10px` · `--fs-detail:11px` · `--fs-body-sm:12px` · `--fs-body:13px` · `--fs-body-lg:14px` · `--fs-base:15px` · `--fs-input:16px` (fijo — evita auto-zoom iOS) · `--fs-title:20px` · `--fs-stat:22px`.
- Tamaños de arte ASCII (`3px`, `0.7px`) quedan hardcodeados a propósito — son dibujo, no tipografía.

### Spacing / Radius / Sombra / Motion

- `--sp-1:4px … --sp-8:32px` (escala 4pt). Aplicación completa diferida a Fase 3; en Fase 2 solo donde el valor ya está en escala.
- `--radius-sm:2px`, `--radius-md:4px`. **Sin nuevos redondeos** — la estética terminal es sharp.
- `--sombra-frame` (columna desktop) + `--glow-focus` (color-mix del acento). Glow "mínimo y sparingly" según el estilo OLED.
- `--dur-fast:100ms`, `--dur-base:150ms`, `--dur-slow:250ms`, `--ease-out`, `--ease-inout`.

## 3. Refinamientos (Fase 2 — sin renombrar UNA sola clase)

1. **Jerarquía de bordes**: separadores *pasivos* (details, headers de sección, hr) → `--color-borde` sutil; los bordes de elementos *interactivos* (chips, badges, botones outline) conservan `--color-texto-dim` como affordance. Es el cambio de mayor impacto visual.
2. **Focus visible global**: `:focus-visible { outline: 2px solid var(--color-acento) }` + glow en `input:focus`. (skill: CRITICAL #1).
3. **Touch**: `touch-action: manipulation` global en controles; micro-botones (`.btn-guardar`, `.btn-delete-serie`, `.btn-mover-*`, `.btn-edit`, `.btn-delete`) pasan de `padding: 0 4px` a `6px` para ampliar la zona táctil sin mover el layout (skill: CRITICAL #2).
4. **Press feedback** `:active` en botones outline (los `:hover` no existen en móvil).
5. **Motion tokenizada** + `@media (prefers-reduced-motion: reduce)` global (mata shimmer y transiciones).
6. **Fix de acento dinámico**: `.autocomplete-item.is-active` tenía fondo verdoso hardcodeado `#1a2a1a` — roto con acento morado/rosa/cian. Ahora `--velo-acento`.
7. `.fin-tabla` usaba `font-family: monospace` genérico → `var(--font-mono)` (consistencia en la captura html2canvas).

## 4. Guardarraíles respetados (críticos del análisis)

- ❌ Cero renombres de clases (hooks de `closest()`).
- ❌ Cero cambios en JS, HTML o `sw.js`.
- ✅ `<details>/<summary>` intactos.
- ✅ Acento dinámico intacto (`aplicarAcento()` sigue funcionando; los derivados usan `color-mix`).
- ✅ `fin-capture-hidden` / `fin-capture-wrapper` sin tocar; sin sombras nuevas dentro del área de captura.
- ✅ Una sola hoja `css/styles.css`.
- ✅ Fase 3 (estructural) **postergada** según §8 del análisis.

## 5. Checklist de validación manual (PM — `pnpm run dev`)

- [ ] Diario: acordeones abren/cierran; guardar/eliminar serie responde; autocompletado (teclado + tap); swap y mover.
- [ ] Pantalla fin: compartir → la captura PNG se ve idéntica a pantalla (probar además con acento no-verde).
- [ ] Progreso: 3 sub-tabs, chips, barras, records.
- [ ] Config: cambiar los 4 acentos → verificar autocompletado activo, swatches, metrica-info.
- [ ] Teclado: Tab por toda la app → focus ring visible en todo control.
- [ ] Ajustes del SO: activar "reducir movimiento" → sin shimmer ni transiciones.
