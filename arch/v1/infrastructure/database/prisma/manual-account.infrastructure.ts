// Adapter Prisma del ciclo de vida de una cuenta manual. La foto del estado se lee siempre con el
// mismo `select`, dentro o fuera de la transacción, para que el hash de la previsualización y el de
// la eliminación se calculen sobre exactamente los mismos datos.
import { prisma } from "./client.ts"
import { Prisma } from "./generated/client.ts"
import type { AccountType } from "../../../domain/finance/finance.domain.ts"
import type { CurrencyCode } from "../../../domain/finance/money.ts"
import type {
  ManualAccountRepository,
  ManualAccountSnapshot,
} from "../../../domain/finance/manual-account.domain.ts"

type Db = Prisma.TransactionClient | typeof prisma

async function loadSnapshot(
  db: Db,
  userId: string,
  accountId: string
): Promise<ManualAccountSnapshot | null> {
  const account = await db.financialAccount.findFirst({
    where: { id: accountId, userId },
    select: {
      id: true,
      name: true,
      accountType: true,
      currency: true,
      provider: true,
      balance: true,
      bankId: true,
      bank: {
        select: {
          name: true,
          provider: true,
          connectionMethod: true,
          emailBankLink: { select: { id: true } },
        },
      },
      _count: { select: { buckets: true, cards: true } },
      incomes: { select: { id: true, name: true }, orderBy: { id: "asc" } },
      recurring: { select: { id: true, label: true }, orderBy: { id: "asc" } },
      installments: {
        select: { id: true, description: true, kind: true },
        orderBy: { id: "asc" },
      },
    },
  })
  if (!account) return null
  // En secuencia: dentro de una transacción interactiva el cliente atiende una consulta a la vez.
  const otherAccountsInBank = await db.financialAccount.count({
    where: { bankId: account.bankId, id: { not: accountId } },
  })
  const transactions = await db.transaction.findMany({
    where: { accountId, userId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      status: true,
      recurringTemplateId: true,
      recurringTemplate: { select: { accountId: true } },
      installmentItemId: true,
      installmentItem: {
        select: { planId: true, plan: { select: { accountId: true } } },
      },
      incomeId: true,
      income: { select: { accountId: true } },
      installmentPlanAsSource: { select: { id: true, accountId: true } },
    },
  })
  const foreign = await db.transaction.findMany({
    where: {
      userId,
      accountId: { not: accountId },
      OR: [
        { recurringTemplate: { accountId } },
        { installmentItem: { plan: { accountId } } },
        { income: { accountId } },
      ],
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      accountId: true,
      account: { select: { name: true } },
      recurringTemplateId: true,
      installmentItemId: true,
      installmentItem: { select: { planId: true } },
      incomeId: true,
    },
  })
  return {
    account: {
      id: account.id,
      name: account.name,
      accountType: account.accountType as AccountType,
      currency: account.currency as CurrencyCode,
      provider: account.provider,
      balance: Number(account.balance),
      bankId: account.bankId,
      bankName: account.bank.name,
      bankIsManual:
        account.bank.provider === "manual" &&
        !account.bank.connectionMethod &&
        !account.bank.emailBankLink,
    },
    otherAccountsInBank,
    buckets: account._count.buckets,
    cards: account._count.cards,
    transactions: transactions.map((t) => ({
      id: t.id,
      status: t.status,
      recurringTemplateId: t.recurringTemplateId,
      recurringAccountId: t.recurringTemplate?.accountId ?? null,
      installmentItemId: t.installmentItemId,
      installmentPlanId: t.installmentItem?.planId ?? null,
      installmentPlanAccountId: t.installmentItem?.plan.accountId ?? null,
      incomeId: t.incomeId,
      incomeAccountId: t.income?.accountId ?? null,
      sourceOfPlanId: t.installmentPlanAsSource?.id ?? null,
      sourceOfPlanAccountId: t.installmentPlanAsSource?.accountId ?? null,
    })),
    incomes: account.incomes,
    recurring: account.recurring,
    plans: account.installments,
    foreignTransactions: foreign.map((t) => ({
      id: t.id,
      accountId: t.accountId,
      accountName: t.account.name,
      recurringTemplateId: t.recurringTemplateId,
      installmentItemId: t.installmentItemId,
      installmentPlanId: t.installmentItem?.planId ?? null,
      incomeId: t.incomeId,
    })),
  }
}

export const manualAccountRepository: ManualAccountRepository = {
  async update(accountId, input) {
    await prisma.financialAccount.update({
      where: { id: accountId },
      data: {
        name: input.name,
        color: input.color,
        cardLast4: input.cardLast4,
        overdraftLimit: input.overdraftLimit.toFixed(2),
      },
    })
  },
  snapshot: (userId, accountId) => loadSnapshot(prisma, userId, accountId),
  async deleteChecked(userId, accountId, check) {
    // Serializable: si otra escritura toca estas filas entre la lectura y el borrado, la BD aborta
    // la transacción completa en vez de borrar sobre un estado que ya no es el confirmado.
    return prisma.$transaction(
      async (db) => {
        const impact = check(await loadSnapshot(db, userId, accountId))
        if (impact.plansToReopen.length > 0)
          await db.installmentPlan.updateMany({
            where: { id: { in: impact.plansToReopen }, userId },
            data: { completedAt: null },
          })
        // FK en cascada: movimientos, buckets, tarjetas, ingresos, recurrentes y planes de la
        // cuenta. Lo de otras cuentas que apuntaba aquí queda sin vínculo (SetNull).
        await db.financialAccount.delete({ where: { id: accountId } })
        if (impact.deletes.bank)
          await db.bank.delete({ where: { id: impact.account.bankId } })
        return impact
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  },
}
