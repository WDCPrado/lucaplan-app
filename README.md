# LucaPlan

App de **planificación financiera** (presupuestos, gastos y metas de ahorro), fullstack
en **Next.js 16** (App Router, React 19) con **clean architecture** en el backend.

## Stack

- Next.js 16 + React 19
- TypeScript
- Tailwind CSS v4 + shadcn/ui + Base UI (estilo `radix-maia`)
- pnpm

## Arranque

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

## Estructura

```
app/                 # Next.js App Router — UI + presentation (Route Handlers / Server Actions)
components/          # UI: shadcn/ui (components/ui) + componentes propios
lib/  hooks/         # utilidades y hooks de cliente
arch/                # backend (doc + código), no hay src/
├─ clean-architecture.md  # definición de la arquitectura (copiable entre proyectos)
├─ shared/           # código puro, sin negocio, cross-version
└─ v1/               # backend versionado
   ├─ domain/        # entidades + ports + errores de negocio
   ├─ application/   # use-cases (orquestan, no tocan IO)
   └─ infrastructure/# adapters que implementan los ports (Prisma, HTTP…)
```

Regla de dependencias: `presentation → application → domain` e `infrastructure → domain`.
Detalle completo en [arch/clean-architecture.md](arch/clean-architecture.md).

## UI / componentes

La UI se construye con **shadcn/ui + Base UI**. Reglas:

- Respeta esos primitivos para todo el UI/UX; no metas otra librería de componentes.
- ¿Falta un componente? Instálalo con el comando (no lo escribas a mano):

  ```bash
  pnpm dlx shadcn@latest add button   # cae en components/ui/
  ```

- El **estilo principal** (tokens, colores, tipografía, radius, dark mode) se define en
  [app/globals.css](app/globals.css) con variables CSS de Tailwind v4 — fuente de verdad
  del diseño. No hardcodees valores en componentes; usa esas variables. Design system
  completo (glassmorphism fintech) en [docs/design/design-system.md](docs/design/design-system.md).
- **Mobile-first y responsive**: sin scroll horizontal, `min-h-dvh`, targets/inputs ≥44px y
  texto ≥16px en móvil, contenedores con `max-w-*`. Prueba en 375px, desktop y dark/light.

## Scripts

| Comando          | Qué hace            |
| ---------------- | ------------------- |
| `pnpm dev`       | desarrollo          |
| `pnpm build`     | build de producción |
| `pnpm start`     | servir el build     |
| `pnpm lint`      | eslint              |
| `pnpm typecheck` | `tsc --noEmit`      |
| `pnpm format`    | prettier            |
