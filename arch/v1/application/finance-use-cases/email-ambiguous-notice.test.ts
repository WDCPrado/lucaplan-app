// Aviso por correo ambiguo contra altas conciliadas (WDC-123): se salta, cuenta como omitido y la
// sincronización sigue. Contrato propuesto: `upsertMovements` devuelve además
// `ambiguousExternalIds` (los que no escribió por ambiguos) en vez de lanzar.
// Corre con: node --test arch/v1/application/finance-use-cases/email-ambiguous-notice.test.ts
import assert from "node:assert/strict"
import { test } from "node:test"
import { Money } from "../../domain/finance/money.ts"
import type {
  BankEmailMessage,
  EmailBankLinkWithMailbox,
  EmailMailbox,
} from "../../domain/finance/email-connection.domain.ts"
import type { BankEmailRegistry } from "./bank-email-registry.ts"
import {
  syncMailbox,
  type EmailConnectionDeps,
  type EmailStoredBucket,
  type ResolvedEmailMovement,
} from "./email-connection-use-cases.ts"

// Banco de prueba: "Cargo por $ N en LUGAR" → gasto CLP en la corriente 2345.
const BANCO = {
  key: "bancoprueba",
  name: "Banco Prueba",
  senders: ["avisos@bancoprueba.cl"],
  parse: (msg: BankEmailMessage) => {
    const m = msg.htmlBody.match(/\$\s*([\d.]+) en (.+)$/)
    if (!m) return { ok: false, reason: "sin_monto" } as const
    return {
      ok: true,
      event: {
        kind: "expense",
        source: "cargo_cuenta",
        amount: Money.of(Number(m[1].replace(/\./g, "")), "CLP"),
        date: msg.receivedAt,
        receivedAt: msg.receivedAt,
        description: m[2],
        instrument: { kind: "checking", ref: "2345" },
        paymentTarget: null,
        cashLeg: null,
        tefId: null,
        externalId: `email:mid:${msg.id}`,
      },
    } as const
  },
}
const REGISTRY: BankEmailRegistry = [BANCO]

const mailbox: EmailMailbox = {
  id: "mbx-1",
  userId: "user-1",
  emailProvider: "outlook",
  emailAddress: "personal@example.test",
  status: "active",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  deltaLink: "delta-1",
  subscriptionId: null,
  subscriptionExpiresAt: new Date("2026-12-01T00:00:00Z"),
  lastSyncedAt: new Date("2026-10-20T10:00:00Z"),
  lastError: null,
  discardedCount: 0,
}
const link: EmailBankLinkWithMailbox = {
  id: "link-1",
  mailboxId: "mbx-1",
  userId: "user-1",
  bankProvider: "bancoprueba",
  label: null,
  bankId: "bank-1",
  status: "active",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  skippedCount: 0,
  lastBalanceReconciledAt: new Date("2026-10-01T00:00:00Z"),
  mailbox,
}
const cargo = (id: string, body: string): BankEmailMessage => ({
  id,
  internetMessageId: `<${id}@example.test>`,
  from: "avisos@bancoprueba.cl",
  subject: "Aviso de cargo",
  receivedAt: new Date("2026-10-21T11:00:00Z"),
  htmlBody: body,
})
const cash: EmailStoredBucket = {
  id: "cash-1",
  accountId: "acct-1",
  kind: "cash",
  currency: "CLP",
  limitAmount: Money.zero("CLP"),
  used: Money.zero("CLP"),
  available: Money.of(100000, "CLP"),
}

test("un aviso ambiguo frente a altas conciliadas se salta y queda omitido para revisar; los demás avisos se registran y mueven el saldo", async () => {
  const ambiguousId = "email:mid:m-ambiguo"
  const written: string[] = []
  const bucketWrites: { id: string; available: number }[] = []
  const linkPatches: { skippedCount?: number }[] = []
  const deps = {
    registry: REGISTRY,
    mailboxes: {
      listByUser: async () => [mailbox],
      findById: async () => mailbox,
      findByAddress: async () => null,
      findBySubscriptionId: async () => null,
      listForSubscriptionRenewal: async () => [],
      create: async () => mailbox,
      update: async () => mailbox,
      delete: async () => {},
    },
    links: {
      listByUser: async () => [link],
      listByMailbox: async () => [link],
      findById: async () => link,
      create: async () => link,
      update: async (_id: string, patch: { skippedCount?: number }) => {
        linkPatches.push(patch)
        return link
      },
      delete: async () => {},
    },
    methods: {
      activeMethod: async () => "email" as const,
      claim: async () => {},
      release: async () => {},
    },
    mail: {
      listMessagesSince: async () => [],
      lastMessageDate: async () => null,
      startDelta: async () => "delta-2",
      runDelta: async () => ({ messages: [], deltaLink: "delta-2" }),
      fetchMessage: async () => null,
      ensureSubscription: async () => null,
      deleteSubscription: async () => {},
    },
    store: {
      confirmSetup: async () => ({ bankId: "bank-1", accounts: 1, cards: 0, movements: 0 }),
      listInstruments: async () => ({
        accounts: [
          { id: "acct-1", accountType: "checking", currency: "CLP" as const, externalRef: "2345", cardLast4: null },
        ],
        buckets: [cash],
      }),
      // Como el adapter: el ambiguo no se escribe ni lanza; se informa aparte.
      upsertMovements: async (_userId: string, movements: ResolvedEmailMovement[]) => {
        const created = movements.map((m) => m.externalId).filter((id) => id !== ambiguousId)
        written.push(...created)
        const result = { createdExternalIds: created, ambiguousExternalIds: [ambiguousId] }
        return result
      },
      updateBucketAmounts: async (id: string, amounts: { available: Money }) => {
        bucketWrites.push({ id, available: amounts.available.toMajor() })
      },
      setAccountBalance: async () => {},
      markBankSynced: async () => {},
      countBankDependents: async () => ({ accounts: 0, movements: 0, recurring: 0, installments: 0, incomes: 0 }),
      deleteBank: async () => {},
    },
  } as EmailConnectionDeps

  const res = await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-10-21T12:00:00Z"),
    messages: [
      cargo("m-ambiguo", "Cargo por $ 12.990 en LIDER EXPRESS 12"),
      cargo("m-nuevo", "Cargo por $ 3.000 en FARMACIA"),
    ],
  })

  assert.deepEqual(written, ["email:mid:m-nuevo"])
  assert.equal(res.created, 1)
  assert.equal(res.skipped, 1, "el ambiguo cuenta como omitido, pendiente de revisión")
  assert.deepEqual(linkPatches.at(-1), { skippedCount: 1 })
  // Solo el aviso creado mueve la caja: 100.000 − 3.000.
  assert.deepEqual(bucketWrites, [{ id: "cash-1", available: 97000 }])
})
