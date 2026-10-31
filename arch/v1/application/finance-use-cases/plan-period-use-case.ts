// Planificación de un período (actual o futuro), SOLO LECTURA: junta lo que se espera que entre y
// salga —ingresos, recurrentes, cuotas y movimientos confirmados con fecha futura— separado por
// moneda, junto a la posición de hoy (caja, sobregiro, tarjetas). No escribe nada: no materializa
// comprometidos, no crea movimientos ni toca saldos.
//
// Sin doble conteo: una recurrente o cuota ya pagada se informa como pagada y no suma a lo
// pendiente; un movimiento confirmado que paga una recurrente, una cuota o un ingreso no vuelve a
// sumarse como "movimiento futuro". El presupuesto se informa como TOPE, nunca como gasto extra.
import type {
  AccountRepository,
  BalanceBucketRepository,
  BankRepository,
  CategoryRepository,
  MonthlyBudgetRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  isIncomeEndedAt,
  type IncomeRepository,
} from "../../domain/finance/income.domain.ts"
import {
  executionDateFor,
  periodIsWithinValidity,
  periodKeyFor,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import {
  isSettled,
  type InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"
import type { ExchangeRateProvider } from "../../domain/finance/exchange.domain.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import { daysOf } from "../../../shared/billing-cycle.ts"
import { todayKey } from "../../../shared/today.ts"
import { rangeOf, getBudgetPeriod, scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { inRange } from "./budget-formulas.ts"
import { effectiveIncomeAmount } from "./income-use-cases.ts"
import { isAdditionalIncome } from "../../../../lib/additional-income.ts"
import { getBudgetView } from "./finance-read.ts"

const CURRENCIES: CurrencyCode[] = ["CLP", "USD"]

import { currencyPositions } from "./financial-position.ts"
export { currencyPositions } from "./financial-position.ts"
export type { CurrencyPosition } from "./financial-position.ts"

type PlanDeps = {
  accounts: AccountRepository
  banks: BankRepository
  balanceBuckets: BalanceBucketRepository
  categories: CategoryRepository
  monthlyBudgets: MonthlyBudgetRepository
  transactions: TransactionRepository
  incomes: IncomeRepository
  recurring: RecurringTemplateRepository
  installments: InstallmentPlanRepository
  exchangeRates: ExchangeRateProvider
  reimbursements?: Parameters<typeof getBudgetView>[0]["reimbursements"]
  budgetPeriod?: BudgetPeriodRepository
}

type Flow = { expected: Money; done: Money; pending: Money }
const flow = (c: CurrencyCode): Flow => ({
  expected: Money.zero(c),
  done: Money.zero(c),
  pending: Money.zero(c),
})
const flowDTO = (f: Flow) => ({
  expected: f.expected.toMajor(),
  done: f.done.toMajor(),
  pending: f.pending.toMajor(),
})

// Día civil "YYYY-MM-DD" como fecha local: es lo que esperan periodKeyFor/executionDateFor.
const localDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export async function getPeriodPlan(
  deps: PlanDeps,
  userId: string,
  year: number,
  month: number,
  today = todayKey()
) {
  deps = await scopeBudgetPeriod(deps)
  const { mode } = await getBudgetPeriod(deps)
  const range = await rangeOf(deps, year, month)
  const [
    accounts,
    buckets,
    incomes,
    incomeAmounts,
    templates,
    plans,
    txs,
    budget,
  ] = await Promise.all([
    deps.accounts.listByUser(userId),
    deps.balanceBuckets.listByUser(userId),
    deps.incomes.listByUser(userId, mode),
    deps.incomes.listAmountsByUser(userId, mode),
    deps.recurring.listActiveByUser(userId),
    deps.installments.listByUser(userId),
    deps.transactions.listByUserPeriod(userId, range),
    getBudgetView(deps, userId, year, month),
  ])
  const byCurrency = new Map(
    CURRENCIES.map((c) => [
      c,
      {
        income: flow(c),
        recurringDebit: flow(c),
        recurringCredit: flow(c),
        installments: flow(c),
        futureDebit: Money.zero(c),
        futureCredit: Money.zero(c),
        unconfirmedDebit: Money.zero(c),
        unconfirmedCredit: Money.zero(c),
      },
    ])
  )
  const totals = (c: CurrencyCode) => byCurrency.get(c)!

  // Ingresos esperados del mes vs registrados (el movimiento generado desde la fuente).
  const incomeRows = []
  const plannedIncomeIds = new Set<string>()
  for (const income of incomes) {
    if (!income.isActive || isIncomeEndedAt(income, year, month)) continue
    const amount = effectiveIncomeAmount(incomeAmounts, income.id, year, month)
    if (!amount) continue
    plannedIncomeIds.add(income.id)
    const received = await deps.incomes.hasGeneratedFor(income.id, year, month, range)
    const t = totals(amount.currency).income
    t.expected = t.expected.add(amount)
    if (received) t.done = t.done.add(amount)
    else t.pending = t.pending.add(amount)
    incomeRows.push({
      id: income.id,
      name: income.name,
      accountId: income.accountId,
      dayOfMonth: income.dayOfMonth,
      amount: amount.toMajor(),
      currency: amount.currency,
      status: received ? "registrado" : "esperado",
    })
  }

  // Abonos reales independientes: incrementan la capacidad del ciclo una sola vez.
  // Un vínculo solo excluye el abono si su fuente fue incluida arriba.
  for (const t of txs) {
    if (!inRange(t.date, range) || !isAdditionalIncome(t, plannedIncomeIds)) continue
    const c = totals(t.amount.currency).income
    c.expected = c.expected.add(t.amount)
    c.done = c.done.add(t.amount)
  }

  // Recurrentes: cada período cuya fecha de ejecución cae en el rango, con su estado real.
  const recurringRows = []
  for (const template of templates) {
    const keys = new Set(
      daysOf(range).map((d) => periodKeyFor(template, localDay(d)))
    )
    for (const key of keys) {
      const executes = executionDateFor(template, key)
      if (
        !inRange(executes, range) ||
        !periodIsWithinValidity(template, executes)
      )
        continue
      const periodTx = await deps.recurring.findPeriodTransaction(
        template.id,
        key
      )
      const paid = periodTx?.status === "confirmed"
      const paidTx = paid ? txs.find((t) => t.id === periodTx!.id) : undefined
      const amount = paidTx?.amount ?? template.baseAmount
      const t =
        template.direction === "debit"
          ? totals(template.currency).recurringDebit
          : totals(template.currency).recurringCredit
      t.expected = t.expected.add(template.baseAmount)
      if (paid) t.done = t.done.add(amount)
      else t.pending = t.pending.add(template.baseAmount)
      recurringRows.push({
        id: template.id,
        label: template.label,
        direction: template.direction,
        periodKey: key,
        date: executes.toISOString().slice(0, 10),
        expectedAmount: template.baseAmount.toMajor(),
        amount: amount.toMajor(),
        currency: template.currency,
        status: paid ? "pagado" : periodTx ? "por_cobrar" : "esperado",
        transactionId: periodTx?.id ?? null,
      })
    }
  }

  // Cuotas que vencen en el rango.
  const installmentRows = []
  for (const plan of plans) {
    for (const item of plan.items) {
      if (!inRange(item.dueDate, range)) continue
      const t = totals(plan.currency).installments
      t.expected = t.expected.add(item.amount)
      if (isSettled(item)) t.done = t.done.add(item.amount)
      else t.pending = t.pending.add(item.amount)
      installmentRows.push({
        planId: plan.id,
        itemId: item.id,
        description: plan.description,
        index: item.index,
        installmentsCount: plan.installmentsCount,
        dueDate: item.dueDate.toISOString().slice(0, 10),
        amount: item.amount.toMajor(),
        currency: plan.currency,
        status: item.transactionId
          ? "pagada"
          : item.paidOutsideApp
            ? "pagada_fuera_de_la_app"
            : "pendiente",
        transactionId: item.transactionId,
      })
    }
  }

  // Movimientos ya registrados que no son de ninguna recurrente, cuota ni ingreso (esos ya están
  // arriba): los confirmados con fecha futura y los que el banco aún no confirma.
  for (const t of txs) {
    // Ya agregado a income.done/expected arriba: no repetir como crédito futuro.
    if (isAdditionalIncome(t, plannedIncomeIds)) continue
    if (
      t.isInternal ||
      t.recurringTemplateId ||
      t.installmentItemId ||
      t.incomeId
    )
      continue
    const c = totals(t.amount.currency)
    if (t.status === "confirmed" && t.date.toISOString().slice(0, 10) > today) {
      if (t.direction === "debit") c.futureDebit = c.futureDebit.add(t.amount)
      else c.futureCredit = c.futureCredit.add(t.amount)
    } else if (t.status === "pending") {
      if (t.direction === "debit")
        c.unconfirmedDebit = c.unconfirmedDebit.add(t.amount)
      else c.unconfirmedCredit = c.unconfirmedCredit.add(t.amount)
    }
  }

  return {
    period: { year, month, range, today },
    notice:
      "Solo lectura: planificar no crea movimientos, no registra pagos ni cambia saldos. CLP y USD van separados y no se suman. El presupuesto es un tope del mes, no un gasto adicional. La línea de sobregiro y el cupo de tarjeta no son caja.",
    positionToday: currencyPositions(accounts, buckets),
    byCurrency: CURRENCIES.map((currency) => {
      const c = totals(currency)
      // Cambio esperado por lo que AÚN falta: ingresos y cobros pendientes menos lo que falta pagar.
      const expectedNetChange = c.income.pending
        .add(c.recurringCredit.pending)
        .add(c.futureCredit)
        .subtract(c.recurringDebit.pending)
        .subtract(c.installments.pending)
        .subtract(c.futureDebit)
      return {
        currency,
        income: flowDTO(c.income),
        recurringExpenses: flowDTO(c.recurringDebit),
        recurringIncome: flowDTO(c.recurringCredit),
        installments: flowDTO(c.installments),
        futureConfirmed: {
          debit: c.futureDebit.toMajor(),
          credit: c.futureCredit.toMajor(),
        },
        unconfirmedMovements: {
          debit: c.unconfirmedDebit.toMajor(),
          credit: c.unconfirmedCredit.toMajor(),
        },
        expectedNetChange: expectedNetChange.toMajor(),
      }
    }),
    budgetCLP: {
      notice:
        "Tope en CLP; los gastos en USD entran convertidos de forma referencial con el dólar de su fecha",
      globalLimit: budget.globalLimit,
      income: budget.income,
      allocated: budget.allocated,
      remainingToAllocate: budget.remainingToAllocate,
      spent: budget.spent,
      reimbursementAdjustment: budget.reimbursementAdjustment,
      committed: budget.committed,
      capsOverspend: budget.capsOverspend,
      monthOverspend: budget.monthOverspend,
      categories: budget.categories
        .filter((cat) => cat.type === "expense" && cat.limit > 0)
        .map((cat) => ({
          id: cat.id,
          name: cat.name,
          limit: cat.limit,
          used: cat.used,
          committed: cat.committed,
          available: cat.available,
        })),
    },
    incomes: incomeRows,
    recurring: recurringRows,
    installments: installmentRows,
  }
}

