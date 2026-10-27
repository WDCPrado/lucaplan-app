import { LockBusyError } from "../../../../shared/mutex.ts"
// Persistencia Prisma de la conexión por CORREO: repositorios de buzones (tokens cifrados) y de
// vínculos con bancos, método de conexión exclusivo por (usuario, banco, buzón) y el store del
// setup/sync (creación atómica de instrumentos + importación idempotente). El dominio nunca ve
// Prisma ni tokens en claro.
import { prisma } from "./client.ts"
import { Prisma } from "./generated/client.ts"
import { decideEmailNotice } from "../../../domain/finance/bank-reconciliation.domain.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { BucketKind } from "../../../domain/finance/finance.domain.ts"
import {
  ConnectionMethodConflictError,
  type ConnectionMethod,
  type ConnectionMethodRepository,
  type EmailBankLink,
  type EmailBankLinkPatch,
  type EmailBankLinkRepository,
  type EmailBankLinkWithMailbox,
  type EmailLinkStatus,
  type EmailMailbox,
  type EmailMailboxPatch,
  type EmailMailboxRepository,
  type EmailMailboxStatus,
  type NewEmailBankLink,
  type NewEmailMailbox,
} from "../../../domain/finance/email-connection.domain.ts"
import type {
  EmailConfirmPersistInput,
  EmailConnectionDeps,
  EmailSetupStore,
  EmailStoredAccount,
  EmailStoredBucket,
  ResolvedEmailMovement,
} from "../../../application/finance-use-cases/email-connection-use-cases.ts"
import { encryptSecret, EMAIL_PURPOSE } from "../../crypto/secret-crypto.ts"
import { makeEmailMailRouter } from "../../http/email/provider-registry.ts"
import { categorizePendingMovements } from "./categorize-pending.infrastructure.ts"
import { matchRecurringForImported } from "./match-recurring.ts"
import { runInstallmentsForImported } from "./run-installments.ts"
import { notifyImportedForSync } from "./push-deps.ts"

const CHUNK = 10 // upsert en lotes acotados (no satura el pool de conexiones)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMailbox(row: any): EmailMailbox {
  return {
    id: row.id,
    userId: row.userId,
    emailProvider: row.emailProvider,
    emailAddress: row.emailAddress,
    status: row.status as EmailMailboxStatus,
    createdAt: row.createdAt,
    deltaLink: row.deltaLink ?? null,
    subscriptionId: row.subscriptionId ?? null,
    subscriptionExpiresAt: row.subscriptionExpiresAt ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastError: row.lastError ?? null,
    discardedCount: row.discardedCount ?? 0,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLink(row: any): EmailBankLink {
  return {
    id: row.id,
    mailboxId: row.mailboxId,
    userId: row.userId,
    bankProvider: row.bankProvider,
    label: row.label ?? null,
    bankId: row.bankId ?? null,
    status: row.status as EmailLinkStatus,
    createdAt: row.createdAt,
    skippedCount: row.skippedCount ?? 0,
    lastBalanceReconciledAt: row.lastBalanceReconciledAt ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toLinkWithMailbox(row: any): EmailBankLinkWithMailbox {
  return { ...toLink(row), mailbox: toMailbox(row.mailbox) }
}

export const emailMailboxRepository: EmailMailboxRepository = {
  async listByUser(userId) {
    const rows = await prisma.emailMailbox.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    })
    return rows.map(toMailbox)
  },
  async findById(id) {
    const row = await prisma.emailMailbox.findUnique({ where: { id } })
    return row ? toMailbox(row) : null
  },
  async findByAddress(userId, emailAddress) {
    const row = await prisma.emailMailbox.findUnique({
      where: { userId_emailAddress: { userId, emailAddress } },
    })
    return row ? toMailbox(row) : null
  },
  async findBySubscriptionId(subscriptionId) {
    const row = await prisma.emailMailbox.findFirst({
      where: { subscriptionId },
    })
    return row ? toMailbox(row) : null
  },
  async listForSubscriptionRenewal(before) {
    const rows = await prisma.emailMailbox.findMany({
      where: {
        status: "active",
        OR: [
          { subscriptionExpiresAt: null },
          { subscriptionExpiresAt: { lt: before } },
        ],
      },
    })
    return rows.map(toMailbox)
  },
  async create(input: NewEmailMailbox) {
    const { enc, iv } = encryptSecret(input.refreshToken, EMAIL_PURPOSE)
    const row = await prisma.emailMailbox.create({
      data: {
        userId: input.userId,
        emailProvider: input.emailProvider,
        emailAddress: input.emailAddress,
        refreshTokenEnc: enc,
        refreshTokenIv: iv,
      },
    })
    return toMailbox(row)
  },
  async update(id, patch: EmailMailboxPatch) {
    const { refreshToken, ...rest } = patch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...rest }
    if (refreshToken) {
      const { enc, iv } = encryptSecret(refreshToken, EMAIL_PURPOSE)
      data.refreshTokenEnc = enc
      data.refreshTokenIv = iv
    }
    return toMailbox(await prisma.emailMailbox.update({ where: { id }, data }))
  },
  async delete(id) {
    await prisma.emailMailbox.delete({ where: { id } })
  },
}

export const emailBankLinkRepository: EmailBankLinkRepository = {
  async listByUser(userId) {
    const rows = await prisma.emailBankLink.findMany({
      where: { userId },
      include: { mailbox: true },
      orderBy: { createdAt: "asc" },
    })
    return rows.map(toLinkWithMailbox)
  },
  async listByMailbox(mailboxId) {
    const rows = await prisma.emailBankLink.findMany({
      where: { mailboxId },
      orderBy: { createdAt: "asc" },
    })
    return rows.map(toLink)
  },
  async findById(id) {
    const row = await prisma.emailBankLink.findUnique({
      where: { id },
      include: { mailbox: true },
    })
    return row ? toLinkWithMailbox(row) : null
  },
  async create(input: NewEmailBankLink) {
    const row = await prisma.emailBankLink.create({
      data: {
        mailboxId: input.mailboxId,
        userId: input.userId,
        bankProvider: input.bankProvider,
        label: input.label,
      },
    })
    return toLink(row)
  },
  async update(id, patch: EmailBankLinkPatch) {
    return toLink(
      await prisma.emailBankLink.update({ where: { id }, data: patch })
    )
  },
  async delete(id) {
    await prisma.emailBankLink.delete({ where: { id } })
  },
}

export const connectionMethodRepository: ConnectionMethodRepository = {
  async activeMethod(userId, bankProvider, mailboxId) {
    const row = await prisma.bankConnectionMethod.findUnique({
      where: {
        userId_bankProvider_mailboxId: { userId, bankProvider, mailboxId },
      },
    })
    return (row?.method as ConnectionMethod) ?? null
  },
  async claim(userId, bankProvider, mailboxId, method) {
    const key = { userId, bankProvider, mailboxId }
    const existing = await prisma.bankConnectionMethod.findUnique({
      where: { userId_bankProvider_mailboxId: key },
    })
    if (existing) {
      if (existing.method === method) return // ya reclamado por el mismo método (idempotente)
      throw new ConnectionMethodConflictError()
    }
    try {
      await prisma.bankConnectionMethod.create({ data: { ...key, method } })
    } catch (e) {
      // Carrera: otro proceso reclamó primero (índice único). Releer y decidir.
      const row = await prisma.bankConnectionMethod.findUnique({
        where: { userId_bankProvider_mailboxId: key },
      })
      if (row && row.method !== method)
        throw new ConnectionMethodConflictError()
      if (!row) throw e
    }
  },
  async release(userId, bankProvider, mailboxId, method) {
    await prisma.bankConnectionMethod.deleteMany({
      where: { userId, bankProvider, mailboxId, method },
    })
  },
}

// --- Store del setup/sync ---

function refDigits(externalId: string): string {
  return externalId.replace(/\D/g, "")
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toStoredBucket(row: any): EmailStoredBucket {
  const currency = row.currency as CurrencyCode
  return {
    id: row.id,
    accountId: row.accountId,
    kind: row.kind as BucketKind,
    currency,
    limitAmount: Money.of(row.limitAmount.toString(), currency),
    used: Money.of(row.used.toString(), currency),
    available: Money.of(row.available.toString(), currency),
    reconciledAt: row.reconciledAt ?? null,
  }
}

export const emailSetupStore: EmailSetupStore = {
  // Confirmación ATÓMICA: banco + cuentas + tarjetas + buckets + movimientos del mes en una sola
  // transacción; si algo falla no queda ninguna entidad creada.
  async confirmSetup(input: EmailConfirmPersistInput) {
    return prisma.$transaction(
      async (db) => {
        const now = new Date()
        const bank = await db.bank.create({
          data: {
            userId: input.userId,
            name: input.bankName,
            provider: input.bankProvider,
            connectionMethod: "email",
            lastSyncedAt: now,
          },
        })
        const accountIdByKey = new Map<string, string>()
        const bucketIdByKey = new Map<string, string>() // `${accountKey}:${kind}`
        let cards = 0
        for (const acc of input.accounts) {
          const account = await db.financialAccount.create({
            data: {
              userId: input.userId,
              bankId: bank.id,
              name: acc.name,
              accountType: acc.accountType,
              currency: acc.currency,
              balance: acc.balance.toDecimalString(),
              cardLast4: acc.cardLast4,
              provider: input.bankProvider,
              externalId: acc.externalId,
              lastSyncedAt: now,
            },
          })
          accountIdByKey.set(acc.key, account.id)
          let cardId: string | null = null
          if (acc.card) {
            const card = await db.card.create({
              data: {
                userId: input.userId,
                accountId: account.id,
                cardType: acc.card.cardType,
                cardLast4: acc.cardLast4,
                brand: acc.card.brand,
                provider: input.bankProvider,
                externalId: acc.externalId,
              },
            })
            cardId = card.id
            cards++
          }
          for (const b of acc.buckets) {
            const bucket = await db.balanceBucket.create({
              data: {
                userId: input.userId,
                accountId: account.id,
                cardId,
                kind: b.kind,
                currency: b.currency,
                limitAmount: b.limitAmount.toDecimalString(),
                used: b.used.toDecimalString(),
                available: b.available.toDecimalString(),
                asOf: input.snapshotAt,
              },
            })
            bucketIdByKey.set(`${acc.key}:${b.kind}`, bucket.id)
          }
        }
        let movements = 0
        for (const m of input.movements) {
          const accountId = accountIdByKey.get(m.accountKey)
          if (!accountId) continue // movimiento de un instrumento no confirmado: no se importa
          await db.transaction.upsert({
            where: {
              accountId_externalId: { accountId, externalId: m.externalId },
            },
            create: {
              userId: input.userId,
              accountId,
              bucketId: m.bucketKind
                ? (bucketIdByKey.get(`${m.accountKey}:${m.bucketKind}`) ?? null)
                : null,
              externalId: m.externalId,
              transactionDate: m.date,
              description: m.description,
              amount: m.amount.toDecimalString(),
              currency: m.amount.currency,
              direction: m.direction,
              status: m.status,
              pending: false,
              isInternal: m.isInternal,
            },
            update: {}, // ya existía (no debería en la primera confirmación): se conserva intacto
          })
          movements++
        }
        // El vínculo adopta su banco dentro de la MISMA transacción: si algo falla, no queda un
        // vínculo apuntando a un banco a medio crear.
        await db.emailBankLink.update({
          where: { id: input.linkId },
          data: {
            bankId: bank.id,
            status: "active",
            lastBalanceReconciledAt: input.snapshotAt,
          },
        })
        return {
          bankId: bank.id,
          accounts: input.accounts.length,
          cards,
          movements,
        }
      },
      { timeout: 60_000 }
    )
  },

  async listInstruments(bankId) {
    const accountRows = await prisma.financialAccount.findMany({
      where: { bankId },
    })
    const accounts: EmailStoredAccount[] = accountRows.map((a) => ({
      id: a.id,
      accountType: a.accountType,
      currency: a.currency as CurrencyCode,
      externalRef: refDigits(a.externalId ?? ""),
      cardLast4: a.cardLast4 ?? null,
    }))
    const buckets = (
      await prisma.balanceBucket.findMany({
        where: { accountId: { in: accountRows.map((a) => a.id) } },
      })
    ).map(toStoredBucket)
    return { accounts, buckets }
  },

  // Upsert idempotente por (accountId, externalId); el update NO toca categoryId (categoría
  // preservada). Devuelve los externalId creados de verdad (para proyectar los buckets una sola
  // vez) y los ambiguos contra altas conciliadas, que no se escriben y quedan para revisión.
  async upsertMovements(userId, movements: ResolvedEmailMovement[]) {
    const created = new Set<string>()
    const ambiguous = new Set<string>()
    for (let i = 0; i < movements.length; i += CHUNK) {
      await Promise.all(
        movements.slice(i, i + CHUNK).map((m) => {
          const fields = {
            bankReceivedAt: m.bankReceivedAt,
            bucketId: m.bucketId,
            transactionDate: m.date,
            description: m.description,
            amount: m.amount.toDecimalString(),
            currency: m.amount.currency,
            direction: m.direction,
            status: "confirmed",
            pending: false,
            isInternal: m.isInternal,
          }
          return prisma.$transaction(async db => {
            const previous = await db.transaction.findUnique({ where: { accountId_externalId: { accountId: m.accountId, externalId: m.externalId } } })
            const key = (date: Date, amount: number, currency: string, description: string) =>
              ({ date: date.toISOString().slice(0, 10), direction: m.direction, amount, currency, description })
            // Una alta conciliada sin externalId puede recibir su aviso después: candidatas a ±4 días.
            let nearby: Parameters<typeof decideEmailNotice>[2] = []
            if (!previous) {
              const start = new Date(m.date); start.setUTCDate(start.getUTCDate() - 4)
              const end = new Date(m.date); end.setUTCDate(end.getUTCDate() + 4)
              const rows = await db.transaction.findMany({ where: { userId, accountId: m.accountId, externalId: null, reconciliation: { not: Prisma.DbNull }, transactionDate: { gte: start, lte: end }, direction: m.direction } })
              nearby = rows.map((c) => ({ id: c.id, ...key(c.transactionDate, Number(c.amount), c.currency, c.description) }))
            }
            const decision = decideEmailNotice(
              key(m.date, m.amount.toMajor(), m.amount.currency, m.description),
              previous && { reconciled: !!previous.reconciliation },
              nearby
            )
            if (decision.kind === "keep") return
            if (decision.kind === "link") {
              await db.transaction.update({ where: { id: decision.id, userId }, data: { externalId: m.externalId, bankReceivedAt: m.bankReceivedAt } })
              return
            }
            if (decision.kind === "ambiguous") {
              ambiguous.add(m.externalId)
              return
            }
            await db.transaction.upsert({
              where: {
                accountId_externalId: {
                  accountId: m.accountId,
                  externalId: m.externalId,
                },
              },
              create: {
                userId,
                accountId: m.accountId,
                externalId: m.externalId,
                ...fields,
              },
              update: fields, // categoryId intacto → categoría preservada
            })
            if (decision.kind === "create") created.add(m.externalId)
          })
        })
      )
    }
    // En el orden de entrada: las escrituras del lote terminan en cualquier orden.
    const ids = movements.map((m) => m.externalId)
    return {
      createdExternalIds: ids.filter((id) => created.has(id)),
      ambiguousExternalIds: ids.filter((id) => ambiguous.has(id)),
    }
  },

  async updateBucketAmounts(bucketId, amounts) {
    await prisma.balanceBucket.update({
      where: { id: bucketId },
      data: {
        limitAmount: amounts.limitAmount.toDecimalString(),
        used: amounts.used.toDecimalString(),
        available: amounts.available.toDecimalString(),
        asOf: amounts.asOf,
        ...(amounts.reconciledAt ? { reconciledAt: amounts.reconciledAt } : {}),
      },
    })
  },

  async setAccountBalance(accountId, amount) {
    await prisma.financialAccount.update({
      where: { id: accountId },
      data: { balance: amount.toDecimalString() },
    })
  },

  async markBankSynced(bankId) {
    await prisma.bank.update({
      where: { id: bankId },
      data: { lastSyncedAt: new Date() },
    })
  },

  // Lo que el borrado del banco arrastra en cascada desde sus cuentas. Se cuenta ANTES de ejecutar
  // para que la UI pueda decir qué se pierde: son datos que el usuario creó a mano.
  async countBankDependents(bankId) {
    const accountIds = (
      await prisma.financialAccount.findMany({
        where: { bankId },
        select: { id: true },
      })
    ).map((a) => a.id)
    if (accountIds.length === 0)
      return {
        accounts: 0,
        movements: 0,
        recurring: 0,
        installments: 0,
        incomes: 0,
      }
    const where = { accountId: { in: accountIds } }
    const [movements, recurring, installments, incomes] = await Promise.all([
      prisma.transaction.count({ where }),
      prisma.recurringTemplate.count({ where }),
      prisma.installmentPlan.count({ where }),
      prisma.income.count({ where }),
    ])
    return {
      accounts: accountIds.length,
      movements,
      recurring,
      installments,
      incomes,
    }
  },

  async deleteBank(bankId) {
    // FK ON DELETE CASCADE: borra cuentas y, con ellas, tarjetas, buckets, movimientos y lo que el
    // usuario colgó de esas cuentas (ingresos, recurrentes, planes de cuotas). Por eso la UI lo
    // enumera antes: ver countBankDependents.
    await prisma.bank.delete({ where: { id: bankId } })
  },
}

// Deps completas de los use-cases de correo, listas para inyectar desde las rutas.
export function makeEmailConnectionDeps(): EmailConnectionDeps {
  return {
    withBankLock: (userId, work) => prisma.$transaction(async db => {
      const [lock] = await db.$queryRaw<{locked:boolean}[]>`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS locked`
      if (!lock.locked) throw new LockBusyError("Hay una sincronización o conciliación en curso")
      return work()
    },{timeout:120000}),
    mailboxes: emailMailboxRepository,
    links: emailBankLinkRepository,
    methods: connectionMethodRepository,
    mail: makeEmailMailRouter(),
    store: emailSetupStore,
    matchRecurring: matchRecurringForImported,
    runInstallments: runInstallmentsForImported,
    categorize: categorizePendingMovements,
    notify: notifyImportedForSync,
  }
}

