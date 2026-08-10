# infrastructure (v1)

Adapters que **implementan los ports** definidos en `domain`. Agrupado por tecnología.
Depende de `domain` (para implementar sus interfaces); nunca al revés.

- `database/prisma/` — repos concretos (`<feature>.infrastructure.ts`). Agrégalo
  cuando metas persistencia (instala Prisma entonces, no antes — YAGNI).
- `http/<servicio>/` — clientes HTTP a terceros.

Las implementaciones se instancian en la capa de presentation (`app/`) y se inyectan
al use-case.

Excepción: un adapter que **recibe un evento externo** (no una request HTTP que pase por
`app/`) compone aquí mismo e invoca el use-case — `database/prisma/push-deps.ts` para las
notificaciones y el hook `databaseHooks.user.create` de `auth/auth.ts`. Sigue siendo
composición: la lógica vive en el use-case y solo habla con ports.
