## 1. Modelo y persistencia

- [ ] 1.1 Modelos `InstallmentPlan` e `InstallmentItem` en `prisma/schema.prisma` (cuenta crédito, total, cuotas, día de pago, `completedAt`; ítem con índice, vencimiento, monto)
- [ ] 1.2 `Transaction.installmentItemId` único y `InstallmentPlan.sourceTransactionId`
- [ ] 1.3 Migración y `prisma generate`

## 2. Dominio

- [ ] 2.1 `arch/v1/domain/finance/installment.domain.ts`: entidades, `InstallmentPlanRepository`, errores
- [ ] 2.2 Reglas puras: cuenta crédito obligatoria, cronograma desde día de pago, `total/N` con resto en la última, Σ cuotas = total
- [ ] 2.3 `nextDueItem(plan, paymentDate)`: la cuota pendiente más antigua vencida a esa fecha (null si no hay)
- [ ] 2.4 Tests de dominio: reparto, override que rompe/mantiene el total, cronograma, selección de cuota

## 3. Casos de uso

- [ ] 3.1 `createPlanFromTransaction`: crea plan + ítems, ejecuta las cuotas marcadas como pagadas (fecha = vencimiento de cada una) y neutraliza la compra origen
- [ ] 3.2 `executeInstallmentsForPayment(accountId, paymentDate)`: una cuota por plan (la más antigua vencida), idempotente por ítem; marca el plan completado al ejecutar la última
- [ ] 3.3 Enganchar en el import donde se proyecta el pago de tarjeta, best-effort
- [ ] 3.4 Editar montos/fechas de cuotas pendientes (rechaza ejecutadas y rupturas de Σ = total)
- [ ] 3.5 Tests: neutralización de la origen, una cuota por pago, atrasadas de a una, plan completado, cupo intacto, cuotas retroactivas en su mes

## 4. Infraestructura

- [ ] 4.1 Repos Prisma de `InstallmentPlan` / `InstallmentItem`
- [ ] 4.2 Lectura del plan (ítems + estado pagada/pendiente/vencida + compra origen)

## 5. UI

- [ ] 5.1 Botón "Pasar a cuotas" en el modal de transacción, solo si la cuenta es de crédito
- [ ] 5.2 Formulario: N cuotas con fechas autogeneradas, montos editables y casillas de "ya pagada" premarcadas para las vencidas
- [ ] 5.3 Vista del plan: cronograma con estados, edición de pendientes, compra origen

## 6. Cierre

- [ ] 6.1 `pnpm lint`, `npx tsc --noEmit`, `node --test "arch/**/*.test.ts"` y `pnpm build` en verde
- [ ] 6.2 `openspec validate add-installment-plans --strict`
