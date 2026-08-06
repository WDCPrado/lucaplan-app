<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Luca Plan

**Lee el [README](README.md) antes de trabajar.** Es la fuente canónica del proyecto: qué es,
stack, arquitectura, puesta en marcha y el mapa de toda la documentación.

Desde ahí abre lo que necesites, sobre todo:

- [docs/development.md](docs/development.md) — flujo OpenSpec, reglas de UI, convenciones, qué
  correr antes del PR y cómo sembrar los datos con los que se prueba la feature en su entorno de PR
  (`scripts/seed-pr-feature.ts`, se reescribe en cada cambio).
- [openspec/README.md](openspec/README.md) — specs canónicas y cambios en curso.

Este archivo no duplica reglas: si algo falta o se contradice, se corrige en el README o en
`docs/`, no aquí.
