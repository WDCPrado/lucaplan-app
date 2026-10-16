// Planificación de un período (actual o futuro), SOLO LECTURA: junta lo que se espera que entre y
// salga —ingresos, recurrentes, cuotas y movimientos confirmados con fecha futura— separado por
// moneda, junto a la posición de hoy (caja, sobregiro, tarjetas). No escribe nada: no materializa
// comprometidos, no crea movimientos ni toca saldos.
//
// Sin doble conteo: una recurrente o cuota ya pagada se informa como pagada y no suma a lo
// pendiente; un movimiento confirmado que paga una recurrente, una cuota o un ingreso no vuelve a
// sumarse como "movimiento futuro". El presupuesto se informa como TOPE, nunca como gasto extra.
import type {
  Account,
  AccountRepository,
  BalanceBucket,
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
import { rangeOf } from "./budget-period-use-cases.ts"
import { inRange } from "./budget-formulas.ts"
import { effectiveIncomeAmount } from "./income-use-cases.ts"
import { getBudgetView } from "./finance-read.ts"

const CURRENCIES: CurrencyCode[] = ["CLP", "USD"]

export type CurrencyPosition = {
  currency: CurrencyCode
  cash: number // caja propia disponible (cuentas corrientes)
  overdraftUsed: number // deuda de sobregiro: NO es caja
  overdraftAvailable: number // línea disponible: capacidad de endeudarse, NO es caja
  cardDebt: number // deuda de tarjetas de crédito en esta moneda
  cardAvailable: number // cupo disponible de tarjetas conectadas: NO es caja
  otherBalances: number // ahorro, billeteras e inversiones (no cuentan como caja activa)
}

/**
 * Posición por moneda. Cuentas conectadas: caja, sobregiro y cupos salen de sus buckets (el saldo
 * de la cuenta nunca se pone negativo para representar sobregiro). Cuentas manuales: el saldo
 * negativo de una corriente es sobregiro usado, y el de una tarjeta, su deuda.
 */
export function currencyPositions(
  accounts: Account[],
  buckets: BalanceBucket[]
): CurrencyPosition[] {
  const pos = new Map(
    CURRENCIES.map((currency) => [
      currency,
      {
        currency,
        cash: Money.zero(currency),
        overdraftUsed: Money.zero(currency),
        overdraftAvailable: Money.zero(currency),
        cardDebt: Money.zero(currency),
        cardAvailable: Money.zero(currency),
        otherBalances: Money.zero(currency),
      },
    ])
  )
  const add = (
    currency: CurrencyCode,
    field: Exclude<keyof CurrencyPosition, "currency">,
    amount: Money
  ) => {
    const p = pos.get(currency)
    if (p) p[field] = p[field].add(amount)
  }
  for (const account of accounts) {
    const own = buckets.filter((b) => b.accountId === account.id)
    const zero = Money.zero(account.currency)
    if (account.accountType === "checking") {
      const cash = own.find((b) => b.kind === "cash")
      const od = own.find((b) => b.kind === "overdraft")
      if (cash) {
        // Sin bucket de sobregiro la caja puede quedar negativa: eso también es deuda, no caja.
        if (cash.available.isNegative)
          add(cash.currency, "overdraftUsed", cash.available.negate())
        else add(cash.currency, "cash", cash.available)
        if (od) {
          add(od.currency, "overdraftUsed", od.used)
          add(od.currency, "overdraftAvailable", od.available)
        }
      } else if (account.balance.isNegative) {
        const used = account.balance.negate()
        add(account.currency, "overdraftUsed", used)
        add(
          account.currency,
          "overdraftAvailable",
          account.overdraftLimit.subtract(used)
        )
      } else {
        add(account.currency, "cash", account.balance)
        add(account.currency, "overdraftAvailable", account.overdraftLimit)
      }
    } else if (account.accountType === "credit_card") {
      const cards = own.filter(
        (b) => b.kind === "credit_national" || b.kind === "credit_international"
      )
      if (cards.length > 0)
        for (const b of cards) {
          add(b.currency, "cardDebt", b.used)
          add(b.currency, "cardAvailable", b.available)
        }
      else if (account.balance.isNegative)
        add(account.currency, "cardDebt", account.balance.negate())
    } else if (account.accountType === "credit_line") {
      if (account.balance.isNegative)
        add(account.currency, "overdraftUsed", account.balance.negate())
    } else if (account.balance.compare(zero) !== 0) {
      add(account.currency, "otherBalances", account.balance)
    }
  }
  return [...pos.values()].map((p) => ({
    currency: p.currency,
    cash: p.cash.toMajor(),
    overdraftUsed: p.overdraftUsed.toMajor(),
    overdraftAvailable: p.overdraftAvailable.toMajor(),
    cardDebt: p.cardDebt.toMajor(),
    cardAvailable: p.cardAvailable.toMajor(),
    otherBalances: p.otherBalances.toMajor(),
  }))
}

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
    deps.incomes.listByUser(userId),
    deps.incomes.listAmountsByUser(userId),
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
  for (const income of incomes) {
    if (!income.isActive || isIncomeEndedAt(income, year, month)) continue
    const amount = effectiveIncomeAmount(incomeAmounts, income.id, year, month)
    if (!amount) continue
    const received = await deps.incomes.hasGeneratedFor(income.id, year, month)
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
      allocated: budget.allocated,
      remainingToAllocate: budget.remainingToAllocate,
      spent: budget.spent,
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
