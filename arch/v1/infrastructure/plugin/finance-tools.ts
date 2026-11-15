import { linkReimbursement, unlinkReimbursement } from "../database/prisma/reimbursement.infrastructure.ts"
import { bankReconciliationStore } from "../database/prisma/bank-reconciliation.infrastructure.ts"
import { reconcileBankAccount } from "../../application/finance-use-cases/bank-reconciliation.ts"
import { proponerConciliacion } from "../../application/finance-use-cases/propose-reconciliation.ts"
import { changeCreditKind } from "../../application/finance-use-cases/credit-kind-use-cases.ts"
import { isFromBank } from "../../domain/finance/recurring.domain.ts"
import type {
  PluginActor,
  PluginJsonValue,
} from "../../domain/plugin/plugin.domain.ts"
import type {
  PluginToolInput,
  PluginToolName,
} from "../../../../lib/schemas/plugin.ts"
import { Money } from "../../domain/finance/money.ts"
import { calculateFinancialOverview } from "../../../../lib/financial-health.ts"
import { NotOwnerError } from "../../domain/finance/finance.domain.ts"
import { prisma } from "../database/prisma/client.ts"
import { Prisma } from "../database/prisma/generated/client.ts"
import {
  accountRepository,
  bankRepository,
  balanceBucketRepository,
  categoryRepository,
  monthlyBudgetRepository,
  transactionRepository,
} from "../database/prisma/finance.infrastructure.ts"
import { reimbursementReadRepository } from "../database/prisma/reimbursement-read.infrastructure.ts"
import { recurringTemplateRepository } from "../database/prisma/recurring.infrastructure.ts"
import { installmentPlanRepository } from "../database/prisma/installment.infrastructure.ts"
import { correctionRepository } from "../database/prisma/categorization-correction.infrastructure.ts"
import { budgetPeriodRepository } from "../database/prisma/budget-period.infrastructure.ts"
import { exchangeRateProvider } from "../http/exchange/usd-clp.ts"
import { createAccount } from "../../application/finance-use-cases/create-account-use-case.ts"
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
import { followIncome, setMonthlyBudgetFollowing } from "../../application/finance-use-cases/follow-income.ts"
import {
  createRecurringTemplate,
  updateRecurringTemplate,
  setRecurringActive,
  deleteRecurringTemplate,
  setRecurringPeriodPaid,
  payRecurringPeriodWith,
  createPlannedRecurringTemplate,
} from "../../application/finance-use-cases/recurring-use-cases.ts"
import {
  createInstallmentPlan,
  updateInstallmentItem,
  setInstallmentPlanCategory,
  deleteInstallmentPlan,
  payInstallmentManually,
  linkTransactionToItem,
  unlinkTransactionFromItem,
  moveInstallmentPayment,
  listLinkCandidates,
} from "../../application/finance-use-cases/installment-use-cases.ts"
import {
  listAccounts,
  getMonthlySummary,
  getBudgetView,
  listIncomeCredits,
  listRecurringView,
  listInstallmentsView,
  listRecurringCandidates,
} from "../../application/finance-use-cases/finance-read.ts"
import { rangeOf } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { createHash, createHmac } from "node:crypto"
import { manualAccountRepository } from "../database/prisma/manual-account.infrastructure.ts"
import { budgetAlertRepository } from "../database/prisma/budget-alert.infrastructure.ts"
import { dueReminderRepository } from "../database/prisma/due-reminder.infrastructure.ts"
import { paceFrequencyRepository } from "../database/prisma/pace.infrastructure.ts"
import {
  deleteManualAccount,
  previewManualAccountDeletion,
  updateManualAccount,
} from "../../application/finance-use-cases/manual-account-use-cases.ts"
import { annotateCorrection } from "../../application/finance-use-cases/annotate-correction-use-case.ts"
import { isDuplicateInstallmentPayment } from "../../application/finance-use-cases/duplicate-installment-payment.ts"
import { getPeriodPlan } from "../../application/finance-use-cases/plan-period-use-case.ts"
import { getBudgetPeriod, scopeBudgetPeriod } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { getPaceFrequency } from "../../application/finance-use-cases/pace-use-cases.ts"
import { listBudgetAlerts } from "../../application/notification-use-cases/budget-alert-use-cases.ts"
import { getDueDays } from "../../application/notification-use-cases/due-reminder-use-cases.ts"
import {
  PluginReferenceError,
  PluginRejection,
} from "../../application/plugin-use-cases/plugin-tools.ts"
import { InstallmentPlanNotFoundError } from "../../domain/finance/installment.domain.ts"
import {
  getPluginTransaction,
  searchPluginTransactions,
} from "./finance-search.ts"

// Misma composición que la app; excluye deliberadamente lectores y categorizadores IA.
const deps = {
  accounts: accountRepository,
  banks: bankRepository,
  balanceBuckets: balanceBucketRepository,
  categories: categoryRepository,
  monthlyBudgets: monthlyBudgetRepository,
  transactions: transactionRepository,
  reimbursements: reimbursementReadRepository,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
  corrections: correctionRepository,
  budgetPeriod: budgetPeriodRepository,
  exchangeRates: exchangeRateProvider,
  manualAccounts: manualAccountRepository,
  budgetAlerts: budgetAlertRepository,
  dueReminder: dueReminderRepository,
  paceFrequency: paceFrequencyRepository,
  bankReconciliation: bankReconciliationStore,
}

// Escritura que mueve el ingreso del plan: el tope igualado al ingreso la sigue en los dos modos
// (ver follow-income).
const follow = async <T>(userId: string, mutate: () => Promise<T>) =>
  (await followIncome(deps, userId, mutate, { allModes: true })).result

// Confirmación de borrado de cuenta: hash del estado y firma con el secreto del servidor.
const deletionDeps = {
  manualAccounts: manualAccountRepository,
  hash: (input: string) => createHash("sha256").update(input).digest("hex"),
  sign: (input: string) =>
    createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(input)
      .digest("base64url"),
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

// Todo id de entrada debe ser del usuario, también los relacionados (destino de un movimiento,
// cuenta de una fuente…). Los casos de uso validan su recurso principal; aquí se cubren todos con
// el nombre del campo, antes de cualquier escritura.
async function ownedReferences(userId: string, input: Record<string, unknown>) {
  const owned = async (
    field: string,
    load: (id: string) => Promise<{ userId: string } | null>
  ) => {
    const value = input[field]
    if (typeof value !== "string") return
    const found = await load(value)
    if (!found || found.userId !== userId) throw new PluginReferenceError(field)
  }
  await owned("accountId", (id) => deps.accounts.findById(id))
  // Algunas altas históricas no validaban categoría: el boundary del plugin sí lo exige.
  await owned("categoryId", (id) => deps.categories.findById(id))
  await owned("transactionId", (id) => deps.transactions.findById(id))
  await owned("planId", (id) => deps.installments.findById(id))
  await owned("toPlanId", (id) => deps.installments.findById(id))
  await owned("sourceTransactionId", async (id) => {
    const source = await deps.transactions.findById(id)
    return source && source.accountId === input.accountId ? source : null
  })
}

// Nombre único por usuario (índice de la BD): se rechaza antes de escribir con un motivo claro.
async function assertCategoryNameFree(
  userId: string,
  name: string,
  id?: string
) {
  const taken = (await deps.categories.listByUser(userId)).some(
    (c) => c.name === name.trim() && c.id !== id
  )
  if (taken)
    throw new PluginRejection(
      `Ya existe una categoría llamada «${name.trim()}». Usa lucaplan_listar_categorias y edítala, o elige otro nombre`
    )
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
  lucaplan_proponer_conciliacion: (userId, input) =>
    proponerConciliacion(deps, userId, input.accountId, input.document),
  lucaplan_previsualizar_conciliacion: (userId, input) => reconcileBankAccount(deps, userId, input),
  lucaplan_aplicar_conciliacion: (userId, { previewToken, ...input }) =>
    follow(userId, () => reconcileBankAccount(deps, userId, input, previewToken)),
  lucaplan_corregir_metadatos_movimiento: async (userId, input) => {
    const tx = await deps.transactions.findById(input.transactionId)
    if (!tx || tx.userId !== userId) throw new PluginReferenceError("transactionId")
    if (isFromBank(tx) || tx.externalId || tx.installmentItemId || tx.recurringTemplateId)
      throw new PluginRejection("No se pueden alterar los datos originales del banco (correo o cartola) ni movimientos ligados a cuotas o recurrentes")
    const changedDate = new Date(input.date + "T00:00:00.000Z")
    if (!Number.isFinite(changedDate.getTime()) ||
        changedDate.toISOString().slice(0, 10) !== input.date)
      throw new PluginRejection("Fecha inválida")
    // Otra fecha ya no es la que conciliaba la cartola: se borra la conciliación (WDC-123).
    const dateChanged = tx.date.toISOString().slice(0, 10) !== input.date
    // Otra fecha puede llevarlo a otro período: el tope que sigue al ingreso se alinea.
    const updated = await follow(userId, () => prisma.transaction.updateMany({
      where: { id: tx.id, userId, externalId: null, origin: { notIn: ["email", "statement"] },
        installmentItemId: null, recurringTemplateId: null },
      data: { transactionDate: changedDate, description: input.description.trim(),
        ...(dateChanged ? { reconciliation: Prisma.DbNull } : {}) },
    }))
    if (updated.count !== 1)
      throw new PluginRejection("Movimiento cambiado por otra operación; vuelve a consultarlo")
    return { transactionId: tx.id, updated: true,
      date: input.date, description: input.description.trim(), affectsBalance: false }
  },
  lucaplan_corregir_movimiento: (userId, input) =>
    follow(userId, () => updateTransaction(deps, userId, { ...input, date: new Date(input.date) })),
  lucaplan_eliminar_movimiento: async (userId, input) => {
    await follow(userId, () => deleteTransaction(deps, userId, input.transactionId))
    return { ok: true }
  },
  lucaplan_vincular_reembolso: (userId, input) => follow(userId, () => linkReimbursement(userId, input)),
  lucaplan_desvincular_reembolso: (userId, input) =>
    follow(userId, () => unlinkReimbursement(userId, input.reimbursementId)),
  lucaplan_asignar_categoria: (userId, input) =>
    categorizeTransaction(deps, userId, input.transactionId, input.categoryId),
  lucaplan_crear_categoria: async (userId, input) => {
    await assertCategoryNameFree(userId, input.name)
    return upsertCategory(deps, userId, input)
  },
  lucaplan_editar_categoria: async (userId, input) => {
    await assertCategoryNameFree(userId, input.name, input.id)
    return upsertCategory(deps, userId, input)
  },
  lucaplan_aprender_categoria: (userId, input) =>
    annotateCorrection(deps, userId, input.transactionId, input),
  lucaplan_ver_movimiento: (userId, input) =>
    getPluginTransaction(userId, input.transactionId, async () => {
      const tx = await deps.transactions.findById(input.transactionId)
      return tx ? isDuplicateInstallmentPayment(deps, userId, tx) : false
    }),
  lucaplan_editar_cuenta: (userId, input) =>
    updateManualAccount(deps, userId, input),
  lucaplan_previsualizar_eliminar_cuenta: (userId, input) =>
    previewManualAccountDeletion(deletionDeps, userId, input.accountId),
  lucaplan_eliminar_cuenta: (userId, input) =>
    deleteManualAccount(deletionDeps, userId, input),
  lucaplan_planificar_periodo: async (userId, input) => {
    const scopedDeps = await scopeBudgetPeriod(deps)
    const plan = await getPeriodPlan(scopedDeps, userId, input.year, input.month)
    const periodConfig = await getBudgetPeriod(scopedDeps)
    if (periodConfig.mode !== "card_cycle") return plan
    const previousYear = input.month === 1 ? input.year - 1 : input.year
    const previousMonth = input.month === 1 ? 12 : input.month - 1
    const previous = await listIncomeCredits(scopedDeps, userId, previousYear, previousMonth)
    return {
      ...plan,
      creditCycleCoverage: {
        explanation: "En modo crédito, los ingresos asociados a un ciclo sirven para liquidar la factura de ese ciclo, incluso si se reciben después del cierre. Los ingresos del ciclo actual respaldan su próxima facturación; no sumes ambos ciclos.",
        previousCycle: { year: previousYear, month: previousMonth },
        previousCycleIncomes: previous,
        verification: "Son abonos de ingreso confirmados; los que el correo no trajo aparecen al conciliar la cartola.",
      },
    }
  },
  lucaplan_ver_configuracion: async () => {
    const [period, paceFrequency, budgetAlerts, dueDays] = await Promise.all([
      getBudgetPeriod(deps),
      getPaceFrequency(deps),
      listBudgetAlerts(deps),
      getDueDays(deps),
    ])
    return {
      scope:
        "Configuración común a toda la instalación de Luca Plan (la que usan la app, los cálculos y las notificaciones). Solo lectura desde el chat: se cambia en Configuración",
      periodMode: period.mode,
      closingOverrides: period.overrides,
      paceFrequency,
      budgetAlerts,
      dueDays,
    }
  },
  lucaplan_eliminar_categoria: async (userId, input) => {
    await deleteCategory(deps, userId, input.categoryId)
    return { ok: true }
  },
  lucaplan_medidor_financiero: async (userId, input) => {
    const scopedDeps = await scopeBudgetPeriod(deps)
    const [budget, range, summary] = await Promise.all([
      getBudgetView(scopedDeps, userId, input.year, input.month),
      rangeOf(scopedDeps, input.year, input.month),
      getMonthlySummary(scopedDeps, userId, input.year, input.month),
    ])
    return {
      period: { year: input.year, month: input.month, range },
      currency: "CLP",
      ...calculateFinancialOverview({ cash: summary.activeCash, overdraftDebt: summary.overdraftDebt, income: budget.income, spent: budget.spent, committed: budget.committed, reimbursementAdjustment: budget.reimbursementAdjustment }),
      spendable: budget.spendable,
      notice: "Los ingresos son los abonos de ingreso (creditKind income) confirmados del período; los gastos son todo gasto CLP confirmado no interno, con o sin categoría o tope, y los compromisos todo pendiente y cuota por cobrar. Un movimiento USD sin dólar observado queda fuera (exchangeRateUnavailable en el presupuesto). La compensación de reembolsos incluidos en ingresos se cuenta una sola vez. remainingBeforeCommitments es ingresos menos gasto realizado, antes de reservas. balance es margen del plan después de compromisos, no caja. spendable.amount es el disponible para gastar = menor entre margen (balance) y topes que quedan (spendable.plannedLeft: Σ tope − gastado − comprometido de las categorías en el plan, incluidas las sin tope que ya gastaron); spendable.limitedBy dice cuál manda; sin ningún tope definido manda el margen. Puede ser negativo y no es caja. Esta herramienta solo lee y no materializa las recurrentes del período: las que aún no existen como pendientes (el Inicio las crea al abrirse) no entran en committed. planStatus describe el presupuesto; status combina plan y liquidez. liquidity usa los últimos saldos registrados, no un saldo histórico ni proyectado del período. Ambos modos comparten movimientos de corriente y tarjeta; cada uno conserva su plan y su rango temporal.",
    }
  },
  lucaplan_ver_presupuesto: async (userId, input) => ({
    currency: "CLP",
    notice:
      "Presupuesto de la app en CLP; puede incluir conversión referencial de gastos USD",
    budget: await getBudgetView(deps, userId, input.year, input.month),
  }),
  lucaplan_fijar_presupuesto_global: (userId, input) =>
    setMonthlyBudgetFollowing(deps, userId, input),
  lucaplan_fijar_presupuesto_categoria: (userId, input) =>
    setCategoryLimit(deps, userId, input),
  lucaplan_listar_ingresos: (userId, input) =>
    listIncomeCredits(deps, userId, input.year, input.month),
  lucaplan_cambiar_tipo_abono: async (userId, input) =>
    (await changeCreditKind(deps, userId, input)).transaction,
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
    follow(userId, () => payRecurringPeriodWith(deps, userId, input)),
  lucaplan_planificar_recurrente: (userId, input) =>
    createPlannedRecurringTemplate(deps, userId, {
      ...input,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
    }),
  lucaplan_candidatos_pago_recurrente: (userId, input) =>
    listRecurringCandidates(deps, userId, input.id, input),
  lucaplan_listar_planes_cuotas: (userId) => listInstallmentsView(deps, userId),
  lucaplan_ver_plan_cuotas: async (userId, input) => {
    const plan = (await listInstallmentsView(deps, userId)).find(
      (p) => p.id === input.planId
    )
    if (!plan) throw new PluginReferenceError("planId")
    return plan
  },
  lucaplan_candidatos_pago_cuota: async (userId, input) => {
    const plan = await deps.installments.findById(input.planId)
    if (!plan || plan.userId !== userId)
      throw new PluginReferenceError("planId")
    const item = plan.items.find((i) => i.id === input.itemId)
    if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
    const candidates = await listLinkCandidates(
      deps,
      userId,
      item.dueDate,
      input.accountId
    )
    return {
      planCurrency: plan.currency,
      dueDate: item.dueDate.toISOString().slice(0, 10),
      expectedAmount: item.amount.toMajor(),
      items: candidates.map((c) => ({
        ...c,
        date: c.date.toISOString().slice(0, 10),
        usable: c.amount.currency === plan.currency,
      })),
    }
  },
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
    follow(userId, () => deleteInstallmentPlan(deps, userId, input.planId)),
  lucaplan_pagar_cuota: (userId, input) =>
    follow(userId, () => payInstallmentManually(deps, userId, { ...input, date: new Date(input.date) })),
  lucaplan_vincular_pago_cuota: (userId, input) =>
    follow(userId, () => linkTransactionToItem(deps, userId, input)),
  lucaplan_desvincular_pago_cuota: (userId, input) =>
    follow(userId, () => unlinkTransactionFromItem(deps, userId, input)),
  lucaplan_mover_pago_cuota: (userId, input) =>
    follow(userId, () => moveInstallmentPayment(deps, userId, input)),
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

