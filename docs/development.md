# Desarrollo y contribución

Guía de trabajo dentro del repo, para personas y agentes. El contexto general (qué es Luca Plan,
stack, puesta en marcha, scripts, deploy) vive en el [README](../README.md); este documento cubre
solo **cómo se trabaja aquí**.

Los checks del PR deben pasar antes del merge. Al integrar en `master`, el webhook firmado de
GitHub dispara el auto-deploy nativo de Coolify. Sigue la [guía de Coolify](coolify.md).
Cerrar un PR sin merge no despliega. La app Dockerfile y PostgreSQL son recursos nativos separados;
se conservan los secretos y datos de Coolify. Usa backups nativos programados y un respaldo manual
verificado antes de migraciones destructivas.

## Flujo de trabajo

Por defecto se trabaja desde el pedido y el issue: entender el alcance, implementar, revisar y
verificar. No se crea una propuesta OpenSpec ni se exige aprobarla antes de implementar.
OpenSpec se usa **solo si Willy lo pide expresamente** para ese trabajo; un archivo del repo
o una tarjeta que lo mencione no activa ese flujo por sí solo.

Para un rediseño de UI, se muestran ejemplos visuales y se acuerda la dirección antes de
cambiar la interfaz. Después se construye la versión funcional y se verifica contra el pedido.

La documentación y los cambios históricos de OpenSpec siguen disponibles en
[openspec/README.md](../openspec/README.md) como referencia optativa.

## Next.js 16 — léelo antes de codear

Esta versión tiene breaking changes respecto a lo que conoces (APIs, convenciones,
estructura de archivos). **Antes de escribir código de Next, lee la guía relevante en
`node_modules/next/dist/docs/`** y respeta los avisos de deprecación. No asumas APIs de memoria.

## Arquitectura

La definición completa y la regla de dependencias están en
[arch/clean-architecture.md](../arch/clean-architecture.md). Resumen:

```
presentation (app/) → application → domain
infrastructure → domain   (implementa sus ports)
```

- **`arch/v1/domain`** — tipos + ports (interfaces repo) + errores de negocio. No importa de nadie.
- **`arch/v1/application`** — use-cases. Solo depende de `domain` (+ `@/arch/shared`). No toca IO.
- **`arch/v1/infrastructure`** — adapters que implementan los ports (Prisma, HTTP a terceros).
- **`app/`** — presentation: Route Handlers (`app/api/<feature>/route.ts`) y Server Actions
  son los entrypoints HTTP. Parsean request → invocan use-case → mapean a HTTP. Sin negocio.
- **`arch/shared`** — puro, sin negocio, cross-version.

Todo el backend (doc + código) vive en `arch/`; no hay carpeta `src/`. Dentro de
`arch/` los imports cross-capa van **relativos con `.ts`** (así los use-cases corren con
`node --test` sin framework; Node no resuelve `@/`). El alias `@/` es para la UI
(`@/components`, `@/lib`, `@/hooks`) y para cuando `app/` importa el backend.

## UI / frontend

- **La UI se construye con shadcn/ui + Base UI** (`components.json`, estilo `radix-maia`),
  Tailwind v4, `lucide-react`, `next-themes`. Respeta siempre esos primitivos; no
  introduzcas otra librería de componentes.
- **Componente que no existe → instálalo con el comando**, no lo escribas a mano:
  `pnpm dlx shadcn@latest add <componente>` → cae en `components/ui/`.
- **Siempre shadcn, nunca primitivos del navegador.** Prohibido `window.confirm/alert/prompt` y
  diálogos/notificaciones nativas. Usa los primitivos de shadcn: **AlertDialog** para
  confirmaciones (sobre todo acciones destructivas), **Dialog**/`ResponsiveModal` para contenido en
  modal, toast/sonner para avisos. Cualquier interacción modal, de confirmación o de aviso pasa por
  shadcn; si el componente no está, instálalo con el comando de arriba.
- **El estilo principal (tokens, colores, tipografía, radius, dark mode) se define en
  `app/globals.css`** (variables CSS de Tailwind v4). Es la fuente de verdad del diseño;
  no hardcodees valores en componentes, tira de esas variables. Detalle del design system
  (glassmorphism fintech, tokens, glass, dark/light) en [docs/design/design-system.md](design/design-system.md).
- **Responsividad obligatoria (mobile-first).** La experiencia primaria es **móvil**: una
  columna legible, acciones al alcance y modales adaptados al teléfono. En escritorio se
  aprovecha el ancho con sidebar fija y layout multi-columna. El shell vive en
  [components/finance/app-shell.tsx](../components/finance/app-shell.tsx) (shadcn `sidebar`,
  colapsable, drawer en móvil); las superficies contextuales usan
  [components/ui/responsive-modal.tsx](../components/ui/responsive-modal.tsx) (dialog en escritorio,
  drawer vaul con altura según el contenido y tope de 96dvh en móvil — **sin** `shouldScaleBackground`: escalar el fondo
  le pone un `transform` al wrapper y eso rompe todo `position: fixed` de la página, empezando por
  la barra de navegación inferior). Listas de chips/badges van en **scroll-x sin wrap**; fechas con **Calendar +
  Popover de shadcn**, nunca `<input type="date">`. Escala **hacia abajo** con breakpoints
  (`sm`/`md`/`lg`): en móvil el shell colapsa a drawer y el contenido se apila en una columna.
  Reglas mínimas (en ambos extremos): sin scroll horizontal; `min-h-dvh` (no `100vh`); targets
  táctiles ≥44px (`h-11`) y texto ≥16px (`text-base`) en móvil para evitar zoom de iOS;
  contenedores con `max-w-*`; prueba en escritorio (~1440px) y en ~375px, y en dark + light.
- Evita `useEffect` para lógica de otra capa (auth/redirects → proxy; errores de red →
  capa fetch; estado derivado → calcular en render; datos iniciales → server component).

### Formas y uso de componentes

Reglas copiadas del front de sdi-estoril (`apps/web`), que es la referencia de forma. Los
colores siguen siendo los de Luca Plan; lo que se copia es cómo se usan los componentes.
Rigen para todo lo nuevo; un formulario o modal existente se adapta cuando se toca, no en
un barrido aparte.

- **shadcn es la fuente de verdad; `components/ui/` solo se toca para los radios.** Los primitivos
  llevan la jerarquía de radios de abajo aplicada a mano: al reinstalar uno con `shadcn add`,
  volver a aplicarla. Nada más se edita ahí. Lo reutilizable
  se compone encima, en `components/<carpeta>/` (`finance/`, `landing/`, `pwa/`): un
  componente propio envuelve a los primitivos, nunca los reemplaza. Una excepción documentada:
  `responsive-modal.tsx`, que es composición de Dialog y Drawer.
- **Tokens, no valores.** Color, fuente, radio y espaciado salen de `app/globals.css`, en los
  dos temas. Un color nuevo es un token nuevo, no un hex en `className`.
- **Radio sobrio, con jerarquía de tres niveles** (`--radius: 0.625rem`):
  `rounded-lg` para controles (botones, inputs, selects, chips, filtros, botones de icono);
  `rounded-xl` para superficies (tarjetas, paneles `glass`, secciones, modales, drawers,
  popovers); `rounded-md` para ítems de lista y de menú. `rounded-full` solo en lo que es un
  círculo o una barra por significado: avatares, anillos de icono, puntos de estado, barras de
  progreso, el marcador del día, badges de conteo y los controles flotantes de vidrio (cápsulas y círculos de la navegación y la toolbar). Nada de `rounded-2xl`/`3xl`/`4xl`
  en controles ni paneles.
- **Las alturas no cambian con el radio**: targets táctiles ≥44 px (`h-11`) en móvil, como dice
  la sección de responsividad.
- **Modales, dos tipos y nada más.** `ResponsiveModal` para crear, editar o mostrar contenido
  (dialog en escritorio, drawer en móvil); `AlertDialog` para confirmar una acción al momento.
  En escritorio los modales de contenido tienen X arriba; en móvil **no llevan X**: el drawer
  se cierra por arrastre o tocando el fondo, sin un «Cerrar» ni «Listo» que repita eso. Las
  confirmaciones se resuelven con sus botones. Las acciones se declaran con `ModalActions`
  (`primary`, `cancel`): en móvil van en el encabezado de la hoja como en iOS («Cancelar» a la
  izquierda, la primaria en azul a la derecha) y en escritorio en el pie; el botón que envía va
  con `form="<id>"` del `<form>` del modal. `ModalFooter` solo existe en escritorio. Borrar va
  en `ModalDangerRow`, una fila roja al final del contenido, nunca junto a la primaria. Las
  secciones de un modal son grupos al estilo Ajustes (`ModalSection`). Convertir un movimiento
  en recurrente o cuota son filas con chevron de una lista agrupada. Las etiquetas pueden envolver y conservan ≥44px de alto.
  **Ancho en escritorio, una escala y nada inventado por modal:** contenido (formulario,
  detalle, lista) hereda el default de `ResponsiveModal`, `sm:max-w-2xl`, sin pasar
  `className`; denso (varias columnas, como el de cuenta) sube a `sm:max-w-3xl`; un solo campo
  o un aviso de dos líneas baja a `sm:max-w-md`, porque estirado se ve vacío; una confirmación
  (`AlertDialog`) queda angosta con su default. Ojo en móvil: el `className` sí llega al drawer, pero el default de
  ancho no, porque vive solo en el diálogo de escritorio; el drawer conserva su altura según el contenido, con tope de 96dvh.
- **Modales anidados.** El padre permanece abierto y montado; el hijo se compone dentro de su
  árbol React, con su formulario fuera del formulario del padre. `ResponsiveModal` asigna una
  identidad por instancia y registra padre/profundidad; usa la raíz anidada de Vaul en móvil.
  Cerrar, Cancelar, Esc y el fondo cierran solo el hijo y devuelven el foco al padre. Los cierres
  después de una escritura exitosa tienen callbacks propios, separados de `onOpenChange`.
  Los formularios y sus botones de envío usan IDs por instancia; las demás acciones llevan
  `type="button"`. Toda superficie modal pasa por `ResponsiveModal`.
- **Formularios.** Un `<form id>` por sección; error de cada campo debajo del campo con
  `aria-invalid` y `aria-describedby`; Guardar manda solo lo que cambió y queda deshabilitado
  sin cambios. Dinero con `useMoneyInput`/`formatCLP`, nunca `type="number"` ni formato a mano.
  Fechas con Calendar + Popover; enums con `Select`.
- **Un componente de campo no hace fetch ni muta**: recibe valores y callbacks. La mutación
  vive en quien abre el modal, y el modal se cierra en el éxito, nunca antes.

### Lenguaje visual: iOS y Liquid Glass

La app sigue el lenguaje de iOS 26 en móvil y de macOS 26 en escritorio (WDC-147). Es una
dirección de diseño, no una conversión a SwiftUI: se toman de Apple la jerarquía, las
agrupaciones, la tipografía y los controles.

- **Skills de referencia, obligatorias al tocar UI de la app:** `apple-hig` (las Human Interface
  Guidelines completas, por componente) y `apple-design` (revisión de diseño contra la HIG), las
  dos declaradas en `skills-lock.json`; se restauran con `npx skills experimental_install`. Para
  anti-slop y escaneabilidad manda `impeccable`. La landing no sigue estas reglas.
- **Cada elemento tiene un propósito.** Todo botón, texto, ícono, color, borde, badge o sección
  responde a qué decisión o acción de la persona sirve. Si no sirve ninguna o repite algo que ya
  está, se quita o se funde; si sirve, su peso visual corresponde a su importancia. Quitar va antes
  que agregar.
- **Materiales (apple-hig `foundations/materials`, `color`, `components/scroll-views`).** Todo sale
  de los tokens y utilidades de `app/globals.css`; ningún componente pone su propio blur o fondo.
  - **Liquid Glass (`liquid-glass`) solo en la capa de controles y navegación**: fila superior y
    barra de pestañas en móvil, sidebar y topbar en escritorio, cápsulas y botones flotantes. Nunca
    en el contenido (tarjetas, listas, hojas), que va sólido en `card` sobre el fondo agrupado.
    Variante regular (desenfoque + luminosidad), sin «clear». Lo grande (sidebar) un poco más opaco
    que lo chico, pero reutiliza `liquid-glass` para el mismo acabado. La base es CSS compatible con
    Safari, Firefox y Chrome: desenfoque de 16 px, saturación moderada (120 %), relleno neutro,
    reflejo localizado arriba-izquierda y un eco menor abajo-derecha (`::before` cónico), rim
    interior (`--glass-rim`), contorno de 0.5 px y sombra. No hay una línea brillante continua.
  - **Sin motor de refracción (WDC-174).** El acabado usa sólo CSS: no hay filtros SVG sobre el
    contenido, clones ni seguimiento continuo. Se retiraron Glisse y el motor anterior para
    recuperar la composición estable en Safari móvil. Tabs y búsquedas usan enlaces/botones/
    inputs nativos; Select, menús, sliders y modales conservan los contratos accesibles de Radix/Vaul.
  - **Movimiento del vidrio**: `liquid-squish` encoge la cápsula al 97 % al presionarla (ella o un
    control suyo con `data-squish`) y vuelve con un spring (`linear()`, con `cubic-bezier` de respaldo). Solo CSS,
    interrumpible, y nada con movimiento reducido.
  - **Cambio de pantalla** (React `<ViewTransition>` en `AppShell`, clase `nav`): solo el contenido
    se desliza un poco (24 px en móvil, 14 px en escritorio) y funde; el marco (sidebar, topbar,
    fila superior, barra de pestañas) tiene nombre propio y queda quieto. La dirección sale de
    `lib/nav-direction.ts` (orden de `NAV` y profundidad de la ruta) y la deja `data-nav-dir` en
    `<html>` antes de navegar, también con el atrás del navegador: móvil siempre horizontal;
    escritorio, entre links del sidebar en vertical y entrar/volver en horizontal. Dentro de la
    misma ruta (mes, `?tx=`) no anima. La pastilla activa de las pestañas (`.tab-pill`) y la del
    sidebar (`.nav-pill`) se deslizan con la misma `--nav-duration`/`--nav-ease`. Con movimiento
    reducido solo queda el fundido y las pastillas saltan.
  - **Material regular (`--material`)** para lo que lleva texto encima del contenido:
    menús, select, popover, tooltip, toasts, alertas y el aviso de refresco de la PWA. Más opaco que
    el vidrio de las barras, con la misma saturación moderada; la utilidad `material` concentra la
    receta. Los toasts de estado conservan su color semántico. Las hojas van sólidas (`--sheet`).
  - **Color con moderación**: el vidrio no tiene color propio; textos e íconos encima van en
    `foreground`. La pestaña móvil activa y el link activo del sidebar llevan el mismo fondo azul
    (`--glass-tab-active`) con `--glass-active-shadow`, sin vidrio adicional dentro del vidrio; en
    el sidebar el ícono y el texto del activo van además en `primary`. Hover y press sobre el
    vidrio son un velo de `foreground` (5 % y 10 %), no el gris sólido `--sidebar-accent`.
  - **Scroll edge effect** (`scroll-edge-top`) queda solo detrás de la topbar de escritorio:
    un velo tenue (`--scroll-edge-amount`, 22 % por defecto y proporcional al nivel de vidrio),
    desenfoque leve (`--scroll-edge-blur`, 4 px) y fundido largo. En móvil el desenfoque queda
    dentro de las cápsulas, sin franjas a ancho completo alrededor de los controles.
  - **Concentricidad**: lo que va dentro de una barra o cápsula usa el radio externo menos el
    margen (`--radius-bar-inner` en la topbar y el sidebar; `rounded-full` dentro de cápsulas).
  - Con `prefers-reduced-transparency` todo material cae a sólido, sin desenfoque ni reflejo;
    con `prefers-contrast: more` gana relleno y contorno, también en la selección activa. Ambas
    preferencias apagan el reflejo por token, incluso en variantes responsive y en el sidebar.
    Sin soporte de `backdrop-filter`, el relleno cae a sólido.
  - **Nivel del vidrio** (Ajustes → Apariencia): un slider de 5 pasos, de «Transparente» (el vidrio
    más translúcido) a «Teñido» (casi sólido), ajusta el relleno de `--glass-fill` y
    `--glass-fill-large` con `--glass-clear` (65 %, 40 %, 20 %, 0 %, 0 %), y desde el nivel 3 los
    lleva junto a `--material` hacia `--card` con `--glass-tint` (30 % y 75 %). El desenfoque se
    mantiene en los cinco pasos para separar las letras del fondo de los controles; solo la
    preferencia de reducir transparencia lo apaga. `data-glass` vive en `<html>`. Es por usuario, en la base junto
    con el tema (`user_setting`, `PATCH /api/user-settings`); el layout de `app/(app)` la lee en el
    servidor y un script la aplica a `<html>` antes del primer pintado (`lib/appearance.ts`). Los
    cambios se ven al instante y, si el guardado falla, vuelven al valor guardado. Los valores
    viejos de localStorage (`glass-level`, `theme`) se suben una sola vez por dispositivo, solo si
    el usuario aún está en los valores por defecto. Las rutas públicas no la usan. Las dos
    preferencias del sistema de arriba siguen ganando.
- **Navegación flotante, sin barras a lo ancho**: en móvil, arriba una sola fila: a la izquierda
  el título de la vista (`text-headline` en negrita; sale del mapa de rutas `NAV` y es el `h1` de la
  página en móvil, las vistas no traen el suyo) y el resto para las acciones de la vista (el
  selector de mes `MonthNav`). En las vistas sin selector, el marco pone el mismo `MonthNav`
  deshabilitado con el período en curso (también junto al título de la topbar de escritorio), así
  la fila es igual en todas y no salta al navegar. Con el primer scroll el título se va (fundido y
  leve desplazamiento a la izquierda) y el selector se corre y se ensancha hasta llenar la fila;
  al volver arriba, al revés (`.top-title`, 280 ms, una transición de `grid-template-columns`
  disparada por IntersectionObserver; sin movimiento con `prefers-reduced-motion`). Al navegar el
  título cambia con un fundido corto. El vidrio queda dentro de cada cápsula. La pestaña
  activa no cambia de peso: la marca su pastilla. La cuenta (perfil, tema, cerrar sesión) vive en
  Ajustes. Las dos barras viven en el layout (`AppFrame`) y no se desmontan al navegar; la vista
  inyecta sus acciones por portal. Abajo, una cápsula con las pestañas (la activa con pastilla) y
  la búsqueda global en un círculo suelto a la derecha, en todas las vistas, pegadas al borde del
  teléfono como la tab bar de iOS 26: `--tab-bar-inset` (safe area − 12 px, mínimo 8 px) la deja
  casi concéntrica con la esquina y con el home indicator debajo. En escritorio, sidebar y topbar
  flotantes de la misma familia (mismo margen, radio y vidrio); la topbar lleva el título y la
  búsqueda global en todas las vistas. Crear un movimiento no está en la navegación: entran desde
  el correo del banco. Todo respeta `env(safe-area-inset-*)` y el contenido deja aire para no
  quedar tapado (`5rem + --tab-bar-inset` abajo).
- **Listas agrupadas («inset grouped»)**: secciones en tarjetas con filas de ≥44 px, separadores
  finos con inset desde el texto (`.inset-list`), chevron cuando la fila abre algo y la acción de la
  sección en texto azul a la derecha del encabezado. Las superficies se separan por el fondo, no
  por bordes ni sombras.
- **Tipografía de la escala de iOS**, nunca tamaños sueltos: `text-large-title`, `text-hero` (la
  cifra protagonista), `text-title-1`, `text-title-3`, `text-headline`, `text-body`,
  `text-subheadline`, `text-footnote`, `text-caption`. Un tamaño nuevo se registra también en
  `lib/utils.ts` o `cn()` lo confunde con un color. Los montos van con `.tabular`.
- **Menús, popovers y selects siguen el tema** (claro en claro): nada de `dark` fijo en un
  primitivo. El toque da respuesta con `.press`, y el movimiento respeta
  `prefers-reduced-motion`.

## Flujo de creación de UI / mocks

Método para construir vistas nuevas (síguelo siempre):

1. **Construir en código primero, no en Figma.** React/Next + shadcn/ui + tokens de
   `app/globals.css`. **El mock debe ser FUNCIONAL, no una pantalla estática**: client components
   con estado (`useState`), navegación real entre vistas, y acciones que responden (botones,
   formularios, filtros). La idea es validar el comportamiento, no solo el aspecto. Datos mock en
   memoria.
2. **Vive en `app/design/`.** Cada vista mock en `app/design/<slug>/page.tsx`; regístrala
   en el índice `app/design/page.tsx`. La home (`app/page.tsx`) queda limpia — **no mezcles
   mocks con la app real**.
3. **Verifica con `lint` y `typecheck`, y entrega.** No levantes `pnpm dev` ni tomes screenshots
   para "comprobar" la vista: la revisión visual la hace el usuario en el entorno de PR, que es
   donde la va a mirar igual. Escribe mobile-first y adapta escritorio (~420px / ~1440px) por
   criterio, no verificándolo a mano.
4. **Itera en código** hasta que el usuario apruebe ("me gustó").
5. **Pasar a Figma solo si es necesario y si el usuario lo pide.** Recién cuando lo apruebe,
   trasladar la vista al archivo Figma (página `Screens`) usando las variables/tokens del
   design system. Vínculo del archivo Figma en `figma.json`.

### Notas de verificación

La implementación incluye un entorno local del worktree con base aislada y datos demo.
Entrega su URL desde que esté disponible, sin esperar un pedido adicional.

- **Mantén disponible el entorno de revisión** mientras la rama o el PR estén en curso.
  Usa puertos propios del issue para no ocupar los del checkout del usuario. Al limpiar el
  worktree se apagan sus procesos y su base; cerrar el turno no cierra el entorno de revisión.
- **Turbopack + rutas nuevas:** crear o borrar carpetas de ruta en `app/` con el dev server
  corriendo puede corromper el caché incremental de Turbopack (panic
  `directory_tree_to_loader_tree` → recarga en bucle en `/login` u otras). Si pasa: mata el
  server, `rm -rf .next` y reinicia. Mejor: crea la carpeta de la ruta **antes** de levantar el
  server.

## Antes del PR

```bash
pnpm lint && pnpm typecheck && pnpm test
DATABASE_URL='postgresql://build:build@127.0.0.1:5432/build?schema=public' NEXT_PUBLIC_LANDING_ONLY=true pnpm build
```

`pnpm test` corre `node --test` sobre los tres directorios que tienen tests (`arch/`, `lib/` y
`scripts/`). Antes el glob iba escrito a mano y solo cubría `arch/`: los de `lib/` y `scripts/` no
los corría nadie.

Las tres son estáticas: **ninguna necesita Postgres**. El entorno local de revisión sí usa una
base aislada y el mismo seed demo que el PR; aplica sus migraciones y siembra sus datos al
preparar el worktree. Railway construye su propia imagen y base al publicar el PR.

CI también ejecuta el build con Node 24, igual que Docker; el placeholder no conecta a Postgres.
La regresión de planes por modo se ejecuta con `node scripts/verify-plan-modes.ts`.
Crea y elimina su propio contenedor PostgreSQL 17 de Docker, aplica todo el historial de
migraciones con datos anteriores al cambio y verifica backfill, rollback transaccional,
independencia de planes y generación concurrente de un solo cobro. Ignora `DATABASE_URL`
externa y no usa datos reales.
Las fuentes viven en `app/fonts/` con sus licencias y se cargan con `next/font/local`, sin
descargas de Google Fonts durante la compilación.

El pedido de implementar autoriza preparar dependencias y configuración demo del worktree.
Publica según las reglas globales de Git; pedir el enlace de revisión cuenta como OK para abrir
el PR. Las operaciones destructivas y los cambios de secretos reales requieren autorización.

### Sembrar los datos de la feature

Hay **una sola cuenta demo**, `demo@lucaplan.cl`, con toda la data: la siembra `scripts/seed.ts` en
la base vacía de cada entorno de PR y en la local (`pnpm setup:db` o `pnpm seed`)
([detalle en el README](../README.md#railway-entornos-de-pr-con-datos-falsos)). Una feature que
necesite datos que ahí no existen no se puede revisar: hay que agregarlos a esa cuenta.

El seed se separa en dos, y el orden lo declaran las listas de `scripts/seed/orden.ts` (el seed
aborta, y su test falla, si hay un archivo fuera de ellas o falta uno declarado):

- `scripts/seed/produccion/` — lo que debe existir en todo entorno (catálogos fijos): `upsert` que
  no pisa, sin `delete`. Hoy no tiene archivos.
- `scripts/seed/demo/` — la cuenta demo, solo fuera de producción y siempre después de
  producción. `1-base/cuenta-demo.ts` crea el usuario, sus cuentas, categorías, presupuesto,
  movimientos, recurrentes y cuotas; `2-casos/` tiene un archivo por dominio (`presupuesto.ts`,
  `recurrentes.ts`, `cuentas.ts`, `cuotas.ts`, `conciliacion.ts`, `correo.ts`, `plugin.ts`), que
  recibe el contexto de la base (`prisma`, `userId`, `checkingId`, `creditCardId`, los buckets de
  la tarjeta y el mapa nombre → id de las categorías).

Reglas:

- **Un PR no crea un archivo por escenario**: agrega o corrige casos en el archivo de su dominio.
  Un dominio nuevo trae su archivo, declarado en la lista.
- **Montos fijos**: el número que siembras es el que va escrito en el guion de prueba.
- **Filtra SIEMPRE por `userId`** en cada query: el `prisma` es el cliente normal, sin límite por
  usuario.
- **Nada de datos reales ni secretos**: el entorno de PR es público.
- **Pruébalo antes de abrir el PR** contra una base local: `SEED_DEMO_FORCE=1 pnpm seed` rehace la
  cuenta demo desde cero. Si un caso falla en Railway, el seed lo registra y sigue con los demás —el
  deploy no se cae— pero ese queda sin sus datos.

### Entrar en local y en el entorno de PR

La cuenta demo entra con `demo@lucaplan.cl` y **`000000`**, sin correo, en dos lugares: en local con
`pnpm dev` (`NODE_ENV=development` exacto y sin `RAILWAY_ENVIRONMENT_NAME`) y en un entorno de PR de
Railway (`…pr-<n>`, solo datos sembrados). Nunca en producción. Cualquier otra cuenta recibe su
código aleatorio por correo, también en local y en PR. No depende de Next (`next start` solo pone
`production` si `NODE_ENV` viene vacío): lo cierran `devLoginCode` y que sea la cuenta demo
(`arch/v1/infrastructure/auth/login-code.ts`).

## Convenciones

| Capa           | Archivo                                |
| -------------- | -------------------------------------- |
| domain         | `<feature>.domain.ts`                  |
| application    | `<verbo>-<feature>-use-case.ts`        |
| infrastructure | `<feature>.infrastructure.ts`          |
| presentation   | `app/api/<feature>/route.ts` (Next.js) |
