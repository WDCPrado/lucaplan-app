import assert from "node:assert/strict"
import { test } from "node:test"
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import { parseMachbankEmail } from "./machbank-email-map.ts"
import { routeEmail } from "./bank-email-registry.ts"

// Plantillas reales de MACHBANK con los datos reemplazados: nombres, RUT, cuenta de destino,
// últimos 4, identificadores y correos son inventados. Son tablas de "etiqueta | valor", así que
// cada celda queda en su propia línea tras htmlToText.
function message(over: Partial<BankEmailMessage> = {}): BankEmailMessage {
  return {
    id: "m-1",
    internetMessageId: "<m-1@example.test>",
    from: "no-reply@mail.machbank.cl",
    subject: "Realizaste una transferencia a Ana Pérez",
    receivedAt: new Date("2026-06-15T07:11:36Z"),
    htmlBody: TRANSFERENCIA_HTML,
    ...over,
  }
}

const TRANSFERENCIA_HTML = `
<p><b>Realizaste una transferencia</b></p>
<p>Hola Ana. Acabas de hacer una transferencia desde tu <b>cuenta principal MACHBANK.</b></p>
<table>
  <tr><td>Fecha</td><td><b>15/06/2026 - 03:11:26</b></td></tr>
  <tr><td>Nombre destinatario</td><td><b>Ana P&eacute;rez</b></td></tr>
  <tr><td>RUT</td><td><b>11.111.111-1</b></td></tr>
  <tr><td>Banco destino</td><td><b>BANCO FICTICIO</b></td></tr>
  <tr><td>Cuenta destino</td><td><b>999999995469</b></td></tr>
  <tr><td>Monto</td><td><b>$1.000</b></td></tr>
  <tr><td>Mensaje</td><td><b></b></td></tr>
  <tr><td>C&oacute;digo de confirmaci&oacute;n</td><td><b>112233445566</b></td></tr>
</table>
<p>Te recomendamos no ingresar a tu cuenta MACHBANK desde redes p&uacute;blicas de internet.</p>`

// El aviso de la plata que entra usa la MISMA maqueta que el saliente: lo único que cambia es el
// verbo ("Acabas de recibir"). Por eso el saliente exige su frase en el cuerpo.
const ABONO_HTML = TRANSFERENCIA_HTML.replace(
  "Acabas de hacer una transferencia desde tu <b>cuenta principal MACHBANK.</b>",
  "Acabas de recibir una transferencia de Ana P&eacute;rez <b>sin costo desde MACHBANK.</b>"
)

// La compra informa DOS montos y el pie menciona un rango en pesos: si el monto no saliera de la
// etiqueta "Monto CLP", este correo se importaría como 1 peso.
const COMPRA_HTML = `
<p>Comprobante de pago</p>
<table>
  <tr><td>Comercio</td><td><b>RAILWAY</b></td></tr>
  <tr><td>Monto (moneda original)</td><td><b>$ 1 USD</b></td></tr>
  <tr><td>Monto CLP</td><td><b>$ 943</b></td></tr>
  <tr><td>Tarjeta</td><td><b>Visa D&eacute;bito</b></td></tr>
  <tr><td>&Uacute;ltimos 4 d&iacute;gitos de la tarjeta</td><td><b>4321</b></td></tr>
  <tr><td>Nombre en tarjeta</td><td><b>ANA PEREZ</b></td></tr>
  <tr><td>Fecha y hora</td><td><b>11-06-2026 19:36</b></td></tr>
  <tr><td>Identificador Visa</td><td><b>346162814174956</b></td></tr>
</table>
<p>Recuerda que algunos comercios hacen un cargo de $500 a $1.500 para validar tu tarjeta.</p>`

const PAGO_DIRECTO_HTML = `
<p>Hola ANA</p>
<p>Le pagaste $15.750 a ANA PEREZ</p>
<p><b>Motivo:</b> Pago sin motivo. Agrega el motivo de cada pago y mant&eacute;n tus cuentas claras.</p>`

const PROMOCION_HTML = `<p>&iexcl;Beneficios del MES! Hasta $20.000 de descuento con tu MACHBANK.</p>`

test("MACHBANK se enruta por sus tres remitentes y solo por ellos", () => {
  for (const from of [
    "no-reply@mail.machbank.cl",
    "contacto@mail.machbank.cl",
    "noreply@somosmach.com",
  ])
    assert.equal(routeEmail(message({ from }))?.key, "machbank")
  assert.equal(routeEmail(message({ from: "hola@machbank.cl" })), null)
  assert.deepEqual(parseMachbankEmail(message({ from: "otro@example.test" })), {
    ok: false,
    reason: "remitente_desconocido",
  })
})

test("transferencia saliente: gasto CLP desde la cuenta principal, con destinatario, fecha e ID estables", () => {
  const parsed = parseMachbankEmail(message())
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.source, "transferencia")
  assert.equal(parsed.event.amount.toString(), "1000 CLP")
  // El correo no numera la cuenta: la refiere como la principal del vínculo.
  assert.deepEqual(parsed.event.instrument, { kind: "primary_checking" })
  assert.equal(parsed.event.description, "Transferencia a Ana Pérez")
  assert.equal(parsed.event.date.toISOString(), "2026-06-15T00:00:00.000Z")
  assert.equal(parsed.event.externalId, "email:txn:112233445566")
})

test("transferencia saliente: no se filtran RUT, banco ni cuenta del destinatario", () => {
  const parsed = parseMachbankEmail(message())
  assert.ok(parsed.ok)
  assert.doesNotMatch(
    parsed.event.description,
    /11\.111\.111|999999995469|BANCO FICTICIO/
  )
})

test("compra con Visa Débito en dólares: se cobra el Monto CLP, no el monto original", () => {
  const parsed = parseMachbankEmail(
    message({
      from: "contacto@mail.machbank.cl",
      subject: "Tu compra con MACHBANK 📲",
      htmlBody: COMPRA_HTML,
      receivedAt: new Date("2026-06-11T22:37:12Z"),
    })
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.source, "cargo_cuenta")
  // 943 CLP: ni el "$ 1 USD" de la moneda original ni el "$500" de la letra chica.
  assert.equal(parsed.event.amount.toString(), "943 CLP")
  // Débito: la tarjeta es de la cuenta corriente, nunca una tarjeta de crédito.
  assert.deepEqual(parsed.event.instrument, { kind: "checking", ref: "4321" })
  assert.equal(parsed.event.paymentTarget, null)
  assert.equal(parsed.event.description, "RAILWAY")
  assert.equal(parsed.event.date.toISOString(), "2026-06-11T00:00:00.000Z")
  assert.equal(parsed.event.externalId, "email:txn:346162814174956")
})

test("pago directo: gasto CLP desde la cuenta principal, con los fallbacks de fecha e identidad", () => {
  const parsed = parseMachbankEmail(
    message({
      from: "contacto@mail.machbank.cl",
      subject: "Le pagaste a ANA PEREZ",
      htmlBody: PAGO_DIRECTO_HTML,
      receivedAt: new Date("2026-06-05T17:58:34Z"),
    })
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.amount.toString(), "15750 CLP")
  assert.deepEqual(parsed.event.instrument, { kind: "primary_checking" })
  assert.equal(parsed.event.description, "Pago a ANA PEREZ")
  // Sin fecha ni ID propios en la plantilla: recepción y Message-ID.
  assert.equal(parsed.event.date.toISOString(), "2026-06-05T00:00:00.000Z")
  assert.equal(parsed.event.externalId, "email:mid:<m-1@example.test>")
})

test("reprocesar el mismo correo da la misma identidad (idempotencia)", () => {
  const msg = message()
  const a = parseMachbankEmail(msg)
  const b = parseMachbankEmail({ ...msg, id: "otro-id-de-graph" })
  assert.ok(a.ok && b.ok)
  assert.equal(a.event.externalId, b.event.externalId)
})

test("la plata que entra se descarta con su propio motivo, no se convierte en movimiento", () => {
  assert.deepEqual(
    parseMachbankEmail(
      message({
        from: "noreply@somosmach.com",
        subject: "Recibiste una transferencia de Ana Pérez",
        htmlBody: ABONO_HTML,
      })
    ),
    { ok: false, reason: "abono_ignorado" }
  )
})

test("el remitente que también manda marketing no crea movimientos con asuntos promocionales", () => {
  for (const subject of [
    "¡Beneficios del MES en MACHBANK!",
    "Tu resumen mensual MACHBANK",
  ])
    assert.deepEqual(
      parseMachbankEmail(
        message({
          from: "contacto@mail.machbank.cl",
          subject,
          htmlBody: PROMOCION_HTML,
        })
      ),
      { ok: false, reason: "asunto_desconocido" }
    )
})

test("fail-closed: cuerpo que no confirma la plantilla, sin monto y sin tarjeta se omiten", () => {
  // Asunto de transferencia saliente sobre el cuerpo de un abono: la maqueta es la misma.
  assert.deepEqual(parseMachbankEmail(message({ htmlBody: ABONO_HTML })), {
    ok: false,
    reason: "plantilla_desconocida",
  })
  // El origen también se confirma: sin "cuenta principal" no se sabe de dónde salió la plata.
  assert.deepEqual(
    parseMachbankEmail(
      message({
        htmlBody: TRANSFERENCIA_HTML.replace("cuenta principal MACHBANK.", ""),
      })
    ),
    { ok: false, reason: "plantilla_desconocida" }
  )
  // "Le pagaste" sin la forma completa "<monto> a <destinatario>" no alcanza.
  assert.deepEqual(
    parseMachbankEmail(
      message({
        from: "contacto@mail.machbank.cl",
        subject: "Le pagaste a ANA PEREZ",
        htmlBody: "<p>Le pagaste tu suscripción de $15.750</p>",
      })
    ),
    { ok: false, reason: "plantilla_desconocida" }
  )
  assert.deepEqual(
    parseMachbankEmail(
      message({ htmlBody: TRANSFERENCIA_HTML.replace("$1.000", "") })
    ),
    { ok: false, reason: "sin_monto" }
  )
  const compra = (htmlBody: string) =>
    parseMachbankEmail(
      message({
        from: "contacto@mail.machbank.cl",
        subject: "Tu compra con MACHBANK 📲",
        htmlBody,
      })
    )
  // Sin "Visa Débito" no se sabe si el cargo es de esta cuenta: la plantilla cambió.
  assert.deepEqual(compra(COMPRA_HTML.replace("Visa D&eacute;bito", "Visa")), {
    ok: false,
    reason: "plantilla_desconocida",
  })
  // Sin "Monto CLP" solo queda el monto en moneda original, que no es lo cobrado.
  assert.deepEqual(compra(COMPRA_HTML.replace("Monto CLP", "Total")), {
    ok: false,
    reason: "sin_monto",
  })
  assert.deepEqual(
    compra(
      COMPRA_HTML.replace(
        "&Uacute;ltimos 4 d&iacute;gitos de la tarjeta",
        "Terminal"
      )
    ),
    { ok: false, reason: "sin_instrumento" }
  )
})
