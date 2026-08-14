## Why

MACHBANK ya notifica por correo cada transferencia, pago y compra con Visa Débito al mismo buzón de
Outlook que la app lee para Banco de Chile y BICE, pero hoy esos avisos se descartan porque ningún
banco del catálogo los reclama. Es plata que sale y no aparece en el mes.

La cuenta MACHBANK del usuario es **solo débito**: no tiene tarjeta de crédito, cuotas ni línea de
crédito, así que el adapter se acota a eso y no arrastra el modelo de cupos que sí necesitan los
otros bancos.

## What Changes

- **MACHBANK entra al catálogo de bancos por correo** (clave `machbank`), con sus tres remitentes
  reales y su parser propio. Ningún use-case aprende nada de MACHBANK: lo único que cambia fuera del
  parser es el soporte **genérico** de la nueva referencia de instrumento (punto 4).
- **Tres plantillas producen gasto CLP**: transferencia saliente, compra con Visa Débito (el monto
  es el `Monto CLP`, aunque la compra sea en dólares) y pago directo (`Le pagaste a …`).
- **El aviso de transferencia recibida se descarta** con `abono_ignorado`, igual que en el resto de
  los bancos: del correo nunca sale una entrada de dinero.
- **Nueva referencia de instrumento `primary_checking`** en el contrato del parser: dos de las tres
  plantillas dicen "tu cuenta principal MACHBANK" sin número de cuenta. Se resuelve a la única
  cuenta corriente confirmada del vínculo; con cero o varias, el movimiento se omite.
- **Fuera de alcance, explícito**: tarjeta de crédito, cupos nacional/internacional, compras en
  cuotas, pago de tarjeta, línea de crédito y sobregiro. Ninguna plantilla MACHBANK produce un
  evento de crédito, así que el escaneo solo propone la cuenta corriente y el único bucket que nace
  del adapter es `cash`. El formulario de confirmación sigue siendo el genérico: lo que el usuario
  agregue a mano ahí es decisión suya, como en cualquier banco.

## Capabilities

### New Capabilities

(ninguna: MACHBANK entra por el catálogo existente)

### Modified Capabilities

- `bank-email-registry`: el contrato común del parser admite una referencia de instrumento sin
  número —la cuenta principal del vínculo— además de cuenta por número/últimos 4 y tarjeta.
- `bank-email-connection`: filtrado cerrado de las notificaciones MACHBANK (solo débito) y
  resolución de la referencia a cuenta principal contra los instrumentos confirmados.

## Impact

- `arch/v1/application/finance-use-cases/machbank-email-map.ts` (nuevo) + su test.
- `arch/v1/application/finance-use-cases/bank-email-map.ts`: variante `primary_checking` en
  `EmailInstrumentRef`.
- `arch/v1/application/finance-use-cases/bank-email-registry.ts`: entrada `MACHBANK`.
- `arch/v1/application/finance-use-cases/email-connection-use-cases.ts`: resolución y proyección de
  la nueva referencia.
- `arch/v1/application/finance-use-cases/bancochile-email-candidates.ts`: la referencia sin número
  no propone candidato de cuenta.
- `lib/bank-cards.ts`: monograma propio de MACHBANK (arte de tarjeta; nunca logos de terceros).
- `docs/bank-email-contract.md`: catálogo MACHBANK.
- Sin migraciones, sin variables de entorno nuevas y sin componentes nuevos: el banco aparece solo
  en el selector porque sale del catálogo.

---

## Revisión cruzada (Claude + Codex)

**Qué revisó Codex:** los cuatro artefactos del change contra el código real de la conexión por
correo (contrato del parser, resolución de instrumentos, proyección, formulario de confirmación).

**Aceptado y corregido:**
- "Los use-cases multi-banco no se tocan" era falso → la nueva referencia obliga a tocar
  `email-connection-use-cases.ts` en resolución y en las dos proyecciones. Reescrito: ningún
  use-case aprende de MACHBANK, pero sí gana soporte **genérico** para la referencia nueva.
- "MACHBANK solo crea el bucket `cash`" leído como una restricción del setup → reescrito como lo que
  realmente es: ninguna plantilla MACHBANK produce eventos de crédito, así que el escaneo solo
  propone la cuenta corriente.
- "se omite con motivo visible" prometía una persistencia de motivos que no existe → cambiado por el
  contador de omitidos del vínculo (`skippedCount`), que es lo que el estado ya muestra.

**Descartado:**
- "La confirmación MUST rechazar `overdraft` y `cards[]` cuando el banco es `machbank`": mete una
  regla por banco en un use-case que hoy es agnóstico —el catálogo existe justo para que agregar un
  banco no toque los use-cases (`openspec/specs/bank-email-registry/spec.md`)— y protege contra algo
  que nadie va a hacer: el formulario solo ofrece tarjetas que el usuario agregue a mano. El alcance
  "solo débito" se sostiene en que el parser nunca emite eventos de crédito.
- "Agregar motivos `primary_checking_ambiguo` / `primary_checking_sin_cuenta`": los motivos de
  omisión son del parser, no del mapeo; un mapeo que no resuelve ya cuenta como omitido en todos los
  bancos. Inventar una segunda taxonomía para un caso que hoy es teórico es sobre-diseño.

**Conclusión:** de acuerdo en que el spec prometía más precisión de la que el código da (use-cases
intactos, motivos por causa) y en que eso se corrige redactando, no agregando código. Riesgo vivo:
si algún día un vínculo llega a tener dos cuentas corrientes, las transferencias MACHBANK dejan de
importarse silenciosamente salvo por el contador de omitidos.

### Verificación post-apply (Codex, read-only)

Cobertura completa de los requisitos; sin deriva de alcance. Tres hallazgos:

- **Aceptado** — la transferencia solo confirmaba el verbo (`Acabas de hacer`) y no el origen: ahora
  exige también que el cuerpo declare la cuenta principal, como pide la spec.
- **Aceptado** — el pago directo aceptaba cualquier línea que empezara con `Le pagaste`: ahora exige
  la forma completa `Le pagaste <monto> a <destinatario>`.
- **Descartado** — "omitir el correo cuando falte el `Código de confirmación` o el `Identificador
  Visa`": el contrato del repo define esos IDs como *preferencia*, no como requisito
  (`docs/bank-email-contract.md`, orden ID banco → TEF → `Message-ID` → id del proveedor), y BICE se
  comporta igual (`bice-email-map.ts`, `txnId` nullable). Exigirlos haría a MACHBANK más estricto
  que el resto y perdería movimientos reales si el banco renombra una etiqueta.

Codex no pudo correr las verificaciones (sandbox read-only). Corridas aquí: `pnpm lint` (0 errores,
3 warnings preexistentes), `pnpm typecheck` ✓, `node --test "arch/**/*.test.ts"` 354/354 ✓,
`openspec validate --strict` ✓ y `pnpm seed:pr` contra una base local ✓.
