## 1. Contrato: la cuenta principal como instrumento

- [x] 1.1 Agregar la variante `{ kind: "primary_checking" }` a `EmailInstrumentRef` en `bank-email-map.ts`, documentando por qué existe
- [x] 1.2 Resolverla en `resolveEventTarget`/`resolveChecking` (`email-connection-use-cases.ts`): la única cuenta `checking` del vínculo; con cero o varias, `null`
- [x] 1.3 Incluirla en las dos proyecciones de saldo (`applyEventToProjection` y `applyEventToStoredBuckets`), para que el gasto descuente la caja
- [x] 1.4 En `detectCandidates` (`bancochile-email-candidates.ts`), contarla como movimiento pero no proponer candidato de cuenta

## 2. Parser MACHBANK

- [x] 2.1 Crear `machbank-email-map.ts` con los tres remitentes exportados y el parser puro, usando solo helpers de `bank-email-map.ts`
- [x] 2.2 Transferencia saliente: validar asunto + cuerpo, monto por etiqueta `Monto`, destinatario del asunto, `Código de confirmación` como `txnId`, instrumento `primary_checking`
- [x] 2.3 Compra Visa Débito: validar prefijo de asunto + `Tarjeta Visa Débito`, monto de `Monto CLP`, comercio de `Comercio`, últimos 4 por su etiqueta, `Identificador Visa` como `txnId`, instrumento `checking` por esos últimos 4
- [x] 2.4 Pago directo: validar `Le pagaste <monto> a <destinatario>` en el cuerpo, destinatario del asunto, sin `txnId` (fallback existente), instrumento `primary_checking`
- [x] 2.5 Abono: prefijo `Recibiste una transferencia de ` → `abono_ignorado`; resto → `asunto_desconocido`; remitente ajeno → `remitente_desconocido`

## 3. Catálogo

- [x] 3.1 Agregar la entrada `MACHBANK` (clave `machbank`, nombre visible `MACHBANK`, sus 3 remitentes, su parser) a `bank-email-registry.ts` y al `BANK_EMAIL_REGISTRY`
- [x] 3.2 Agregar el monograma de MACHBANK en `lib/bank-cards.ts` (arte propio, sin logos de terceros)

## 4. Tests (`node --test`)

- [x] 4.1 `machbank-email-map.test.ts` con fixtures anonimizados de los cuatro correos reales (RUT, nombres, cuentas, IDs y correos ficticios)
- [x] 4.2 Casos positivos: transferencia (gasto CLP + `primary_checking` + id estable), compra RAILWAY (943 CLP, nunca 1 USD, `checking` por los últimos 4 de la Visa Débito — el fixture los anonimiza), pago directo (gasto CLP + fallback de identidad y fecha)
- [x] 4.3 Casos negativos: abono → `abono_ignorado`, promoción del remitente compartido → `asunto_desconocido`, remitente ajeno → `remitente_desconocido`, plantilla sin monto → `sin_monto`, cuerpo que no confirma la plantilla → `asunto_desconocido`/`plantilla_desconocida`
- [x] 4.4 Resolución del instrumento en `email-connection.test.ts` o `email-multibank.test.ts`: una checking → importa y descuenta caja; cero o dos → omitido; reproceso del mismo correo → idempotente

## 5. Documentación

- [x] 5.1 Catálogo MACHBANK en `docs/bank-email-contract.md` (remitentes, asuntos, efecto, qué se extrae, alcance solo débito) y mención de la referencia a cuenta principal en "qué debe aportar un banco nuevo"
- [x] 5.2 Actualizar la mención de bancos soportados en el `README.md` si corresponde

## 6. Verificación

- [x] 6.1 `pnpm lint`, `pnpm typecheck`, `node --test "arch/**/*.test.ts"` y `openspec validate --strict`
- [x] 6.2 Reescribir `scripts/seed-pr-feature.ts` con lo mínimo para revisar la feature en el entorno del PR
