# CLAUDE.md — LucaPlan

App **fullstack Next.js 16** (App Router, React 19) con **clean architecture** para el backend.
Dominio: **planificación financiera** (presupuestos, gastos, metas de ahorro).
Gestor de paquetes: **pnpm**.

## Next.js 16 — léelo antes de codear

Esta versión tiene breaking changes respecto a lo que conoces (APIs, convenciones,
estructura de archivos). **Antes de escribir código de Next, lee la guía relevante en
`node_modules/next/dist/docs/`** y respeta los avisos de deprecación. No asumas APIs de memoria.

## Arquitectura

La definición completa y la regla de dependencias están en
[arch/clean-architecture.md](arch/clean-architecture.md). Resumen:

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
- **El estilo principal (tokens, colores, tipografía, radius, dark mode) se define en
  `app/globals.css`** (variables CSS de Tailwind v4). Es la fuente de verdad del diseño;
  no hardcodees valores en componentes, tira de esas variables. Detalle del design system
  (glassmorphism fintech, tokens, glass, dark/light) en [docs/design/design-system.md](docs/design/design-system.md).
- **Responsividad obligatoria (mobile-first).** Diseña para móvil y escala con breakpoints
  (`sm`/`md`/`lg`). Reglas mínimas: sin scroll horizontal; `min-h-dvh` (no `100vh`); inputs
  y targets táctiles ≥44px (`h-11`) y texto ≥16px (`text-base`) en móvil para evitar zoom de
  iOS; contenedores con `max-w-*`; prueba en 375px y desktop, y en dark + light.
- Evita `useEffect` para lógica de otra capa (auth/redirects → proxy; errores de red →
  capa fetch; estado derivado → calcular en render; datos iniciales → server component).

## Flujo de creación de UI / mocks

Método para construir vistas nuevas (síguelo siempre):

1. **Construir en código primero, no en Figma.** React/Next + shadcn/ui + tokens de
   `app/globals.css`. Usa las skills frontend (`ui-ux-pro-max`, `frontend-design`).
   **El mock debe ser FUNCIONAL, no una pantalla estática**: client components con estado
   (`useState`), navegación real entre vistas, y acciones que responden (botones, formularios,
   filtros). La idea es validar el comportamiento, no solo el aspecto. Datos mock en memoria.
2. **Vive en `app/design/`.** Cada vista mock en `app/design/<slug>/page.tsx`; regístrala
   en el índice `app/design/page.tsx`. La home (`app/page.tsx`) queda limpia — **no mezcles
   mocks con la app real**.
3. **Comprueba y MUESTRA.** Levanta `pnpm dev` (puerto libre, ej. 3007) y con Playwright a
   viewport mobile (~420px) prueba la interacción. **REGLA INQUEBRANTABLE: el último paso de
   cada iteración es SIEMPRE un screenshot del resultado final, GUARDADO en la carpeta del
   feature como `app/design/<slug>/preview.png` (no lo borres — es la referencia visual del
   mock) y mostrado al usuario.** Las capturas intermedias sí se borran; el `preview.png`
   queda. Cierra el dev server al terminar.
4. **Itera en código** hasta que el usuario apruebe ("me gustó").
5. **Pasar a Figma solo si es necesario y si el usuario lo pide.** Recién cuando lo apruebe,
   trasladar la vista al archivo Figma (página `Screens`) usando las variables/tokens del
   design system. Vínculo del archivo Figma en `figma.json`.

**Notas de verificación (Playwright):**

- Playwright corre **headless** (el plugin lleva `--headless` en su `.mcp.json`); no abre
  ventana del navegador. Si tras actualizar el plugin vuelve a abrir ventana, reaplica el flag.
- Antes de navegar, **espera a que el dev server responda** (poll a la URL); Next compila on-demand.
- Viewport mobile **~420px** de ancho (es una app de finanzas mobile-first).
- El `preview.png` de cada feature **se versiona** junto a su `page.tsx` — es la referencia
  visual del mock; no lo borres.

## Comandos

```bash
pnpm dev        # desarrollo
pnpm build      # build de producción
pnpm lint       # eslint
pnpm typecheck  # tsc --noEmit
pnpm format     # prettier
```

## Convenciones

| Capa           | Archivo                                |
| -------------- | -------------------------------------- |
| domain         | `<feature>.domain.ts`                  |
| application    | `<verbo>-<feature>-use-case.ts`        |
| infrastructure | `<feature>.infrastructure.ts`          |
| presentation   | `app/api/<feature>/route.ts` (Next.js) |
