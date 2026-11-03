// Multi-buzón y multi-banco: un correo alimenta N bancos y un banco puede venir de N correos.
// El catálogo se inyecta, así que estos tests registran un banco de prueba sin esperar a que exista
// un segundo banco real.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Money } from "../../domain/finance/money.ts"
import type {
  BankEmailMessage,
  EmailBankLink,
  EmailBankLinkWithMailbox,
  EmailMailbox,
} from "../../domain/finance/email-connection.domain.ts"
import { BANCOCHILE, type BankEmailRegistry } from "./bank-email-registry.ts"
import {
  addBankLink,
  syncMailbox,
  type EmailConnectionDeps,
  type EmailStoredBucket,
  type ResolvedEmailMovement,
} from "./email-connection-use-cases.ts"

// Banco de prueba: mismos efectos que uno real, plantilla mínima ("Cargo por $ N en CUENTA 2345").
const BANCO_PRUEBA = {
  key: "bancoprueba",
  name: "Banco Prueba",
  senders: ["avisos@bancoprueba.cl"],
  parse: (msg: BankEmailMessage) => {
    const m = msg.htmlBody.match(/\$\s*([\d.]+)/)
    if (!m) return { ok: false, reason: "sin_monto" } as const
    return {
      ok: true,
      event: {
        kind: "expense",
        source: "cargo_cuenta",
        amount: Money.of(Number(m[1].replace(/\./g, "")), "CLP"),
        date: msg.receivedAt,
        receivedAt: msg.receivedAt,
        description: "Cargo Banco Prueba",
        instrument: { kind: "checking", ref: "2345" },
        paymentTarget: null,
        cashLeg: null,
        tefId: null,
        externalId: `email:mid:${msg.id}`,
      },
    } as const
  },
}

const REGISTRY: BankEmailRegistry = [BANCOCHILE, BANCO_PRUEBA]

const mailbox = (over: Partial<EmailMailbox> = {}): EmailMailbox => ({
  id: "mbx-1",
  userId: "user-1",
  emailProvider: "outlook",
  emailAddress: "personal@example.test",
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  deltaLink: "delta-1",
  subscriptionId: null,
  subscriptionExpiresAt: null,
  lastSyncedAt: new Date("2026-07-14T10:00:00Z"),
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
  bankId: "bank-1",
  status: "active",
  createdAt: new Date("2026-07-01T00:00:00Z"),
  skippedCount: 0,
  lastBalanceReconciledAt: new Date("2026-07-01T00:00:00Z"),
  mailbox: mailbox(),
  ...over,
})

const cargoBancoChile = (id: string): BankEmailMessage => ({
  id,
  internetMessageId: `<${id}@example.test>`,
  from: "enviodigital@bancochile.cl",
  subject: "Cargo en Cuenta",
  receivedAt: new Date("2026-07-14T11:00:00Z"),
  htmlBody: "Cargo por $ 1.000 asociado a COMPRA. Cuenta terminada en 2345.",
})

const cargoBancoPrueba = (id: string): BankEmailMessage => ({
  id,
  internetMessageId: `<${id}@example.test>`,
  from: "avisos@bancoprueba.cl",
  subject: "Aviso de cargo",
  receivedAt: new Date("2026-07-14T11:05:00Z"),
  htmlBody: "Cargo por $ 2.000 en cuenta 2345.",
})

const ajeno = (id: string): BankEmailMessage => ({
  id,
  internetMessageId: `<${id}@example.test>`,
  from: "newsletter@ejemplo.cl",
  subject: "Ofertas de la semana",
  receivedAt: new Date("2026-07-14T11:10:00Z"),
  htmlBody: "Nada financiero aquí.",
})

const bucket = (accountId: string, id: string): EmailStoredBucket => ({
  id,
  accountId,
  kind: "cash",
  currency: "CLP",
  limitAmount: Money.zero("CLP"),
  used: Money.zero("CLP"),
  available: Money.of(100000, "CLP"),
})

// Deps con un store que registra a qué banco fue cada movimiento y qué se escribió en cada fila.
function depsFor(
  links: EmailBankLinkWithMailbox[],
  messages: BankEmailMessage[],
  captured: {
    byBank: Map<string, string[]>
    linkPatches: { id: string; skippedCount?: number }[]
    mailboxPatches: { discardedCount?: number }[]
  }
) {
  const instrumentsOf = (bankId: string) => ({
    accounts: [
      {
        id: `${bankId}-acct`,
        accountType: "checking",
        currency: "CLP" as const,
        externalRef: "2345",
        cardLast4: "2345",
      },
    ],
    buckets: [bucket(`${bankId}-acct`, `${bankId}-cash`)],
  })
  let currentBank = ""
  return {
    registry: REGISTRY,
    mailboxes: {
      listByUser: async () => links.map((l) => l.mailbox),
      findById: async (id: string) =>
        links.find((l) => l.mailboxId === id)?.mailbox ?? null,
      findByAddress: async () => null,
      findBySubscriptionId: async () => null,
      listForSubscriptionRenewal: async () => [],
      updateIfState: async () => true,
      create: async () => links[0].mailbox,
      update: async (_id: string, patch: { discardedCount?: number }) => {
        captured.mailboxPatches.push(patch)
        return links[0].mailbox
      },
      delete: async () => {},
    },
    links: {
      listByUser: async () => links,
      listByMailbox: async (mailboxId: string): Promise<EmailBankLink[]> =>
        links.filter((l) => l.mailboxId === mailboxId),
      findById: async (id: string) => links.find((l) => l.id === id) ?? null,
      create: async () => links[0],
      update: async (id: string, patch: { skippedCount?: number }) => {
        captured.linkPatches.push({ id, ...patch })
        return links[0]
      },
      delete: async () => {},
    },
    methods: {
      activeMethod: async () => "email" as const,
      claim: async () => {},
      release: async () => {},
    },
    mail: {
      listMessagesSince: async () => messages,
      // Como el proveedor real: la fecha del último correo de esos remitentes, sin cuerpos.
      lastMessageDate: async (
        _id: string,
        senders: string[],
        since: Date,
        until: Date
      ) => {
        const times = messages
          .filter((m) => senders.includes(m.from.trim().toLowerCase()))
          .map((m) => m.receivedAt.getTime())
          .filter((t) => t >= since.getTime() && t <= until.getTime())
        return times.length ? new Date(Math.max(...times)) : null
      },
      startDelta: async () => "delta-2",
      runDelta: async () => ({ messages, deltaLink: "delta-2" }),
      fetchMessage: async () => null,
      ensureSubscription: async () => null,
      deleteSubscription: async () => {},
    },
    store: {
      confirmSetup: async () => ({
        bankId: "bank-x",
        accounts: 1,
        cards: 0,
        movements: 0,
      }),
      listInstruments: async (bankId: string) => {
        currentBank = bankId
        return instrumentsOf(bankId)
      },
      upsertMovements: async (
        _userId: string,
        movements: ResolvedEmailMovement[]
      ) => {
        const list = captured.byBank.get(currentBank) ?? []
        list.push(...movements.map((m) => m.description))
        captured.byBank.set(currentBank, list)
        return { createdExternalIds: movements.map((m) => m.externalId), ambiguousExternalIds: [] }
      },
      updateBucketAmounts: async () => {},
      setAccountBalance: async () => {},
      markBankSynced: async () => {},
      countBankDependents: async () => ({
        accounts: 0,
        movements: 0,
        recurring: 0,
        installments: 0,
        incomes: 0,
      }),
      deleteBank: async () => {},
    },
  } satisfies EmailConnectionDeps
}

test("un buzón con dos bancos importa en una pasada y cada movimiento va a su banco", async () => {
  const links = [
    link({ id: "link-bch", bankProvider: "bancochile", bankId: "bank-bch" }),
    link({ id: "link-bp", bankProvider: "bancoprueba", bankId: "bank-bp" }),
  ]
  const captured = {
    byBank: new Map<string, string[]>(),
    linkPatches: [] as { id: string; skippedCount?: number }[],
    mailboxPatches: [] as { discardedCount?: number }[],
  }
  const deps = depsFor(
    links,
    [cargoBancoChile("m-bch"), cargoBancoPrueba("m-bp")],
    captured
  )

  const res = await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T12:00:00Z"),
  })

  assert.equal(res.imported, 2)
  assert.deepEqual(captured.byBank.get("bank-bch"), ["COMPRA"])
  assert.deepEqual(captured.byBank.get("bank-bp"), ["Cargo Banco Prueba"])
})

test("el correo de otro banco del mismo buzón no cuenta como omitido", async () => {
  const links = [
    link({ id: "link-bch", bankProvider: "bancochile", bankId: "bank-bch" }),
    link({ id: "link-bp", bankProvider: "bancoprueba", bankId: "bank-bp" }),
  ]
  const captured = {
    byBank: new Map<string, string[]>(),
    linkPatches: [] as { id: string; skippedCount?: number }[],
    mailboxPatches: [] as { discardedCount?: number }[],
  }
  const deps = depsFor(
    links,
    [cargoBancoChile("m-bch"), cargoBancoPrueba("m-bp")],
    captured
  )

  const res = await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T12:00:00Z"),
  })

  assert.equal(res.skipped, 0)
  // Ningún vínculo sumó omitidos por el correo del otro banco.
  for (const patch of captured.linkPatches)
    assert.equal(patch.skippedCount ?? 0, 0)
})

test("el correo que ningún banco reclama se descarta en el buzón, no en un banco", async () => {
  const links = [
    link({ id: "link-bch", bankProvider: "bancochile", bankId: "bank-bch" }),
  ]
  const captured = {
    byBank: new Map<string, string[]>(),
    linkPatches: [] as { id: string; skippedCount?: number }[],
    mailboxPatches: [] as { discardedCount?: number }[],
  }
  const deps = depsFor(
    links,
    [cargoBancoChile("m-bch"), ajeno("m-spam"), cargoBancoPrueba("m-sin-link")],
    captured
  )

  const res = await syncMailbox(deps, "mbx-1", {
    now: new Date("2026-07-14T12:00:00Z"),
  })

  // El del newsletter y el del banco sin vínculo en este buzón: descartados del buzón.
  assert.equal(res.discarded, 2)
  assert.equal(res.skipped, 0)
  assert.equal(captured.mailboxPatches.at(-1)?.discardedCount, 2)
})

// --- Alta de vínculos ---

function linkDeps(existing: EmailBankLinkWithMailbox[]) {
  const created: {
    mailboxId: string
    bankProvider: string
    label: string | null
  }[] = []
  return {
    created,
    deps: {
      registry: REGISTRY,
      mailboxes: {
        listByUser: async () => [mailbox(), mailbox({ id: "mbx-2" })],
        findById: async (id: string) => mailbox({ id }),
        findByAddress: async () => null,
        findBySubscriptionId: async () => null,
        listForSubscriptionRenewal: async () => [],
        updateIfState: async () => true,
        create: async () => mailbox(),
        update: async () => mailbox(),
        delete: async () => {},
      },
      links: {
        listByUser: async () => existing,
        listByMailbox: async (id: string): Promise<EmailBankLink[]> =>
          existing.filter((l) => l.mailboxId === id),
        findById: async () => null,
        create: async (input: {
          mailboxId: string
          bankProvider: string
          label: string | null
        }) => {
          created.push(input)
          return link({ ...input, id: "link-nuevo" })
        },
        update: async () => link(),
        delete: async () => {},
      },
      methods: {
        activeMethod: async () => null,
        claim: async () => {},
        release: async () => {},
      },
    },
  }
}

test("el mismo banco no puede repetirse dentro del mismo buzón", async () => {
  const { deps } = linkDeps([link({ mailboxId: "mbx-1" })])
  await assert.rejects(
    () =>
      addBankLink(deps, "user-1", {
        mailboxId: "mbx-1",
        bankProvider: "bancochile",
      }),
    /ya está conectado desde este correo/
  )
})

test("el mismo banco desde otro buzón exige etiqueta y no se fusiona", async () => {
  const { deps, created } = linkDeps([link({ mailboxId: "mbx-1" })])

  await assert.rejects(
    () =>
      addBankLink(deps, "user-1", {
        mailboxId: "mbx-2",
        bankProvider: "bancochile",
      }),
    /etiqueta/
  )

  await addBankLink(deps, "user-1", {
    mailboxId: "mbx-2",
    bankProvider: "bancochile",
    label: "Empresa",
  })
  assert.equal(created.length, 1)
  assert.deepEqual(
    {
      mailboxId: created[0].mailboxId,
      bankProvider: created[0].bankProvider,
      label: created[0].label,
    },
    { mailboxId: "mbx-2", bankProvider: "bancochile", label: "Empresa" }
  )
})

test("el primer vínculo de un banco no exige etiqueta", async () => {
  const { deps, created } = linkDeps([])
  await addBankLink(deps, "user-1", {
    mailboxId: "mbx-1",
    bankProvider: "bancoprueba",
  })
  assert.equal(created[0].label, null)
})
