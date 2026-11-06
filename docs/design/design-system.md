# Design System — Luca Plan

Estilo: **iOS 26 / macOS 26 con Liquid Glass** (WDC-147): fondos agrupados, celdas sólidas y una
capa de controles de vidrio. Esquinas sobrias (`--radius: 0.625rem`, ver
[Formas y uso de componentes](../development.md#formas-y-uso-de-componentes)), colores de sistema de
Apple ajustados a AA. Light + dark emparejados.
Fuente de verdad: [app/globals.css](../../app/globals.css). No hardcodees valores en
componentes — siempre tira de estos tokens (variables CSS / utilidades Tailwind v4). Las reglas de
uso están en [Lenguaje visual](../development.md#lenguaje-visual-ios-y-liquid-glass).

## Contrato de estabilidad de Liquid Glass

**Los efectos son parte del diseño, no un detalle del layout.** Una tarea de reordenar secciones, cambiar tamaños, añadir gráficos o modificar navegación **no autoriza** modificar el material de vidrio. Preservar en móvil y escritorio: `liquid-glass`, los cinco niveles de `data-glass` en Apariencia, `--glass-fill`, `--glass-clear`, `--glass-tint`, `--glass-blur`, `--glass-saturate`, `--glass-shadow`, `--glass-rim`, `--glass-sheen`, `--glass-reflection-opacity` y el reflejo `::before`. Desde WDC-174 el acabado es CSS, sin Glisse, filtros SVG ni seguimiento continuo del contenido. Excepción (WDC-179): en móvil, los controles de vidrio flotantes (barra inferior, búsqueda, cápsula del mes y «Hoy»), los círculos de vidrio del encabezado de las hojas y la perilla del slider al arrastrarla suman la refracción WebGL de `@ybouane/liquidglass` encima de ese vidrio ([liquid-glass.ts](../../components/finance/liquid-glass.ts)), con el CSS como respaldo; se apaga en escritorio, con reducir transparencia, más contraste, reducir movimiento y en el nivel 4. Menús y popovers siguen con el material CSS.

- Para cambios de UI, modificar únicamente distribución, jerarquía y espaciado; no anular tokens de vidrio en contenedores como `.top-bar` para solucionar problemas de layout.
- «Hoy» del selector de ciclo y «Hoy» del selector de movimientos deben heredar el mismo `liquid-glass` en móvil y el mismo material de control en escritorio, respetando Apariencia y accesibilidad. Si cambia el material compartido, revisar ambos controles.
- Si un pedido requiere alterar transparencia, sombra, blur, brillo o refracción, tratarlo como cambio explícito de material, acotado y con revisión visual en iOS Safari/PWA y escritorio, ambos temas y niveles de Apariencia. Nunca mezclarlo silenciosamente con un PR de layout.
- Antes del merge, inspeccionar `git diff` de `app/globals.css` y de clases `liquid-glass` de los controles; verificar que el efecto no haya variado accidentalmente. Las preferencias del usuario siguen siendo la única fuente de nivel de vidrio.

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
| Material regular | `material` (`--material`) y `[data-slot]` de menús, select, popover, tooltip, toasts y alertas | lectura sobre contenido y aviso de refresco PWA |
| Sólido | `card`, `--sheet`, `--sheet-cell` | contenido, listas, hojas y diálogos |

El vidrio usa un relleno neutro, desenfoque de 22 px (nivel por defecto), saturación de 165 % y un brillo interior radial
desde arriba-izquierda (`--glass-sheen`, que se apaga con reducir transparencia, más contraste o sin
desenfoque). El sidebar reutiliza el
acabado de `liquid-glass` con más relleno. El borde combina un contorno tenue de 0.5 px con un
reflejo localizado arriba-izquierda y un eco más débil abajo-derecha; no ilumina todo el perímetro.
Los cinco niveles de Apariencia van de transparente a teñido como en iOS 26: 0–1 aclaran el relleno
y bajan el desenfoque (4 y 12 px) para que el contenido se lea a través; 3–4 lo tiñen hacia la celda
sólida (4 casi opaco).

`liquid-glass-active` usa `--glass-tab-active`, un velo neutro de `foreground`, con
`--glass-active-shadow`: es la pastilla de la pestaña móvil activa y la del link activo del
sidebar. En los dos, el ícono y el texto del activo van en `text-tab-active` (`--tab-active`):
`primary` en claro y un azul más claro en oscuro (#89C1FF), porque #0A84FF sobre la pastilla no
llega a 4.5:1.
`scroll-edge-top` (`--scroll-edge`, `--scroll-edge-amount`, `--scroll-edge-blur`) queda solo detrás
de la topbar de escritorio. En móvil el desenfoque se limita a las cápsulas del selector de mes y
la navegación, sin velos fuera de sus bordes. La fila superior móvil anula la sombra exterior
de sus cápsulas, conservando blur, contorno y rim internos; escritorio y barra inferior mantienen
su sombra. Los controles (`input`, segmentado) usan
`--glass-control` / `--glass-control-active`.
`--radius-bar-inner` es el radio concéntrico de lo que va dentro de una barra `rounded-xl`.
`--card-art-*` colorea el cupo sobre el arte de las tarjetas de cuenta. `--scrollbar` pinta el
scrollbar fino de escritorio.

Accesibilidad: con `prefers-reduced-transparency: reduce` todo material cae a sólido y pierde el
desenfoque; con `prefers-contrast: more` el vidrio y su selección ganan relleno y contorno. Ambas
apagan `--glass-reflection-opacity`, también en el sidebar y las variantes responsive. Sin soporte
de desenfoque, los materiales caen a sólido. `prefers-reduced-motion` sigue siendo para animaciones.

## Forma y tipografía

- `--radius: 0.625rem`; jerarquía de tres niveles (botones, búsqueda y segmentado en cápsula
  `rounded-full`, los demás campos `rounded-lg`, superficies `rounded-xl`, ítems `rounded-md`) y
  `--radius-sheet` para hojas y alertas.
- Tipografía del sistema: SF en Apple, Geist en el resto (`--font-sans`), con la escala de iOS
  (`text-large-title` … `text-caption`). Cifras con `.tabular` (cifras tabulares de la fuente del
  sistema). La landing conserva Geist, Space Grotesk y cifras mono.

## Dark mode

Conmuta con la clase `.dark` (vía `next-themes`). Todos los tokens —incluido el fondo
ambiental y el glass— tienen su variante. Diseña y prueba ambos modos juntos, no infieras
uno del otro.

El fondo oscuro es negro `#000000`, como el fondo agrupado de iOS 26; las tarjetas conservan `#1C1C1E` y las superficies
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
