## Why

En las tablas de **recurrentes** y **cuotas** se ve cuánto se cobra y cuándo, pero no si la
obligación de **este período ya se saldó**. El usuario tiene que abrir el detalle o cruzar con los
movimientos para saber si el gimnasio ya se cobró o si la cuota del mes ya se pagó. La señal es
barata: es la misma regla de "Por cobrar", al revés — si el período tiene su transacción real, ya
está saldado.

## What Changes

- La fila de una **recurrente** muestra un indicador (check "Cobrado") cuando el **cobro del
  período en curso ya llegó** (existe una transacción `confirmed` para ese período); si no, mantiene
  el "Cobra el …"/"Por cobrar" actual.
- La fila de un **plan de cuotas** muestra un indicador (check "Pagada") cuando la **cuota que vence
  este mes ya está saldada** (pagada o registrada antes de la conexión); si no, mantiene el monto
  del mes y su vencimiento.
- Recurrentes: se añade al `RecurringDTO` un campo derivado `currentPeriodPaid` (existe transacción
  `confirmed` para el período de hoy). Cuotas: ya está todo en el DTO (`items[].status`), es solo
  presentación.

## Capabilities

### New Capabilities
<!-- Ninguna. -->

### Modified Capabilities
- `recurring-templates`: la lista de recurrentes indica por fila si el cobro del período en curso ya
  ocurrió.
- `installment-plans`: la lista de planes indica por fila si la cuota del mes ya está saldada.

## Impact

- **Lectura/DTO**: `finance-read.ts` — `RecurringDTO.currentPeriodPaid` (usa
  `findPeriodTransaction`). Sin cambios para cuotas (dato ya presente).
- **UI**: `recurring-view.tsx` (fila) e `installments-view.tsx` (fila). Reutiliza el patrón de
  check ya usado en el modal del plan.
- **Tests**: `finance-read.test.ts` para `currentPeriodPaid`. Sin schema, API ni migración.
