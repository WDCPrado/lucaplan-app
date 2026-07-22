## 1. Modelo y persistencia

- [ ] 1.1 Modelos `InstallmentPlan` e `InstallmentItem` en `prisma/schema.prisma` (cuenta crédito, total, cuotas, día de pago; ítem con índice, vencimiento, monto)
- [ ] 1.2 `Transaction.installmentItemId` único y `InstallmentPlan.sourceTransactionId` + relación 1:1 con la plantilla `cron`
- [ ] 1.3 Migración (tras la de recurrentes) y `prisma generate`

## 2. Dominio

- [ ] 2.1 `arch/v1/domain/finance/installment.domain.ts`: entidades, `InstallmentPlanRepository`, errores
- [ ] 2.2 Reglas puras: cuenta crédito obligatoria, cronograma de vencimientos desde día de pago, `total/N` con resto en la última cuota, Σ cuotas = total
- [ ] 2.3 Tests de dominio: reparto, override que rompe/mantiene el total, fechas del cronograma

## 3. Casos de uso

- [ ] 3.1 `createPlanFromTransaction`: crea plan + plantilla `cron` + ítems y neutraliza la compra origen (`isInternal`, `sourceTransactionId`)
- [ ] 3.2 `executeInstallmentPeriod`: invocado por el cron de recurrentes; ubica el ítem del período y confirma su `Transaction`, idempotente por ítem
- [ ] 3.3 Enganchar `executeInstallmentPeriod` en el use-case de cron de `add-recurring-templates` cuando la plantilla pertenece a un plan
- [ ] 3.4 Completar el plan al ejecutar la última cuota: desactiva su plantilla `cron` (+ test de que no cobra de más)
- [ ] 3.5 Editar montos/fechas de cuotas pendientes (rechaza cuotas ya ejecutadas y rupturas de Σ = total)
- [ ] 3.6 Tests: neutralización de la origen, solo-cuota-del-mes cuenta como gasto, idempotencia por ítem, cupo intacto

## 4. Infraestructura

- [ ] 4.1 Repos Prisma de `InstallmentPlan` / `InstallmentItem`
- [ ] 4.2 Lectura del plan (ítems + estado ejecutada/pendiente + compra origen)

## 5. UI

- [ ] 5.1 Botón "Pasar a cuotas" en el modal de transacción, visible solo si la cuenta es de crédito
- [ ] 5.2 Vista de creación: N cuotas con fechas autogeneradas y montos editables + descripción
- [ ] 5.3 Vista del plan: lista de cuotas, edición de pendientes, compra origen

## 6. Cierre

- [ ] 6.1 `pnpm test` y `pnpm build` en verde
- [ ] 6.2 `openspec validate add-installment-plans --strict`
