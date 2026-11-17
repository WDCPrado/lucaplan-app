# Design System — Luca Plan

Lenguaje **«Finanzas en calma»** (WDC-188): papel cálido, superficies por tono, una sola fuente y un
acento verde bosque. Sin vidrio, sin filetes entre secciones, sin decoración: cada elemento sirve a
una decisión o acción de la persona; lo que repite o decora se quita.
Fuente de verdad: [app/globals.css](../../app/globals.css). Ningún componente lleva un hex, un
oklch, un tamaño de letra o un radio sueltos: todo sale de estos tokens. Reglas de uso de
componentes: [docs/development.md](../development.md#formas-y-uso-de-componentes).

## Color

Light y dark van emparejados; el oscuro es por tono, no negro. Cambia con la clase `.dark`
(`next-themes`).

| Rol | Utilidad | Claro | Oscuro | Uso |
| --- | --- | --- | --- | --- |
| Papel | `bg-background` | #F4F1EA | #12130F | fondo de la app |
| Superficie | `bg-card` = `bg-surface` | #FCFBF8 | #1B1C18 | tarjetas, hojas, diálogos |
| Tono | `bg-secondary` = `bg-surface-2` = `bg-muted` | #EDE9DF | #25261F | controles rellenos, grupos dentro de una tarjeta, hover de filas |
| Tono 2 | `bg-surface-3` | #E4DFD3 | #2F3029 | hover sobre tono, pista del switch |
| Menú | `bg-popover` | #FCFBF8 | #25261F | menús, popovers, select, toasts |
| Tinta | `text-foreground` = `text-ink` | #17160F | #EEEBE3 | cifras y texto principal |
| Tinta 2 | `text-ink-2` | #47443B | #C4BFB3 | títulos de tarjeta, meta, labels |
| Tinta 3 | `text-ink-3` = `text-muted-foreground` | #655F53 | #9D9888 | captions, ejes, placeholders |
| Acento | `bg-primary` / `text-primary` / `bg-primary-soft` | #1E4D3A / #DCE7DF | #93C6AA / #1E3127 | acciones, foco (`ring`), selección |
| Positivo | `text-success` | #1F6B3F | #8FCB9F | ingresos, montos + |
| Cerca del límite | `text-warning` / `bg-warning-soft` / `bg-warning-bar` | #7A5200 / #F4E6C6 / #B7841F | #E5BC6A / #382C14 / #D9A94A | tope cerca |
| Exceso y deuda | `text-destructive` / `bg-destructive-soft` / `bg-destructive-bar` | #9C3A20 / #F3E0D7 / #B5482A | #EDA28A / #3B2219 / #D97757 | exceso, deuda, borrar, errores |
| Barras | `bg-track`, `bg-bar`, `bg-committed` | | | pista, lo gastado, lo comprometido |
| Filete | `border-border`, `border-rule-strong` | #E3DED2 / #CBC4B4 | #2C2D27 / #3F4038 | solo el borde de un control que lo necesita |
| Gráficos | `chart-1…5` | acento, ámbar, positivo, óxido, tinta 3 | | series |

- **El color nunca va solo**: un monto positivo o negativo lleva signo además del color.
- **Dominio**: CLP y USD van siempre separados; cupo y sobregiro son deuda (óxido), no caja.
- **El acento no es estado**: verde bosque es acción y selección; «bien» es `success`.
- `card-art-*` colorea el cupo sobre el arte de las tarjetas de cuenta (fondo del banco).
- Un color nuevo es un token nuevo en `:root` **y** `.dark`, mapeado en `@theme inline`.

## Tipografía

Una fuente, **Geist** (`next/font/local`, también en Apple), dos pesos: **400 y 600** (`font-bold`
cae en 600). Cifras tabulares en todo el documento (el `body` las pone). Cinco tamaños y nada fuera
de ellos; responden al ancho solos:

| Utilidad | Móvil | ≥768 | Uso |
| --- | --- | --- | --- |
| `text-display` | 44/48 | 52/56 (60/64 ≥1200) | solo la cifra protagonista de una pantalla, semibold |
| `text-title` | 17/24 | 18/24 | título de tarjeta u hoja, cifra clave, semibold |
| `text-body` | 16/22 | 15/22 | filas, formularios, botones |
| `text-callout` | 14/20 | 14/20 | texto secundario, labels, acciones de texto |
| `text-caption` | 12/16 | 13/16 | metadatos, ejes, etiquetas |

Los nombres viejos siguen funcionando y caen en esta escala: `text-hero` y `text-large-title` →
display; `text-title-1`, `text-title-3` y `text-headline` → title; `text-subheadline` → callout;
`text-footnote` → caption. En código nuevo, los nombres nuevos. Tres tintas: `foreground`,
`ink-2`, `ink-3`. Un monto nunca se parte (`whitespace-nowrap`).

## Forma y espacio

- **Radios**: `rounded-md`/`rounded-sm` 8 (controles: botón, input, select, segmentado, ítem de
  menú, aviso), `rounded-lg` 12 (filas, grupos, menús), `rounded-xl` 16 (tarjetas, popovers),
  `rounded-2xl` y `rounded-(--radius-sheet)` 24 (hojas y diálogos). `rounded-full` solo en lo que es
  círculo por significado (avatar, punto de estado, switch, barras de progreso) y la barra inferior
  flotante.
- **Espacio** en la escala 4/8 (`gap-1`, `gap-2`, `gap-3`, `gap-4`, `gap-6`). Las secciones se separan
  por tono y espacio, nunca por líneas.
- **Página**: `page-container` (tope 1520, 16 px de margen en móvil, 32 en escritorio), el mismo borde
  que la barra superior.
- **Sombras**: `shadow-float` (lo que flota: menús, barra inferior), `shadow-sheet`, `shadow-panel`.
  Las tarjetas no llevan sombra.

## Lo que flota y el nivel de Apariencia

No hay vidrio. Lo único que flota sobre el contenido son la barra superior móvil y la barra
inferior: fondo propio `--float` (la superficie con opacidad) con desenfoque `--float-blur`
(utilidad `float`). La preferencia **Ajustes → Apariencia** (`data-glass` en `<html>`, 0–4, por
usuario en la base, `lib/appearance.ts`) mueve esas dos barras de más transparente a sólido:

| Nivel | 0 | 1 | 2 (por defecto) | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| `--float-opacity` | 60 % | 74 % | 88 % | 96 % | 100 % |
| `--float-blur` | 24 px | 20 px | 16 px | 8 px | 0 |

`prefers-reduced-transparency`, `prefers-contrast: more` (que además oscurece filetes y tinta 3) y la
falta de `backdrop-filter` las dejan sólidas siempre. Los nombres heredados `liquid-glass`,
`liquid-glass-active`, `liquid-squish`, `material`, `scroll-edge-top`, `.glass`, `--glass-*`,
`--sheet*`, `--tab-active` siguen definidos y mapeados a lo de arriba para no romper pantallas que
aún no se rediseñan; no se usan en código nuevo.

## Movimiento

- Press: `.press` (escala .98, 140 ms). Hover en tono.
- Menús y popovers nacen de su botón: 160 ms al entrar, 120 al salir.
- Chevron que gira 180° al abrir (`Chevron` de `components/finance/blocks.tsx`).
- Colapsables (`Collapsible`, `<details>`) con altura animada (200/160 ms).
- Cambio de pantalla: el contenido se desliza (React `<ViewTransition>`, `--nav-duration`); el marco
  queda quieto.
- `prefers-reduced-motion`: sin escalas, desplazamientos ni alturas animadas; solo fundidos.

## Accesibilidad

Contraste AA en los dos temas. Foco de teclado: anillo de 2 px en el acento, por dentro
(`outline-offset: -2px`) para que no cambie el tamaño ni lo recorte un contenedor; el botón primario
lo lleva por fuera. Controles de 44 px en táctil (`--ctl`), 36 con puntero fino.
