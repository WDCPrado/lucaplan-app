## Why

Una compra en cuotas se cobra **una sola vez** por el total en el correo del banco, pero el
gasto real ocurre mes a mes con cada cuota. Hoy el sistema la trata como un gasto único del
mes de la compra, lo que infla ese mes y deja vacíos los siguientes. El usuario necesita
transformar esa compra en un plan: N movimientos, uno por mes, cada uno contando como gasto
solo en su mes.

## What Changes

- **Nueva entidad `InstallmentPlan` + `InstallmentItem`**: un plan con cuenta de crédito
  obligatoria, categoría, descripción, monto total (capital, sin intereses), número de
  cuotas, fecha de inicio y día de pago; y N ítems (cuota 1..N) con vencimiento y monto
  (por defecto `total / N`, **editable por cuota**).
- **La cuota se registra cuando llega el pago de la tarjeta**, no en una fecha de
  calendario: el import de correo ya reconoce el pago de tarjeta de crédito
  (`internal_payment` / `pago_tarjeta`, con la tarjeta identificada por sus últimos 4). Cada
  pago ejecuta **una** cuota por plan de esa cuenta: la pendiente más antigua. **No hay
  cron.**
- **Cuotas ya pagadas al crear el plan**: si la fecha de inicio es anterior a hoy, el
  formulario lista las cuotas ya vencidas **premarcadas como pagadas**; el usuario puede
  desmarcar las que quedaron debiendo. Cada cuota marcada crea su `Transaction` confirmada
  **en su mes**, de modo que el historial queda como si el plan hubiera existido desde el
  principio. Las desmarcadas quedan pendientes y se saldan con los próximos pagos.
- **La compra original se neutraliza**: la `Transaction` por el total se marca interna
  (deja de contar como gasto) y queda vinculada al plan como origen. Se conserva para ver
  cuánto se cobró; no se elimina.
- **El cupo lo sigue manejando el correo**: el plan **no** toca el bucket de crédito. La
  proyección de pagos (`applyPayment`) sigue siendo la única fuente de liberación de cupo,
  para no liberar dos veces.
- **El plan termina solo**: al ejecutarse la última cuota queda completado y deja de
  esperar pagos.
- **UI**: botón "Pasar a cuotas" en el modal de transacción (solo en cuentas de crédito),
  formulario con el cronograma (fechas autogeneradas, montos editables, casillas de cuotas
  ya pagadas) y vista del plan.
- **Fuera de scope**: intereses del banco (solo capital), refinanciamiento, prepago total,
  cuotas fuera de cuentas de crédito, y registrar una cuota a mano cuando el pago no llega
  por correo.

## Capabilities

### New Capabilities
- `installment-plans`: transformar una compra en un plan de cuotas sobre una cuenta de
  crédito, con ejecución disparada por el pago de la tarjeta, montos editables por cuota,
  declaración de cuotas ya pagadas al crear, y neutralización de la compra original.

### Modified Capabilities
- `finance-model`: `Transaction` gana el gancho hacia el ítem de cuota que la generó, y la
  compra origen puede quedar neutralizada (interna) con referencia a su plan.
- `bank-email-connection`: el pago de tarjeta, además de proyectar saldos, pasa a disparar
  la ejecución de la cuota de los planes de esa cuenta.

## Impact

- **Datos/Prisma**: modelos `InstallmentPlan` e `InstallmentItem`; `Transaction` gana
  `installmentItemId` (único). Nueva migración.
- **Código**: `arch/v1/domain/finance/installment.domain.ts` (entidades, port, reglas:
  cuenta crédito obligatoria, cronograma, Σ cuotas = total); `installment-use-cases.ts`
  (crear desde transacción, ejecutar cuota al pagar); enganche en el import de correo donde
  hoy se proyecta el pago de tarjeta; repos Prisma; UI del modal y de la vista del plan.
- **Riesgo**: doble conteo del gasto si la compra original no se neutraliza; se cubre
  haciendo la neutralización parte atómica de la transformación.
- **No depende de `add-recurring-templates`**: al ejecutarse por el pago y no por cron, el
  plan no necesita plantilla recurrente. Comparte el concepto, no el mecanismo.
