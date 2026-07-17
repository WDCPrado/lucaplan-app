import assert from "node:assert/strict"
import { test } from "node:test"
import { Money } from "../../domain/finance/money.ts"
import type {
  BankEmailMessage,
  EmailConnection,
} from "../../domain/finance/email-connection.domain.ts"
import { parseBancoChileEmail } from "./bancochile-email-map.ts"
import { detectCandidates } from "./bancochile-email-candidates.ts"
import {
  applyCreditPurchase,
  applyDebitToCash,
  applyInternalCredit,
} from "./email-projection.ts"
import {
  confirmEmailSetup,
  resolveEventTarget,
  scanEmailCandidates,
  syncEmailConnection,
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

test("parser extrae TEF y trata abonos/pagos como eventos internos", () => {
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

  const credit = parseBancoChileEmail(
    message({
      from: "serviciodetransferencias@bancochile.cl",
      subject: "Aviso de transferencia de fondos",
      htmlBody:
        "Abono por $ 9.000 en cuenta terminada en 2345. N° de operación 876543.",
    })
  )
  assert.equal(credit.ok, true)
  if (credit.ok) assert.equal(credit.event.kind, "internal_credit")

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

test("pago de crédito de consumo es interno, toma el monto pagado y la cuenta de origen", () => {
  const parsed = parseBancoChileEmail(pagoConsumo())
  assert.equal(parsed.ok, true)
  if (!parsed.ok) return
  assert.equal(parsed.event.kind, "internal_payment")
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

test("pago de crédito de consumo baja la caja de origen y no cuenta como gasto", () => {
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
  const connection: EmailConnection = {
    id: "conn-1",
    userId: "user-1",
    bankProvider: "bancochile",
    emailProvider: "outlook",
    emailAddress: "sanitized@example.test",
    bankId: null,
    status: "pending_setup",
    createdAt: connectedAt,
    deltaLink: null,
    subscriptionId: null,
    subscriptionExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    skippedCount: 0,
    lastBalanceReconciledAt: null,
  }
  const requestedSince: { value?: Date } = {}
  const result = await scanEmailCandidates(
    {
      emailConnections: {
        findByUser: async () => connection,
        findById: async () => connection,
        findBySubscriptionId: async () => null,
        create: async () => connection,
        update: async () => connection,
        delete: async () => {},
      },
      mail: {
        listMessagesSince: async (_id, since) => {
          requestedSince.value = since
          return [
            message({ receivedAt: new Date("2026-06-30T22:00:00Z") }),
            message({
              id: "late",
              receivedAt: new Date("2026-07-01T01:00:00Z"),
            }),
          ]
        },
        startDelta: async () => "delta",
        runDelta: async () => ({ messages: [], deltaLink: "delta" }),
        fetchMessage: async () => null,
        ensureSubscription: async () => null,
        deleteSubscription: async () => {},
      },
    },
    "user-1",
    { now: new Date("2026-07-14T12:00:00Z") }
  )
  assert.equal(requestedSince.value?.toISOString(), "2026-06-01T00:00:00.000Z")
  assert.equal(result.totalMessages, 1)
})

test("confirmación vincula al bucket y no redescuenta movimientos anteriores al snapshot", async () => {
  const connection: EmailConnection = {
    id: "conn-confirm",
    userId: "user-1",
    bankProvider: "bancochile",
    emailProvider: "outlook",
    emailAddress: "sanitized@example.test",
    bankId: null,
    status: "pending_setup",
    createdAt: new Date("2026-07-14T12:00:00Z"),
    deltaLink: null,
    subscriptionId: null,
    subscriptionExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    skippedCount: 0,
    lastBalanceReconciledAt: null,
  }
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
  const deps = {
    emailConnections: {
      findByUser: async () => connection,
      findById: async () => connection,
      findBySubscriptionId: async () => null,
      create: async () => connection,
      update: async () => connection,
      delete: async () => {},
    },
    methods: {
      activeMethod: async () => "email" as const,
      claim: async () => {},
      release: async () => {},
    },
    mail: {
      listMessagesSince: async () => [
        checkingMessage("old", "2026-07-14T10:00:00Z", 1000),
        checkingMessage("new", "2026-07-14T11:30:00Z", 2000),
      ],
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
      deleteBank: async () => {},
    },
    categorize: async () => ++categorized,
  } satisfies EmailConnectionDeps

  await confirmEmailSetup(
    deps,
    "user-1",
    {
      snapshotAt: new Date("2026-07-14T11:00:00Z"),
      checking: { ref: "2345", cash: Money.of(10000, "CLP"), overdraft: null },
      cards: [],
    },
    { now: new Date("2026-07-14T12:00:00Z") }
  )
  assert.ok(persisted)
  const saved = persisted as EmailConfirmPersistInput
  assert.equal(saved.connectionId, "conn-confirm")
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
  const connection: EmailConnection = {
    id: "conn-sync",
    userId: "user-1",
    bankProvider: "bancochile",
    emailProvider: "outlook",
    emailAddress: "sanitized@example.test",
    bankId: "bank-1",
    status: "active",
    createdAt: new Date("2026-07-01T00:00:00Z"),
    deltaLink: "delta-1",
    subscriptionId: null,
    subscriptionExpiresAt: null,
    lastSyncedAt: new Date("2026-07-14T10:00:00Z"),
    lastError: null,
    skippedCount: 0,
    lastBalanceReconciledAt: new Date("2026-07-14T10:00:00Z"),
  }
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
    emailConnections: {
      findByUser: async () => connection,
      findById: async () => connection,
      findBySubscriptionId: async () => null,
      create: async () => connection,
      update: async () => connection,
      delete: async () => {},
    },
    methods: {
      activeMethod: async () => "email" as const,
      claim: async () => {},
      release: async () => {},
    },
    mail: {
      listMessagesSince: async () => [],
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
      deleteBank: async () => {},
    },
    categorize: async () => ++categorized,
  } satisfies EmailConnectionDeps

  await syncEmailConnection(deps, "user-1", {
    now: new Date("2026-07-14T12:00:00Z"),
  })
  await syncEmailConnection(deps, "user-1", {
    now: new Date("2026-07-14T12:05:00Z"),
  })
  assert.equal(bucket.available.toMajor(), 9000)
  assert.equal(seen.size, 1)
  assert.equal(categorized, 1)
})
