# Desarrollo y contribución

Guía de trabajo dentro del repo, para personas y agentes. El contexto general (qué es Luca Plan,
stack, puesta en marcha, scripts, deploy) vive en el [README](../README.md); este documento cubre
solo **cómo se trabaja aquí**.

## Flujo OpenSpec — obligatorio para cada feature nueva

Toda feature nueva pasa por OpenSpec **en este orden**. No saltes pasos ni escribas código de
producción antes de tener el cambio propuesto y revisado con el usuario. Para fixes pequeños y
documentación basta el PR directo.

1. **`opsx:propose`** — crea el cambio y sus artefactos (proposal, design, specs, tasks).
   **Revísalo con el usuario** y ajusta hasta que apruebe **antes** de pasar a implementar.
2. **`opsx:apply`** — implementa las tareas del cambio (código + tests). Marca los checkboxes.
3. **`opsx:verify`** — contrasta la implementación contra specs/design/tasks (completeness,
   correctness, coherence). Corrige lo que salga antes de seguir.
4. **`opsx:sync`** — promueve las specs delta del cambio a las specs canónicas en
   `openspec/specs/<capacidad>/spec.md`. **Opcional**: `opsx:archive` también sincroniza; el
   valor de hacerlo aparte es revisar las specs canónicas fusionadas antes de archivar.
5. **`opsx:archive`** — mueve el cambio a `openspec/changes/archive/`. Cierra el ciclo.

Para explorar/pensar antes de proponer: **`opsx:explore`** (no implementa, solo captura ideas).

Índice y reglas de OpenSpec: [openspec/README.md](../openspec/README.md).

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
- **Responsividad obligatoria (desktop-first, aún responsive).** La experiencia primaria es
  **escritorio** (Luca Plan es una webapp de acceso directo, sin depender de una tienda): sidebar
  fija + layout multi-columna que aprovecha el ancho. El shell vive en
  [components/finance/app-shell.tsx](../components/finance/app-shell.tsx) (shadcn `sidebar`,
  colapsable, drawer en móvil); las superficies contextuales usan
  [components/ui/responsive-modal.tsx](../components/ui/responsive-modal.tsx) (dialog en escritorio,
  drawer vaul full-height estilo iOS en móvil — **sin** `shouldScaleBackground`: escalar el fondo
  le pone un `transform` al wrapper y eso rompe todo `position: fixed` de la página, empezando por
  la barra de navegación inferior). Listas de chips/badges van en **scroll-x sin wrap**; fechas con **Calendar +
  Popover de shadcn**, nunca `<input type="date">`. Escala **hacia abajo** con breakpoints
  (`sm`/`md`/`lg`): en móvil el shell colapsa a drawer y el contenido se apila en una columna.
  Reglas mínimas (en ambos extremos): sin scroll horizontal; `min-h-dvh` (no `100vh`); targets
  táctiles ≥44px (`h-11`) y texto ≥16px (`text-base`) en móvil para evitar zoom de iOS;
  contenedores con `max-w-*`; prueba en escritorio (~1440px) y en ~375px, y en dark + light.
- Evita `useEffect` para lógica de otra capa (auth/redirects → proxy; errores de red →
  capa fetch; estado derivado → calcular en render; datos iniciales → server component).

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
3. **Comprueba y MUESTRA.** Levanta `pnpm dev` (puerto libre, ej. 3007) y prueba la interacción en
   **escritorio (~1440px) y móvil (~420px)** (desktop-first, sin regresión móvil). **El último paso
   de cada iteración es siempre un screenshot del resultado final, GUARDADO en la carpeta del
   feature como `app/design/<slug>/preview.png`** (no lo borres — es la referencia visual del mock,
   y se versiona junto a su `page.tsx`) y mostrado al usuario. Las capturas intermedias sí se
   borran. Cierra el dev server al terminar.
4. **Itera en código** hasta que el usuario apruebe ("me gustó").
5. **Pasar a Figma solo si es necesario y si el usuario lo pide.** Recién cuando lo apruebe,
   trasladar la vista al archivo Figma (página `Screens`) usando las variables/tokens del
   design system. Vínculo del archivo Figma en `figma.json`.

### Notas de verificación

- **Nunca dejes procesos colgando al terminar.** Todo dev server (`pnpm dev`) u otro proceso que
  se levante (foreground o background) se mata al cerrar la tarea, y se confirma que el puerto
  quedó libre (`netstat`). Si queda tomado, el `pnpm dev` del usuario falla con `EADDRINUSE`. Solo
  se deja corriendo lo que ya estaba corriendo del usuario.
- Antes de navegar, **espera a que el dev server responda** (poll a la URL); Next compila on-demand.
- **Turbopack + rutas nuevas:** crear o borrar carpetas de ruta en `app/` con el dev server
  corriendo puede corromper el caché incremental de Turbopack (panic
  `directory_tree_to_loader_tree` → recarga en bucle en `/login` u otras). Si pasa: mata el
  server, `rm -rf .next` y reinicia. Mejor: crea la carpeta de la ruta **antes** de levantar el
  server.

## Antes del PR

```bash
pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"
```

Sin commit/push, instalación de dependencias, cambios en secretos o `.env`, deploys ni operaciones
destructivas sin autorización explícita del usuario.

## Convenciones

| Capa           | Archivo                                |
| -------------- | -------------------------------------- |
| domain         | `<feature>.domain.ts`                  |
| application    | `<verbo>-<feature>-use-case.ts`        |
| infrastructure | `<feature>.infrastructure.ts`          |
| presentation   | `app/api/<feature>/route.ts` (Next.js) |
