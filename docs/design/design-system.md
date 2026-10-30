# Design System — Luca Plan

Estilo: **iOS 26 / macOS 26 con Liquid Glass** (WDC-147): fondos agrupados, celdas sólidas y una
capa de controles de vidrio. Esquinas sobrias (`--radius: 0.625rem`, ver
[Formas y uso de componentes](../development.md#formas-y-uso-de-componentes)), colores de sistema de
Apple ajustados a AA. Light + dark emparejados.
Fuente de verdad: [app/globals.css](../../app/globals.css). No hardcodees valores en
componentes — siempre tira de estos tokens (variables CSS / utilidades Tailwind v4). Las reglas de
uso están en [Lenguaje visual](../development.md#lenguaje-visual-ios-y-liquid-glass).

## Principios

- **Orden y confianza sobre decoración.** Primario **azul** (banca/fintech serio), neutros
  **slate** fríos, sin colores chillones. El **verde** se reserva para montos positivos
  (`success`), no es color de marca.
- **Datos primero.** Los números son el contenido: tipografía tabular y esquinas nítidas
  priorizan la lectura y el análisis por encima de la suavidad visual.
- **Vidrio con propósito.** El vidrio marca la capa de controles que flota sobre el contenido,
  nunca el contenido. `.glass` (nombre heredado) es hoy la celda sólida de `card`.
- **Color nunca solo.** Montos positivos/negativos llevan icono o signo además del color
  (`color-not-only`). `text-success` para positivo, `text-destructive` para negativo.
- **Contraste verificado en ambos modos** (AA 4.5:1 texto). Dark usa tonos desaturados y
  luminosos, no invertidos.

## Tokens semánticos

Mapeados a utilidades Tailwind (`bg-*`, `text-*`, `border-*`):

| Token | Uso |
| --- | --- |
| `background` / `foreground` | fondo de app / texto base |
| `card` / `card-foreground` | superficies sólidas |
| `primary` / `primary-foreground` | CTA principal, marca (azul confianza) |
| `secondary`, `muted`, `accent` | superficies y texto secundario |
| `success` / `warning` / `destructive` | montos +, alertas, montos − / errores |
| `border` / `input` / `ring` | bordes, inputs, focus ring |
| `chart-1…5` | series de gráficos (finanzas) |

**Solo del design system** (no shadcn por defecto): `success`, `warning`, `destructive-foreground`,
y los tokens glass.

## Materiales

Tres superficies, todas desde tokens de `globals.css`:

| Superficie | Clase / token | Dónde |
| --- | --- | --- |
| Liquid Glass | `liquid-glass` (`--glass-fill`, `--glass-fill-large` en el sidebar) | barras, topbar, sidebar, cápsulas y botones flotantes |
| Material regular | `material` (`--material`) y `[data-slot]` de menús, select, popover, tooltip, toasts y alertas | lo que lleva texto encima del contenido |
| Sólido | `card`, `--sheet`, `--sheet-cell` | contenido, listas, hojas y diálogos |

`liquid-glass-active` (`--glass-active`) es la pastilla activa: el acento tiñe el fondo, no el texto.
`scroll-edge-top` / `scroll-edge-bottom` (`--scroll-edge`) separan los controles del contenido que pasa
por debajo. Los controles (`input`, segmentado) usan `--glass-control` / `--glass-control-active`.
`--radius-bar-inner` es el radio concéntrico de lo que va dentro de una barra `rounded-xl`.
`--card-art-*` colorea el cupo sobre el arte de las tarjetas de cuenta. `--scrollbar` pinta el
scrollbar fino de escritorio.

Accesibilidad: con `prefers-reduced-transparency: reduce` todo material cae a sólido; con
`prefers-contrast: more` el vidrio gana relleno y contorno. No se usa `prefers-reduced-motion` para
esto (es para animaciones).

## Forma y tipografía

- `--radius: 0.625rem`; jerarquía de tres niveles (controles `rounded-lg`, superficies `rounded-xl`,
  ítems `rounded-md`) y `--radius-sheet` para hojas y alertas.
- Tipografía del sistema: SF en Apple, Geist en el resto (`--font-sans`), con la escala de iOS
  (`text-large-title` … `text-caption`). Cifras con `.tabular` (cifras tabulares de la fuente del
  sistema). La landing conserva Geist, Space Grotesk y cifras mono.

## Dark mode

Conmuta con la clase `.dark` (vía `next-themes`). Todos los tokens —incluido el fondo
ambiental y el glass— tienen su variante. Diseña y prueba ambos modos juntos, no infieras
uno del otro.

## Cómo extender

1. ¿Color/valor nuevo? Agrégalo como variable en `:root` **y** `.dark` de `globals.css`.
2. Si quieres utilidad Tailwind (`bg-foo`), mapéala en `@theme inline` (`--color-foo: var(--foo)`).
3. Recién entonces úsalo en componentes. Nunca un hex/oklch suelto en un `.tsx`.

## Modales del producto

Los modales son hojas sólidas (`--sheet`) con celdas `--sheet-cell` encima, mediante `[data-product]`.
`ResponsiveModal` conserva la altura según el contenido en móvil, los formularios validados y la
jerarquía de modales anidados: cerrar un hijo mantiene abierto al padre y devuelve el foco al control
de origen.
