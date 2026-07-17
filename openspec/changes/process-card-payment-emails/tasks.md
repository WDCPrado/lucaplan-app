## 1. Parser: asuntos y campos (`bancochile-email-map.ts`)

- [x] 1.1 Agregar los asuntos exactos `Pago de Tarjeta de Crédito Nacional` e `Internacional` (normalizados: minúsculas, espacios, entidades, **tildes eliminadas**) a la rama del remitente `BCH_SENDER_TEF`, con validación secundaria del cuerpo (`se ha efectuado el pago de la tarjeta de crédito`). El `Comprobante pago...` del cuerpo no es el asunto.
- [x] 1.2 Extender `EmailEvent` con `cashLeg: { ref: string; amount: Money } | null` (null en todos los demás eventos).
- [x] 1.3 Parsers acotados por etiqueta: `Monto` (CLP pagado) distinto de `Utilizado`; `Monto pagado` en USD para el internacional; `Monto` en CLP para la caja del internacional (el regex de `Monto` NO debe capturar `Monto pagado`). Tolerar `N°`/`Nº`/`Nro`. Reusar/generalizar `parseLabeledClp` y agregar el equivalente USD por etiqueta.
- [x] 1.4 Cuenta de origen desde la sección "Origen" (reusar `originSection` + `parseAccountRef`); tarjeta destino por últimos 4 desde `N° de tarjeta ************NNNN`.
- [x] 1.5 Parser del campo `Transacción` (alfanumérico) para la identidad; `emailExternalId` prioriza `email:txn:<Transacción>` y cae a `email:mid:<Message-ID>`.
- [x] 1.6 Construir el evento de pago de tarjeta: `kind: "internal_payment"`, `source: "pago_tarjeta"`, `instrument = { credit_card, last4 }`, `paymentTarget = credit_national | credit_international` según moneda, `amount` = monto de la tarjeta, `cashLeg = { ref, amount CLP }`. Omitir fail-closed (`sin_monto` / `sin_instrumento`) si falta monto pagado, cuenta de origen o tarjeta.
- [x] 1.7 Descripción sin PII: "Pago Tarjeta de Crédito ••••NNNN".

## 2. Resolución y fan-out (`email-connection-use-cases.ts`)

- [x] 2.1 Resolver la pata de caja: cuenta corriente de origen por número/últimos 4 (reusar `resolveChecking`), además de la pata de deuda que ya resuelve `resolveEventTarget`.
- [x] 2.2 En `confirmEmailSetup` y `syncEmailConnection`, para un evento con `cashLeg` emitir DOS `ResolvedEmailMovement`: deuda (`externalId = <base>:card`, direction `credit`, bucket de la tarjeta) y caja (`externalId = <base>:cash`, direction `debit`, bucket `cash`), ambos `isInternal: true`.
- [x] 2.3 Si cualquiera de las dos patas no resuelve su instrumento, omitir el evento completo (no registrar media pata) y contarlo en `skipped`.
- [x] 2.4 Proyección por pata: caja → `applyDebitToCash`; deuda → `applyInternalPayment`. Solo movimientos nuevos y posteriores al snapshot mueven los buckets (regla vigente), por pata.

## 3. Tests (`email-connection.test.ts`)

- [x] 3.1 Fixture SANITIZADA (datos ficticios) del comprobante **nacional** con la estructura real (Origen, Destino, `Utilizado`, `Monto`).
- [x] 3.2 Fixture SANITIZADA del comprobante **internacional** (`Utilizado USD$`, sección `Detalle` con `Monto pagado USD$`, `Tipo de cambio`, `Monto` CLP).
- [x] 3.3 Parseo nacional: toma `Monto` (no `Utilizado`), tarjeta y cuenta correctas, `paymentTarget = credit_national`, `cashLeg` en CLP.
- [x] 3.4 Parseo internacional: deuda en USD (`Monto pagado`, no `Utilizado` ni `Monto`), caja en CLP (`Monto`), `paymentTarget = credit_international`.
- [x] 3.5 Resolución + proyección: la caja de origen baja por el monto pagado y el `Utilizado` de la tarjeta baja/libera cupo; ninguna pata cuenta como gasto/ingreso/presupuesto.
- [x] 3.6 Idempotencia: reprocesar el mismo correo no duplica ninguna de las dos patas (identidad `email:txn:<Transacción>` sufijada `:card` / `:cash`).
- [x] 3.7 Fail-closed: sin `Monto`, sin cuenta de origen o sin tarjeta → omitido; asunto parecido pero no exacto → `asunto_desconocido`.
- [x] 3.8 Rechazo con el mismo remitente: `Transferencia a Terceros` y pago de línea de crédito NO se procesan como pago de tarjeta.
- [x] 3.9 Tolerancia: `N°`/`Nº`/`Nro`, entidades HTML, saltos de línea y espacios extra; sin depender de nombre ni números reales.
- [x] 3.10 Ajustar los conteos de "importados" en los tests existentes que asuman 1 movimiento por correo (ahora el pago de tarjeta produce 2).

## 4. Spec y verificación

- [x] 4.1 Confirmar que el delta `bank-email-connection` refleja lo implementado (`opsx:verify`).
- [x] 4.2 `pnpm typecheck`, `pnpm lint` y `node --test` de `finance-use-cases` en verde.
- [x] 4.3 `pnpm format`.
