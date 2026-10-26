import { createHash } from "node:crypto"
import { prisma } from "./client.ts"
import { canonicalJson } from "../../../../shared/canonical-json.ts"
import { LockBusyError, withLock } from "../../../../shared/mutex.ts"
import { planBankReconciliation } from "../../../application/finance-use-cases/bank-reconciliation.ts"
import { NotOwnerError } from "../../../domain/finance/finance.domain.ts"
import { EmailSetupStateError } from "../../../domain/finance/email-connection.domain.ts"
import type { BankReconciliationInput } from "../../../../../lib/schemas/bank-reconciliation.ts"
import { Prisma } from "./generated/client.ts"

const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue

/** Preview y aplicación recorren exactamente la misma validación. Todo el lote se guarda atómicamente. */
export async function reconcileBankAccount(
  userId: string,
  input: BankReconciliationInput,
  previewToken?: string
) {
  return withLock(`email:${userId}`, () =>
    prisma.$transaction(
      async (db) => {
        const [lock] = await db.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext(${userId})) AS locked`
        if (!lock.locked)
          throw new LockBusyError(
            "Hay una sincronización o conciliación en curso"
          )
        if (previewToken) {
          const receipt = await db.bankReconciliation.findUnique({
            where: { userId_token: { userId, token: previewToken } },
          })
          if (receipt) {
            if (canonicalJson(receipt.input) !== canonicalJson(input))
              throw new EmailSetupStateError("Token ya usado con otros datos")
            return receipt.result
          }
        }
        const account = await db.financialAccount.findFirst({
          where: { id: input.accountId, userId },
          include: { buckets: { orderBy: { id: "asc" } } },
        })
        if (!account) throw new NotOwnerError()
        const [rows, categories, links] = await Promise.all([
          db.transaction.findMany({
            where: { accountId: account.id, userId },
            orderBy: { id: "asc" },
            include: {
              reimbursementsPaid: true,
              reimbursementsReceived: true,
              installmentPlanAsSource: true,
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
        ])
        const legacyCutoff =
          links
            .map((l) => l.lastBalanceReconciledAt?.toISOString())
            .filter((d): d is string => !!d)
            .sort()
            .at(-1) ?? null
        const state = {
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
            recurringOnly:
              !!m.recurringTemplateId &&
              !m.incomeId &&
              !m.installmentItemId &&
              !m.installmentPlanAsSource,
            linked: !!(
              m.incomeId ||
              m.recurringTemplateId ||
              m.installmentItemId ||
              m.installmentPlanAsSource
            ),
            reimbursementAmount: [
              ...m.reimbursementsPaid,
              ...m.reimbursementsReceived,
            ].reduce((s, r) => s + Number(r.amount), 0),
            updatedAt: m.updatedAt.toISOString(),
          })),
          categories,
        }
        const plan = {
          ...planBankReconciliation(state, input, new Date()),
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
        const token = createHash("sha256")
          .update(
            canonicalJson({
              userId,
              input,
              state,
              accountUpdatedAt: account.updatedAt.toISOString(),
              bucketVersions: account.buckets
                .map((b) => [b.id, b.updatedAt.toISOString()])
                .sort(),
            })
          )
          .digest("hex")
        if (!previewToken)
          return json({ dryRun: true, previewToken: token, ...plan })
        if (token !== previewToken)
          throw new EmailSetupStateError(
            "Los datos cambiaron desde la previsualización; repite el dry run"
          )
        const now = new Date()
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
                source: input.source,
                evidence: c.after.evidence,
                recurringSettlement: c.after.settleRecurringCharge === true,
                recurringTemplateId: row.recurringTemplateId,
                bankPostingDate: c.after.date,
                snapshotAt: input.snapshotAt,
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
                source: input.source,
                evidence: a.evidence,
                distinctFrom: a.distinctFrom ?? [],
                bankPostingDate: a.date,
                snapshotAt: input.snapshotAt,
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
              reconciledAt: new Date(input.snapshotAt),
              asOf: plan.replayedIds.length ? now : new Date(input.snapshotAt),
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
      { isolationLevel: "Serializable", timeout: 30000 }
    )
  )
}
