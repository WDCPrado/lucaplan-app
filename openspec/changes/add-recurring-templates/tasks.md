## 1. Modelo y persistencia

- [x] 1.1 Modelo `RecurringTemplate` en `prisma/schema.prisma` (categoría obligatoria, monto base, tolerancia, periodicidad, modo, día, cuenta opcional, `isActive`)
- [x] 1.2 `Transaction.recurringTemplateId` nullable + índice, y `periodKey` con único `(recurringTemplateId, periodKey)`
- [x] 1.3 Migración y `prisma generate`

## 2. Dominio

- [x] 2.1 `arch/v1/domain/finance/recurring.domain.ts`: entidad, `RecurringTemplateRepository`, errores de negocio
- [x] 2.2 `periodKeyFor(template, date)` y `executionDateFor(template, periodKey)` puros (mensual/quincenal/anual, día 31 en meses cortos)
- [x] 2.3 `matchesTemplate(movement, template)` puro: texto normalizado + rango de tolerancia + moneda + dirección
- [x] 2.4 Tests de dominio: rangos, empate por rango más estrecho, períodos y fechas límite

## 3. Casos de uso

- [x] 3.1 CRUD de plantillas (crear desde movimiento origen incluido) con validaciones de dominio
- [x] 3.2 `materializePeriod`: crea la `Transaction` `pending` del período, idempotente por único de BD
- [x] 3.3 `confirmFromMovement`: el cargo importado toma el período y consume el comprometido, marca `reviewed`
- [x] 3.4 `runRecurringCron(date)`: materializa períodos abiertos y confirma las plantillas `cron` que vencen; devuelve conteos
- [x] 3.5 Integrar el match en `email-connection-use-cases.ts` antes de `deps.categorize`
- [x] 3.6 Tests: idempotencia, prioridad plantilla > IA, dos plantillas mismo comercio, segundo cargo del período

## 4. Presupuesto

- [x] 4.1 `computeCategoryCommitted` en `budget-formulas.ts` (Σ `pending` no internos del mes) + test
- [x] 4.2 Exponer el comprometido en la lectura de presupuesto (`finance-read.ts`)

## 5. Infraestructura y cron

- [x] 5.1 Repo Prisma de `RecurringTemplate`
- [x] 5.2 Guard `requireInternal(req)` reutilizable para `/api/cron/*` + test (rechaza tráfico de edge, exige `CRON_KEY`)
- [x] 5.3 `POST /api/cron/recurring/run` (fecha opcional, respuesta con conteos) + rutas CRUD `/api/recurring`
- [x] 5.4 App escuchando en `::`, `CRON_KEY` en env y función de cron en Railway documentadas en el README

## 6. UI

- [x] 6.1 Ruta `/recurrentes` con `AppShell` + ítem de navegación
- [x] 6.2 Lista de plantillas (categoría, base ± rango, periodicidad, estado, próxima/última ejecución) y acciones CRUD
- [x] 6.3 Botón "Hacer recurrente" en el modal de transacción, precargando descripción, monto, cuenta y categoría
- [x] 6.4 Capa "comprometido" distinguible del gastado en la vista de presupuesto

## 7. Cierre

- [x] 7.1 `pnpm test` y `pnpm build` en verde
- [x] 7.2 `openspec validate --change add-recurring-templates --strict`
