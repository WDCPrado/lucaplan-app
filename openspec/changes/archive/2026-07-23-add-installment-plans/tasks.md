## 1. Modelo y persistencia

- [x] 1.1 Modelos `InstallmentPlan` (con `kind: card | loan`, cuenta, total, cuotas, día de pago, `tolerancePct`, `completedAt`) e `InstallmentItem` (índice, vencimiento, monto, `paidOutsideApp`) en `prisma/schema.prisma`
- [x] 1.2 `Transaction.installmentItemId` único y `InstallmentPlan.sourceTransactionId`
- [x] 1.3 Migración y `prisma generate`

## 2. Dominio

- [x] 2.1 `arch/v1/domain/finance/installment.domain.ts`: entidades, `InstallmentPlanRepository`, errores
- [x] 2.2 Reglas puras: cuenta válida según `kind` (crédito en `card`, cualquiera en `loan`), cronograma desde día de pago, `total/N` con resto en la última, Σ cuotas = total **solo** en `card`
- [x] 2.3 `nextDueItem(plan, paymentDate)`: la cuota pendiente más antigua vencida a esa fecha (null si no hay)
- [x] 2.4 `pickLoanPlanFor(payment, plans)`: cuenta de origen → N° de cuota del correo → tolerancia sobre el monto esperado; null si queda ambiguo. La tolerancia NUNCA descarta un plan ya identificado de forma única
- [x] 2.5 `outstanding(plan)`: saldo pendiente sobre lo efectivamente registrado, no sobre el cronograma
- [x] 2.6 Tests de dominio: reparto, override que rompe/mantiene el total, cronograma, selección de cuota, selección de plan (único candidato, desempate por cuota, desempate por monto, ambiguo), última cuota fuera de tolerancia con plan único

## 3. Casos de uso

- [x] 3.1 `createPlan`: crea plan + ítems; en `card` ejecuta las cuotas marcadas (fecha = vencimiento de cada una) y neutraliza la compra origen; en `loan` engancha los pagos ya importados y marca como `paidOutsideApp` las cuotas sin movimiento que adoptar
- [x] 3.2 `executeCardInstallments(accountId, paymentDate)`: una cuota por plan `card` (la más antigua vencida), crea su `Transaction`, idempotente por ítem
- [x] 3.3 `adoptLoanInstallment(transactionId)`: engancha el movimiento importado al ítem del plan `loan` elegido y le aplica la categoría del plan; no crea movimientos; sin plan inequívoco no hace nada
- [x] 3.4 Marcar el plan completado al registrar la última cuota (ambos tipos)
- [x] 3.5 Enganchar ambos disparadores en el import, en el mismo punto donde ya corren `matchRecurring` y `categorize`, y **antes** de la IA. Best-effort
- [x] 3.6 Editar montos/fechas de cuotas pendientes (rechaza las ya registradas; en `card` rechaza romper Σ = total)
- [x] 3.7 `payInstallmentManually(itemId, date, amount)`: registra una cuota cuyo pago no llegó por correo; misma escritura que la automática
- [x] 3.8 Tests: neutralización de la origen, una cuota por pago, atrasadas de a una, plan completado, cupo intacto, cuotas retroactivas en su mes (`card`), adopción sin crear movimiento (`loan`), monto del correo distinto al estimado, cuotas previas a la conexión sin gasto, marca manual seguida del correo sin duplicar

## 4. Infraestructura

- [x] 4.1 Repos Prisma de `InstallmentPlan` / `InstallmentItem`
- [x] 4.2 Lectura del plan (ítems + estado pagada/pendiente/vencida/fuera de la app + avance + saldo pendiente + compra origen)

## 5. UI

- [x] 5.1 Botón "Pasar a cuotas" en el modal de transacción, solo si la cuenta es de crédito (crea un plan `card`)
- [x] 5.2 Alta de un plan `loan` (crédito de consumo): cuenta de cargo, total, N cuotas, día de pago, categoría
- [x] 5.3 Formulario: N cuotas con fechas autogeneradas, montos editables y casillas de "ya pagada" premarcadas para las vencidas
- [x] 5.4 Vista del plan: cronograma con estados, avance y saldo pendiente, edición de pendientes, marcar una cuota como pagada a mano, compra origen cuando exista

## 6. Cierre

- [x] 6.1 `pnpm lint`, `npx tsc --noEmit`, `node --test "arch/**/*.test.ts"` y `pnpm build` en verde
- [x] 6.2 `openspec validate add-installment-plans --strict`
