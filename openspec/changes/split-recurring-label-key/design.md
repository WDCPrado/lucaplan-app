## Context

`RecurringTemplate.description` es hoy a la vez el nombre visible y la clave de match contra el
correo del banco (`matchesTemplate` compara `normalizeMovementText(description)`). El acoplamiento
rompe el reconocimiento cuando el usuario renombra la plantilla. El vínculo con el cargo real no
vive en la plantilla (no hay `sourceTransactionId` en `RecurringTemplate`), sino en
`Transaction.recurringTemplateId`; la plantilla nace desde un movimiento (`createRecurringTemplate`
recibe `sourceTransactionId` y lo vincula con `attachImportedMovement`), pero también admite hoy
una creación manual sin movimiento.

## Goals / Non-Goals

**Goals:**
- Que el nombre visible se pueda editar sin afectar el reconocimiento del cargo.
- Que la clave de match provenga siempre del movimiento real y sea inmutable desde el front.
- Reparar las plantillas ya rotas en producción sin borrarlas.

**Non-Goals:**
- No se cambia el algoritmo de match (sigue: texto normalizado igual + monto en rango + moneda +
  dirección). Solo cambia de qué campo sale el texto visible vs. la clave.
- No se añade edición de la clave de match en la UI (escape hatch = re-crear desde el movimiento).
- No se toca installments ni el resto de finanzas.

## Decisions

### D1 — Campo `label` nuevo; `description` pasa a ser solo clave de match
`RecurringTemplate` gana `label: string`. `description` conserva su rol de clave (match sin cambios).
La UI y el DTO exponen `label`; `description` deja de mostrarse. Alternativa descartada: renombrar
`description`→`matchKey` y crear `description`=visible — más churn en dominio/infra/tests sin ganancia.

### D2 — La clave sale del movimiento, no del input
`RecurringInput` deja de llevar `description` y pasa a llevar `label`. `createRecurringTemplate`
**exige** `sourceTransactionId`, carga el movimiento y fija `description = source.description`
(la clave real). `label` viene del input (default en el front = descripción del movimiento).
Sin `sourceTransactionId` → `InvalidRecurringTemplateError` (ya no hay creación manual).

### D3 — `update` no toca la clave
`updateRecurringTemplate` deja de recibir `description`. En la infra, `update` **no** incluye
`description` en el `data` de Prisma, así la clave persistida queda intacta. Solo se actualizan
`label` y los parámetros de cobro.

### D4 — El comprometido muestra `label`
`materializePeriod` en la infra pasa `description: template.label` al crear la `Transaction`
`pending`. Los `pending` ya materializados con el nombre viejo no se tocan (su descripción ya es
el nombre que el usuario veía).

### D5 — Migración de schema con backfill
Migración Prisma: `ALTER TABLE recurring_template ADD COLUMN label` y luego
`UPDATE recurring_template SET label = description`. Corre una vez, en el deploy; deja `label`
con el nombre que el usuario ve hoy.

### D6 — Script de reparación idempotente, fuera del deploy
Script Node con argumento de conexión a la DB de prod (patrón de `scripts/clone-prod-db.mjs`).
Por cada plantilla, busca su cargo real vinculado (`Transaction` con `recurringTemplateId = plantilla`
y `externalId != null`, el más antiguo = el de origen) y setea `description = ese.description`.
Idempotente: correrlo de nuevo vuelve a fijar la misma clave. El `label` no lo toca (ya quedó del
backfill D5). Reporta las plantillas sin cargo real vinculado (no reparables automáticamente).

### D7 — Eliminar los puntos de entrada de creación manual
`recurring-view.tsx`: se quitan el botón "Nueva", el FAB (`onAdd`) y el CTA del empty state; el
empty state instruye crear desde un movimiento. `recurring-modal.tsx` deja de soportar el modo sin
preset y elimina el branch de categoría manual (siempre heredada). El único origen es el preset de
`transaction-modal.tsx`.

## Risks / Trade-offs

- **Plantilla sin cargo real vinculado** (solo `pending`, nunca recibió un cargo del banco) → el
  script no puede derivar la clave. Mitigación: se reportan; el usuario las corrige re-creándolas
  desde el movimiento real cuando llegue. Son las que de todos modos nunca han matcheado.
- **Orden migración → script**: el backfill (D5) debe correr antes que el script (D6) para que
  `label` capture el nombre viejo. El deploy aplica la migración; el script se corre manualmente
  después. Documentado en tasks.
- **`description` de origen con ruido** (números de operación variables) → el match ya normaliza y
  borra dígitos sueltos (`normalizeMovementText`); es el mismo comportamiento actual, no una regresión.

## Migration Plan

1. Deploy con la migración (columna `label` + backfill `label = description`).
2. Correr el script de reparación contra prod (`--db-prod "postgresql://..."`).
3. Verificar un par de plantillas (el "gimnasio"): `label` = nombre puesto por el usuario,
   `description` = texto real del banco, y que un cargo nuevo se reconoce.

**Rollback**: la columna `label` es aditiva; revertir código deja `label` sin uso (inocuo). El
script solo reescribe `description` con un valor derivable de nuevo, no destruye datos.

## Open Questions

- Ninguna pendiente: decisiones de producto (clave inmutable, sin creación manual, reparación por
  script) ya confirmadas con el usuario.
