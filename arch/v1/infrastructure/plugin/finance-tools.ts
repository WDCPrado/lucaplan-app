import type {
  PluginActor,
  PluginJsonValue,
} from "../../domain/plugin/plugin.domain.ts"
import type {
  PluginToolInput,
  PluginToolName,
} from "../../../../lib/schemas/plugin.ts"
import { Money } from "../../domain/finance/money.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import { EmailSetupStateError } from "../../domain/finance/email-connection.domain.ts"
import { prisma } from "../database/prisma/client.ts"
import {
  accountRepository,
  bankRepository,
  balanceBucketRepository,
  categoryRepository,
  monthlyBudgetRepository,
  transactionRepository,
} from "../database/prisma/finance.infrastructure.ts"
import { incomeRepository } from "../database/prisma/income.infrastructure.ts"
import { recurringTemplateRepository } from "../database/prisma/recurring.infrastructure.ts"
import { installmentPlanRepository } from "../database/prisma/installment.infrastructure.ts"
import { correctionRepository } from "../database/prisma/categorization-correction.infrastructure.ts"
import { budgetPeriodRepository } from "../database/prisma/budget-period.infrastructure.ts"
import { exchangeRateProvider } from "../http/exchange/usd-clp.ts"
import { makeEmailConnectionDeps } from "../database/prisma/email-connection.infrastructure.ts"
import { createAccount } from "../../application/finance-use-cases/create-account-use-case.ts"
import { createTransaction } from "../../application/finance-use-cases/create-transaction-use-case.ts"
import {
  updateTransaction,
  deleteTransaction,
} from "../../application/finance-use-cases/update-transaction-use-case.ts"
import { categorizeTransaction } from "../../application/finance-use-cases/categorize-transaction-use-case.ts"
import {
  upsertCategory,
  deleteCategory,
  setCategoryLimit,
} from "../../application/finance-use-cases/upsert-category-use-case.ts"
import { setMonthlyBudget } from "../../application/finance-use-cases/set-monthly-budget-use-case.ts"
import {
  createIncome,
  updateIncome,
  deleteIncome,
  generateMonthlyIncome,
  ungenerateMonthlyIncome,
} from "../../application/finance-use-cases/income-use-cases.ts"
import {
  createRecurringTemplate,
  updateRecurringTemplate,
  setRecurringActive,
  deleteRecurringTemplate,
  setRecurringPeriodPaid,
  payRecurringPeriodWith,
} from "../../application/finance-use-cases/recurring-use-cases.ts"
import {
  createInstallmentPlan,
  updateInstallmentItem,
  setInstallmentPlanCategory,
  deleteInstallmentPlan,
  payInstallmentManually,
  linkTransactionToItem,
  unlinkTransactionFromItem,
} from "../../application/finance-use-cases/installment-use-cases.ts"
import {
  listAccounts,
  getMonthlySummary,
  getBudgetView,
  listIncomesView,
  listRecurringView,
  listInstallmentsView,
} from "../../application/finance-use-cases/finance-read.ts"
import { applyAccountBalance } from "../../application/finance-use-cases/balance-scan-use-cases.ts"
import { rangeOf } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { reconcileEmailBalances } from "../../application/finance-use-cases/email-connection-use-cases.ts"
import { withLock } from "../../../shared/mutex.ts"
import { searchPluginTransactions } from "./finance-search.ts"

// Misma composición que la app; excluye deliberadamente lectores y categorizadores IA.
const deps = {
  accounts: accountRepository,
  banks: bankRepository,
  balanceBuckets: balanceBucketRepository,
  categories: categoryRepository,
  monthlyBudgets: monthlyBudgetRepository,
  transactions: transactionRepository,
  incomes: incomeRepository,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
  corrections: correctionRepository,
  budgetPeriod: budgetPeriodRepository,
  exchangeRates: exchangeRateProvider,
}

export function pluginJson(value: unknown): PluginJsonValue {
  if (value === undefined || value === null) return null
  if (value instanceof Money)
    return { amount: value.toMajor(), currency: value.currency }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(pluginJson)
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, item]) => key !== "userId" && item !== undefined)
        .map(([key, item]) => [key, pluginJson(item)])
    )
  throw new Error("Resultado no serializable")
}

async function ownedReferences(userId: string, input: Record<string, unknown>) {
  // Algunas altas históricas no validaban categoría: el boundary del plugin sí lo exige.
  if (typeof input.accountId === "string") {
    const account = await deps.accounts.findById(input.accountId)
    if (!account || account.userId !== userId) throw new NotOwnerError()
  }
  if (typeof input.categoryId === "string") {
    const category = await deps.categories.findById(input.categoryId)
    if (!category || category.userId !== userId) throw new NotOwnerError()
  }
  if (typeof input.sourceTransactionId === "string") {
    const source = await deps.transactions.findById(input.sourceTransactionId)
    if (
      !source ||
      source.userId !== userId ||
      source.accountId !== input.accountId
    )
      throw new NotOwnerError()
  }
}

async function reconcile(
  userId: string,
  input: Omit<
    PluginToolInput<"lucaplan_reconciliar_saldos_correo">,
    "operationId"
  >
) {
  return withLock(`email:${userId}`, async () => {
    const link = await prisma.emailBankLink.findFirst({
      where: { id: input.linkId, userId },
      select: {
        bankId: true,
        lastBalanceReconciledAt: true,
        mailbox: { select: { lastSyncedAt: true } },
        bank: { select: { lastSyncedAt: true } },
      },
    })
    if (!link?.bankId) throw new NotOwnerError()
    const snapshotAt = new Date(input.snapshotAt)
    const newest = await prisma.transaction.findFirst({
      where: {
        userId,
        account: { bankId: link.bankId },
        externalId: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    const bucket = await prisma.balanceBucket.findFirst({
      where: { account: { userId, bankId: link.bankId } },
      orderBy: { asOf: "desc" },
      select: { asOf: true },
    })
    const cutoffs = [
      link.lastBalanceReconciledAt,
      link.mailbox.lastSyncedAt,
      link.bank?.lastSyncedAt,
      newest?.createdAt,
      bucket?.asOf,
    ]
    if (
      snapshotAt.getTime() > Date.now() ||
      cutoffs.some((at) => at && at > snapshotAt)
    )
      throw new EmailSetupStateError(
        "La fecha es anterior a datos ya conciliados o sincronizados. Se necesita un estado actual; la conciliación histórica no está habilitada"
      )
    const clp = (bucket: { limit: number; used: number } | null) =>
      bucket && {
        limit: Money.of(bucket.limit, "CLP"),
        used: Money.of(bucket.used, "CLP"),
      }
    const usd = (bucket: { limit: number; used: number } | null) =>
      bucket && {
        limit: Money.of(bucket.limit, "USD"),
        used: Money.of(bucket.used, "USD"),
      }
    return reconcileEmailBalances(
      makeEmailConnectionDeps(),
      userId,
      input.linkId,
      {
        snapshotAt,
        checking: input.checking
          ? {
              ref: input.checking.ref,
              cash: Money.of(input.checking.cash, "CLP"),
              overdraft: clp(input.checking.overdraft),
            }
          : null,
        cards: input.cards.map((card) => ({
          last4: card.last4,
          national: clp(card.national),
          international: usd(card.international),
        })),
      }
    )
  })
}

type Handlers = {
  [N in PluginToolName]: (
    userId: string,
    input: Omit<PluginToolInput<N>, "operationId">
  ) => Promise<unknown>
}
const handlers: Handlers = {
  lucaplan_ver_operacion: async () => {
    throw new Error("Consulta resuelta por el runner")
  },
  lucaplan_listar_cuentas: async (userId) => {
    const [accounts, links] = await Promise.all([
      listAccounts(deps, userId),
      prisma.emailBankLink.findMany({
        where: { userId },
        select: { id: true, bankId: true },
      }),
    ])
    return accounts.map((account) => ({
      ...account,
      linkId: links.find((link) => link.bankId === account.bankId)?.id ?? null,
    }))
  },
  lucaplan_crear_cuenta: (userId, input) => createAccount(deps, userId, input),
  lucaplan_listar_categorias: (userId) => deps.categories.listByUser(userId),
  lucaplan_resumen_mes: async (userId, input) => {
    const range = await rangeOf(deps, input.year, input.month)
    const [summary, totals] = await Promise.all([
      getMonthlySummary(deps, userId, input.year, input.month),
      prisma.transaction.groupBy({
        by: ["currency", "direction"],
        where: {
          userId,
          status: "confirmed",
          isInternal: false,
          transactionDate: {
            gte: new Date(`${range.start}T00:00:00Z`),
            lte: new Date(`${range.end}T00:00:00Z`),
          },
        },
        _sum: { amount: true },
      }),
    ])
    return {
      range,
      budgetReferenceCLP: summary,
      notice:
        "El presupuesto de la app usa conversión referencial a CLP; los totales originales siguientes no se convierten ni suman entre monedas",
      movementTotalsByCurrency: totals.map((row) => ({
        currency: row.currency,
        direction: row.direction,
        amount: Number(row._sum.amount ?? 0),
      })),
    }
  },
  lucaplan_buscar_movimientos: (userId, input) =>
    searchPluginTransactions(userId, input),
  lucaplan_crear_movimiento: (userId, input) =>
    createTransaction(deps, userId, { ...input, date: new Date(input.date) }),
  lucaplan_corregir_movimiento: (userId, input) =>
    updateTransaction(deps, userId, { ...input, date: new Date(input.date) }),
  lucaplan_eliminar_movimiento: async (userId, input) => {
    await deleteTransaction(deps, userId, input.transactionId)
    return { ok: true }
  },
  lucaplan_asignar_categoria: (userId, input) =>
    categorizeTransaction(deps, userId, input.transactionId, input.categoryId),
  lucaplan_crear_categoria: (userId, input) =>
    upsertCategory(deps, userId, input),
  lucaplan_editar_categoria: (userId, input) =>
    upsertCategory(deps, userId, input),
  lucaplan_eliminar_categoria: async (userId, input) => {
    await deleteCategory(deps, userId, input.categoryId)
    return { ok: true }
  },
  lucaplan_ver_presupuesto: async (userId, input) => ({
    currency: "CLP",
    notice:
      "Presupuesto de la app en CLP; puede incluir conversión referencial de gastos USD",
    budget: await getBudgetView(deps, userId, input.year, input.month),
  }),
  lucaplan_fijar_presupuesto_global: (userId, input) =>
    setMonthlyBudget(deps, userId, input),
  lucaplan_fijar_presupuesto_categoria: (userId, input) =>
    setCategoryLimit(deps, userId, input),
  lucaplan_listar_ingresos: (userId, input) =>
    listIncomesView(deps, userId, input.year, input.month),
  lucaplan_crear_ingreso: (userId, input) => createIncome(deps, userId, input),
  lucaplan_editar_ingreso: (userId, input) => updateIncome(deps, userId, input),
  lucaplan_eliminar_ingreso: (userId, input) =>
    deleteIncome(deps, userId, input.id, input),
  lucaplan_registrar_ingreso_mes: (userId, input) =>
    generateMonthlyIncome(deps, userId, input),
  lucaplan_deshacer_ingreso_mes: (userId, input) =>
    ungenerateMonthlyIncome(deps, userId, input),
  lucaplan_listar_recurrentes: (userId) => listRecurringView(deps, userId),
  lucaplan_crear_recurrente: (userId, input) =>
    createRecurringTemplate(deps, userId, {
      ...input,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
    }),
  lucaplan_editar_recurrente: (userId, input) =>
    updateRecurringTemplate(deps, userId, {
      ...input,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
    }),
  lucaplan_activar_recurrente: (userId, input) =>
    setRecurringActive(deps, userId, input),
  lucaplan_eliminar_recurrente: (userId, input) =>
    deleteRecurringTemplate(deps, userId, input.id),
  lucaplan_marcar_pago_recurrente: (userId, input) =>
    setRecurringPeriodPaid(deps, userId, input),
  lucaplan_vincular_pago_recurrente: (userId, input) =>
    payRecurringPeriodWith(deps, userId, input),
  lucaplan_listar_planes_cuotas: (userId) => listInstallmentsView(deps, userId),
  lucaplan_crear_plan_cuotas: async (userId, input) => {
    if (input.kind === "card") {
      const source = await prisma.transaction.findFirst({
        where: {
          id: input.sourceTransactionId!,
          userId,
          accountId: input.accountId,
          direction: "debit",
          status: "confirmed",
          isInternal: false,
          installmentItemId: null,
          recurringTemplateId: null,
          installmentPlanAsSource: { is: null },
        },
        select: { id: true },
      })
      if (!source) throw new NotOwnerError()
    }
    return createInstallmentPlan(deps, userId, {
      ...input,
      startDate: new Date(input.startDate),
    })
  },
  lucaplan_editar_cuota: (userId, input) =>
    updateInstallmentItem(deps, userId, {
      ...input,
      dueDate: new Date(input.dueDate),
    }),
  lucaplan_categorizar_plan_cuotas: (userId, input) =>
    setInstallmentPlanCategory(deps, userId, input),
  lucaplan_eliminar_plan_cuotas: (userId, input) =>
    deleteInstallmentPlan(deps, userId, input.planId),
  lucaplan_pagar_cuota: (userId, input) =>
    payInstallmentManually(deps, userId, {
      ...input,
      date: new Date(input.date),
    }),
  lucaplan_vincular_pago_cuota: (userId, input) =>
    linkTransactionToItem(deps, userId, input),
  lucaplan_desvincular_pago_cuota: (userId, input) =>
    unlinkTransactionFromItem(deps, userId, input),
  lucaplan_actualizar_saldos: (userId, input) =>
    withLock(`email:${userId}`, () =>
      applyAccountBalance(deps, userId, input.accountId, {
        last4: input.last4,
        cash: input.cash,
        overdraft: { ...input.overdraft, limit: null },
        national: { ...input.national, limit: null },
        international: { ...input.international, limit: null },
      })
    ),
  lucaplan_reconciliar_saldos_correo: reconcile,
}

export const pluginFinanceExecutor = {
  async execute(
    actor: PluginActor,
    name: PluginToolName,
    args: Record<string, unknown>
  ): Promise<PluginJsonValue> {
    await ownedReferences(actor.userId, args)
    // El runner validó el esquema correspondiente antes de elegir el handler.
    const handler = handlers[name] as (
      userId: string,
      input: Record<string, unknown>
    ) => Promise<unknown>
    return pluginJson(await handler(actor.userId, args))
  },
}
