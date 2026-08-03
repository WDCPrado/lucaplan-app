## 1. Lectura / DTO (recurrentes)

- [x] 1.1 Añadir `currentPeriodPaid: boolean` a `RecurringDTO` en `finance-read.ts`
- [x] 1.2 En `listRecurringView`, por plantilla consultar `findPeriodTransaction(t.id, periodKeyFor(t, today))` y poblar `currentPeriodPaid = status === "confirmed"`

## 2. UI

- [x] 2.1 `recurring-view.tsx` (RecurringRow): mostrar check "Cobrado" cuando `t.currentPeriodPaid`; si no, mantener el `nextChargeLabel` actual
- [x] 2.2 `installments-view.tsx` (PlanRow): derivar la cuota del mes (`items.find(isThisMonth(dueDate))`) y mostrar check "Pagada" cuando su `status` sea `paid`/`outside_app`; si no, mantener monto/vencimiento
- [x] 2.3 Reusar el patrón de check de `installment-plan-modal.tsx` (icono `Check`), sin componente ni dependencia nueva

## 3. Tests y verificación

- [x] 3.1 Test en `finance-read.test.ts`: recurrente con transacción `confirmed` del período → `currentPeriodPaid` true; solo `pending` o sin transacción → false
- [x] 3.2 Correr `pnpm lint && pnpm typecheck && node --test "arch/**/*.test.ts"` y dejar en verde
