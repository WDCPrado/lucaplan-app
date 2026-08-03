## Context

El parser `parseBancoChileEmail` (`bancochile-email-map.ts`) es fail-closed: por remitente y asunto
exactos produce un `EmailEvent`, o omite con un motivo sin PII. Hoy `EmailEvent` tiene **una sola
pata**: un `amount`, un `instrument`, un `paymentTarget` y un `externalId`.

El pago de tarjeta que ya existe (`source: "pago_tarjeta"`) llega solo desde `enviodigital` con la
plantilla "Pago por $X a tarjeta terminada en 1234". Esa plantilla **no trae la cuenta de origen**,
así que solo puede mover la deuda de la tarjeta (baja `Utilizado`), nunca la caja. Es un pago
tuerto.

Los dos comprobantes nuevos llegan desde `serviciodetransferencias@bancochile.cl` con asunto `Pago
de Tarjeta de Crédito Nacional` / `Internacional` (el cuerpo los titula "Comprobante pago Tarjeta de
Crédito …"), y **sí** traen la sección "Origen" con la cuenta corriente y la sección "Destino" con la
tarjeta y los montos. Con eso se puede reflejar el pago completo: caja de origen ↓ y deuda de
tarjeta ↓. Ese remitente también manda transferencias, pagos de línea y de crédito de consumo, así
que la detección es por **asunto exacto**, no por remitente.

El pipeline de movimientos (`confirmEmailSetup` y `syncEmailConnection`) hoy mapea **un evento → un
movimiento** vía `resolveEventTarget`, y proyecta con `applyEventToProjection` /
`applyEventToStoredBuckets`. La identidad idempotente sale de `emailExternalId` (TEF > Message-ID >
Graph id) y es única por movimiento (`@@unique(accountId, externalId)`).

## Goals / Non-Goals

**Goals:**
- Reconocer los dos asuntos de pago de tarjeta desde el remitente TEF, fail-closed.
- Reflejar el pago como **dos movimientos internos**: débito en la caja de origen y crédito
  (reducción de deuda) en la tarjeta destino; ninguno cuenta en ingreso/gasto/presupuesto ni pasa
  por IA.
- Soportar el caso **internacional bimoneda**: pata de deuda en USD, pata de caja en CLP, sin
  recalcular tipo de cambio.
- Idempotencia por pata: reprocesar el correo no duplica ninguno de los dos movimientos.

**Non-Goals:**
- Arreglar el `pago_tarjeta` de `enviodigital` (no trae cuenta de origen; se queda como pata única).
- Un modelo genérico de N patas. Solo el caso de dos patas del pago de tarjeta.
- Persistir el tipo de cambio ni el N° completo de tarjeta/cuenta.

## Decisions

### 0. Detección: asunto exacto + validación secundaria del cuerpo

El asunto (barra del correo) es `Pago de Tarjeta de Crédito Nacional` / `Internacional`; se compara
**normalizado** (minúsculas, espacios colapsados, entidades HTML decodificadas y **tildes
eliminadas**, para tolerar `Crédito`/`Credito`). Como el remitente TEF también manda otros
comprobantes, se exige además una **validación secundaria del cuerpo**: la frase `se ha efectuado el
pago de la tarjeta de crédito`. Sin esa frase, se omite (`asunto_desconocido`/`plantilla_desconocida`).
No se depende de logos, URLs, nombre del cliente, ni del orden de los nodos HTML.

### 1. Un `EmailEvent` con una pata de caja opcional (no dos eventos, no refactor del parser)

`parseBancoChileEmail` sigue devolviendo **un** `ParsedEmail`. El `EmailEvent` gana un campo
opcional:

```ts
cashLeg: { ref: string; amount: Money } | null // débito en la corriente de origen (solo pago de tarjeta)
```

El evento principal es la **pata de deuda** (como hoy el `pago_tarjeta`): `kind: "internal_payment"`,
`instrument = { kind: "credit_card", last4 }`, `paymentTarget = credit_national | credit_international`,
`amount` = monto pagado **en la moneda de la tarjeta** (CLP nacional, USD internacional). `cashLeg`
lleva el débito **en CLP** contra la cuenta corriente de origen.

Alternativa descartada: hacer que el parser devuelva `EmailEvent[]`. Obliga a cambiar la firma y
todos los `.map(parseBancoChileEmail)`, el detector de candidatos y los tests, para un único caso de
dos patas. Un campo opcional es el diff mínimo y no toca a los demás asuntos.

### 2. Fan-out a dos movimientos en el use-case, con `externalId` sufijado por pata

`resolveEventTarget` sigue resolviendo la **pata de deuda** (tarjeta por últimos 4 + bucket de la
moneda; ya existe). Se agrega la resolución de la **pata de caja** (cuenta corriente por número /
últimos 4, reusando `resolveChecking`).

En `confirmEmailSetup` y `syncEmailConnection`, un evento con `cashLeg` emite **dos**
`ResolvedEmailMovement`:
- **deuda:** cuenta = tarjeta, bucket = `credit_national|international`, `direction: "credit"`,
  `externalId = <base>:card`, `amount` = monto de la tarjeta.
- **caja:** cuenta = corriente, bucket = `cash`, `direction: "debit"`, `externalId = <base>:cash`,
  `amount` = `cashLeg.amount` (CLP).

Ambos `isInternal: true`. La base es el `externalId` actual del evento (`email:mid:<id>`); el sufijo
`:card`/`:cash` los hace únicos y estables ⇒ reprocesar es idempotente por pata.

Si **cualquiera** de las dos patas no resuelve su instrumento (tarjeta o cuenta ausente en el
snapshot), se omite el evento **completo** (no se registra medio pago). Fail-closed.

### 3. Proyección: reusar las reglas existentes, una por pata

- pata de caja → `applyDebitToCash(cash, overdraft, cashLeg.amount)` (consume caja; excedente al
  sobregiro, igual que un cargo).
- pata de deuda → `applyInternalPayment(cardBucket, amount)` (baja `Utilizado`, nunca bajo cero).

Sin lógica nueva en `email-projection.ts`. La proyección solo corre para movimientos **nuevos** y
posteriores al snapshot (la regla actual), por pata.

### 4. Parseo por etiqueta (el primer `$` es `Utilizado`, no `Monto`)

El cuerpo trae varias cifras. Reglas acotadas por etiqueta, tolerando `N°`/`Nº`/`Nro`:
- **Nacional:** monto pagado = etiqueta `Monto` (`$652.580`), **no** `Utilizado` (`$540.835`).
- **Internacional:** deuda = `Monto pagado` en USD (`USD$142,05`), **no** `Utilizado` (`USD$12,00`);
  caja = `Monto` en CLP (`$134.571`). El regex de `Monto` NO debe capturar `Monto pagado` (anclar la
  etiqueta). El `Tipo de cambio` se ignora (no se recalcula nada).
- Cuenta de origen: de la sección **Origen** (`N° de cuenta`), acotando la búsqueda a ese bloque
  para no confundirla con la tarjeta de Destino.
- Tarjeta destino: últimos 4 de `N° de tarjeta ************2120`.
- Normalización monetaria (ya existe): CLP quita `$` y puntos de miles; USD quita `USD$` y usa la
  coma como decimal. Sin float: `Money` en unidad menor.

Falta el monto pagado, la cuenta de origen o la tarjeta ⇒ se omite (`sin_monto` / `sin_instrumento`).

### 5. Identidad: campo `Transacción`, con Message-ID de fallback

Estos comprobantes traen un campo **`Transacción`** (`BCAMOVIL0120260628…`, `INTERNET_P20260628…`),
presente porque vienen del remitente de transferencias (igual que las TEF). Es alfanumérico y
estable por operación, así que es mejor identidad que el Message-ID. Se agrega un parser para ese
campo (el `parseTefId` actual solo acepta dígitos, no sirve). La identidad base es
`email:txn:<Transacción>`; si el campo faltara, cae a `email:mid:<Message-ID>`. En ambos casos se
**sufija por pata** (`:card` / `:cash`) para que las dos patas sean únicas e idempotentes.

## Risks / Trade-offs

- **`cashLeg` en `EmailEvent`:** agrega un campo que solo usan los pagos de tarjeta. Aceptable: es
  opcional (`null` en todo lo demás) y evita un refactor mayor del parser a listas.
- **Fan-out a dos movimientos:** el conteo de "importados" sube en 2 por correo, no 1. Es correcto
  (son dos movimientos reales en dos cuentas), pero hay que reflejarlo en los tests de conteo.
- **Snapshot parcial:** si el usuario confirmó la cuenta corriente pero no la tarjeta (o viceversa),
  el pago se omite completo. Es la política fail-closed vigente; el usuario ve el skip y puede
  agregar el instrumento faltante y refrescar.
- **Doble moneda internacional:** las dos patas viven en monedas distintas y nunca se suman; el
  `Money` ya prohíbe mezclar CLP/USD, así que un error de asignación de moneda falla ruidoso en vez
  de producir un total sin sentido.
