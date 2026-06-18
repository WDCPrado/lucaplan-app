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

Todo el backend (doc + código) vive en `arch/`; no hay carpeta `src/`. Imports vía
`@/arch/...`. La UI (shadcn) usa `@/components`, `@/lib`, `@/hooks`.

## UI / frontend

- shadcn/ui (`components.json`, estilo `radix-maia`), Tailwind v4, `lucide-react`, `next-themes`.
- Agregar componentes: `pnpm dlx shadcn@latest add <componente>` → caen en `components/ui/`.
- Evita `useEffect` para lógica de otra capa (auth/redirects → middleware; errores de red →
  capa fetch; estado derivado → calcular en render; datos iniciales → server component).

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
