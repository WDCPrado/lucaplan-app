## Why

El design system actual (glassmorphism esmeralda, esquinas muy redondeadas de `0.85rem`,
Roboto/Geist Mono) se siente decorativo y "blando" para una app de planificación financiera.
Los números —lo más importante del producto— no tienen una tipografía pensada para lectura
tabular y análisis. Queremos un lenguaje visual más **ordenado, sobrio y financiero**:
esquinas nítidas, una paleta rediseñada de cero, y tipografía con figuras tabulares claras,
manteniendo el liquid glass como técnica de elevación (no como adorno).

## What Changes

- **BREAKING** Rediseño completo de la paleta de tokens en `app/globals.css` (`:root` y `.dark`):
  colores, superficies, semánticos (`success`/`warning`/`destructive`), `chart-1…5` y tokens
  glass. Todo redibujado de cero con criterio fintech; los nombres de token se conservan (la
  UI sigue tirando de las mismas variables), pero los valores cambian.
- **BREAKING** `--radius` baja de `0.85rem` a `0.25rem` (esquinas casi rectas). La escala
  derivada `radius-sm…4xl` se recalibra para el nuevo valor base.
- Tipografía nueva: **IBM Plex Sans** como `--font-sans` (texto) e **IBM Plex Mono** como
  `--font-mono` (todos los montos, cifras y columnas numéricas). Reemplaza Roboto + Geist Mono
  en `app/layout.tsx`. Se limpian los imports de fuentes sin uso.
- Regla de números: montos/precios usan `font-mono` + `tabular-nums` (y `slashed-zero` donde
  aplique) para lectura y alineación de análisis.
- **El liquid glass se mantiene** como mecanismo de elevación (`.glass`, `.glass-strong`,
  controles frosted, blobs de fondo), pero sus tokens se recalibran a la nueva paleta para que
  el efecto sea coherente con el look más sobrio.
- Actualización de la documentación del design system (`docs/design/design-system.md`) para
  reflejar la nueva paleta, radius, tipografía y las reglas de uso.

## Capabilities

### New Capabilities

- `design-system`: Lenguaje visual de LucaPlan — tokens de color/superficie/semánticos,
  radius, tipografía (texto + cifras tabulares), liquid glass y reglas de accesibilidad
  (contraste AA, color-not-only, reduced-transparency). Fuente de verdad: `app/globals.css`.

### Modified Capabilities

<!-- Ninguna: no existen specs previas en openspec/specs/. -->

## Impact

- **Código:** `app/globals.css` (todos los tokens + radius + glass), `app/layout.tsx` (fuentes),
  `docs/design/design-system.md` (doc). Componentes que hardcodeen valores en vez de tokens
  deberán migrar a tokens (auditoría rápida).
- **UI existente:** login/register y cualquier vista construida heredan el nuevo look
  automáticamente al tirar de tokens; revisar contraste y radius en ambos modos (light/dark).
- **Dependencias:** cambio de familias de `next/font/google` (IBM Plex Sans / IBM Plex Mono);
  sin nuevas dependencias npm.
- **Sin impacto** en backend, dominio, auth ni datos.
