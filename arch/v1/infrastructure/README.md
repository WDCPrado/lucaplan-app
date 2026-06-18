# infrastructure (v1)

Adapters que **implementan los ports** definidos en `domain`. Agrupado por tecnología.
Depende de `domain` (para implementar sus interfaces); nunca al revés.

- `database/prisma/` — repos concretos (`<feature>.infrastructure.ts`). Agrégalo
  cuando metas persistencia (instala Prisma entonces, no antes — YAGNI).
- `http/<servicio>/` — clientes HTTP a terceros.

Las implementaciones se instancian en la capa de presentation (`app/`) y se inyectan
al use-case.
