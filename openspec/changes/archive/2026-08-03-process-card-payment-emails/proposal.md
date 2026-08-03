## Why

Banco de Chile envía, desde `serviciodetransferencias@bancochile.cl`, dos comprobantes al pagar
la tarjeta de crédito, con asunto **"Pago de Tarjeta de Crédito Nacional"** y **"…Internacional"**
(el cuerpo los titula "Comprobante pago Tarjeta de Crédito …", que se usa como validación secundaria).
Hoy esos asuntos no están en la allowlist del remitente TEF, así que caen en `asunto_desconocido`
y se **pierden**: el pago de la tarjeta no se refleja en ningún lado.

Además hay un hueco de modelo preexistente: el pago de tarjeta que sí procesamos hoy (desde el
remitente `enviodigital`) solo mueve la **deuda** de la tarjeta (baja el `Utilizado`, libera cupo)
pero **no descuenta la caja** de la cuenta corriente de origen. El pago de la tarjeta es un traslado
entre dos productos del usuario: sale plata de la corriente y baja la deuda de la tarjeta. Ambas
patas son reales y hoy solo se refleja una.

El pago de tarjeta **no es gasto** (las compras ya se registraron una a una el día que ocurrieron;
contar también el pago las duplicaría). Por eso el concepto correcto es un **movimiento interno de
dos patas**, visible en el historial pero fuera de ingreso, gasto, presupuesto y categorización IA.

## What Changes

- **Dos asuntos nuevos** en la allowlist del remitente TEF: `Pago de Tarjeta de Crédito Nacional` y
  `Pago de Tarjeta de Crédito Internacional` (normalizados —minúsculas, espacios, entidades,
  tildes—, fail-closed), con validación secundaria del cuerpo (`se ha efectuado el pago de la
  tarjeta de crédito`) para no colisionar con otros comprobantes del mismo remitente.
- **Pago de tarjeta como movimiento interno de dos patas**, ambas `isInternal`:
  - **Pata de caja (débito):** baja el bucket `cash` de la cuenta corriente de **origen** por el
    monto pagado. Aparece en el historial como "Pago Tarjeta de Crédito ••••NNNN".
  - **Pata de deuda (crédito):** baja el `Utilizado` del bucket de la tarjeta **destino**
    (`credit_national` o `credit_international` según la moneda) y libera cupo (reusa
    `applyInternalPayment`).
- **Internacional bimoneda:** la pata de deuda usa el **monto pagado en USD** contra el bucket
  internacional; la pata de caja usa el **monto en CLP** contra la caja. Cada pata en su moneda; el
  tipo de cambio lo informa el banco y **no se recalcula**.
- **Parseo por etiqueta, no por el primer `$`:** en el cuerpo el primer monto es `Utilizado` (la
  deuda), no `Monto` (lo pagado). El parser toma la etiqueta correcta y **omite** el correo si falta
  el monto pagado, la cuenta de origen o la tarjeta destino.
- **Idempotencia por pata:** cada pata persiste con su `externalId` propio, derivado del campo
  `Transacción` del correo (alfanumérico, estable por operación) sufijado por pata, con Message-ID
  de fallback; reprocesar el mismo correo (webhook/delta) no duplica ninguna de las dos.

## Capabilities

### New Capabilities
<!-- ninguna -->

### Modified Capabilities
- `bank-email-connection`: agrega el reconocimiento de los dos comprobantes de pago de tarjeta desde
  el remitente TEF y define el pago de tarjeta como movimiento interno de dos patas (caja de origen
  + deuda de la tarjeta), con parseo por etiqueta e idempotencia por pata.

## Impact

- **Aplicación** (`arch/v1/application/finance-use-cases`):
  - `bancochile-email-map.ts`: asuntos nuevos, parseo por etiqueta (`Monto` vs `Utilizado`, USD del
    "Monto pagado", cuenta de la sección "Origen", últimos 4 de "N° de tarjeta"), y un evento de pago
    de tarjeta que expone **ambas patas**.
  - `email-connection-use-cases.ts`: `resolveEventTarget` y la proyección resuelven y aplican las dos
    patas; el fan-out a dos movimientos con `externalId` por pata en `confirmEmailSetup` y
    `syncEmailConnection`.
  - `email-projection.ts`: sin lógica nueva (reusa `applyDebitToCash` para la caja y
    `applyInternalPayment` para la deuda).
- **Tests** (`email-connection.test.ts`): fixtures **sanitizadas** (datos ficticios) nacional e
  internacional; parseo, resolución, proyección de ambas patas e idempotencia. Las capturas reales
  con datos personales **no** entran al repo.
- **Spec** (`openspec/specs/bank-email-connection/spec.md`): delta con el nuevo comportamiento.
- Sin cambios de esquema Prisma ni de entorno.
