## Why

El banco avisa por correo cuando quiere. Una recurrente que el usuario ya pagó sigue apareciendo
como **comprometido** hasta que llega esa notificación —a veces días después— y en ese hueco el
presupuesto del mes miente por defecto: muestra como disponible plata que ya salió.

Hoy no hay forma de decirlo. El comprometido del período solo pasa a `confirmed` por la vía del
correo (`attachImportedMovement`), y esa vía además **rechaza** el cargo si el período ya está
confirmado, sin distinguir quién lo confirmó.

Las cuotas ya resolvieron su mitad de este problema: `payInstallmentManually` crea el movimiento de
una cuota cuyo pago no dejó rastro. Las recurrentes no tienen equivalente.

## What Changes

- El usuario SHALL poder **marcar pagado** el cobro del período de una recurrente: el comprometido
  `pending` pasa a `confirmed` y cuenta como gasto del mes. Si el período todavía no tenía
  comprometido, se materializa en ese momento y queda confirmado.
- La marca es **reversible**: deshacerla devuelve el movimiento a comprometido del período. Solo se
  puede deshacer lo que se marcó a mano; un cobro que vino del banco no se toca desde ahí.
- Cuando después llega el cargo real por correo, ese cargo **reemplaza** la marca manual: la manual
  se borra y queda el movimiento del banco con su monto, su fecha y su `externalId` reales. Si el
  correo nunca llega, la marca manual se queda — el usuario no pierde el registro de lo que pagó.
- La acción vive en la **fila de `/recurring`** (donde hoy se lee "Cobra el 20 ago" / "Cobrado") y
  en el **modal de la recurrente**.
- Una recurrente pausada o finalizada NO ofrece la marca: no tiene período que cobrar.

Fuera de alcance:

- **Cuotas.** Ya tienen su marca manual desde el modal del plan; el reemplazo por correo en planes
  `loan` (donde hoy el pago importado queda como gasto suelto duplicado) es un problema distinto y
  va en su propio cambio.
- Elegir monto o fecha al marcar: se conservan los del comprometido del período (monto base y día
  de ejecución). El correo corrige ambos cuando llega.
- Saldos y cupos: la marca no mueve buckets. El saldo de una cuenta conectada lo sigue proyectando
  el correo, que es su única fuente.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `recurring-templates`: dos cosas — la **marca manual del cobro del período** (nueva vía de
  confirmación, reversible, con su superficie en la lista y el modal) y la regla de **precedencia**
  del cargo del correo sobre esa marca, que hoy no existe porque no había marca que preceder.

## Impact

- **Domain**: el port `RecurringTemplateRepository` gana `markPeriodPaid` / `unmarkPeriodPaid`;
  `findPeriodTransaction` pasa a informar si el movimiento del período es manual (sin `externalId`),
  que es lo que distingue una marca del usuario de un cobro del banco.
- **Application**: `markRecurringPeriodPaid` en `recurring-use-cases.ts` — materializa el período
  (idempotente) y lo confirma; el inverso lo devuelve a `pending`.
- **Infrastructure**: `attachImportedMovement` deja de rechazar sin más cuando el período está
  confirmado: si esa confirmación es manual, la borra y adopta el importado.
- **API**: `PATCH /api/recurring/[id]` gana la forma `{ periodPaid: boolean }`, junto a la que ya
  existe para `{ isActive }`.
- **UI**: `recurring-view.tsx` (fila) y `recurring-modal.tsx` (modal). `RecurringDTO` gana el dato
  de si el cobro del período está marcado a mano.
- **Sin migración ni cambios de schema**: `externalId` ya distingue lo manual de lo importado, y el
  schema ya lo documenta así.
