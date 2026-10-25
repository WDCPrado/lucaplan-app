import type {
  PluginActor,
  PluginJsonValue,
} from "../../domain/plugin/plugin.domain.ts"
import type {
  PluginToolInput,
  PluginToolName,
} from "../../../../lib/schemas/plugin.ts"
import { Money } from "../../domain/finance/money.ts"
import { calculateFinancialHealth } from "../../../../lib/financial-health.ts"
import { reconcileBankRows } from "../../../../lib/bank-reconciliation.ts"
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
  listIncomesView,
  listRecurringView,
  listInstallmentsView,
  listRecurringCandidates,
} from "../../application/finance-use-cases/finance-read.ts"
import { applyAccountBalance } from "../../application/finance-use-cases/balance-scan-use-cases.ts"
import { rangeOf } from "../../application/finance-use-cases/budget-period-use-cases.ts"
import { reconcileEmailBalances } from "../../application/finance-use-cases/email-connection-use-cases.ts"
import { withLock } from "../../../shared/mutex.ts"
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
import { getBudgetPeriod } from "../../application/finance-use-cases/budget-period-use-cases.ts"
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
  incomes: incomeRepository,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
  corrections: correctionRepository,
  budgetPeriod: budgetPeriodRepository,
  exchangeRates: exchangeRateProvider,
  manualAccounts: manualAccountRepository,
  budgetAlerts: budgetAlertRepository,
  dueReminder: dueReminderRepository,
  paceFrequency: paceFrequencyRepository,
}

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
  await owned("incomeId", (id) => deps.incomes.findById(id))
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
  lucaplan_conciliar_cartola: async (userId, input) => {
    const account = await deps.accounts.findById(input.accountId)
    if (!account || account.userId !== userId) throw new PluginReferenceError("accountId")
    if (account.currency !== input.currency) throw new PluginRejection("Moneda distinta a la cuenta")
    const dates = input.movements.map((m) => m.date).sort()
    const start = new Date(dates[0] + "T00:00:00Z")
    const end = new Date(dates.at(-1) + "T00:00:00Z")
    start.setUTCDate(start.getUTCDate()-1)
    end.setUTCDate(end.getUTCDate()+1)
    const existing = (await deps.transactions.listByUserPeriod(userId, {
      start: start.toISOString().slice(0,10), end: end.toISOString().slice(0,10),
    })).filter(t => t.accountId === input.accountId && !t.isInternal &&
      t.status !== "reversed" && t.status !== "duplicated" && t.amount.currency === input.currency)
    return { results: reconcileBankRows(input.movements, existing.map(t=>({
      id:t.id, date:t.date.toISOString().slice(0,10), amount:t.amount.toMajor(),
      direction:t.direction, description:t.description,
    }))), notice:"Previsualización sin modificaciones. Los ambiguos requieren revisión manual." }
  },
  lucaplan_importar_cargos_bancarios: async (userId, input) => {
    const results: Array<{ index:number; status:string; transactionId?:string; reason?:string }> = []
    for (const [index, row] of input.movements.entries()) {
      try {
        // La operación por fila reutiliza las validaciones del alta individual.
        const created = await handlers.lucaplan_registrar_cargo_bancario(userId, {
          ...row, accountId:input.accountId, currency:input.currency,
        }) as { transactionId: string; created: boolean }
        results.push({index,status:"created",transactionId:created.transactionId})
      } catch (error) {
        if (error instanceof PluginRejection || error instanceof PluginReferenceError) {
          results.push({index,status:"rejected",reason:error.message})
        } else {
          throw error // El runner informa resultado incierto; consultar operación antes de repetir.
        }
      }
    }
    return {results,created:results.filter(r=>r.status==="created").length,
      rejected:results.filter(r=>r.status==="rejected").length}
  },
  lucaplan_registrar_ingreso_extraordinario: async (userId, input) => {
    const account = await deps.accounts.findById(input.accountId)
    if (!account || account.userId !== userId) throw new PluginReferenceError("accountId")
    if (account.accountType !== "checking" || account.currency !== input.currency)
      throw new PluginRejection("Se requiere cuenta corriente con moneda coincidente")
    const category = await deps.categories.findById(input.categoryId)
    if (!category || category.userId !== userId) throw new PluginReferenceError("categoryId")
    if (category.type !== "income") throw new PluginRejection("Se requiere categoría de ingreso")
    const date = new Date(input.date+"T00:00:00Z")
    if (!Number.isFinite(date.getTime()) || date > new Date()) throw new PluginRejection("Fecha inválida o futura")
    const start = new Date(date); start.setUTCDate(start.getUTCDate()-1)
    const end = new Date(date); end.setUTCDate(end.getUTCDate()+1)
    const existing = await deps.transactions.listByUserPeriod(userId, {
      start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),
    })
    if (existing.some(t=> t.accountId===input.accountId && t.direction==="credit" &&
      t.status==="confirmed" && t.amount.currency===input.currency && t.amount.toMajor()===input.amount))
      throw new PluginRejection("Ya existe un abono del mismo monto en fecha cercana; no se creó ingreso")
    const tx = await createTransaction(deps,userId,{...input, direction:"credit",date})
    return {transactionId:tx.id,created:true}
  },
  lucaplan_registrar_cargo_bancario: async (userId, input) => {
    const account = await deps.accounts.findById(input.accountId)
    if (!account || account.userId !== userId) throw new PluginReferenceError("accountId")
    if (account.provider === "manual") throw new PluginRejection("Esta herramienta es solo para cuentas conectadas")
    if (account.currency !== input.currency) throw new PluginRejection("La moneda no corresponde a la cuenta")
    const day = new Date(input.date + "T00:00:00.000Z")
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== input.date || day > new Date())
      throw new PluginRejection("Fecha inválida o futura")
    // Sin editar el origen bancario, sin sumar cuotas o pagos como si fueran gastos.
    const description = input.description.trim()
    if (/pago\s*(?:tarjeta|tc)|transferencia\s*(?:desde|a)\s*linea|traspaso\s*(?:de|a)\s*cuenta\s*propia/i.test(description))
      throw new PluginRejection("Los pagos y traspasos internos deben conciliarse, no crearse como gastos")
    const before = new Date(day)
    before.setUTCDate(before.getUTCDate() - 1)
    const after = new Date(day)
    after.setUTCDate(after.getUTCDate() + 1)
    const matches = await deps.transactions.listByUserPeriod(userId, {
      start: before.toISOString().slice(0,10),
      end: after.toISOString().slice(0,10),
    })
    if (matches.some((t) =>
      t.accountId === input.accountId && t.direction === "debit" &&
      t.status !== "reversed" && t.status !== "duplicated" &&
      t.amount.currency === input.currency && t.amount.toMajor() === input.amount
    ))
      throw new PluginRejection("Posible duplicado: ya existe un cargo del mismo monto en esta cuenta dentro de ±1 día. Revisa sus movimientos antes de importar; no se creó un cargo nuevo")
    if (input.categoryId) {
      const category = await deps.categories.findById(input.categoryId)
      if (!category || category.userId !== userId) throw new PluginReferenceError("categoryId")
      if (category.type !== "expense") throw new PluginRejection("La categoría debe ser de tipo gasto")
    }
    const tx = await createTransaction(deps, userId, {
      accountId: input.accountId, categoryId: input.categoryId ?? null, date: day,
      description, amount: input.amount, currency: input.currency,
      direction: "debit", source: "bank-scan",
    })
    return { transactionId: tx.id, created: true, categoryId: input.categoryId ?? null,
      notice: "Cargo registrado. Revisa la proyección del saldo y su impacto en el presupuesto; si llega el correo del banco, comprueba que no se duplique." }
  },
  lucaplan_corregir_metadatos_movimiento: async (userId, input) => {
    const tx = await deps.transactions.findById(input.transactionId)
    if (!tx || tx.userId !== userId) throw new PluginReferenceError("transactionId")
    if (tx.externalId || tx.installmentItemId || tx.recurringTemplateId)
      throw new PluginRejection("No se pueden alterar los datos originales del banco ni movimientos ligados a cuotas o recurrentes")
    const changedDate = new Date(input.date + "T00:00:00.000Z")
    if (!Number.isFinite(changedDate.getTime()) ||
        changedDate.toISOString().slice(0, 10) !== input.date)
      throw new PluginRejection("Fecha inválida")
    if (tx.incomeId)
      throw new PluginRejection("Es un ingreso generado desde una fuente mensual: la fecha debe corregirse desde el flujo de ingresos para conservar su ciclo de origen; no se modificó nada")
    const updated = await prisma.transaction.updateMany({
      where: { id: tx.id, userId, externalId: null,
        installmentItemId: null, recurringTemplateId: null, incomeId: null },
      data: { transactionDate: changedDate, description: input.description.trim() },
    })
    if (updated.count !== 1)
      throw new PluginRejection("Movimiento cambiado por otra operación; vuelve a consultarlo")
    return { transactionId: tx.id, updated: true,
      date: input.date, description: input.description.trim(), affectsBalance: false }
  },
  lucaplan_corregir_movimiento: (userId, input) =>
    updateTransaction(deps, userId, { ...input, date: new Date(input.date) }),
  lucaplan_eliminar_movimiento: async (userId, input) => {
    await deleteTransaction(deps, userId, input.transactionId)
    return { ok: true }
  },
  lucaplan_vincular_reembolso: async (userId, input) => {
    return prisma.$transaction(async (db) => {
      const [expense, credit] = await Promise.all([
        db.transaction.findFirst({ where: { id: input.expenseId, userId } }),
        db.transaction.findFirst({ where: { id: input.creditId, userId } }),
      ])
      if (!expense || !credit) throw new PluginReferenceError(!expense ? "expenseId" : "creditId")
      if (expense.direction !== "debit" || credit.direction !== "credit" ||
          expense.status !== "confirmed" || credit.status !== "confirmed" ||
          expense.isInternal || credit.isInternal || expense.currency !== "CLP" || credit.currency !== "CLP")
        throw new PluginRejection("Se requiere gasto y abono confirmados no internos en CLP")
      const current = await db.expenseReimbursement.findUnique({
        where: { expenseId_creditId: { expenseId: expense.id, creditId: credit.id } },
      })
      if (current) {
        if (Number(current.amount) !== input.amount) throw new PluginRejection("Vínculo existente con otro importe")
        return { reimbursementId: current.id, amount: input.amount, created: false }
      }
      const [expenseLinks, creditLinks] = await Promise.all([
        db.expenseReimbursement.aggregate({ where: { expenseId: expense.id }, _sum: { amount: true } }),
        db.expenseReimbursement.aggregate({ where: { creditId: credit.id }, _sum: { amount: true } }),
      ])
      if (Number(expenseLinks._sum.amount ?? 0) + input.amount > Number(expense.amount) ||
          Number(creditLinks._sum.amount ?? 0) + input.amount > Number(credit.amount))
        throw new PluginRejection("La compensación excede el saldo libre del gasto o abono")
      const linked = await db.expenseReimbursement.create({
        data: { userId, expenseId: expense.id, creditId: credit.id, amount: input.amount },
      })
      return { reimbursementId: linked.id, amount: input.amount, created: true }
    }, { isolationLevel: "Serializable" })
  },
  lucaplan_vincular_abono_ingreso: async (userId, input) => {
    const [income, credit] = await Promise.all([
      prisma.income.findFirst({ where: { id: input.incomeId, userId } }),
      prisma.transaction.findFirst({ where: { id: input.transactionId, userId } }),
    ])
    if (!income || !credit) throw new PluginReferenceError(!income ? "incomeId" : "transactionId")
    if (credit.direction !== "credit" || credit.status !== "confirmed" || credit.isInternal ||
        income.accountId !== credit.accountId || income.currency !== credit.currency ||
        income.categoryId !== credit.categoryId ||
        (credit.incomeId && credit.incomeId !== income.id))
      throw new PluginRejection("El abono debe coincidir en cuenta, moneda y categoría y estar sin otra fuente")
    const updated = await prisma.transaction.updateMany({
      where: { id: credit.id, userId, OR: [{ incomeId: null }, { incomeId: income.id }] },
      data: { incomeId: income.id },
    })
    if (!updated.count) throw new PluginRejection("El abono está vinculado a otra fuente")
    return { incomeId: income.id, transactionId: credit.id, linked: true, createdTransaction: false }
  },
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
    const plan = await getPeriodPlan(deps, userId, input.year, input.month)
    const periodConfig = await getBudgetPeriod(deps)
    if (periodConfig.mode !== "card_cycle") return plan
    const previousYear = input.month === 1 ? input.year - 1 : input.year
    const previousMonth = input.month === 1 ? 12 : input.month - 1
    const previous = await listIncomesView(deps, userId, previousYear, previousMonth)
    return {
      ...plan,
      creditCycleCoverage: {
        explanation: "En modo crédito, los ingresos asociados a un ciclo sirven para liquidar la factura de ese ciclo, incluso si se reciben después del cierre. Los ingresos del ciclo actual respaldan su próxima facturación; no sumes ambos ciclos ni confundas un ingreso generado en la app con un abono conciliado del banco.",
        previousCycle: { year: previousYear, month: previousMonth },
        previousCycleIncomes: previous.map(i => ({
          id: i.id, name: i.name, amount: i.amount, currency: i.currency,
          dayOfMonth: i.dayOfMonth,
          status: i.generated ? "registrado_en_app" : "pendiente_en_app",
        })),
        previousCyclePendingCLP: previous.filter(i => !i.generated && i.currency === "CLP").reduce((sum, i) => sum + i.amount, 0),
        verification: "El estado registrado_en_app no confirma necesariamente la recepción bancaria; concilia el correo o la cartola antes de declarar una factura cubierta.",
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
    const [budget, incomes, range] = await Promise.all([
      getBudgetView(deps, userId, input.year, input.month),
      listIncomesView(deps, userId, input.year, input.month),
      rangeOf(deps, input.year, input.month),
    ])
    const income = incomes.filter((i) => i.isActive && i.currency === "CLP").reduce((sum, i) => sum + i.amount, 0)
    return {
      period: { year: input.year, month: input.month, range },
      currency: "CLP",
      ...calculateFinancialHealth({ income, spent: budget.spent, committed: budget.committed }),
      notice: "Los ingresos planificados incluyen todas las fuentes; solo cuentan gastos de categorías presupuestadas. El resultado no representa caja bancaria ni total facturado de la tarjeta.",
    }
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
  lucaplan_mover_pago_cuota: (userId, input) =>
    moveInstallmentPayment(deps, userId, input),
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
