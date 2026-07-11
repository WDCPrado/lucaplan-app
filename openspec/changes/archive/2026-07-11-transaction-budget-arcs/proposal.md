# Proposal: transaction-budget-arcs

## Why

Tarjeta Linear **LUCA-3**: cada movimiento de gasto ya calcula "Quedan $X" (el restante histórico
de su categoría justo tras ese movimiento), pero solo como texto. Falta la lectura visual: un
**arco igual al de los anillos de Presupuestos** que muestre de un vistazo cuánto quedaba del
límite en ese punto.

## What Changes

- **Arco de presupuesto en la fila de movimiento** (`MovementRow`): el icono de categoría de los
  movimientos de gasto con "Quedan" pasa a estar rodeado por un mini anillo de progreso (mismo
  `ProgressRing` y misma semántica de color por estado que los anillos de Presupuestos), con
  `% = usado en ese punto / límite` donde `usado = límite − quedan`.
- **`TransactionDTO` expone `categoryLimit`** (número o `null`): el límite efectivo de la
  categoría del movimiento, necesario para calcular el porcentaje del arco en la fila. Aditivo.
- Movimientos sin "Quedan" (ingresos, sin categoría, reversados, búsqueda) quedan exactamente
  como hoy: círculo plano sin arco.

## Capabilities

### New Capabilities

(ninguna)

### Modified Capabilities

- `finance-ui`: la fila de movimiento con restante muestra además el arco de presupuesto
  (MODIFIED del scenario de movimientos con contexto en la pestaña Resumen).

## Impact

- **Solo lectura/presentación**; sin cambios de modelo de datos ni escritura.
- `arch/v1/application/finance-use-cases/finance-read.ts`: `TransactionDTO.categoryLimit`
  (aditivo; `null` donde no aplica, p. ej. búsqueda).
- `components/finance/movement-row.tsx`: mini `ProgressRing` alrededor del icono cuando hay
  restante y límite.
- **Linear**: LUCA-3 se documenta y cierra con este cambio.
