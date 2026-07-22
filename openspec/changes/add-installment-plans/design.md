## Context

Depende de `add-recurring-templates`: ahí queda el motor `cron` (materialización +
confirmación idempotente por período) y el endpoint `POST /api/cron/recurring/run`. Una
compra en cuotas es un caso de ese motor donde, en vez de confirmar un monto base fijo, se
confirma el monto del ítem de cuota del período.

El correo del banco cobra la compra una sola vez por el total; luego cada mes llega el pago
de la tarjeta, que `email-projection.applyPayment` ya usa para liberar cupo. Por eso el cupo
no es responsabilidad del plan (ver decisión).

## Goals / Non-Goals

**Goals:**
- Que el gasto de una compra en cuotas aparezca mes a mes, solo la cuota del mes.
- Reusar el cron de WDC-5 sin duplicar runner ni endpoint.
- Conservar la compra original para ver el cargo real y la info del plan.

**Non-Goals:**
- Intereses del banco (solo capital).
- Tocar el cupo de la tarjeta desde el plan.
- Cuotas fuera de cuentas de crédito, prepago o refinanciamiento.

## Decisions

### El plan no toca el cupo; lo maneja el correo

**Decisión:** `InstallmentPlan` no ajusta el bucket de crédito. La liberación de cupo la
sigue haciendo `applyPayment` cuando llega el pago de la tarjeta por correo.

**Por qué:** el pago mensual real de la tarjeta ya llega por correo y ya libera cupo. Si
además cada cuota liberara capital, el cupo se liberaría dos veces. Reconciliar ambas
fuentes (cuota vs. pago) es complejidad sin dueño claro. El banco es la fuente real del
saldo; el plan solo modela el gasto por mes. Coste: si el usuario no tiene el correo
conectado, el cupo no se mueve — aceptable, el proyecto ya asume banco conectado.

### El plan reutiliza el motor `cron`, no crea uno nuevo

Una plantilla recurrente `cron` 1:1 con el plan es el disparador. El use-case de cron de
WDC-5, al confirmar el período de una plantilla que pertenece a un plan, delega en
`installment-use-cases` para elegir el ítem del período y su monto en vez del monto base.
La idempotencia es la misma del período (único de BD) más el vínculo 1:1 ítem→movimiento.

**Alternativa descartada:** un cron propio de cuotas. Duplicaría runner, endpoint y guard de
red privada; el issue explícitamente pide reutilizar el de recurrentes.

### Neutralizar la compra origen (no eliminar)

**Decisión:** al transformar, la compra por el total se marca `isInternal=true` y se
referencia desde el plan (`sourceTransactionId`).

**Por qué:** `isInternal` ya existe y ya excluye del presupuesto y de la caja
(`budget-formulas`), así que no se doble-cuenta el total. Conservarla (vs. borrarla) permite
ver cuánto cobró el banco realmente y enlazar la info del plan, que es justo lo que el
usuario pidió. Coste: una fila "muerta" por plan, invisible en los cálculos.

### Σ cuotas = total, con override por cuota

Regla de dominio pura: los montos por defecto son `total / N` (con el resto en la última
cuota para cerrar el redondeo); cualquier edición debe mantener Σ = total o el guardado se
rechaza. Testeable sin IO.

### El plan termina solo; la plantilla no queda viva

Una plantilla de WDC-5 es perpetua: mientras esté activa, el cron le abre período tras período.
Un plan de cuotas **no** puede comportarse así, o seguiría cobrando después de la cuota N. Dos
frenos, no uno:

1. El ejecutor de cuotas busca el `InstallmentItem` del período; sin ítem pendiente no crea nada
   (freno pasivo, sobrevive a cualquier reproceso del cron).
2. Al ejecutar la última cuota, el plan queda completado y su plantilla se desactiva (freno
   activo: el cron deja de recorrerla, sin trabajo inútil cada día).

La fecha de fin se **deriva** del cronograma (vencimiento de la cuota N) en vez de guardarse:
un campo `endDate` editable podría contradecir a los ítems, que son la fuente real.

## Risks / Trade-offs

- **Doble conteo del gasto** si la compra origen no se neutraliza → la neutralización es
  parte atómica de la transformación; test que verifica que la origen queda interna.
- **Cupo desalineado sin correo conectado** → aceptado; el proyecto asume banco conectado y
  el correo es la fuente del saldo real.
- **Redondeo de cuotas** (`total/N` no exacto) → el resto va a la última cuota; la regla Σ =
  total lo cubre con test.
- **Editar una cuota ya ejecutada** rompería la coherencia con su `Transaction` → prohibido
  por requisito; solo se editan cuotas pendientes.

## Migration Plan

1. Requiere la migración de `add-recurring-templates` aplicada.
2. Migración: `InstallmentPlan`, `InstallmentItem`, `Transaction.installmentItemId` (único)
   y `InstallmentPlan.sourceTransactionId`.
3. Deploy: sin planes creados, comportamiento idéntico al actual.

Rollback: eliminar planes y sus plantillas `cron`; des-neutralizar la compra origen (quitar
`isInternal`) si se quiere revertir la transformación.

## Open Questions

- Ninguna pendiente: la fecha de fin queda derivada del cronograma (ver decisión de vigencia).
