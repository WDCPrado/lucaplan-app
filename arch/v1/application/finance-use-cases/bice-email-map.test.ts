import assert from "node:assert/strict"
import { test } from "node:test"
import type { BankEmailMessage } from "../../domain/finance/email-connection.domain.ts"
import { parseBiceEmail } from "./bice-email-map.ts"
import { routeEmail } from "./bank-email-registry.ts"
import { parseDate } from "./bank-email-map.ts"

// Plantillas reales de BICE con los datos reemplazados: cuenta 12345678, tarjeta 4321 y nombres
// inventados. Son tablas de "etiqueta | valor", así que cada celda queda en su propia línea.
function message(over: Partial<BankEmailMessage> = {}): BankEmailMessage {
  return {
    id: "m-1",
    internetMessageId: "<m-1@example.test>",
    from: "reply@info.bice.cl",
    subject: "Hicimos la transferencia",
    receivedAt: new Date("2026-07-28T21:12:19Z"),
    htmlBody: TRANSFERENCIA_HTML,
    ...over,
  }
}

// La letra chica de las promociones va al pie de varias plantillas y trae cifras en pesos: si el
// monto no saliera de su etiqueta, cualquiera de estas podría pasar por el monto del movimiento.
const LETRA_CHICA = `<p>CAE:1,19%. Costo Total del Cr&eacute;dito de $300.594, calculado por un monto
  referencial de compras de $300.000 en 3 cuotas mensuales. Valor cuota: $100.000. Promoci&oacute;n
  v&aacute;lida hasta el 31 de agosto de 2026.</p>`

const TRANSFERENCIA_HTML = `
<p>Hola, Ana P&eacute;rez</p>
<p>Hicimos la transferencia que nos pediste por:</p>
<table><tr><td>Monto</td></tr><tr><td>$45.000</td></tr></table>
<table>
  <tr><td>Cuenta de origen</td><td>Tipo de cuenta</td><td>Cuenta corriente</td></tr>
  <tr><td>N&uacute;mero de cuenta</td><td>12345678</td></tr>
</table>
<table>
  <tr><td>Cuenta de destino</td><td>Nombre</td><td>Carla Soto</td></tr>
  <tr><td>RUT</td><td>11.111.111-1</td></tr>
  <tr><td>Banco</td><td>Banco Falabella</td></tr>
  <tr><td>Tipo de cuenta</td><td>Cuenta corriente</td></tr>
  <tr><td>N&uacute;mero de cuenta</td><td>999999995469048318</td></tr>
  <tr><td>Email</td><td>carla@example.test</td></tr>
</table>
<table><tr><td>Operaci&oacute;n</td><td>N&uacute;mero de operaci&oacute;n</td><td>239167263</td></tr></table>
<p>28 Jul 2026, 17:12</p>
${LETRA_CHICA}`

// El n&uacute;mero de cuenta viene con guiones en esta plantilla y sin ellos en la anterior: las dos
// tienen que resolver el mismo instrumento o el usuario terminaría con dos cuentas.
const PAGO_COMERCIO_HTML = `
<p>Hola, ANA PEREZ</p>
<p>Enviamos tu pago a Servipag. Ahora, es responsabilidad del comercio pagar y emitirte un comprobante.</p>
<table><tr><td>Monto</td></tr><tr><td>$252.474</td></tr></table>
<table>
  <tr><td>Cuenta de origen</td><td>Tipo de cuenta</td><td>Cuenta corriente</td></tr>
  <tr><td>N&uacute;mero de cuenta</td><td>12-34567-8</td></tr>
</table>
<table>
  <tr><td>Cuenta de destino</td><td>Comercio</td><td>Servipag</td></tr>
  <tr><td>Tipo de pago</td><td>Servicios</td></tr>
</table>
<table><tr><td>Operaci&oacute;n</td><td>N&uacute;mero de operaci&oacute;n</td><td>EXP0067420260790738557</td></tr></table>`

const PAGO_TARJETA_NAC_HTML = `
<p>Hola, ANA PEREZ</p>
<p>Pagaste tu tarjeta de cr&eacute;dito por:</p>
<table><tr><td>Monto</td></tr><tr><td>$262.060</td></tr></table>
<table>
  <tr><td>Datos del pago</td><td>Tipo de tarjeta</td><td>Visa Banca Joven</td></tr>
  <tr><td>N&uacute;mero de tarjeta</td><td>**** 4321</td></tr>
  <tr><td>Cupo</td><td>Nacional</td></tr>
  <tr><td>Medio de pago</td><td>Cuenta corriente N&deg; 12345678</td></tr>
</table>
<table><tr><td>Operaci&oacute;n</td><td>N&uacute;mero de operaci&oacute;n</td><td>240217903</td></tr></table>
<p>03 ago 2026 - 09:15 h</p>`

const PAGO_TARJETA_INT_HTML = `
<p>Hola, ANA PEREZ</p>
<p>Pagaste tu tarjeta de cr&eacute;dito por:</p>
<table><tr><td>Monto</td></tr><tr><td>US$500,00</td></tr></table>
<table>
  <tr><td>Datos del pago</td><td>Tipo de tarjeta</td><td>Visa Banca Joven</td></tr>
  <tr><td>N&uacute;mero de tarjeta</td><td>**** 4321</td></tr>
  <tr><td>Cupo</td><td>Internacional</td></tr>
  <tr><td>Medio de pago</td><td>Cuenta corriente N&deg; 12345678</td></tr>
  <tr><td>Monto pagado</td><td>$456.625</td></tr>
  <tr><td>Tipo de cambio</td><td>$913</td></tr>
</table>
<table><tr><td>Operaci&oacute;n</td><td>N&uacute;mero de operaci&oacute;n</td><td>232106264</td></tr></table>`

test("BICE se enruta por su remitente y solo por ese", () => {
  assert.equal(routeEmail(message())?.key, "bice")
  assert.equal(
    routeEmail(message({ from: "beneficiosbice@info.bice.cl" })),
    null
  )
  assert.equal(
    routeEmail(message({ from: "newsletter-bicestore@bicestore.cl" })),
    null
  )
  assert.deepEqual(parseBiceEmail(message({ from: "otro@example.test" })), {
    ok: false,
    reason: "remitente_desconocido",
  })
})

test("transferencia enviada: gasto de la cuenta de origen, con el destinatario y la fecha del cuerpo", () => {
  const parsed = parseBiceEmail(message())
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.source, "transferencia")
  assert.equal(parsed.event.amount.toString(), "45000 CLP")
  assert.deepEqual(parsed.event.instrument, {
    kind: "checking",
    ref: "12345678",
  })
  // El nombre sale de la sección de destino, no del saludo al titular.
  assert.equal(parsed.event.description, "Transferencia a Carla Soto")
  assert.equal(parsed.event.date.toISOString(), "2026-07-28T00:00:00.000Z")
  assert.equal(parsed.event.externalId, "email:txn:239167263")
})

test("transferencia enviada: no se filtran RUT, correo ni cuenta del destinatario", () => {
  const parsed = parseBiceEmail(message())
  assert.ok(parsed.ok)
  assert.doesNotMatch(
    parsed.event.description,
    /11\.111\.111|example\.test|999999995469048318/
  )
})

test("pago a un comercio: gasto con el comercio del asunto y la misma cuenta pese a los guiones", () => {
  const parsed = parseBiceEmail(
    message({
      subject: "Enviamos tu pago a Servipag",
      htmlBody: PAGO_COMERCIO_HTML,
      receivedAt: new Date("2026-07-28T20:14:48Z"),
    })
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.source, "transferencia_fondos")
  assert.equal(parsed.event.amount.toString(), "252474 CLP")
  assert.deepEqual(parsed.event.instrument, {
    kind: "checking",
    ref: "12345678",
  })
  assert.equal(parsed.event.description, "Pago a Servipag")
  // Sin fecha en el cuerpo: la de recepción, truncada al día.
  assert.equal(parsed.event.date.toISOString(), "2026-07-28T00:00:00.000Z")
  assert.equal(parsed.event.externalId, "email:txn:EXP0067420260790738557")
})

test("pago de tarjeta nacional: interno en pesos, con la pata de caja en la cuenta del medio de pago", () => {
  const parsed = parseBiceEmail(
    message({
      subject: "Confirmación del pago de tarjeta de crédito",
      htmlBody: PAGO_TARJETA_NAC_HTML,
      receivedAt: new Date("2026-08-03T13:16:07Z"),
    })
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.event.kind, "internal_payment")
  assert.equal(parsed.event.source, "pago_tarjeta")
  assert.equal(parsed.event.paymentTarget, "credit_national")
  assert.equal(parsed.event.amount.toString(), "262060 CLP")
  assert.deepEqual(parsed.event.instrument, {
    kind: "credit_card",
    last4: "4321",
  })
  assert.equal(parsed.event.cashLeg?.ref, "12345678")
  assert.equal(parsed.event.cashLeg?.amount.toString(), "262060 CLP")
  assert.equal(parsed.event.date.toISOString(), "2026-08-03T00:00:00.000Z")
})

test("pago de tarjeta internacional: deuda en dólares (Monto) y caja en pesos (Monto pagado)", () => {
  const parsed = parseBiceEmail(
    message({
      subject: "Confirmación del pago de tarjeta de crédito",
      htmlBody: PAGO_TARJETA_INT_HTML,
    })
  )
  assert.ok(parsed.ok)
  assert.equal(parsed.event.paymentTarget, "credit_international")
  assert.equal(parsed.event.amount.toString(), "500 USD")
  assert.equal(parsed.event.cashLeg?.amount.toString(), "456625 CLP")
  // El tipo de cambio ($913) no puede colarse como monto de ninguna de las dos patas.
  assert.equal(parsed.event.cashLeg?.ref, "12345678")
})

test("la plata que entra se descarta con su propio motivo, no se convierte en movimiento", () => {
  for (const subject of [
    "Recibiste una transferencia",
    "Aviso de transferencia de fondos",
  ]) {
    assert.deepEqual(parseBiceEmail(message({ subject })), {
      ok: false,
      reason: "abono_ignorado",
    })
  }
})

test("fail-closed: asunto no catalogado, sin monto, sin cupo y sin cuenta se omiten", () => {
  assert.deepEqual(
    parseBiceEmail(
      message({ subject: "Tu Cartola de Cuenta Corriente Banco BICE" })
    ),
    { ok: false, reason: "asunto_desconocido" }
  )
  assert.deepEqual(
    parseBiceEmail(
      message({ htmlBody: TRANSFERENCIA_HTML.replace("$45.000", "") })
    ),
    { ok: false, reason: "sin_monto" }
  )
  assert.deepEqual(
    parseBiceEmail(
      message({ htmlBody: TRANSFERENCIA_HTML.replace(/cuenta/gi, "producto") })
    ),
    { ok: false, reason: "sin_instrumento" }
  )
  // Sin "Cupo" no se sabe si la deuda es en pesos o en dólares: la plantilla cambió.
  assert.deepEqual(
    parseBiceEmail(
      message({
        subject: "Confirmación del pago de tarjeta de crédito",
        htmlBody: PAGO_TARJETA_NAC_HTML.replace(
          "Cupo",
          "Tipo de cupo del producto"
        ),
      })
    ),
    { ok: false, reason: "plantilla_desconocida" }
  )
})

test("WDC-179: sin fecha en el cuerpo, el cargo es del día de recepción en Chile, no en UTC", () => {
  // 01:00 UTC del 5-oct = 22:00 del 4-oct en Chile.
  const recibido = new Date("2026-10-05T01:00:00Z")
  assert.equal(parseDate("sin fecha", recibido).toISOString(), "2026-10-04T00:00:00.000Z")
  const bice = parseBiceEmail(
    message({ receivedAt: recibido, htmlBody: TRANSFERENCIA_HTML.replace("28 Jul 2026, 17:12", "") })
  )
  assert.ok(bice.ok)
  assert.equal(bice.event.date.toISOString(), "2026-10-04T00:00:00.000Z", "BICE usa el mismo respaldo")
})
