// Planificación de un período (actual o futuro), SOLO LECTURA: junta lo que se espera que entre y
// salga —ingresos, recurrentes, cuotas y movimientos confirmados con fecha futura— separado por
// moneda, junto a la posición de hoy (caja, sobregiro, tarjetas). No escribe nada: no materializa
// comprometidos, no crea movimientos ni toca saldos.
//
// Sin doble conteo: una recurrente o cuota ya pagada se informa como pagada y no suma a lo
// pendiente; un movimiento confirmado que paga una recurrente o una cuota, o un abono de ingreso, no
// vuelve a sumarse como "movimiento futuro". El ingreso es el del plan (`planIncome`): lo que ya
// entró más lo esperado de los ingresos programados que aún no llegan (pendiente). El presupuesto se
// informa como TOPE, nunca como gasto extra.
import type {
  AccountRepository,
  BalanceBucketRepository,
  BankRepository,
  CategoryRepository,
  MonthlyBudgetRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  executionDateFor,
  periodIsWithinValidity,
  periodKeyFor,
  periodTransactionPaying,
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
import { rangeOf, scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { inRange, isPlanIncome, planIncome } from "./budget-formulas.ts"
import { expectedAt, type IncomeSourceRepository } from "../../domain/finance/income-source.domain.ts"
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
  recurring: RecurringTemplateRepository
  installments: InstallmentPlanRepository
  exchangeRates: ExchangeRateProvider
  reimbursements?: Parameters<typeof getBudgetView>[0]["reimbursements"]
  budgetPeriod?: BudgetPeriodRepository
  incomeSources?: IncomeSourceRepository
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

// Día civil "YYYY-MM-DD" a medianoche UTC: periodKeyFor/executionDateFor leen getters UTC.
const localDay = (day: string) => new Date(`${day}T00:00:00.000Z`)

export async function getPeriodPlan(
  deps: PlanDeps,
  userId: string,
  year: number,
  month: number,
  today = todayKey()
) {
  deps = await scopeBudgetPeriod(deps)
  const range = await rangeOf(deps, year, month)
  const [
    accounts,
    buckets,
    templates,
    plans,
    txs,
    budget,
    sources,
  ] = await Promise.all([
    deps.accounts.listByUser(userId),
    deps.balanceBuckets.listByUser(userId),
    deps.recurring.listActiveByUser(userId),
    deps.installments.listByUser(userId),
    deps.transactions.listByUserPeriod(userId, range),
    getBudgetView(deps, userId, year, month),
    deps.incomeSources?.listByUser(userId) ?? Promise.resolve([]),
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

  // Ingresos, por moneda: el ingreso del plan es lo esperado; lo hecho, los abonos que ya entraron;
  // lo pendiente, el esperado de los programados que aún no llegan.
  const incomeRows: {
    id: string
    description: string
    accountId: string | null
    date: string
    amount: number
    currency: CurrencyCode
    status: "registrado" | "esperado"
    incomeSourceId: string | null
  }[] = []
  for (const c of CURRENCIES) {
    const plan = planIncome(txs, range, c, sources)
    const done = txs
      .filter((t) => isPlanIncome(t) && t.amount.currency === c && inRange(t.date, range))
      .reduce((sum, t) => sum.add(t.amount), Money.zero(c))
    totals(c).income.expected = plan.total
    totals(c).income.done = done
    totals(c).income.pending = plan.sources
      .filter((s) => s.received.isZero)
      .reduce((sum, s) => sum.add(s.expected), Money.zero(c))
    for (const s of plan.sources)
      if (s.received.isZero)
        for (const day of s.occurrences)
          incomeRows.push({
            id: s.source.id,
            description: s.source.name,
            accountId: null,
            date: day,
            amount: expectedAt(s.source, day).toMajor(),
            currency: c,
            status: "esperado",
            incomeSourceId: s.source.id,
          })
  }
  for (const t of txs)
    if (isPlanIncome(t) && inRange(t.date, range))
      incomeRows.push({
        id: t.id,
        description: t.description,
        accountId: t.accountId,
        date: t.date.toISOString().slice(0, 10),
        amount: t.amount.toMajor(),
        currency: t.amount.currency,
        status: "registrado",
        incomeSourceId: t.incomeSourceId ?? null,
      })

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
      const periodTx = periodTransactionPaying(
        template,
        key,
        await deps.recurring.findPeriodTransaction(template.id, key)
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
    // Ya agregado a income arriba: no repetir como crédito futuro.
    if (isPlanIncome(t) || t.isInternal || t.recurringTemplateId || t.installmentItemId) continue
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
        .filter((cat) => cat.inPlan)
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

