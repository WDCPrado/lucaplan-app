## Context

Recurrentes y cuotas ya calculan "Por cobrar" del mes en sus vistas (`recurring-view.tsx`,
`installments-view.tsx`). Falta la señal inversa: "ya saldado". Para cuotas el dato ya viaja en el
DTO (`InstallmentItemDTO.status`: `paid`/`outside_app`/`overdue`/`upcoming`). Para recurrentes el
`RecurringDTO` no sabe el estado de la transacción del período; el repo sí lo puede responder con
`findPeriodTransaction(templateId, periodKey)` → `{ id, status }`.

## Goals / Non-Goals

**Goals:**
- Un indicador por fila de "período saldado" en las dos tablas, con la misma regla que "Por cobrar".
- Reusar el patrón de check ya existente en `installment-plan-modal.tsx` (icono `Check`).

**Non-Goals:**
- No cambiar el modelo ni la API. No tocar el modal del plan (ahí el check ya existe por cuota).
- No un semáforo de estados: un check binario (saldado / no saldado) basta.

## Decisions

### D1 — `RecurringDTO.currentPeriodPaid: boolean`
`listRecurringView` calcula, por plantilla, `periodKey = periodKeyFor(t, today)` y consulta
`findPeriodTransaction(t.id, periodKey)`; `currentPeriodPaid = periodTx?.status === "confirmed"`. El
`pending` (comprometido no cobrado) NO cuenta como pagado. Es una consulta por plantilla; N es chico
(las recurrentes de un usuario), así que un loop simple basta —sin batch prematuro—.
Alternativa descartada: exponer el estado crudo (`"paid"|"committed"|"none"`) → más de lo que la UI
necesita hoy (un check).

### D2 — Cuotas: derivar en la vista, sin backend
`installments-view.tsx` calcula por plan `thisMonthItem = items.find(isThisMonth(dueDate))` y
`paid = thisMonthItem && (status === "paid" || "outside_app")`. Todo el dato ya está en el DTO.

### D3 — Presentación consistente
Ambas filas muestran el check con el mismo lenguaje visual del modal del plan (icono `Check` en un
realce `primary`), sin introducir un componente nuevo ni dependencias.

## Risks / Trade-offs

- **N consultas `findPeriodTransaction` en recurrentes** → intrascendente (pocas plantillas por
  usuario); si algún día pesa, se agrupa en una sola consulta por (templateId, periodKey).
- **Zona horaria del período** → se usa el mismo `periodKeyFor`/`isThisMonth` que ya usa el resto,
  así que no introduce un criterio nuevo de fecha (el borde de mes es un tema aparte ya conocido).

## Migration Plan

Sin datos ni schema. Deploy directo; rollback = revertir el commit.

## Open Questions

- Ninguna.
