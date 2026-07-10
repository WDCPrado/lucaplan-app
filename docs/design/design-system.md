# Design System — LucaPlan

Estilo: **fintech moderno y sereno, con liquid glass**. Esquinas suaves, neutros
slate fríos, primario azul vibrante. Light + dark emparejados.
Fuente de verdad: [app/globals.css](../../app/globals.css). No hardcodees valores en
componentes — siempre tira de estos tokens (variables CSS / utilidades Tailwind v4).

## Principios

- **Orden y confianza sobre decoración.** Primario **azul** (banca/fintech serio), neutros
  **slate** fríos, sin colores chillones. El **verde** se reserva para montos positivos
  (`success`), no es color de marca.
- **Datos primero.** Los números son el contenido: tipografía tabular y esquinas nítidas
  priorizan la lectura y el análisis por encima de la suavidad visual.
- **Glass con propósito.** El blur indica superficie elevada/flotante, no adorno
  (regla `blur-purpose`). Usa `.glass` en cards/paneles que flotan sobre el fondo.
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

## Liquid glass

El efecto depende de **dos cosas juntas**: un fondo con color (los blobs sutiles del
`body`) y superficies translúcidas que lo refractan. Sobre un fondo plano no se aprecia.

Tokens (light y dark): `--glass-tint-1` / `--glass-tint-2` (fill en gradiente, casi sólido),
`--glass-border` (hairline neutro), `--glass-shadow` (sombra corta y difusa — sin insets ni
brillos, que sobre fondo plano se ven como recortes), `--glass-blur`, y para controles
`--glass-control` / `--glass-control-active`.

- `.glass` — card/panel flotante: fill en gradiente + blur fuerte + borde + sombra con
  highlight superior. Úsalo en `<div>` (no en el `Card` de shadcn, cuyo `bg-card` ganaría).
- `.glass-strong` — más opaco, para contenido denso (tablas, formularios largos).
- **Controles** (`input`, `tabs-list`, `tabs-trigger` activo): frosted automáticamente vía
  selectores `[data-slot=...]` definidos **fuera de `@layer`** (para ganar a las utilidades
  de Tailwind). Solo tocan `background` + `blur`, nunca el borde, para no romper el focus
  ring ni `aria-invalid`.

Accesibilidad: bajo `prefers-reduced-transparency: reduce` el blur se desactiva y todo cae
a `--card` sólido (sigue legible). Ojo: **no** uses `prefers-reduced-motion` para esto
(es para animaciones) — apagaría el glass a cualquiera con efectos de animación reducidos.

## Forma y tipografía

- `--radius: 0.625rem` (esquinas suaves, look moderno y amigable); escala `radius-sm…4xl` derivada.
- Tipografía (cargada vía `next/font/google` en `app/layout.tsx`):
  - **Geist** (`--font-sans`) — UI y texto: moderna, neutra, muy legible en cuerpo pequeño.
  - **Space Grotesk** (`--font-heading`, utilidad `font-heading`) — headings y marca:
    la personalidad fintech de LucaPlan. Pesos 500–700.
  - **Geist Mono** (`--font-mono`) — cifras.
  - Cuerpo ≥16px, line-height 1.5–1.75.
- Cifras: montos/precios usan **`font-mono` + `tabular-nums`** (utilidad `.tabular` = mono +
  `tabular-nums slashed-zero`) para alineación estable y lectura de análisis.

## Dark mode

Conmuta con la clase `.dark` (vía `next-themes`). Todos los tokens —incluido el fondo
ambiental y el glass— tienen su variante. Diseña y prueba ambos modos juntos, no infieras
uno del otro.

## Cómo extender

1. ¿Color/valor nuevo? Agrégalo como variable en `:root` **y** `.dark` de `globals.css`.
2. Si quieres utilidad Tailwind (`bg-foo`), mapéala en `@theme inline` (`--color-foo: var(--foo)`).
3. Recién entonces úsalo en componentes. Nunca un hex/oklch suelto en un `.tsx`.
