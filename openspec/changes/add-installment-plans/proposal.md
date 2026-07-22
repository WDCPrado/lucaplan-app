## Why

Una compra en cuotas se cobra **una sola vez** por el total en el correo del banco, pero el
gasto real ocurre mes a mes con cada cuota. Hoy el sistema la trata como un gasto único del
mes de la compra, lo que infla ese mes y deja vacíos los siguientes. El usuario necesita
transformar esa compra en un plan de cuotas: N movimientos, uno por mes, cada uno contando
como gasto solo en su mes.

Este cambio **reutiliza** el motor de plantillas recurrentes (WDC-5) en modo `cron` como
disparador; el plan solo aporta los montos por cuota y la trazabilidad con la compra
original. Depende de `add-recurring-templates`.

## What Changes

- **Nueva entidad `InstallmentPlan` + `InstallmentItem`**: un plan con cuenta de crédito
  obligatoria, categoría, descripción, monto total (capital, sin intereses), número de
  cuotas, fecha de inicio y día de pago; y N ítems (cuota 1..N) con fecha de vencimiento y
  monto (por defecto `total / N`, **editable por cuota**).
- **1 plantilla recurrente `cron` por plan** (relación 1:1): es el disparador. Llegado el
  día de cada cuota, el cron confirma la `Transaction` del ítem correspondiente con el monto
  de esa cuota y la categoría del plan, sin IA. Reusa el endpoint y la idempotencia de
  WDC-5.
- **La compra original se neutraliza**: al transformar, la `Transaction` de la compra por el
  total se marca interna (deja de contar como gasto) y queda vinculada al plan como origen.
  Se conserva para ver cuánto se cobró y la información del plan de cuotas; no se elimina.
- **El cupo lo sigue manejando el correo**: el plan **no** toca el bucket de crédito. La
  proyección de pagos por correo (`applyPayment`) sigue siendo la única fuente de liberación
  de cupo, para no liberar dos veces.
- **UI**: botón "Pasar a cuotas" en el modal de transacción (solo si la cuenta es de
  crédito), que abre una vista con las N cuotas (fechas autogeneradas desde el día de pago,
  montos editables) y la descripción; y una vista del plan para revisar/editar cuotas.
- **Fuera de scope**: intereses del banco (solo capital), refinanciamiento, prepago total,
  cuotas sobre cuentas que no sean de crédito.

## Capabilities

### New Capabilities
- `installment-plans`: transformar una compra en un plan de cuotas sobre una cuenta de
  crédito, con ejecución mensual vía la plantilla recurrente `cron`, montos editables por
  cuota y neutralización de la compra original.

### Modified Capabilities
- `finance-model`: `Transaction` gana el gancho hacia el ítem de cuota que la generó y la
  compra origen puede quedar neutralizada (interna) con referencia a su plan.

La ejecución por cron y la materialización/confirmación de la `Transaction` de cada cuota
NO agregan requisitos nuevos a `recurring-templates` ni a `finance-api`: el plan usa el modo
`cron` y el endpoint tal como quedan definidos en `add-recurring-templates`.

## Impact

- **Datos/Prisma**: modelos `InstallmentPlan` e `InstallmentItem`; `Transaction` gana
  `installmentItemId` (o reutiliza el vínculo, ver design) y la compra origen se referencia
  desde el plan. Nueva migración. Depende de la migración de WDC-5.
- **Código**: `arch/v1/domain/finance/installment.domain.ts` (entidades, port, reglas:
  cuenta crédito obligatoria, Σ cuotas = total salvo override, cronograma de fechas);
  `installment-use-cases.ts` (crear plan desde transacción, ejecutar cuota del período),
  invocado por el use-case de cron de WDC-5; repos Prisma; UI del modal y de la vista del
  plan.
- **Riesgo**: doble conteo del gasto si la compra original no se neutraliza; se cubre con la
  neutralización obligatoria en la transformación.
