## 1. Schema y migración

- [x] 1.1 Agregar `label String` a `RecurringTemplate` en `prisma/schema.prisma` (comentario: nombre visible; `description` queda como clave de match)
- [x] 1.2 Crear migración Prisma: `ADD COLUMN "label"` + `UPDATE recurring_template SET label = description` (backfill)
- [x] 1.3 Regenerar el cliente Prisma

## 2. Dominio

- [x] 2.1 Añadir `label` a `RecurringTemplate`, `NewRecurringTemplate` (y por herencia `UpdateRecurringTemplate`) en `recurring.domain.ts`
- [x] 2.2 Confirmar que `matchesTemplate` sigue usando `description` (clave) y ajustar el comentario de cabecera del dominio para dejar claro label vs. description

## 3. Aplicación (use-cases)

- [x] 3.1 `RecurringInput`: quitar `description`, agregar `label`
- [x] 3.2 `createRecurringTemplate`: exigir `sourceTransactionId`; cargar el movimiento y fijar `description = source.description`, `label = input.label`; sin source → `InvalidRecurringTemplateError`
- [x] 3.3 `updateRecurringTemplate`: dejar de recibir/pasar `description` (la clave no se edita); actualizar solo `label` y parámetros de cobro
- [x] 3.4 `validateInput`: validar `label` (no vacío) en vez de `description`

## 4. Infraestructura

- [x] 4.1 `toTemplate`: mapear `label`
- [x] 4.2 `create`: persistir `label`
- [x] 4.3 `update`: **no** incluir `description` en el `data` de Prisma (clave intacta); persistir `label`
- [x] 4.4 `materializePeriod`: usar `template.label` como `description` de la `Transaction` `pending`

## 5. Lectura / DTO

- [x] 5.1 `RecurringDTO` en `finance-read.ts`: exponer `label` (además de/en vez de `description` según lo use la UI)
- [x] 5.2 Ajustar el mapeo del DTO para poblar `label`

## 6. Presentación (API + UI)

- [x] 6.1 `app/api/recurring/route.ts` (POST): parsear `label`; exigir `sourceTransactionId`
- [x] 6.2 `app/api/recurring/[id]/route.ts` (PATCH): parsear `label`; no aceptar `description`
- [x] 6.3 `recurring-modal.tsx`: el input captura `label`; cambiar el subtítulo (ya no es "la clave del correo"); quitar el branch de categoría manual (siempre heredada); asumir siempre preset
- [x] 6.4 `recurring-view.tsx`: quitar botón "Nueva", FAB (`onAdd`) y CTA de creación manual; empty state instruye crear desde un movimiento; mostrar `label` en filas y resumen
- [x] 6.5 `transaction-modal.tsx`: el preset de "Hacer recurrente" pasa `label` (default = `tx.description`) y `sourceTransactionId`

## 7. Script de reparación en producción

- [x] 7.1 Script Node con argumento `--db-prod` (patrón `scripts/clone-prod-db.mjs`) que, por plantilla, busca el cargo real vinculado (`Transaction.recurringTemplateId` + `externalId != null`, el más antiguo) y setea `description` = su descripción; idempotente; reporta plantillas sin cargo real
- [x] 7.2 Registrar el comando en `package.json` (ej. `fix:recurring-keys`) y documentar el orden (deploy/migración → script) en el propio script o README de scripts

## 8. Tests y verificación

- [x] 8.1 Actualizar `recurring.test.ts` (use-cases): creación exige source y deriva la clave; update no toca la clave; renombrar label no rompe el match
- [x] 8.2 Actualizar tests de dominio de `recurring` si tocan `label`/`description`
- [x] 8.3 Actualizar `finance-read.test.ts` y `finance-write.test.ts` para `label`
- [x] 8.4 Correr `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"` y dejar en verde
