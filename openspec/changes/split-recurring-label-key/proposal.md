## Why

En una plantilla recurrente, `description` cumple hoy dos papeles a la vez: es el **nombre que
el usuario ve y edita** y a la vez la **clave con la que se reconoce el cargo en el correo del
banco** (`matchesTemplate` compara `normalizeMovementText(description)`). Renombrar la recurrente
para diferenciarla —algo que el usuario espera poder hacer libremente— rompe silenciosamente el
match: el cargo real deja de vincularse, el comprometido nunca se consume y el gasto pasa por la
IA como si la plantilla no existiera. Ya ocurrió en producción (el "gimnasio" renombrado).

## What Changes

- Se separa el **nombre visible** (`label`, editable) de la **clave de match** (`description`,
  inmutable, derivada del cargo real). El formulario solo muestra y edita `label`; la clave nunca
  se toca desde el front.
- **BREAKING** (comportamiento): se elimina la **creación manual** de recurrentes. Una plantilla
  solo nace **desde un movimiento real** (`sourceTransactionId` obligatorio), de donde salen la
  clave de match y la categoría. Desaparecen los puntos de entrada "Nueva" / FAB / empty-state CTA
  de creación directa.
- El **comprometido** (`pending`) que se materializa cada período muestra `label` (nombre legible),
  no la clave del banco.
- **Editar** una plantilla ya no modifica `description`: solo `label`, monto, tolerancia,
  periodicidad, día, cuenta y fecha de término.
- **Migración de datos**: backfill `label = description` para las plantillas existentes.
- **Script de operación** (fuera del deploy) con argumento de conexión a la DB de producción, que
  corrige `description` = descripción del cargo real vinculado (`Transaction.recurringTemplateId`
  con `externalId`), idempotente, para reparar las recurrentes ya rotas por un renombre.

## Capabilities

### New Capabilities
<!-- Ninguna: es una modificación de la capacidad recurrente existente. -->

### Modified Capabilities
- `recurring-templates`: la plantilla gana un `label` visible distinto de la `description`
  (clave de match inmutable); la creación es solo desde un movimiento (no manual); la edición no
  altera la clave; el comprometido muestra `label`.

## Impact

- **Schema/DB**: `RecurringTemplate.label` nuevo (+ migración con backfill). Script de reparación
  contra prod.
- **Dominio**: `arch/v1/domain/finance/recurring.domain.ts` (tipos `RecurringTemplate`,
  `NewRecurringTemplate`, `UpdateRecurringTemplate`; el match sigue usando `description`).
- **Aplicación**: `recurring-use-cases.ts` (`RecurringInput` pasa `label`; `create` exige
  `sourceTransactionId` y deriva `description` del movimiento; `update` no toca `description`).
- **Infra**: `recurring.infrastructure.ts` (`toTemplate`, `create`, `update`, `materializePeriod`
  usa `label`).
- **Lectura/DTO**: `finance-read.ts` (`RecurringDTO` expone `label`).
- **Presentación**: `app/api/recurring/route.ts` y `[id]/route.ts`; `recurring-modal.tsx`,
  `recurring-view.tsx`, `transaction-modal.tsx` (preset).
- **Tests**: `recurring.test.ts`, `recurring.domain` tests, `finance-read.test.ts`,
  `finance-write.test.ts`.
