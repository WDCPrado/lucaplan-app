## ADDED Requirements

### Requirement: Tokens como única fuente de verdad

El design system SHALL definir todos los valores visuales (color, superficie, semánticos,
radius, glass) como variables CSS en `app/globals.css`, declaradas en `:root` (light) y `.dark`
(dark), y expuestas como utilidades Tailwind vía `@theme inline`. Los componentes MUST tirar de
esos tokens; NO se permiten valores `hex`/`oklch`/`px` sueltos en archivos `.tsx`.

#### Scenario: Componente usa token, no valor literal
- **WHEN** un componente necesita un color, superficie o radio
- **THEN** usa una utilidad Tailwind mapeada a un token (`bg-card`, `text-success`, `rounded-md`)
- **AND** no contiene ningún literal de color ni de radio en el `.tsx`

#### Scenario: Todo token existe en ambos modos
- **WHEN** se agrega o modifica una variable de color/superficie/glass
- **THEN** existe una definición correspondiente tanto en `:root` como en `.dark`

### Requirement: Paleta financiera rediseñada

La paleta SHALL rediseñarse de cero con criterio fintech (sobria, ordenada, sin colores
chillones). El primario, los neutros y los semánticos MUST elegirse para transmitir confianza y
priorizar la lectura de datos por encima de la decoración. Los nombres de token existentes
(`primary`, `secondary`, `muted`, `accent`, `success`, `warning`, `destructive`, `border`,
`input`, `ring`, `chart-1…5`) SHALL conservarse; solo cambian sus valores.

#### Scenario: Semánticos distinguibles
- **WHEN** se muestran estados positivo / advertencia / negativo
- **THEN** `success`, `warning` y `destructive` son visualmente distinguibles entre sí y del
  texto base en light y dark

#### Scenario: Series de gráfico diferenciables
- **WHEN** un gráfico usa `chart-1…5`
- **THEN** las cinco series son distinguibles entre sí en ambos modos

### Requirement: Esquinas casi rectas

El sistema SHALL usar `--radius: 0.25rem` como radio base (esquinas casi rectas, estilo
financiero). La escala derivada `radius-sm…4xl` SHALL recalcularse de forma consistente a partir
del nuevo valor base.

#### Scenario: Radio base aplicado
- **WHEN** un elemento usa `rounded-md`/`rounded-lg`
- **THEN** el redondeo resultante deriva de `--radius: 0.25rem` (esquinas nítidas, no blandas)

### Requirement: Tipografía para texto y análisis numérico

El sistema SHALL usar **IBM Plex Sans** como `--font-sans` (texto general) e **IBM Plex Mono**
como `--font-mono`. Los montos, precios y columnas numéricas MUST renderizarse con `font-mono` +
`tabular-nums` para alineación estable y lectura de análisis. El texto de cuerpo SHALL ser
≥16px con line-height 1.5–1.75. Las fuentes SHALL cargarse vía `next/font/google`.

#### Scenario: Montos con figuras tabulares
- **WHEN** se renderiza una columna de montos o precios
- **THEN** usa `font-mono` con `tabular-nums`, sin saltos de layout al cambiar dígitos

#### Scenario: Fuentes sin dependencias huérfanas
- **WHEN** se configuran las fuentes en `app/layout.tsx`
- **THEN** solo se importan IBM Plex Sans e IBM Plex Mono; no quedan imports de fuentes sin uso

### Requirement: Liquid glass como elevación

El sistema SHALL mantener el liquid glass (`.glass`, `.glass-strong`, controles frosted vía
`[data-slot=...]`, y los blobs ambientales del `body`) como mecanismo de elevación de superficies
flotantes. Sus tokens (`--glass-tint-1/2`, `--glass-border`, `--glass-shadow`, `--glass-blur`,
`--glass-control`/`--glass-control-active`) MUST recalibrarse a la nueva paleta para ser
coherentes con el look sobrio.

#### Scenario: Glass sobre fondo vívido
- **WHEN** se usa `.glass` en una superficie flotante
- **THEN** el efecto se aprecia sobre los blobs del `body` (translucidez + blur + borde)

#### Scenario: Controles frosted no rompen focus
- **WHEN** un `input`/`tabs` recibe el tratamiento frosted
- **THEN** solo se altera `background` + `blur`, nunca el borde, preservando focus ring y `aria-invalid`

### Requirement: Accesibilidad del sistema visual

El sistema SHALL cumplir contraste AA (≥4.5:1 para texto) en light y dark. El color NO SHALL ser
el único indicador de significado: montos y estados MUST acompañarse de signo o icono
(`color-not-only`). Bajo `prefers-reduced-transparency: reduce`, el glass SHALL desactivarse y
las superficies caer a `--card` sólido legible.

#### Scenario: Monto negativo no depende solo del color
- **WHEN** se muestra un monto negativo
- **THEN** lleva signo/icono además de `text-destructive`

#### Scenario: Reduced transparency
- **WHEN** el usuario activa `prefers-reduced-transparency: reduce`
- **THEN** `.glass`/`.glass-strong` y controles frosted pierden el blur y usan `--card` sólido

#### Scenario: Contraste AA en ambos modos
- **WHEN** se define un par texto/fondo con tokens
- **THEN** cumple ≥4.5:1 tanto en light como en dark
