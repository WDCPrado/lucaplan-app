import assert from "node:assert/strict"
import { test } from "node:test"
import { Money } from "../../domain/finance/money.ts"
import type {
  BankEmailMessage,
  EmailBankLink,
  EmailBankLinkWithMailbox,
  EmailMailbox,
} from "../../domain/finance/email-connection.domain.ts"
import { parseBancoChileEmail } from "./bancochile-email-map.ts"
import { parseMachbankEmail } from "./machbank-email-map.ts"
import { detectCandidates } from "./bancochile-email-candidates.ts"
import {
  applyCreditPurchase,
  applyDebitToCash,
  applyInternalCredit,
  applyInternalPayment,
} from "./email-projection.ts"
import {
  confirmEmailSetup,
  resolveEventTarget,
  scanEmailCandidates,
  syncMailbox,
  type EmailConfirmPersistInput,
  type EmailConnectionDeps,
  type EmailStoredBucket,
} from "./email-connection-use-cases.ts"

const message = (over: Partial<BankEmailMessage> = {}): BankEmailMessage => ({
  id: "graph-1",
  internetMessageId: "<sanitized-1@example.test>",
  from: "enviodigital@bancochile.cl",
  subject: "Compra con Tarjeta de Crédito",
  receivedAt: new Date("2026-07-14T12:00:00Z"),
  htmlBody:
    "Compra por $ 12.345 en COMERCIO PRUEBA con tu tarjeta terminada en 1234 el 14/07/2026.",
  ...over,
})

// --- Fakes del buzón y su vínculo con un banco ---

// El proveedor real pregunta a Graph por la fecha del último correo de esos remitentes; el fake la
// deriva de los mismos mensajes que entrega, para que la ventana del escaneo salga de los datos del
// test en vez de fijarse a mano.
const lastDateFrom =
  (messages: BankEmailMessage[]) =>
  async (_id: string, senders: string[], since: Date, until: Date) => {
    const times = messages
      .filter((m) => senders.includes(m.from.trim().toLowerCase()))
      .map((m) => m.receivedAt.getTime())
      .filter((t) => t >= since.getTime() && t <= until.getTime())
    return times.length ? new Date(Math.max(...times)) : null
  }

const mailbox = (over: Partial<EmailMailbox> = {}): EmailMailbox => ({
  id: "mbx-1",
  userId: "user-1",
  emailProvider: "outlook",
  emailAddress: "sanitized@example.test",
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  deltaLink: null,
  subscriptionId: null,
  subscriptionExpiresAt: null,
  lastSyncedAt: null,
  lastError: null,
  discardedCount: 0,
  ...over,
})

const link = (
  over: Partial<EmailBankLinkWithMailbox> = {}
): EmailBankLinkWithMailbox => ({
  id: "link-1",
  mailboxId: "mbx-1",
  userId: "user-1",
  bankProvider: "bancochile",
  label: null,
  bankId: null,
  status: "pending_setup",
  createdAt: new Date("2026-07-14T12:00:00Z"),
  skippedCount: 0,
  lastBalanceReconciledAt: null,
  mailbox: mailbox(),
  ...over,
})

// Repos en memoria: devuelven siempre los mismos vínculos y aceptan las escrituras sin guardarlas
// (los tests observan el efecto en el store y en los mensajes, no en estas filas).
const repos = (links: EmailBankLinkWithMailbox[]) => ({
  mailboxes: {
    listByUser: async () => links.map((l) => l.mailbox),
    findById: async (id: string) =>
      links.find((l) => l.mailboxId === id)?.mailbox ?? null,
    findByAddress: async () => links[0]?.mailbox ?? null,
    findBySubscriptionId: async () => null,
    listForSubscriptionRenewal: async () => [],
    create: async () => links[0].mailbox,
    update: async () => links[0].mailbox,
    delete: async () => {},
  },
  links: {
    listByUser: async () => links,
    listByMailbox: async (mailboxId: string): Promise<EmailBankLink[]> =>
      links.filter((l) => l.mailboxId === mailboxId),
    findById: async (id: string) => links.find((l) => l.id === id) ?? null,
    create: async () => links[0],
    update: async () => links[0],
    delete: async () => {},
  },
})

const methodsFake = {
  activeMethod: async () => "email" as const,
  claim: async () => {},
  release: async () => {},
}

const noDependents = {
  accounts: 0,
  movements: 0,
  recurring: 0,
  installments: 0,
  incomes: 0,
}

test("parser fail-closed extrae gastos CLP/USD y excluye remitentes/asuntos no permitidos", () => {
  const clp = parseBancoChileEmail(message())
  assert.equal(clp.ok, true)
  if (clp.ok) {
    assert.equal(clp.event.amount.toMajor(), 12345)
    assert.equal(clp.event.amount.currency, "CLP")
    assert.deepEqual(clp.event.instrument, {
      kind: "credit_card",
      last4: "1234",
    })
  }

  const usd = parseBancoChileEmail(
    message({
      id: "graph-2",
      htmlBody:
        "Compra por US$ 19,90 en COMERCIO PRUEBA con tu tarjeta **** 1234.",
    })
  )
  assert.equal(usd.ok, true)
  if (usd.ok) assert.equal(usd.event.amount.toDecimalString(), "19.90")

  assert.deepEqual(
    parseBancoChileEmail(message({ from: "alertas@example.test" })),
    {
      ok: false,
      reason: "remitente_desconocido",
    }
  )
  assert.deepEqual(
    parseBancoChileEmail(message({ subject: "Cartola mensual" })),
    {
      ok: false,
      reason: "asunto_desconocido",
    }
  )
})

// Fixture sanitizado con la estructura de la plantilla real de "Cargo en Cuenta":
// "compra por <monto> con cargo a Cuenta <cuenta> en <comercio> el <fecha>".
const CARGO_CUENTA_HTML = `
<table><tr><td>
  <p>Estimado cliente:</p>
  <p>Te informamos que se ha realizado una compra por $ 25.990 con cargo a
  Cuenta ***8900 en COMERCIO EJEMPLO SPA el 14/07/2026 a las 18:32 hrs.</p>
</td></tr></table>`

test("cargo en cuenta usa el comercio de la plantilla real como descripción, no el asunto", () => {
  const parsed = parseBancoChileEmail(
    message({ subject: "Cargo en Cuenta", htmlBody: CARGO_CUENTA_HTML })
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.event.description, "COMERCIO EJEMPLO SPA")
  assert.equal(parsed.event.amount.toMajor(), 25990)
  assert.equal(parsed.event.amount.currency, "CLP")
  assert.deepEqual(parsed.event.instrument, { kind: "checking", ref: "8900" })
  assert.equal(parsed.event.date.toISOString().slice(0, 10), "2026-07-14")
})

// Fixture sanitizado con la estructura de la plantilla real de "Compra con Tarjeta de Crédito":
// "compra por <monto> con Tarjeta de Crédito ****<last4> en <comercio> el <fecha> <hora>".
const COMPRA_TARJETA_HTML = `
<table><tr><td>
  <p>NOMBRE CLIENTE PRUEBA:</p>
  <p>Te informamos que se ha realizado una compra por $1.890 con Tarjeta de
  Crédito ****2120 en COMERCIO PRUEBA el 14/07/2026 19:32.
  Revisa Saldos y Movimientos en App Mi Banco o Banco en Línea.</p>
</td></tr></table>`

test("compra con tarjeta usa el comercio de la plantilla real como descripción, no el asunto", () => {
  const parsed = parseBancoChileEmail(
    message({ htmlBody: COMPRA_TARJETA_HTML })
  )
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.event.description, "COMERCIO PRUEBA")
  assert.equal(parsed.event.amount.toMajor(), 1890)
  assert.equal(parsed.event.amount.currency, "CLP")
  assert.deepEqual(parsed.event.instrument, {
    kind: "credit_card",
    last4: "2120",
  })
})

test("parser extrae TEF, descarta abonos y trata pagos como eventos internos", () => {
  const transfer = parseBancoChileEmail(
    message({
      from: "serviciodetransferencias@bancochile.cl",
      subject: "Transferencia a Terceros",
      htmlBody:
        "Transferencia a DESTINATARIO PRUEBA por $ 5.000. Cuenta N° 001-2345. N° de operación 987654.",
    })
  )
  assert.equal(transfer.ok, true)
  if (transfer.ok) {
    assert.equal(transfer.event.externalId, "email:tef:987654")
    assert.equal(transfer.event.kind, "expense")
  }

  // Un abono se reconoce para DESCARTARLO: la plata que entra se declara en Ingresos.
  const credit = parseBancoChileEmail(
    message({
      from: "serviciodetransferencias@bancochile.cl",
      subject: "Aviso de transferencia de fondos",
      htmlBody:
        "Abono por $ 9.000 en cuenta terminada en 2345. N° de operación 876543.",
    })
  )
  assert.deepEqual(credit, { ok: false, reason: "abono_ignorado" })

  const payment = parseBancoChileEmail(
    message({
      subject: "Pago Tarjeta de Crédito",
      htmlBody: "Pago por $ 4.000 a tarjeta terminada en 1234.",
    })
  )
  assert.equal(payment.ok, true)
  if (payment.ok) {
    assert.equal(payment.event.kind, "internal_payment")
    assert.equal(payment.event.paymentTarget, "credit_national")
  }
})

// Fixture SANITIZADA (datos ficticios) con la estructura real de "Comprobante Pago Credito
// Consumo": varias cifras ($ interés, penal, cobranza) antes del monto pagado, y dos fechas.
const PAGO_CONSUMO_HTML = `
<table><tr><td>
  <p>Estimado(a) NOMBRE CLIENTE PRUEBA</p>
  <p>Te informamos que has realizado un Pago de Cuota de tu Cr&eacute;dito de Consumo
  N&deg; 999900001111222233, el d&iacute;a 03/07/2026.</p>
  <p>Datos de Origen</p>
  <table><tr><td>Cuenta de Cargo</td><td>Cuenta Corriente</td></tr>
  <tr><td>N&deg; de Cuenta</td><td>00-999-11111-00</td></tr></table>
  <p>Datos de Destino</p>
  <table><tr><td>N&deg; de Cr&eacute;dito</td><td>999900001111222233</td></tr>
  <tr><td>Fecha de Vencimiento</td><td>06/07/2026</td></tr>
  <tr><td>N&deg; Cuota</td><td>3</td></tr>
  <tr><td>Inter&eacute;s</td><td>$136.097</td></tr>
  <tr><td>Inter&eacute;s Penal</td><td>$0</td></tr>
  <tr><td>Inter&eacute;s Cobranza</td><td>$0</td></tr></table>
  <p>Datos de la Transacci&oacute;n</p>
  <table><tr><td>Fecha</td><td>03/07/2026</td></tr>
  <tr><td>Hora</td><td>21:14 horas</td></tr>
  <tr><td>Monto Pagado</td><td>$265.708</td></tr></table>
</td></tr></table>`

const pagoConsumo = (over: Partial<BankEmailMessage> = {}) =>
  message({
    from: "serviciodetransferencias@bancochile.cl",
    subject: "Comprobante Pago Credito Consumo",
    htmlBody: PAGO_CONSUMO_HTML,
    ...over,
  })

test("pago de crédito de consumo es gasto categorizable, con el monto pagado y la cuenta de origen", () => {
  const parsed = parseBancoChileEmail(pagoConsumo())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  // Gasto real: el consumo financiado por el crédito nunca entró a la app, y la cuota trae
  // intereses. Va a presupuesto y al categorizador de IA (a diferencia del pago de tarjeta).
  assert.equal(parsed.event.kind, "expense")
  assert.equal(parsed.event.source, "pago_credito_consumo")
  assert.equal(parsed.event.paymentTarget, null) // nunca tarjeta ni sobregiro
  assert.equal(parsed.event.amount.toMajor(), 265708) // no el interés ($136.097)
  assert.equal(parsed.event.date.toISOString().slice(0, 10), "2026-07-03") // no el vencimiento
  assert.deepEqual(parsed.event.instrument, {
    kind: "checking",
    ref: "009991111100",
  })
  assert.equal(parsed.event.description, "Pago cuota 3 de crédito de consumo")
  // Sin ID de operación: identidad idempotente por Message-ID, y sin el N° de crédito.
  assert.equal(parsed.event.externalId, "email:mid:<sanitized-1@example.test>")
  assert.ok(!parsed.event.description.includes("9999"))
})

test("pago de crédito de consumo se omite fail-closed sin monto o con asunto parecido", () => {
  assert.deepEqual(
    parseBancoChileEmail(
      pagoConsumo({ subject: "Comprobante Pago Credito Consumo Vigente" })
    ),
    { ok: false, reason: "asunto_desconocido" }
  )
  assert.deepEqual(
    parseBancoChileEmail(
      pagoConsumo({
        htmlBody: PAGO_CONSUMO_HTML.replace("Monto Pagado", "Monto"),
      })
    ),
    { ok: false, reason: "sin_monto" }
  )
  assert.deepEqual(
    parseBancoChileEmail(
      pagoConsumo({
        htmlBody: PAGO_CONSUMO_HTML.replace(/Cuenta/g, "Producto"),
      })
    ),
    { ok: false, reason: "sin_instrumento" }
  )
})

test("pago de crédito de consumo baja la caja de la cuenta de origen", () => {
  const parsed = parseBancoChileEmail(pagoConsumo())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const accounts = [
    {
      id: "acc-1",
      accountType: "checking",
      currency: "CLP" as const,
      externalRef: "009991111100",
      cardLast4: "1100",
    },
  ]
  const buckets: EmailStoredBucket[] = [
    {
      id: "b-cash",
      accountId: "acc-1",
      kind: "cash",
      currency: "CLP",
      limitAmount: Money.zero("CLP"),
      used: Money.zero("CLP"),
      available: Money.fromMinor(500000, "CLP"),
    },
  ]
  assert.deepEqual(resolveEventTarget(parsed.event, accounts, buckets), {
    accountId: "acc-1",
    bucketId: "b-cash",
  })
  const res = applyDebitToCash(buckets[0], null, parsed.event.amount)
  assert.equal(res.cash.available.toMajor(), 234292)
})

// Fixture SANITIZADA (datos ficticios) del comprobante de pago de tarjeta NACIONAL. El asunto real
// es "Pago de Tarjeta de Crédito Nacional"; el cuerpo se titula "Comprobante pago...". El primer
// monto es "Utilizado" (deuda previa), el pago es "Monto".
const PAGO_TARJETA_NAC_HTML = `
<table><tr><td>
  <p>Comprobante pago Tarjeta de Crédito Nacional</p>
  <p>Estimado(a): NOMBRE CLIENTE PRUEBA</p>
  <p>Te informamos que se ha efectuado el pago de la tarjeta de crédito
  nacional en forma exitosa con el siguiente detalle:</p>
  <p>Origen</p>
  <table><tr><td>Tipo de cuenta</td><td>Cuenta Corriente</td></tr>
  <tr><td>N&deg; de cuenta</td><td>00-999-11111-00</td></tr></table>
  <p>Destino</p>
  <table><tr><td>Tipo de tarjeta</td><td>Tarjeta de Crédito</td></tr>
  <tr><td>N&deg; de tarjeta</td><td>************2120</td></tr>
  <tr><td>Utilizado</td><td>$540.835</td></tr>
  <tr><td>Monto</td><td>$652.580</td></tr></table>
  <p>Fecha y Hora</p><p>28/06/2026 16:33</p>
  <p>Transacci&oacute;n</p><p>BCAMOVIL012026062800111122223</p>
</td></tr></table>`

// Fixture SANITIZADA del comprobante INTERNACIONAL: deuda en USD ("Monto pagado"), cargo a la
// cuenta corriente en CLP ("Monto"), con "Utilizado" en USD y "Tipo de cambio" como ruido.
const PAGO_TARJETA_INT_HTML = `
<table><tr><td>
  <p>Comprobante pago Tarjeta de Crédito Internacional</p>
  <p>Estimado(a): NOMBRE CLIENTE PRUEBA</p>
  <p>Te informamos que se ha efectuado el pago de la tarjeta de crédito
  internacional en forma exitosa con el siguiente detalle:</p>
  <p>Origen</p>
  <table><tr><td>Tipo de cuenta</td><td>Cuenta Corriente</td></tr>
  <tr><td>N&ordm; de cuenta</td><td>00-999-11111-00</td></tr></table>
  <p>Destino</p>
  <table><tr><td>Tipo de tarjeta</td><td>Tarjeta de Crédito</td></tr>
  <tr><td>N&ordm; de tarjeta</td><td>************2120</td></tr>
  <tr><td>Utilizado</td><td>USD$12,00</td></tr></table>
  <p>Detalle</p>
  <table><tr><td>Monto pagado</td><td>USD$142,05</td></tr>
  <tr><td>Tipo de cambio</td><td>$947</td></tr>
  <tr><td>Monto</td><td>$134.571</td></tr></table>
  <p>Transacci&oacute;n</p><p>INTERNET_P2026062800222233</p>
</td></tr></table>`

const TEF = "serviciodetransferencias@bancochile.cl"
const pagoTarjetaNac = (over: Partial<BankEmailMessage> = {}) =>
  message({
    id: "graph-tn",
    from: TEF,
    subject: "Pago de Tarjeta de Crédito Nacional",
    htmlBody: PAGO_TARJETA_NAC_HTML,
    ...over,
  })
const pagoTarjetaInt = (over: Partial<BankEmailMessage> = {}) =>
  message({
    id: "graph-ti",
    from: TEF,
    subject: "Pago de Tarjeta de Crédito Internacional",
    htmlBody: PAGO_TARJETA_INT_HTML,
    ...over,
  })

test("pago de tarjeta nacional: interno, toma Monto (no Utilizado), con pata de caja", () => {
  const parsed = parseBancoChileEmail(pagoTarjetaNac())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.event.kind, "internal_payment")
  assert.equal(parsed.event.source, "pago_tarjeta")
  assert.equal(parsed.event.paymentTarget, "credit_national")
  assert.deepEqual(parsed.event.instrument, {
    kind: "credit_card",
    last4: "2120",
  })
  assert.equal(parsed.event.amount.toMajor(), 652580) // no 540835 (Utilizado)
  assert.equal(parsed.event.amount.currency, "CLP")
  assert.equal(parsed.event.cashLeg?.ref, "009991111100")
  assert.equal(parsed.event.cashLeg?.amount.toMajor(), 652580)
  assert.equal(parsed.event.cashLeg?.amount.currency, "CLP")
  assert.equal(parsed.event.description, "Pago Tarjeta de Crédito ••••2120")
  // Identidad por el campo Transacción (sufijo por pata lo agrega el use-case).
  assert.equal(
    parsed.event.externalId,
    "email:txn:BCAMOVIL012026062800111122223"
  )
})

test("pago de tarjeta internacional: deuda USD (Monto pagado), caja CLP (Monto)", () => {
  const parsed = parseBancoChileEmail(pagoTarjetaInt())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.event.paymentTarget, "credit_international")
  assert.equal(parsed.event.amount.currency, "USD")
  assert.equal(parsed.event.amount.toDecimalString(), "142.05") // no 12,00
  assert.equal(parsed.event.cashLeg?.amount.currency, "CLP")
  assert.equal(parsed.event.cashLeg?.amount.toMajor(), 134571)
  assert.equal(parsed.event.externalId, "email:txn:INTERNET_P2026062800222233")
})

test("pago de tarjeta: baja la caja de origen y el Utilizado de la tarjeta (libera cupo)", () => {
  const parsed = parseBancoChileEmail(pagoTarjetaNac())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const accounts = [
    {
      id: "cta",
      accountType: "checking",
      currency: "CLP" as const,
      externalRef: "009991111100",
      cardLast4: "1100",
    },
    {
      id: "tj",
      accountType: "credit_card",
      currency: "CLP" as const,
      externalRef: "2120",
      cardLast4: "2120",
    },
  ]
  const cashBucket: EmailStoredBucket = {
    id: "b-cash",
    accountId: "cta",
    kind: "cash",
    currency: "CLP",
    limitAmount: Money.zero("CLP"),
    used: Money.zero("CLP"),
    available: Money.fromMinor(1_000_000, "CLP"),
  }
  const natBucket: EmailStoredBucket = {
    id: "b-nat",
    accountId: "tj",
    kind: "credit_national",
    currency: "CLP",
    limitAmount: Money.fromMinor(2_000_000, "CLP"),
    used: Money.fromMinor(800_000, "CLP"),
    available: Money.fromMinor(1_200_000, "CLP"),
  }
  // La pata de deuda resuelve la tarjeta y su bucket nacional.
  assert.deepEqual(
    resolveEventTarget(parsed.event, accounts, [cashBucket, natBucket]),
    { accountId: "tj", bucketId: "b-nat" }
  )
  // Proyección: la deuda baja (libera cupo) y la caja baja por el mismo monto.
  const debt = applyInternalPayment(natBucket, parsed.event.amount)
  assert.equal(debt.used.toMajor(), 147420) // 800.000 − 652.580
  const cash = applyDebitToCash(cashBucket, null, parsed.event.cashLeg!.amount)
  assert.equal(cash.cash.available.toMajor(), 347420) // 1.000.000 − 652.580
  // Interno: nunca gasto/ingreso.
  assert.equal(parsed.event.kind !== "expense", true)
})

test("pago de tarjeta se omite fail-closed sin Monto, sin cuenta o con cuerpo ajeno", () => {
  // Sin la etiqueta "Monto" (queda solo "Utilizado") → sin_monto (no toma el Utilizado).
  assert.deepEqual(
    parseBancoChileEmail(
      pagoTarjetaNac({
        htmlBody: PAGO_TARJETA_NAC_HTML.replace(
          "<td>Monto</td>",
          "<td>Total</td>"
        ),
      })
    ),
    { ok: false, reason: "sin_monto" }
  )
  // Sin número de cuenta en Origen → sin_instrumento (la caja no resuelve).
  assert.deepEqual(
    parseBancoChileEmail(
      pagoTarjetaNac({
        htmlBody: PAGO_TARJETA_NAC_HTML.replace(
          "00-999-11111-00",
          "no-disponible"
        ),
      })
    ),
    { ok: false, reason: "sin_instrumento" }
  )
  // Asunto de pago de tarjeta pero cuerpo sin la frase de validación → plantilla_desconocida.
  assert.deepEqual(
    parseBancoChileEmail(
      pagoTarjetaNac({
        htmlBody: "<p>Contenido cualquiera con Monto $1.000</p>",
      })
    ),
    { ok: false, reason: "plantilla_desconocida" }
  )
})

test("mismo remitente TEF, otro asunto, no se procesa como pago de tarjeta", () => {
  const transfer = parseBancoChileEmail(
    message({
      from: TEF,
      subject: "Transferencia a Terceros",
      htmlBody:
        "Transferencia a DESTINATARIO por $ 5.000. Cuenta N° 001-2345. N° de operación 987654.",
    })
  )
  assert.equal(transfer.ok, true)
  if (transfer.ok) assert.equal(transfer.event.source, "transferencia")
  // Un asunto que no es exactamente el de pago de tarjeta sigue siendo desconocido.
  assert.deepEqual(
    parseBancoChileEmail(
      pagoTarjetaNac({ subject: "Pago de Tarjeta de Crédito" })
    ),
    { ok: false, reason: "asunto_desconocido" }
  )
})

test("detección agrupa cargos CLP/USD del mismo last4 en una tarjeta con dos monedas", () => {
  const parsed = [
    parseBancoChileEmail(message()),
    parseBancoChileEmail(
      message({
        id: "graph-2",
        htmlBody: "Compra por USD 8,50 en TEST con tu tarjeta **** 1234.",
      })
    ),
  ]
  assert.deepEqual(detectCandidates(parsed).candidates, [
    {
      kind: "credit_card",
      last4: "1234",
      currencies: ["CLP", "USD"],
      movementCount: 2,
    },
  ])
})

test("proyección consume caja, usa sobregiro, abona primero la deuda y separa crédito USD", () => {
  const cash = {
    limitAmount: Money.zero("CLP"),
    used: Money.zero("CLP"),
    available: Money.of(10000, "CLP"),
  }
  const overdraft = {
    limitAmount: Money.of(50000, "CLP"),
    used: Money.of(5000, "CLP"),
    available: Money.of(45000, "CLP"),
  }
  const debited = applyDebitToCash(cash, overdraft, Money.of(18000, "CLP"))
  assert.equal(debited.cash.available.toMajor(), 0)
  assert.equal(debited.overdraft?.used.toMajor(), 13000)

  const credited = applyInternalCredit(
    debited.cash,
    debited.overdraft,
    Money.of(15000, "CLP")
  )
  assert.equal(credited.overdraft?.used.toMajor(), 0)
  assert.equal(credited.cash.available.toMajor(), 2000)

  const usd = applyCreditPurchase(
    {
      limitAmount: Money.of(1000, "USD"),
      used: Money.of(100, "USD"),
      available: Money.of(900, "USD"),
    },
    Money.of(25.5, "USD")
  )
  assert.equal(usd.used.toDecimalString(), "125.50")
  assert.equal(usd.available.toDecimalString(), "874.50")
})

test("mapeo ambiguo por last4 se omite", () => {
  const parsed = parseBancoChileEmail(message())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const accounts = ["a", "b"].map((id) => ({
    id,
    accountType: "credit_card",
    currency: "CLP" as const,
    externalRef: "1234",
    cardLast4: "1234",
  }))
  const buckets = accounts.map((account) => ({
    id: `bucket-${account.id}`,
    accountId: account.id,
    kind: "credit_national" as const,
    currency: "CLP" as const,
    limitAmount: Money.of(100000, "CLP"),
    used: Money.zero("CLP"),
    available: Money.of(100000, "CLP"),
  }))
  assert.equal(resolveEventTarget(parsed.event, accounts, buckets), null)
})

test("carga inicial usa el mes e instante del OAuth y no persiste candidatos", async () => {
  const connectedAt = new Date("2026-06-30T23:00:00Z")
  const requestedSince: { value?: Date } = {}
  const messages = [
    message({ receivedAt: new Date("2026-06-30T22:00:00Z") }),
    message({
      id: "late",
      receivedAt: new Date("2026-07-01T01:00:00Z"),
    }),
  ]
  const result = await scanEmailCandidates(
    {
      ...repos([link({ createdAt: connectedAt })]),
      mail: {
        listMessagesSince: async (_id, since) => {
          requestedSince.value = since
          return messages
        },
        lastMessageDate: lastDateFrom(messages),
        startDelta: async () => "delta",
        runDelta: async () => ({ messages: [], deltaLink: "delta" }),
        fetchMessage: async () => null,
        ensureSubscription: async () => null,
        deleteSubscription: async () => {},
      },
    },
    "user-1",
    "link-1",
    { now: new Date("2026-07-14T12:00:00Z") }
  )
  // Carga inicial: arranca el 1° del mes de la conexión (junio).
  assert.equal(requestedSince.value?.toISOString(), "2026-06-01T00:00:00.000Z")
  assert.equal(result.totalMessages, 1)
})

test("confirmación vincula al bucket y no redescuenta movimientos anteriores al snapshot", async () => {
  let persisted: EmailConfirmPersistInput | null = null
  let categorized = 0
  const checkingMessage = (id: string, receivedAt: string, amount: number) =>
    message({
      id,
      internetMessageId: `<${id}@example.test>`,
      subject: "Cargo en Cuenta",
      receivedAt: new Date(receivedAt),
      htmlBody: `Cargo por $ ${amount.toLocaleString("es-CL")} asociado a COMPRA PRUEBA. Cuenta terminada en 2345.`,
    })
  const confirmMessages = [
    checkingMessage("old", "2026-07-14T10:00:00Z", 1000),
    checkingMessage("new", "2026-07-14T11:30:00Z", 2000),
  ]
  const deps = {
    ...repos([link({ id: "link-confirm" })]),
    methods: methodsFake,
    mail: {
      listMessagesSince: async () => confirmMessages,
      lastMessageDate: lastDateFrom(confirmMessages),
      startDelta: async () => "delta",
      runDelta: async () => ({ messages: [], deltaLink: "delta" }),
      fetchMessage: async () => null,
      ensureSubscription: async () => null,
      deleteSubscription: async () => {},
    },
    store: {
      confirmSetup: async (input: EmailConfirmPersistInput) => {
        persisted = input
        return {
          bankId: "bank-1",
          accounts: input.accounts.length,
          cards: 1,
          movements: input.movements.length,
        }
      },
      listInstruments: async () => ({ accounts: [], buckets: [] }),
      upsertMovements: async () => ({ createdExternalIds: [] }),
      updateBucketAmounts: async () => {},
      setAccountBalance: async () => {},
      markBankSynced: async () => {},
      countBankDependents: async () => noDependents,
      deleteBank: async () => {},
    },
    categorize: async () => ++categorized,
  } satisfies EmailConnectionDeps

  await confirmEmailSetup(
    deps,
    "user-1",
    "link-confirm",
    {
      snapshotAt: new Date("2026-07-14T11:00:00Z"),
      checking: { ref: "2345", cash: Money.of(10000, "CLP"), overdraft: null },
      cards: [],
    },
    { now: new Date("2026-07-14T12:00:00Z") }
  )
  assert.ok(persisted)
  const saved = persisted as EmailConfirmPersistInput
  assert.equal(saved.linkId, "link-confirm")
  assert.equal(saved.movements.length, 2)
  assert.equal(saved.movements[0].bucketKind, "cash")
  assert.equal(
    saved.accounts[0].buckets
      .find((bucket) => bucket.kind === "cash")
      ?.available.toMajor(),
    8000
  )
  assert.equal(categorized, 1)
})

test("sync repetido es idempotente: crea y proyecta una sola vez", async () => {
  const activeLink = link({
    id: "link-sync",
    bankId: "bank-1",
    status: "active",
    lastBalanceReconciledAt: new Date("2026-07-14T10:00:00Z"),
    mailbox: mailbox({
      deltaLink: "delta-1",
      lastSyncedAt: new Date("2026-07-14T10:00:00Z"),
    }),
  })
  const bucket: EmailStoredBucket = {
    id: "cash-1",
    accountId: "account-1",
    kind: "cash",
    currency: "CLP",
    limitAmount: Money.zero("CLP"),
    used: Money.zero("CLP"),
    available: Money.of(10000, "CLP"),
  }
  const seen = new Set<string>()
  let categorized = 0
  const incoming = message({
    id: "sync-message",
    internetMessageId: "<sync-message@example.test>",
    subject: "Cargo en Cuenta",
    receivedAt: new Date("2026-07-14T11:00:00Z"),
    htmlBody:
      "Cargo por $ 1.000 asociado a COMPRA PRUEBA. Cuenta terminada en 2345.",
  })
  const deps = {
    ...repos([activeLink]),
    methods: methodsFake,
    mail: {
      listMessagesSince: async () => [],
      lastMessageDate: async () => null,
      startDelta: async () => "delta-2",
      runDelta: async () => ({ messages: [incoming], deltaLink: "delta-2" }),
      fetchMessage: async () => null,
      ensureSubscription: async () => null,
      deleteSubscription: async () => {},
    },
    store: {
      confirmSetup: async () => ({
        bankId: "bank-1",
        accounts: 1,
        cards: 1,
        movements: 0,
      }),
      listInstruments: async () => ({
        accounts: [
          {
            id: "account-1",
            accountType: "checking",
            currency: "CLP" as const,
            externalRef: "2345",
            cardLast4: "2345",
          },
        ],
        buckets: [bucket],
      }),
      upsertMovements: async (
        _userId: string,
        movements: { externalId: string }[]
      ) => {
        const createdExternalIds = movements
          .filter((movement) => !seen.has(movement.externalId))
          .map((movement) => movement.externalId)
        createdExternalIds.forEach((id) => seen.add(id))
        return { createdExternalIds }
      },
      updateBucketAmounts: async (
        _id: string,
        amounts: { available: Money }
      ) => {
        bucket.available = amounts.available
      },
      setAccountBalance: async () => {},
      markBankSynced: async () => {},
      countBankDependents: async () => noDependents,
      deleteBank: async () => {},
    },
    categorize: async () => ++categorized,
  } satisfies EmailConnectionDeps

  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T12:00:00Z"),
  })
  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T12:05:00Z"),
  })
  assert.equal(bucket.available.toMajor(), 9000)
  assert.equal(seen.size, 1)
  assert.equal(categorized, 1)
})

// Vínculo activo base para los tests de sync del pago de tarjeta.
const activeLinkTj = (
  over: Partial<EmailBankLinkWithMailbox> = {}
): EmailBankLinkWithMailbox =>
  link({
    id: "link-tj",
    bankId: "bank-1",
    status: "active",
    createdAt: new Date("2026-06-01T00:00:00Z"),
    lastBalanceReconciledAt: new Date("2026-07-14T10:00:00Z"),
    mailbox: mailbox({
      deltaLink: "delta-1",
      lastSyncedAt: new Date("2026-07-14T10:00:00Z"),
    }),
    ...over,
  })

const syncDepsForCardPayment = (
  instruments: {
    accounts: {
      id: string
      accountType: string
      currency: "CLP"
      externalRef: string
      cardLast4: string
    }[]
    buckets: EmailStoredBucket[]
  },
  captured: {
    seen: Set<string>
    upserted: { externalId: string; direction: string; isInternal: boolean }[]
    byId: Map<string, EmailStoredBucket>
    notified?: string[]
  },
  messages: BankEmailMessage[] = [pagoTarjetaNac()]
) =>
  ({
    ...repos([activeLinkTj()]),
    methods: methodsFake,
    mail: {
      listMessagesSince: async () => [],
      lastMessageDate: async () => null,
      startDelta: async () => "delta-2",
      runDelta: async () => ({ messages, deltaLink: "delta-2" }),
      fetchMessage: async () => null,
      ensureSubscription: async () => null,
      deleteSubscription: async () => {},
    },
    store: {
      confirmSetup: async () => ({
        bankId: "bank-1",
        accounts: 2,
        cards: 1,
        movements: 0,
      }),
      listInstruments: async () => instruments,
      upsertMovements: async (
        _userId: string,
        movements: {
          externalId: string
          direction: string
          isInternal: boolean
        }[]
      ) => {
        captured.upserted.push(...movements)
        const createdExternalIds = movements
          .filter((m) => !captured.seen.has(m.externalId))
          .map((m) => m.externalId)
        createdExternalIds.forEach((id) => captured.seen.add(id))
        return { createdExternalIds }
      },
      updateBucketAmounts: async (
        id: string,
        amounts: { used: Money; available: Money }
      ) => {
        const b = captured.byId.get(id)
        if (b) {
          b.used = amounts.used
          b.available = amounts.available
        }
      },
      setAccountBalance: async () => {},
      markBankSynced: async () => {},
      countBankDependents: async () => noDependents,
      deleteBank: async () => {},
    },
    notify: async (_userId: string, movements: { description: string }[]) => {
      captured.notified?.push(...movements.map((m) => m.description))
    },
  }) satisfies EmailConnectionDeps

test("pago de tarjeta: sync expande dos patas (caja + deuda) y es idempotente", async () => {
  const buckets: EmailStoredBucket[] = [
    {
      id: "b-cash",
      accountId: "acct-cta",
      kind: "cash",
      currency: "CLP",
      limitAmount: Money.zero("CLP"),
      used: Money.zero("CLP"),
      available: Money.of(1000000, "CLP"),
    },
    {
      id: "b-nat",
      accountId: "acct-tj",
      kind: "credit_national",
      currency: "CLP",
      limitAmount: Money.of(2000000, "CLP"),
      used: Money.of(800000, "CLP"),
      available: Money.of(1200000, "CLP"),
    },
  ]
  const captured = {
    seen: new Set<string>(),
    upserted: [] as {
      externalId: string
      direction: string
      isInternal: boolean
    }[],
    byId: new Map(buckets.map((b) => [b.id, b])),
  }
  const deps = syncDepsForCardPayment(
    {
      accounts: [
        {
          id: "acct-cta",
          accountType: "checking",
          currency: "CLP",
          externalRef: "009991111100",
          cardLast4: "1100",
        },
        {
          id: "acct-tj",
          accountType: "credit_card",
          currency: "CLP",
          externalRef: "2120",
          cardLast4: "2120",
        },
      ],
      buckets,
    },
    captured
  )

  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T13:00:00Z"),
  })
  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T13:05:00Z"),
  })

  // Dos patas con identidad distinta (sufijo por pata); reprocesar no crea nuevas.
  assert.deepEqual([...captured.seen].sort(), [
    "email:txn:BCAMOVIL012026062800111122223:card",
    "email:txn:BCAMOVIL012026062800111122223:cash",
  ])
  // La caja de origen bajó una sola vez y la deuda de la tarjeta se redujo (liberó cupo).
  assert.equal(captured.byId.get("b-cash")!.available.toMajor(), 347420)
  assert.equal(captured.byId.get("b-nat")!.used.toMajor(), 147420)
})

test("pago de tarjeta: sin la cuenta de origen confirmada se omite el pago completo", async () => {
  // Solo la tarjeta está confirmada; la cuenta corriente de origen no. Ni la deuda ni la caja se
  // registran (nunca medio pago).
  const buckets: EmailStoredBucket[] = [
    {
      id: "b-nat",
      accountId: "acct-tj",
      kind: "credit_national",
      currency: "CLP",
      limitAmount: Money.of(2000000, "CLP"),
      used: Money.of(800000, "CLP"),
      available: Money.of(1200000, "CLP"),
    },
  ]
  const captured = {
    seen: new Set<string>(),
    upserted: [] as {
      externalId: string
      direction: string
      isInternal: boolean
    }[],
    byId: new Map(buckets.map((b) => [b.id, b])),
  }
  const deps = syncDepsForCardPayment(
    {
      accounts: [
        {
          id: "acct-tj",
          accountType: "credit_card",
          currency: "CLP",
          externalRef: "2120",
          cardLast4: "2120",
        },
      ],
      buckets,
    },
    captured
  )

  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T13:00:00Z"),
  })

  assert.deepEqual(captured.upserted, []) // ninguna pata
  assert.equal(captured.byId.get("b-nat")!.used.toMajor(), 800000) // deuda intacta
})

// INVARIANTE del contrato de correo bancario (vale para todo banco, no solo Banco de Chile): del
// correo solo sale el gasto. La plata que ENTRA no se deduce del correo — el aviso de una
// transferencia recibida es idéntico venga del sueldo o de un amigo devolviendo un préstamo—, así
// que el abono se descarta y el dinero se declara en el módulo de Ingresos.
// Este test falla si alguien vuelve a dejar que un correo cree un movimiento de entrada.
test("una transferencia recibida no crea ningún movimiento", async () => {
  const abono = message({
    id: "abono-1",
    internetMessageId: "<abono-1@example.test>",
    from: "serviciodetransferencias@bancochile.cl",
    subject: "Aviso de transferencia de fondos",
    receivedAt: new Date("2026-07-14T11:00:00Z"),
    htmlBody:
      "Abono por $ 50.000 en cuenta terminada en 1100. N° de operación 555111.",
  })
  const buckets: EmailStoredBucket[] = [
    {
      id: "b-cash",
      accountId: "acct-cta",
      kind: "cash",
      currency: "CLP",
      limitAmount: Money.zero("CLP"),
      used: Money.zero("CLP"),
      available: Money.of(10000, "CLP"),
    },
  ]
  const captured = {
    seen: new Set<string>(),
    upserted: [] as {
      externalId: string
      direction: string
      isInternal: boolean
    }[],
    byId: new Map(buckets.map((b) => [b.id, b])),
    notified: [] as string[],
  }
  const deps = syncDepsForCardPayment(
    {
      accounts: [
        {
          id: "acct-cta",
          accountType: "checking",
          currency: "CLP",
          externalRef: "009991111100",
          cardLast4: "1100",
        },
      ],
      buckets,
    },
    captured,
    [abono]
  )

  await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T13:00:00Z"),
  })

  // Ni movimiento ni notificación: el correo no alcanza para decidir qué es esa plata.
  assert.deepEqual(captured.upserted, [])
  assert.deepEqual(captured.notified, [])
  // Y el saldo queda intacto: lo mueve el ingreso que el usuario declara, no el correo.
  assert.equal(captured.byId.get("b-cash")!.available.toMajor(), 10000)
  // El motivo es propio y no se confunde con un correo roto: el descarte es a propósito.
  assert.deepEqual(parseBancoChileEmail(abono), {
    ok: false,
    reason: "abono_ignorado",
  })
})

// --- Cuenta principal: el correo no la numera (MACHBANK) ---

const transferenciaMach = (): BankEmailMessage => ({
  id: "graph-mach-1",
  internetMessageId: "<mach-1@example.test>",
  from: "no-reply@mail.machbank.cl",
  subject: "Realizaste una transferencia a Ana Pérez",
  receivedAt: new Date("2026-07-14T12:00:00Z"),
  htmlBody: `<p>Acabas de hacer una transferencia desde tu cuenta principal MACHBANK.</p>
    <table><tr><td>Monto</td><td>$1.000</td></tr>
    <tr><td>Código de confirmación</td><td>112233445566</td></tr></table>`,
})

const checkingAccount = (id: string, ref: string) => ({
  id,
  accountType: "checking",
  currency: "CLP" as const,
  externalRef: ref,
  cardLast4: ref.slice(-4),
})

const cashBucketOf = (accountId: string): EmailStoredBucket => ({
  id: `cash-${accountId}`,
  accountId,
  kind: "cash",
  currency: "CLP",
  limitAmount: Money.zero("CLP"),
  used: Money.zero("CLP"),
  available: Money.of(50000, "CLP"),
})

test("cuenta principal: con una sola cuenta corriente resuelve y descuenta su caja", () => {
  const parsed = parseMachbankEmail(transferenciaMach())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  const accounts = [checkingAccount("acct-1", "4321")]
  const buckets = [cashBucketOf("acct-1")]
  assert.deepEqual(resolveEventTarget(parsed.event, accounts, buckets), {
    accountId: "acct-1",
    bucketId: "cash-acct-1",
  })
  const res = applyDebitToCash(buckets[0], null, parsed.event.amount)
  assert.equal(res.cash.available.toMajor(), 49000)
})

test("cuenta principal: con cero o dos cuentas corrientes se omite en vez de adivinar", () => {
  const parsed = parseMachbankEmail(transferenciaMach())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(resolveEventTarget(parsed.event, [], []), null)
  const dos = [
    checkingAccount("acct-1", "4321"),
    checkingAccount("acct-2", "8765"),
  ]
  const buckets = [cashBucketOf("acct-1"), cashBucketOf("acct-2")]
  assert.equal(resolveEventTarget(parsed.event, dos, buckets), null)
})

test("cuenta principal: no propone un candidato de cuenta con un número inventado", () => {
  const summary = detectCandidates([parseMachbankEmail(transferenciaMach())])
  assert.deepEqual(summary.candidates, [])
  // Pero el movimiento sí se contabiliza como gasto del escaneo.
  assert.equal(summary.expenseCount, 1)
  assert.equal(summary.skippedCount, 0)
})

// --- Ventana del escaneo: el mes de la última notificación CON movimientos ---

const cargo = (id: string, receivedAt: string): BankEmailMessage =>
  message({
    id,
    internetMessageId: `<${id}@example.test>`,
    subject: "Cargo en Cuenta",
    receivedAt: new Date(receivedAt),
    htmlBody:
      "Cargo por $ 12.345 asociado a COMPRA PRUEBA. Cuenta terminada en 2345.",
  })

// Correo del banco que no produce movimiento: el remitente es suyo, el asunto no está catalogado.
const promo = (id: string, receivedAt: string): BankEmailMessage =>
  message({
    id,
    subject: "Conoce los beneficios del mes",
    receivedAt: new Date(receivedAt),
    htmlBody: "<p>Promoción vigente hasta fin de mes.</p>",
  })

const mailWith = (messages: BankEmailMessage[]) => ({
  listMessagesSince: async (_id: string, since: Date, until?: Date) =>
    messages.filter(
      (m) =>
        m.receivedAt.getTime() >= since.getTime() &&
        (!until || m.receivedAt.getTime() <= until.getTime())
    ),
  lastMessageDate: lastDateFrom(messages),
  startDelta: async () => "delta",
  runDelta: async () => ({ messages: [], deltaLink: "delta" }),
  fetchMessage: async () => null,
  ensureSubscription: async () => null,
  deleteSubscription: async () => {},
})

const CONNECTED_AT = new Date("2026-08-14T12:00:00Z")

const scanWith = (messages: BankEmailMessage[]) =>
  scanEmailCandidates(
    {
      ...repos([link({ createdAt: CONNECTED_AT })]),
      mail: mailWith(messages),
    },
    "user-1",
    "link-1",
    { now: CONNECTED_AT }
  )

test("sin movimientos este mes, el escaneo baja al mes de la última notificación", async () => {
  const result = await scanWith([cargo("jun", "2026-06-20T10:00:00Z")])
  assert.equal(result.since, "2026-06-01T00:00:00.000Z")
  assert.equal(result.totalMessages, 1)
  assert.equal(result.candidates.length, 1)
})

test("el mes de la última notificación sin movimientos no detiene la búsqueda", async () => {
  // Lo último del banco es marketing: si la ventana se fijara ahí, el escaneo vendría vacío igual.
  const result = await scanWith([
    cargo("jun", "2026-06-20T10:00:00Z"),
    promo("ago", "2026-08-10T10:00:00Z"),
  ])
  assert.equal(result.since, "2026-06-01T00:00:00.000Z")
  assert.equal(result.expenseCount, 1)
  assert.equal(result.candidates.length, 1)
})

test("un correo posterior al instante del vínculo no mueve la ventana", async () => {
  const result = await scanEmailCandidates(
    {
      ...repos([link({ createdAt: CONNECTED_AT })]),
      mail: mailWith([
        cargo("jun", "2026-06-20T10:00:00Z"),
        cargo("tarde", "2026-08-20T10:00:00Z"),
      ]),
    },
    "user-1",
    "link-1",
    { now: new Date("2026-08-25T12:00:00Z") }
  )
  assert.equal(result.since, "2026-06-01T00:00:00.000Z")
  assert.equal(result.totalMessages, 1)
})

test("sin correos del banco en el plazo, la ventana vuelve al mes en curso", async () => {
  const vacio = await scanWith([])
  assert.equal(vacio.since, "2026-08-01T00:00:00.000Z")
  assert.equal(vacio.candidates.length, 0)
  // Más viejo que el tope de búsqueda: tampoco se va a buscarlo hasta el fondo del buzón.
  const viejo = await scanWith([cargo("2025", "2025-11-20T10:00:00Z")])
  assert.equal(viejo.since, "2026-08-01T00:00:00.000Z")
  assert.equal(viejo.candidates.length, 0)
})

test("la confirmación importa la misma ventana que mostró el escaneo", async () => {
  const messages = [
    cargo("jun-1", "2026-06-20T10:00:00Z"),
    cargo("jun-2", "2026-06-25T10:00:00Z"),
    promo("ago", "2026-08-10T10:00:00Z"),
  ]
  const scanned = await scanWith(messages)
  let persisted: EmailConfirmPersistInput | null = null
  await confirmEmailSetup(
    {
      ...repos([link({ id: "link-1", createdAt: CONNECTED_AT })]),
      methods: methodsFake,
      mail: mailWith(messages),
      store: {
        confirmSetup: async (input: EmailConfirmPersistInput) => {
          persisted = input
          return {
            bankId: "bank-1",
            accounts: 1,
            cards: 0,
            movements: input.movements.length,
          }
        },
        listInstruments: async () => ({ accounts: [], buckets: [] }),
        upsertMovements: async () => ({ createdExternalIds: [] }),
        updateBucketAmounts: async () => {},
        setAccountBalance: async () => {},
        markBankSynced: async () => {},
        countBankDependents: async () => noDependents,
        deleteBank: async () => {},
      },
    } satisfies EmailConnectionDeps,
    "user-1",
    "link-1",
    {
      snapshotAt: new Date("2026-08-14T11:00:00Z"),
      checking: { ref: "2345", cash: Money.of(50000, "CLP"), overdraft: null },
      cards: [],
    },
    { now: CONNECTED_AT }
  )
  const saved = persisted as EmailConfirmPersistInput | null
  assert.ok(saved)
  // Los dos cargos de junio, ni más ni menos: el mismo rango que revisó el usuario.
  assert.equal(scanned.expenseCount, 2)
  assert.equal(saved!.movements.length, 2)
})
