# Design System — Luca Plan

Estilo: **iOS 26 / macOS 26 con Liquid Glass** (WDC-147): fondos agrupados, celdas sólidas y una
capa de controles de vidrio. Esquinas sobrias (`--radius: 0.625rem`, ver
[Formas y uso de componentes](../development.md#formas-y-uso-de-componentes)), colores de sistema de
Apple ajustados a AA. Light + dark emparejados.
Fuente de verdad: [app/globals.css](../../app/globals.css). No hardcodees valores en
componentes — siempre tira de estos tokens (variables CSS / utilidades Tailwind v4). Las reglas de
uso están en [Lenguaje visual](../development.md#lenguaje-visual-ios-y-liquid-glass).

## Materiales de Glisse

WDC-173 sustituye expresamente el motor y el acabado anterior por Glisse 0.5.0. Los controles
compatibles se importan de la biblioteca, sin clones ni una segunda capa de diseño. El CSS local
sólo adapta tamaños, texto, disposición, tokens y preferencias de accesibilidad.

El nivel de Apariencia sigue siendo del usuario. Tanto «Hoy» del ciclo como «Hoy» de movimientos
usan Button de Glisse. No modificar sus efectos al resolver un problema de layout.
Ver [mapa de migración y límites](glisse.md), incluido el mecanismo oficial de refracción en Safari.

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

Superficies de Glisse y tokens de contenido de `globals.css`:

| Superficie | Clase / token | Dónde |
| --- | --- | --- |
| Liquid Glass | Glass y controles de Glisse | navegación, acciones, campos y popovers compatibles |
| Superficie sólida | card / sheet / popover | contenido, diálogos y controles sin equivalente |

El acabado del vidrio pertenece a la biblioteca; los tokens de la app conservan los colores de
datos y contenido. La selección de TabBar y SegmentedControl también pertenece a Glisse.

## Forma y tipografía

- `--radius: 0.625rem`; jerarquía de tres niveles (controles `rounded-lg`, superficies `rounded-xl`,
  ítems `rounded-md`) y `--radius-sheet` para hojas y alertas.
- Tipografía del sistema: SF en Apple, Geist en el resto (`--font-sans`), con la escala de iOS
  (`text-large-title` … `text-caption`). Cifras con `.tabular` (cifras tabulares de la fuente del
  sistema). La landing conserva Geist, Space Grotesk y cifras mono.

## Dark mode

Conmuta con la clase `.dark` y `data-theme` (vía `next-themes`). Todos los tokens —incluido el fondo
ambiental y el glass— tienen su variante. Diseña y prueba ambos modos juntos, no infieras
uno del otro.

El fondo oscuro es carbón suave `#121214`; las tarjetas conservan `#1C1C1E` y las superficies
secundarias `#2C2C2E`. El `theme-color` inicial y dinámico y el manifest usan ese mismo fondo
para acompañar la app instalada. El tema claro y la landing conservan sus colores.

## Cómo extender

1. ¿Color/valor nuevo? Agrégalo como variable en `:root` **y** `.dark` de `globals.css`.
2. Si quieres utilidad Tailwind (`bg-foo`), mapéala en `@theme inline` (`--color-foo: var(--foo)`).
3. Recién entonces úsalo en componentes. Nunca un hex/oklch suelto en un `.tsx`.

## Modales del producto

Los modales son hojas sólidas (`--sheet`) con celdas `--sheet-cell` encima, mediante `[data-product]`.
`ResponsiveModal` conserva la altura según el contenido en móvil, los formularios validados y la
jerarquía de modales anidados: cerrar un hijo mantiene abierto al padre y devuelve el foco al control
de origen.
