import { prisma } from "./client.ts"
import { LockBusyError, withLock } from "../../../../shared/mutex.ts"
import type {
  BankReconciliationStore,
  BankReconciliationTx,
} from "../../../domain/finance/bank-reconciliation.domain.ts"
import { Prisma } from "./generated/client.ts"

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue

/** Vínculos que la regla de corrección mira; lo comparte la búsqueda del plugin. */
export function reconciliationLinks(m: {
  recurringTemplateId: string | null
  incomeId: string | null
  installmentItemId: string | null
  installmentPlanAsSource: unknown
  reimbursementsPaid: { amount: Prisma.Decimal }[]
  reimbursementsReceived: { amount: Prisma.Decimal }[]
}) {
  return {
    installmentItemId: m.installmentItemId,
    installmentOnly:
      !!m.installmentItemId &&
      !m.recurringTemplateId &&
      !m.incomeId &&
      !m.installmentPlanAsSource,
    recurringOnly:
      !!m.recurringTemplateId &&
      !m.incomeId &&
      !m.installmentItemId &&
      !m.installmentPlanAsSource,
    linked: !!(
      m.recurringTemplateId ||
      m.incomeId ||
      m.installmentItemId ||
      m.installmentPlanAsSource
    ),
    reimbursementAmount: [
      ...m.reimbursementsPaid,
      ...m.reimbursementsReceived,
    ].reduce((s, r) => s + Number(r.amount), 0),
  }
}

/** Una transacción Serializable por conciliación; recuerda lo leído en `loadState` para `apply`. */
function reconciliationTx(db: Prisma.TransactionClient): BankReconciliationTx {
  let loaded: {
    account: { id: string }
    rows: {
      id: string
      recurringTemplateId: string | null
      reconciliation: Prisma.JsonValue
    }[]
  } | null = null
  return {
    async findReceipt(userId, token) {
      const receipt = await db.bankReconciliation.findUnique({
        where: { userId_token: { userId, token } },
      })
      return receipt && { input: receipt.input, result: receipt.result }
    },

    async loadState(userId, accountId) {
      const account = await db.financialAccount.findFirst({
        where: { id: accountId, userId },
        include: { buckets: { orderBy: { id: "asc" } } },
      })
      if (!account) return null
      const [rows, categories, links, loans, cards] = await Promise.all([
        db.transaction.findMany({
          where: { accountId: account.id, userId },
          orderBy: { id: "asc" },
          include: {
            reimbursementsPaid: true,
            reimbursementsReceived: true,
            installmentPlanAsSource: true,
            installmentItem: { select: { plan: { select: { kind: true } } } },
          },
        }),
        db.category.findMany({
          where: { userId },
          select: { id: true, type: true },
          orderBy: { id: "asc" },
        }),
        db.emailBankLink.findMany({
          where: { userId, bankId: account.bankId },
          select: { lastBalanceReconciledAt: true },
        }),
        db.installmentPlan.findMany({
          where: {
            userId,
            accountId: account.id,
            kind: "loan",
            sourceTransactionId: null,
          },
          orderBy: { id: "asc" },
          include: {
            items: {
              orderBy: { index: "asc" },
              include: { transaction: { select: { id: true } } },
            },
          },
        }),
        db.installmentPlan.findMany({
          where: {
            userId,
            accountId: account.id,
            kind: "card",
            sourceTransactionId: { not: null },
          },
          orderBy: { id: "asc" },
          include: {
            items: {
              orderBy: { index: "asc" },
              include: { transaction: { select: { id: true } } },
            },
          },
        }),
      ])
      loaded = { account, rows }
      const legacyCutoff =
        links
          .map((l) => l.lastBalanceReconciledAt?.toISOString())
          .filter((d): d is string => !!d)
          .sort()
          .at(-1) ?? null
      return {
        state: {
          accountType: account.accountType,
          buckets: account.buckets.map((b) => ({
            id: b.id,
            kind: b.kind,
            currency: b.currency,
            reconciledAt: b.reconciledAt?.toISOString() ?? legacyCutoff,
          })),
          movements: rows.map((m) => ({
            id: m.id,
            date: m.transactionDate.toISOString().slice(0, 10),
            description: m.description,
            amount: Number(m.amount),
            currency: m.currency,
            direction: m.direction,
            categoryId: m.categoryId,
            bucketId: m.bucketId,
            status: m.status,
            isInternal: m.isInternal,
            bankReceivedAt: m.bankReceivedAt?.toISOString() ?? null,
            ...reconciliationLinks(m),
            cardInstallment: m.installmentItem?.plan.kind === "card",
            updatedAt: m.updatedAt.toISOString(),
          })),
          categories,
          loanPlans: loans.map((p) => ({
            id: p.id,
            currency: p.currency,
            categoryId: p.categoryId,
            totalAmount: Number(p.totalAmount),
            installmentsCount: p.installmentsCount,
            updatedAt: p.updatedAt.toISOString(),
            items: p.items.map((i) => ({
              id: i.id,
              index: i.index,
              amount: Number(i.amount),
              dueDate: i.dueDate.toISOString().slice(0, 10),
              transactionId: i.transaction?.id ?? null,
              paidOutsideApp: i.paidOutsideApp,
              updatedAt: i.updatedAt.toISOString(),
            })),
          })),
          cardPlans: cards.map((p) => ({
            id: p.id,
            sourceTransactionId: p.sourceTransactionId!,
            currency: p.currency,
            categoryId: p.categoryId,
            totalAmount: Number(p.totalAmount),
            installmentsCount: p.installmentsCount,
            updatedAt: p.updatedAt.toISOString(),
            items: p.items.map((i) => ({
              id: i.id,
              index: i.index,
              amount: Number(i.amount),
              dueDate: i.dueDate.toISOString().slice(0, 10),
              transactionId: i.transaction?.id ?? null,
              paidOutsideApp: i.paidOutsideApp,
              updatedAt: i.updatedAt.toISOString(),
            })),
          })),
        },
        version: {
          accountUpdatedAt: account.updatedAt.toISOString(),
          bucketVersions: account.buckets
            .map((b) => [b.id, b.updatedAt.toISOString()])
            .sort(),
        },
        beforeBuckets: account.buckets.map((b) => ({
          id: b.id,
          kind: b.kind,
          currency: b.currency,
          limit: Number(b.limitAmount),
          used: Number(b.used),
          available: Number(b.available),
          asOf: b.asOf?.toISOString() ?? null,
        })),
      }
    },

    async apply(userId, input, plan, token, now) {
      if (!loaded || loaded.account.id !== input.accountId)
        throw new Error("apply sin loadState de la misma cuenta")
      const { account, rows } = loaded
      // El cronograma, sus pagos, los saldos y el recibo se guardan juntos o se deshacen juntos.
      for (const correction of plan.loanCorrections) {
        await db.installmentPlan.update({
          where: {
            id: correction.before.id,
            userId,
            accountId: account.id,
            kind: "loan",
          },
          data: { totalAmount: correction.after.totalAmount },
        })
        for (const item of correction.after.items) {
          await db.installmentItem.update({
            where: {
              id: item.id,
              planId: correction.before.id,
              plan: { userId },
            },
            data: { amount: item.amount },
          })
        }
      }
      // La compra fuente ya consumió el cupo. Solo cambia la planificación pendiente;
      // las cuotas facturadas/fuera de la app y sus movimientos conservan hasta su versión.
      for (const correction of plan.cardCorrections) {
        await db.installmentPlan.update({
          where: {
            id: correction.before.id,
            userId,
            accountId: account.id,
            kind: "card",
            sourceTransactionId: correction.before.sourceTransactionId,
          },
          data: { totalAmount: correction.after.totalAmount },
        })
        for (const item of correction.after.items) {
          if (
            item.transactionId ||
            item.paidOutsideApp ||
            correction.before.items.find((old) => old.id === item.id)
              ?.amount === item.amount
          )
            continue
          await db.installmentItem.update({
            where: {
              id: item.id,
              planId: correction.before.id,
              plan: { userId, accountId: account.id, kind: "card" },
              paidOutsideApp: false,
              transaction: { is: null },
            },
            data: { amount: item.amount },
          })
        }
      }
      for (const c of plan.corrections) {
        const row = rows.find((r) => r.id === c.before.id)!
        await db.transaction.update({
          where: { id: row.id, userId },
          data: {
            transactionDate: new Date(c.after.date + "T00:00:00Z"),
            description: c.after.description,
            amount: c.after.amount,
            currency: c.after.currency,
            categoryId: c.after.categoryId,
            bucketId: c.after.bucketId,
            reviewed: true,
            reconciliation: json({
              source: plan.source,
              evidence: c.after.evidence,
              recurringSettlement: c.after.settleRecurringCharge === true,
              recurringTemplateId: row.recurringTemplateId,
              ...(c.after.correctedLoanPlanId
                ? { correctedLoanPlanId: c.after.correctedLoanPlanId }
                : {}),
              bankPostingDate: c.after.date,
              snapshotAt: plan.snapshotAt,
              reconciledAt: now.toISOString(),
              original: row.reconciliation ?? c.before,
            }),
          },
        })
      }
      const addedIds: string[] = []
      for (const a of plan.additions) {
        const added = await db.transaction.create({
          data: {
            userId,
            accountId: account.id,
            transactionDate: new Date(a.date + "T00:00:00Z"),
            description: a.description,
            amount: a.amount,
            currency: a.currency,
            categoryId: a.categoryId,
            bucketId: a.bucketId,
            direction: a.direction,
            isInternal: a.isInternal,
            reviewed: true,
            reconciliation: json({
              source: plan.source,
              evidence: a.evidence,
              distinctFrom: a.distinctFrom ?? [],
              bankPostingDate: a.date,
              snapshotAt: plan.snapshotAt,
              reconciledAt: now.toISOString(),
            }),
          },
        })
        addedIds.push(added.id)
      }
      for (const b of plan.projectedBuckets)
        await db.balanceBucket.update({
          where: { id: b.id, userId },
          data: {
            limitAmount: b.limit,
            used: b.used,
            available: b.available,
            reconciledAt: new Date(plan.snapshotAt),
            asOf: plan.replayedIds.length ? now : new Date(plan.snapshotAt),
          },
        })
      const cash = plan.projectedBuckets.find((b) => b.kind === "cash")
      const national = plan.projectedBuckets.find(
        (b) => b.kind === "credit_national"
      )
      await db.financialAccount.update({
        where: { id: account.id, userId },
        data: { balance: cash ? cash.available : -(national?.used ?? 0) },
      })
      const result = json({
        dryRun: false,
        ...plan,
        addedIds,
        appliedAt: now.toISOString(),
      })
      await db.bankReconciliation.create({
        data: {
          userId,
          accountId: account.id,
          token,
          input: json(input),
          result,
        },
      })
      return result
    },
  }
}

/** Lock en memoria + advisory lock por usuario + transacción Serializable: todo el lote es atómico. */
export const bankReconciliationStore: BankReconciliationStore = {
  withUserLock: (userId, fn) =>
    withLock(`email:${userId}`, () =>
      prisma.$transaction(
        async (db) => {
          const [lock] = await db.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS locked`
          if (!lock.locked)
            throw new LockBusyError(
              "Hay una sincronización o conciliación en curso"
            )
          return fn(reconciliationTx(db))
        },
        { isolationLevel: "Serializable", timeout: 30000 }
      )
    ),
}
