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
  (tokens, escala, radios, dark/light) en [docs/design/design-system.md](design/design-system.md).
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

Rigen para todo lo nuevo; una pantalla existente se adapta cuando se toca.

- **shadcn es la base y `components/ui/` lleva el sistema de controles.** Los primitivos ya vienen
  reestilados (WDC-188): botón, input, textarea, select, segmentado, tabs, switch, slider, menús,
  popover, diálogo, hoja, alerta, sonner, calendar. No se les cambia la API; al reinstalar uno con
  `shadcn add`, se le vuelve a aplicar el sistema (radio 8, alto `--ctl`, relleno de tono, foco
  interior, tipografía de la escala). Lo reutilizable se compone encima, en
  `components/<carpeta>/` (`finance/`, `landing/`, `pwa/`); `responsive-modal.tsx` es la
  composición documentada de Dialog y Drawer.
- **Piezas de pantalla** (`components/finance/blocks.tsx`, solo presentación): `SectionCard`
  (tarjeta con título a la izquierda, acción a la derecha y línea clave), `SectionAction`,
  `KeyLine`, `ListRow` + `IconTile` (fila de 56 px con icono de 36, título, meta, valor y chevron),
  `InlineNotice` (aviso a ancho completo), `ProgressBar` (gastado + comprometido + exceso),
  `StatTile` y `Chevron` (gira al abrir). Una pantalla las usa antes de inventar las suyas.
- **Tokens, no valores.** Color, fuente, tamaño, radio y espaciado salen de `app/globals.css`, en
  los dos temas ([design-system.md](design/design-system.md)). Un color nuevo es un token nuevo.
- **Controles: un sistema.** Un alto (`h-(--ctl)`: 44 táctil, 36 con puntero fino), radio 8, el
  foco por dentro sin cambiar el tamaño. Botón primario en acento; secundario en tono; `outline` con
  filete sobre superficie (los de la barra superior); `ghost` en tinta 2; `destructive` en óxido
  suave; `link` es la acción de texto verde. Campos rellenos de tono, sin borde. Un selector
  exclusivo de pocas opciones es `Segmented` (una superficie de tono con el elegido en superficie),
  también Gasto/Ingreso, sin colorear la selección. Nunca `<input type="range">` ni
  `<input type="date">`.
- **Tarjeta** (`SectionCard`): superficie, radio 16, padding `--pad-card` (16 móvil, 24 escritorio).
  Encabezado en una fila: título en tinta 2 a la izquierda y su acción (texto verde) a la derecha;
  debajo, la línea clave (la cifra en tinta primaria y su contexto en callout), luego el contenido.
  Dentro, las filas se separan por `gap-2`, no por líneas; un grupo dentro de la tarjeta va en tono
  (`.sheet-group`, radio 12).
- **Avisos en línea** (`InlineNotice`): fila a ancho completo de 44 px en tono suave (ámbar, óxido o
  verde). Nunca una píldora suelta. Las etiquetas (`Badge`) son de 24 px, radio 8, en tono.
- **Modales, dos tipos y nada más.** `ResponsiveModal` para crear, editar o mostrar (diálogo de
  radio 24 en escritorio, hoja desde abajo en móvil con encabezado fijo y scroll interno);
  `AlertDialog` para confirmar al momento. Se cierran con la X, Esc, el fondo y, en móvil,
  arrastrando. Las acciones se declaran con `ModalActions` (`primary`, `cancel`): en móvil van en el
  encabezado de la hoja como botones de 44 px (Cancelar en tono con X; la primaria en acento con ✓,
  en tono mientras no se puede); `plain` es una acción de texto que no confirma (Importar,
  Conectar) y `icon` un botón de ícono con su texto como nombre accesible. En escritorio van en el
  pie (Cancelar en `secondary`, la primaria rellena). La primaria queda deshabilitada sin cambios y
  con `busy` mientras guarda. El botón que envía lleva `form="<id>"`. Borrar va en
  `ModalDangerRow`, al final del contenido, nunca junto a la primaria. Las secciones son
  `ModalSection` (título callout en tinta 2, grupo en tono y pie en caption).
  **Ancho en escritorio**: contenido hereda `sm:max-w-2xl`; denso, `sm:max-w-3xl`; un campo o un
  aviso corto, `sm:max-w-md`; la confirmación, su default. En móvil la hoja toma la altura del
  contenido con tope de 96dvh.
- **Modales anidados.** El padre sigue abierto y montado; el hijo se compone dentro de su árbol,
  con su formulario fuera del del padre. Cerrar, Esc y el fondo cierran solo el hijo y devuelven el
  foco al padre. Los cierres tras una escritura exitosa tienen callbacks propios. Formularios y
  botones de envío con IDs por instancia; las demás acciones, `type="button"`.
- **Formularios.** Un `<form id>` por sección; error de cada campo debajo con `aria-invalid` y
  `aria-describedby`; Guardar manda solo lo que cambió. Dinero con `useMoneyInput`/`formatCLP`,
  nunca `type="number"`. Fechas con Calendar + Popover; enums con `Select`.
- **Un componente de campo no hace fetch ni muta**: recibe valores y callbacks. La mutación vive en
  quien abre el modal, que se cierra en el éxito, nunca antes.

### Lenguaje visual: Finanzas en calma

Tokens, escala, radios, nivel de Apariencia y movimiento: [design-system.md](design/design-system.md).
Para anti-slop y escaneabilidad manda la skill `impeccable` (modo Operate). La landing
(`components/landing/`) comparte tipografía y tokens con la app.

- **Cada elemento tiene un propósito.** Todo botón, texto, ícono, color o sección responde a qué
  decisión o acción sirve; si no sirve o repite algo, se quita. Quitar va antes que agregar.
- **Móvil primero (390/360).** Margen lateral 16, filas de 56–64 px, controles de 44, montos que no
  se parten, sin scroll horizontal. Escritorio desde 768 con sidebar; la página usa
  `page-container` (tope 1520, padding 32).
- **Marco** (`components/finance/app-shell.tsx`, vive en el layout y no se desmonta al navegar):
  - Escritorio: sidebar en el papel con un filete interior; el ítem activo en superficie con un
    filete fino; el menú de la cuenta (perfil, tema, instalar, cerrar sesión) nace de su botón al
    pie. Barra superior pegada de 64 px con fondo de papel, alineada al contenido: botón del
    sidebar, título, selector de mes (`MonthNav`, una sola superficie: flechas, el mes al centro que
    abre `MonthPicker` y «Hoy» cuando no es el mes en curso) y la búsqueda (`/` o Ctrl K) a la
    derecha. Con scroll gana un filete abajo. El tema no va en la barra.
  - Móvil: barra superior pegada con fondo propio (`float`) y un desvanecido debajo: avatar que abre
    el menú de la cuenta, título de la vista (se recoge con el primer scroll y el selector se
    ensancha) y el selector de mes. En las vistas sin selector va el mismo deshabilitado con el
    período en curso. Abajo, la barra flotante redondeada con las pestañas (la elegida en tono, que
    se desliza) y la búsqueda en un círculo a la derecha, con el fondo desvanecido detrás. Todo
    respeta `env(safe-area-inset-*)`; el contenido deja aire abajo.
  - Cambio de pantalla: solo el contenido se desliza un poco y funde (`<ViewTransition>`,
    `lib/nav-direction.ts`, `data-nav-dir`); el marco tiene nombre propio y queda quieto.
- **Listas**: filas `ListRow` separadas por espacio; chevron solo cuando la fila abre algo. El
  encabezado de un grupo (el día en Movimientos) va en caption, tinta 3. En una fila de movimiento
  el monto va en body semibold (ingreso en `text-success`).
- **Íconos**: `lucide-react`, 20 px en barras y filas, 16 junto a callout. Junto a texto semibold el
  trazo sube solo (`globals.css`). El chevron de una fila que abre algo es `disclosure` o `ListRow
  chevron`.
- **Menús, popovers y selects siguen el tema**: nada de `dark` fijo en un primitivo.

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

### Entornos de PR en Railway con datos falsos

Al arrancar, la imagen aplica las migraciones y corre `scripts/seed.ts`. La cuenta demo
(`demo@lucaplan.cl`) solo se siembra en un entorno de PR de Railway (`RAILWAY_ENVIRONMENT_NAME`
termina en `pr-<número>`; Railway inyecta esa variable sola y nombra así los entornos efímeros, o
`lucaplan-app-pr-<n>` cuando el proyecto tiene varios servicios) o en local con
`NODE_ENV=development` contra una base en `localhost` (`pnpm seed`, `pnpm setup:db`). En producción
y en Docker Compose se salta sin tocar la base. No hay nada que configurar.

| Variable          | Default            | Para qué                                                    |
| ----------------- | ------------------ | ----------------------------------------------------------- |
| `SEED_PR_EMAIL`   | `demo@lucaplan.cl` | Correo de la cuenta demo en el entorno del PR               |
| `SEED_DEMO_FORCE` | —                  | `1` borra los datos de la cuenta demo y la vuelve a sembrar |

Es idempotente: si la cuenta demo ya tiene datos, los redeploys del PR no la tocan (lo que
probaste sigue ahí). Hay **una sola cuenta demo** con toda la data, no una por PR: 2 cuentas con
cupos separados por moneda y la corriente usando su sobregiro, categorías con y sin tope,
presupuesto distinto por modo (calendario y ciclo de tarjeta), sueldo, movimientos del mes en curso
y del anterior (que cerró por sobre el tope), recurrentes en sus tres estados más un arriendo por
cobrar, planes de cuotas (tarjeta con una cuota vencida sin saldar y crédito de consumo), un
reembolso, cargos para conciliar la tarjeta, el banco conectado por correo y una conexión del
plugin.

### Sembrar los datos de la feature

Hay **una sola cuenta demo**, `demo@lucaplan.cl`, con toda la data: la siembra `scripts/seed.ts` en
la base vacía de cada entorno de PR y en la local (`pnpm setup:db` o `pnpm seed`)
([cómo se siembra en Railway](#entornos-de-pr-en-railway-con-datos-falsos)). Una feature que
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
