// Persistencia Prisma de la conexión por CORREO: repositorio de conexiones (tokens cifrados),
// método de conexión exclusivo por (usuario, banco) y el store del setup/sync (creación atómica de
// instrumentos + importación idempotente). El dominio nunca ve Prisma ni tokens en claro.
import { prisma } from "./client.ts"
import { Money, type CurrencyCode } from "../../../domain/finance/money.ts"
import type { BucketKind } from "../../../domain/finance/finance.domain.ts"
import {
  ConnectionMethodConflictError,
  type ConnectionMethod,
  type ConnectionMethodRepository,
  type EmailConnection,
  type EmailConnectionPatch,
  type EmailConnectionRepository,
  type EmailConnectionStatus,
  type NewEmailConnection,
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
import { msgraphMailProvider } from "../../http/outlook/msgraph.provider.ts"
import { categorizePendingMovements } from "./categorize-pending.infrastructure.ts"
import { matchRecurringForImported } from "./match-recurring.ts"
import { runInstallmentsForImported } from "./run-installments.ts"

const CHUNK = 10 // upsert en lotes acotados (no satura el pool de conexiones)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEmailConnection(row: any): EmailConnection {
  return {
    id: row.id,
    userId: row.userId,
    bankProvider: row.bankProvider,
    emailProvider: row.emailProvider,
    emailAddress: row.emailAddress,
    bankId: row.bankId ?? null,
    status: row.status as EmailConnectionStatus,
    createdAt: row.createdAt,
    deltaLink: row.deltaLink ?? null,
    subscriptionId: row.subscriptionId ?? null,
    subscriptionExpiresAt: row.subscriptionExpiresAt ?? null,
    lastSyncedAt: row.lastSyncedAt ?? null,
    lastError: row.lastError ?? null,
    skippedCount: row.skippedCount ?? 0,
    lastBalanceReconciledAt: row.lastBalanceReconciledAt ?? null,
  }
}

export const emailConnectionRepository: EmailConnectionRepository = {
  async findByUser(userId, bankProvider) {
    const row = await prisma.emailConnection.findUnique({
      where: { userId_bankProvider: { userId, bankProvider } },
    })
    return row ? toEmailConnection(row) : null
  },
  async findById(id) {
    const row = await prisma.emailConnection.findUnique({ where: { id } })
    return row ? toEmailConnection(row) : null
  },
  async findBySubscriptionId(subscriptionId) {
    const row = await prisma.emailConnection.findFirst({
      where: { subscriptionId },
    })
    return row ? toEmailConnection(row) : null
  },
  async create(input: NewEmailConnection) {
    const { enc, iv } = encryptSecret(input.refreshToken, EMAIL_PURPOSE)
    const row = await prisma.emailConnection.create({
      data: {
        userId: input.userId,
        bankProvider: input.bankProvider,
        emailProvider: input.emailProvider,
        emailAddress: input.emailAddress,
        refreshTokenEnc: enc,
        refreshTokenIv: iv,
      },
    })
    return toEmailConnection(row)
  },
  async update(id, patch: EmailConnectionPatch) {
    const { refreshToken, ...rest } = patch
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...rest }
    if (refreshToken) {
      const { enc, iv } = encryptSecret(refreshToken, EMAIL_PURPOSE)
      data.refreshTokenEnc = enc
      data.refreshTokenIv = iv
    }
    return toEmailConnection(
      await prisma.emailConnection.update({ where: { id }, data })
    )
  },
  async delete(id) {
    await prisma.emailConnection.delete({ where: { id } })
  },
}

export const connectionMethodRepository: ConnectionMethodRepository = {
  async activeMethod(userId, bankProvider) {
    const row = await prisma.bankConnectionMethod.findUnique({
      where: { userId_bankProvider: { userId, bankProvider } },
    })
    return (row?.method as ConnectionMethod) ?? null
  },
  async claim(userId, bankProvider, method) {
    const existing = await prisma.bankConnectionMethod.findUnique({
      where: { userId_bankProvider: { userId, bankProvider } },
    })
    if (existing) {
      if (existing.method === method) return // ya reclamado por el mismo método (idempotente)
      throw new ConnectionMethodConflictError()
    }
    try {
      await prisma.bankConnectionMethod.create({
        data: { userId, bankProvider, method },
      })
    } catch (e) {
      // Carrera: otro proceso reclamó primero (índice único). Releer y decidir.
      const row = await prisma.bankConnectionMethod.findUnique({
        where: { userId_bankProvider: { userId, bankProvider } },
      })
      if (row && row.method !== method)
        throw new ConnectionMethodConflictError()
      if (!row) throw e
    }
  },
  async release(userId, bankProvider, method) {
    await prisma.bankConnectionMethod.deleteMany({
      where: { userId, bankProvider, method },
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
            provider: "bancochile",
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
              provider: "bancochile",
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
                provider: "bancochile",
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
        await db.emailConnection.update({
          where: { id: input.connectionId },
          data: {
            bankId: bank.id,
            status: "active",
            lastSyncedAt: now,
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
  // preservada). Devuelve los externalId nuevos para proyectar los buckets una sola vez.
  async upsertMovements(userId, movements: ResolvedEmailMovement[]) {
    if (movements.length === 0) return { createdExternalIds: [] }
    const existing = await prisma.transaction.findMany({
      where: { userId, externalId: { in: movements.map((m) => m.externalId) } },
      select: { accountId: true, externalId: true },
    })
    const existingKeys = new Set(
      existing.map((t) => `${t.accountId}:${t.externalId}`)
    )
    const createdExternalIds: string[] = []
    for (let i = 0; i < movements.length; i += CHUNK) {
      await Promise.all(
        movements.slice(i, i + CHUNK).map((m) => {
          if (!existingKeys.has(`${m.accountId}:${m.externalId}`))
            createdExternalIds.push(m.externalId)
          const fields = {
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
          return prisma.transaction.upsert({
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
        })
      )
    }
    return { createdExternalIds }
  },

  async updateBucketAmounts(bucketId, amounts) {
    await prisma.balanceBucket.update({
      where: { id: bucketId },
      data: {
        limitAmount: amounts.limitAmount.toDecimalString(),
        used: amounts.used.toDecimalString(),
        available: amounts.available.toDecimalString(),
        asOf: amounts.asOf,
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

  async deleteBank(bankId) {
    // FK ON DELETE CASCADE: borra cuentas y, con ellas, tarjetas, buckets y movimientos.
    await prisma.bank.delete({ where: { id: bankId } })
  },
}

// Deps completas de los use-cases de correo, listas para inyectar desde las rutas.
export function makeEmailConnectionDeps(): EmailConnectionDeps {
  return {
    emailConnections: emailConnectionRepository,
    methods: connectionMethodRepository,
    mail: msgraphMailProvider,
    store: emailSetupStore,
    matchRecurring: matchRecurringForImported,
    runInstallments: runInstallmentsForImported,
    categorize: categorizePendingMovements,
  }
}
