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
| Comprometido | `bg-committed`, `text-committed`, `bg-committed-soft` | #C2410C / #FFF0E4 | #FB923C / #3D2819 | reserva naranjo, etiquetas y leyenda |
| Gasto: último tercio | `bg-spent-high`, `text-spent-high` | #B91C1C | #F87171 | más de dos tercios del tope consumidos |
| Filete | `border-border`, `border-rule-strong` | #E3DED2 / #CBC4B4 | #2C2D27 / #3F4038 | solo el borde de un control que lo necesita |
| Gráficos | `chart-1…5` | acento, ámbar, positivo, óxido, tinta 3 | | series |

Las barras de presupuesto reservan el comprometido (`bg-committed`) al extremo derecho;
el gastado avanza desde la izquierda y el tramo intermedio es lo libre. La reserva tiene
ambos extremos redondeados y un color opaco por tema, idéntico al de su leyenda aunque cambie
la superficie de fondo. Si gastado más
comprometido exceden el tope, no queda tramo libre: la reserva conserva su ancho y el gastado
se recorta al resto. Los montos de texto conservan el valor real, incluido el déficit.

El gastado usa verde hasta 1/3 del tope inclusive, amarillo hasta 2/3 inclusive y rojo por
encima de 2/3, incluido cualquier exceso. La regla depende de gastado/tope, sin sumar el
comprometido, y se comparte entre barras, gráficos y leyendas (`lib/spending-colors.ts`).
El tramo vacío conserva `bg-track`. Las barras de cuotas pagadas y otros avances conservan
su semántica propia. El comprometido es siempre naranjo, incluso en labels y cifras.

- **El color nunca va solo**: un monto positivo o negativo lleva signo además del color.
- **Dominio**: CLP y USD van siempre separados; cupo y sobregiro son deuda (óxido), no caja.
- **El acento no es estado**: verde bosque es acción y selección; «bien» es `success`.
- `card-art-*` colorea el cupo sobre el arte de las tarjetas de cuenta (fondo del banco).
- Un color nuevo es un token nuevo en `:root` **y** `.dark`, mapeado en `@theme inline`.

## Tipografía

Una fuente, **Geist** (`next/font/local`, también en Apple), dos pesos: **400 y 600** (`font-bold`
cae en 600). Cifras tabulares en todo el documento (el `body` las pone). Seis tamaños y nada fuera
de ellos; responden al ancho solos:

| Utilidad | Móvil | ≥768 | Uso |
| --- | --- | --- | --- |
| `text-display` | 44/48 | 52/56 (60/64 ≥1200) | solo la cifra protagonista de una pantalla, semibold |
| `text-screen-title` | 22/28 | 24/32 | título de pantalla fuera del marco: login, onboarding, setup, semibold |
| `text-title` | 17/24 | 18/24 | título de tarjeta u hoja, cifra clave, semibold |
| `text-body` | 16/22 | 15/22 | filas, formularios, botones |
| `text-callout` | 14/20 | 14/20 | texto secundario, labels, acciones de texto |
| `text-caption` | 12/16 | 13/16 | metadatos, ejes, etiquetas |

Los nombres viejos (`text-hero`, `text-headline`, `text-footnote`…) ya no existen. Tres tintas: `foreground`,
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
- **Grupos en tono**: `.tone-rows` (filas sueltas en tono, radio 12, separadas por 8 px) y
  `.sheet-group` (un solo bloque en tono, radio 12, para datos `dt/dd`). Un campo dentro de
  cualquiera de los dos pasa a superficie para no perderse en el tono.
- **Hojas y diálogos**: padding `--pad-sheet` (16 móvil, 24 escritorio), puesto por la base; el
  contenido no agrega el suyo.
- **Sombras**: `shadow-float` (lo que flota: menús, barra inferior), `shadow-sheet`, `shadow-panel`,
  `shadow-thumb` (la selección de un segmentado).
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
falta de `backdrop-filter` las dejan sólidas siempre. Los nombres heredados del vidrio
(`liquid-glass`, `material`, `.glass`, `--glass-*`, `--sheet*`, `--tab-active`…) se borraron.

**Barra superior móvil** (como G): avatar a la izquierda (abre la hoja «Tu cuenta»), el selector de
mes de una sola superficie al centro (flechas, mes y chevron que gira; abre la hoja «Elegir mes») y
la búsqueda a la derecha. Todo a 44 px con margen 16. El título de la vista queda solo para el
lector. **Barra inferior**: solo los destinos.

## Movimiento

- Press: `.press` (escala .98, 140 ms). Hover en tono.
- Menús y popovers nacen de su botón: 160 ms al entrar, 120 al salir. En móvil (<768) un selector
  (mes, día, fechas, día del mes, la cuenta) es una hoja desde abajo (`ResponsivePopover`).
- Chevron que gira 180° al abrir (`Chevron` de `components/finance/blocks.tsx`).
- Colapsables (`Collapsible`, `<details>`) con altura animada (200/160 ms).
- Cambio de pantalla: el contenido se desliza (React `<ViewTransition>`, `--nav-duration`); el marco
  queda quieto.
- `prefers-reduced-motion`: sin escalas, desplazamientos ni alturas animadas; solo fundidos.

## Accesibilidad

Contraste AA en los dos temas. Foco de teclado: anillo de 2 px en el acento, por dentro
(`outline-offset: -2px`) para que no cambie el tamaño ni lo recorte un contenedor; el botón primario
lo lleva por fuera. Controles de 44 px en táctil (`--ctl`), 36 con puntero fino.
