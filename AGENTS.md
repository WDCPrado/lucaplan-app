<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Luca Plan

**Lee el [README](README.md) antes de trabajar.** Es la fuente canónica del proyecto: qué es,
stack, arquitectura, puesta en marcha y el mapa de toda la documentación.

Desde ahí abre lo que necesites, sobre todo:

- [docs/development.md](docs/development.md) — flujo de trabajo, reglas de UI, convenciones, qué
  correr antes del PR y cómo sembrar los datos con los que se prueba la feature (la cuenta demo
  única `demo@lucaplan.cl`, en `scripts/seed/`).
- OpenSpec se usa solo cuando Willy lo pide expresamente para ese trabajo.

## Rama base

Los PR de Luca Plan van contra `master`; la rama de trabajo sale de `origin/master`.
Esta regla del proyecto tiene prioridad sobre la base global `development`.

Este archivo no duplica reglas: si algo falta o se contradice, se corrige en el README o en
`docs/`, no aquí.
