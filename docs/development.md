# Desarrollo y contribución

Guía de trabajo dentro del repo, para personas y agentes. El contexto general (qué es Luca Plan,
stack, puesta en marcha, scripts, deploy) vive en el [README](../README.md); este documento cubre
solo **cómo se trabaja aquí**.

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
- **Radio sobrio, con jerarquía de tres niveles** (`--radius: 0.5rem`):
  `rounded-lg` para controles (botones, inputs, selects, chips, filtros, botones de icono);
  `rounded-xl` para superficies (tarjetas, paneles `glass`, secciones, modales, drawers,
  popovers); `rounded-md` para ítems de lista y de menú. `rounded-full` solo en lo que es un
  círculo o una barra por significado: avatares, anillos de icono, puntos de estado, barras de
  progreso, el marcador del día, badges de conteo y el "+" de la barra inferior. Nada de `rounded-2xl`/`3xl`/`4xl`
  en controles ni paneles.
- **Las alturas no cambian con el radio**: targets táctiles ≥44 px (`h-11`) en móvil, como dice
  la sección de responsividad.
- **Modales, dos tipos y nada más.** `ResponsiveModal` para crear, editar o mostrar contenido
  (dialog en escritorio, drawer en móvil); `AlertDialog` para confirmar una acción al momento.
  Los dos cierran por X arriba y botón en el pie, además de Esc y fondo. El pie lleva las
  acciones (`ModalFooter`); el botón que envía va con `form="<id>"` del `<form>` del modal.
  **Ancho en escritorio, una escala y nada inventado por modal:** contenido (formulario,
  detalle, lista) hereda el default de `ResponsiveModal`, `sm:max-w-2xl`, sin pasar
  `className`; denso (varias columnas, como el de cuenta) sube a `sm:max-w-3xl`; un solo campo
  o un aviso de dos líneas baja a `sm:max-w-md`, porque estirado se ve vacío; una confirmación
  (`AlertDialog`) queda angosta con su default. El triage a pantalla completa es la única
  excepción (`max-w-none`). Ojo en móvil: el `className` sí llega al drawer, pero el default de
  ancho no, porque vive solo en el diálogo de escritorio; el drawer conserva su altura según el contenido, con tope de 96dvh.
- **Modales anidados.** El padre permanece abierto y montado; el hijo se compone dentro de su
  árbol React, con su formulario fuera del formulario del padre. `ResponsiveModal` asigna una
  identidad por instancia y registra padre/profundidad; usa la raíz anidada de Vaul en móvil.
  Cerrar, Cancelar, Esc y el fondo cierran solo el hijo y devuelven el foco al padre. Los cierres
  después de una escritura exitosa tienen callbacks propios, separados de `onOpenChange`.
  Los formularios y sus botones de envío usan IDs por instancia; las demás acciones llevan
  `type="button"`. El diálogo de triage a pantalla completa usa `ModalScope` para conservar
  la misma jerarquía sin cambiar su superficie.
- **Formularios.** Un `<form id>` por sección; error de cada campo debajo del campo con
  `aria-invalid` y `aria-describedby`; Guardar manda solo lo que cambió y queda deshabilitado
  sin cambios. Dinero con `useMoneyInput`/`formatCLP`, nunca `type="number"` ni formato a mano.
  Fechas con Calendar + Popover; enums con `Select`.
- **Un componente de campo no hace fetch ni muta**: recibe valores y callbacks. La mutación
  vive en quien abre el modal, y el modal se cierra en el éxito, nunca antes.

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
```

`pnpm test` corre `node --test` sobre los tres directorios que tienen tests (`arch/`, `lib/` y
`scripts/`). Antes el glob iba escrito a mano y solo cubría `arch/`: los de `lib/` y `scripts/` no
los corría nadie.

Las tres son estáticas: **ninguna necesita Postgres**. El entorno local de revisión sí usa una
base aislada y el mismo seed demo que el PR; aplica sus migraciones y siembra sus datos al
preparar el worktree. Railway construye su propia imagen y base al publicar el PR.

El pedido de implementar autoriza preparar dependencias y configuración demo del worktree.
Publica según las reglas globales de Git; pedir el enlace de revisión cuenta como OK para abrir
el PR. Las operaciones destructivas y los cambios de secretos reales requieren autorización.

### Sembrar los datos de la feature

Cada PR levanta un entorno efímero en Railway con su propia base vacía, que `scripts/seed-pr.ts`
llena con el usuario demo y su mes de datos ([detalle en el README](../README.md#railway-entornos-de-pr-con-datos-falsos)).
Ese usuario base es igual para todos los PR, así que **una feature que necesite datos que ahí no
existen no se puede revisar**: hay que sembrarlos.

Para eso, **agrega tu escena**: un archivo en `scripts/seed-pr/escenas/` con **su propio usuario
demo**, que el seed descubre solo. No se toca ningún archivo compartido, así que dos ramas en
paralelo no chocan, y la escena no se borra en el PR siguiente — la feature se sigue pudiendo
probar en todos los entornos que vengan.

`scripts/seed-pr/escenas/wdc-91-aviso-de-sobregiro.ts`:

```ts
import type { EscenaContext } from "../sembrar-usuario.ts" // solo el tipo: no ejecuta el seed

export const correo = "wdc-91@lucaplan.cl"
export const titulo = "WDC-91 — cuenta en sobregiro"

export async function seed({ prisma, checkingId }: EscenaContext) {
  // El aviso de sobregiro que trae este PR solo se ve con la cuenta en rojo.
  await prisma.financialAccount.update({
    where: { id: checkingId },
    data: { balance: -120000 },
  })
}
```

Eso es todo: el seed crea el usuario `correo` con el mes de datos completo, le pone `titulo` de
nombre y le pasa a `seed` el contexto ya sembrado — `prisma`, `userId`, `checkingId`,
`creditCardId` y `categoryId` (Map nombre → id). El login del entorno de PR lista las cuentas con
su título; elegir una rellena el formulario.

Reglas:

- **Nombre del archivo: `<id-de-la-tarjeta>-<slug>.ts`.** Las escenas corren en orden alfabético,
  que con el ID delante es estable.
- **El `correo` va bajo el mismo dominio que el del usuario base** (`@lucaplan.cl` por defecto):
  es de donde el login saca la lista.
- **Ajusta solo lo tuyo.** El usuario ya viene con cuentas, categorías, presupuesto, movimientos,
  recurrentes y planes: tómalos del contexto en vez de crear otros.
- **Tu usuario es tuyo: siembra los montos que quieras.** No calcules contra los datos base para
  "encajar" — sobrescríbelos. Un número fijo es el que después va escrito en el guion de prueba.
- **Filtra SIEMPRE por `userId` en cada query.** Acá está el único punto delicado: el `prisma` que
  recibes es el cliente normal, **sin límite por usuario**. Que las escenas no se estorben no es
  algo que la estructura garantice — depende de que cada `where` lleve el `userId` del contexto. Un
  `deleteMany` sin él borra los datos de todos los usuarios demo, base incluido.
- **No toques al usuario base ni al de otra escena.** Ese es el punto de tener uno por escena, y se
  sostiene solo si respetas la regla de arriba.
- **Nada de datos reales ni secretos** — el entorno de PR es público.
- **Pruébala antes de abrir el PR**: `SEED_PR_FORCE=1 RAILWAY_ENVIRONMENT_NAME=pr-0 pnpm seed:pr`
  contra una base local (⚠️ re-siembra desde cero a todos los usuarios demo). Si una escena falla
  en Railway, el seed lo registra y sigue con las demás —el deploy no se cae— pero esa queda sin
  los datos que iba a mostrar.

## Convenciones

| Capa           | Archivo                                |
| -------------- | -------------------------------------- |
| domain         | `<feature>.domain.ts`                  |
| application    | `<verbo>-<feature>-use-case.ts`        |
| infrastructure | `<feature>.infrastructure.ts`          |
| presentation   | `app/api/<feature>/route.ts` (Next.js) |
