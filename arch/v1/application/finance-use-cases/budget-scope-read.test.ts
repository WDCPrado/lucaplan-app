import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  CategoryLimit,
  Transaction,
} from "../../domain/finance/finance.domain.ts"
import type {
  InstallmentPlan,
  InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"
import {
  daysOf,
  periodRange,
  type PeriodMode,
} from "../../../shared/billing-cycle.ts"
import {
  getBudgetView,
  getMonthlySummary,
  getPreviousMonthDebt,
} from "./finance-read.ts"
import { inRange } from "./budget-formulas.ts"
import { spendByDate } from "../../../../lib/day-spend.ts"

function fixture(mode: PeriodMode) {
  const categories = [
    { id: "plan", type: "expense" },
    { id: "sin-tope", type: "expense" },
    { id: "ingreso", type: "income" },
  ].map((c) => ({
    ...c,
    userId: "u1",
    name: c.id,
    icon: null,
    color: null,
    description: null,
    paceEnabled: true,
  }))
  const limits: CategoryLimit[] = [
    {
      id: "l1",
      categoryId: "plan",
      year: 2026,
      month: 9,
      limit: Money.of(100000, "CLP"),
    },
  ]
  const movement = (
    id: string,
    categoryId: string | null,
    amount: number,
    over: Partial<Transaction> = {}
  ): Transaction => ({
    id,
    userId: "u1",
    accountId: "a1",
    categoryId,
    date: new Date("2026-10-10T00:00:00Z"),
    description: id,
    amount: Money.of(amount, "CLP"),
    direction: "debit",
    status: "confirmed",
    isInternal: false,
    externalId: null,
    ...over,
  })
  const txs = [
    movement("incluido", "plan", 10000),
    movement("sin-presupuesto", "sin-tope", 20000),
    movement("sin-categoria", null, 30000),
    movement("pendiente-incluido", "plan", 4000, { status: "pending" }),
    movement("pendiente-excluido", "sin-tope", 50000, { status: "pending" }),
    movement("interno", "plan", 60000, { isInternal: true }),
    movement("reversado", "plan", 70000, { status: "reversed" }),
    movement("duplicado", "plan", 80000, { status: "duplicated" }),
    movement("ingreso", "ingreso", 90000, { direction: "credit" }),
    movement("fuera", "plan", 100000, {
      date: new Date("2026-11-10T00:00:00Z"),
    }),
  ]
  const deps = {
    accounts: {
      async listByUser() {
        return []
      },
    },
    categories: {
      async listByUser() {
        return categories
      },
      async listLimitsByUser() {
        return limits
      },
    },
    transactions: {
      async listByUserPeriod(
        _userId: string,
        range: { start: string; end: string }
      ) {
        return txs.filter((t) => inRange(t.date, range))
      },
    },
    monthlyBudgets: {
      async listByUser() {
        return [
          {
            id: "mes",
            userId: "u1",
            year: 2026,
            month: 9,
            globalLimit: Money.of(100000, "CLP"),
          },
        ]
      },
    },
    exchangeRates: {
      async clpPerUsdAt() {
        return 950
      },
    },
    budgetPeriod: {
      async get() {
        return { mode, overrides: {} }
      },
    },
  } as unknown as Parameters<typeof getBudgetView>[0]
  async function read() {
    const view = await getBudgetView(deps, "u1", 2026, 10)
    const summary = await getMonthlySummary(deps, "u1", 2026, 10)
    const bars = spendByDate(
      txs.map((t) => ({
        ...t,
        date: t.date.toISOString(),
        amount: t.amount.toMajor(),
        currency: t.amount.currency,
        amountClp:
          t.amount.currency === "USD" ? t.amount.toMajor() * 950 : null,
      })),
      daysOf(periodRange(2026, 10, mode, {})),
      view.categories
    )
    return { view, summary, dailyTotal: bars.reduce((s, n) => s + n, 0) }
  }
  return { txs, limits, deps, read }
}

for (const mode of ["calendar", "card_cycle"] as const) {
  test(`${mode}: resumen, presupuesto y barras solo suman categorías con tope efectivo`, async () => {
    const { read } = fixture(mode)
    const { view, summary, dailyTotal } = await read()
    assert.equal(view.spent, 10000)
    assert.equal(summary.expense, 10000)
    assert.equal(dailyTotal, 10000)
    assert.equal(view.committed, 4000)
    assert.equal(view.globalLimit! - view.spent - view.committed, 86000)
    assert.equal(summary.income, 90000)
    // Fuera del plan sigue siendo consultable: se excluye del total, no se borra su historial.
    assert.equal(view.categories.find((c) => c.id === "sin-tope")!.used, 20000)
    assert.equal(
      view.categories.find((c) => c.id === "sin-tope")!.committed,
      50000
    )
  })

  test(`${mode}: quitar y reasignar categoría actualiza todos los totales`, async () => {
    const f = fixture(mode)
    f.txs[0].categoryId = null
    let result = await f.read()
    assert.equal(result.view.spent, 0)
    assert.equal(result.summary.expense, 0)
    assert.equal(result.dailyTotal, 0)
    f.txs[0].categoryId = "sin-tope"
    result = await f.read()
    assert.equal(result.view.spent, 0)
    assert.equal(result.summary.expense, 0)
    assert.equal(result.dailyTotal, 0)
    f.txs[0].categoryId = "plan"
    result = await f.read()
    assert.equal(result.view.spent, 10000)
    assert.equal(result.summary.expense, 10000)
    assert.equal(result.dailyTotal, 10000)
  })

  test(`${mode}: solo las cuotas de categorías presupuestadas comprometen el plan`, async () => {
    const f = fixture(mode)
    const plan = (categoryId: string, amount: number): InstallmentPlan => ({
      id: categoryId,
      userId: "u1",
      kind: "card",
      accountId: "a1",
      categoryId,
      sourceTransactionId: null,
      description: "cuota",
      totalAmount: Money.of(amount, "CLP"),
      currency: "CLP",
      installmentsCount: 1,
      startDate: new Date("2026-10-15"),
      dayOfMonth: 15,
      tolerancePct: 10,
      completedAt: null,
      items: [
        {
          id: categoryId,
          index: 1,
          dueDate: new Date("2026-10-15"),
          amount: Money.of(amount, "CLP"),
          transactionId: null,
          paidOutsideApp: false,
        },
      ],
    })
    f.deps.installments = {
      async listByUser() {
        return [plan("plan", 6000), plan("sin-tope", 8000)]
      },
    } as unknown as InstallmentPlanRepository
    const { view } = await f.read()
    assert.equal(view.spent, 10000)
    assert.equal(view.committed, 10000) // pendiente 4.000 + cuota 6.000
    assert.equal(
      view.categories.find((c) => c.id === "sin-tope")!.committed,
      58000
    )
  })

  test(`${mode}: poner tope cero retira gastos y comprometidos; devolverlo los incluye`, async () => {
    const f = fixture(mode)
    f.limits.push({
      id: "cero",
      categoryId: "plan",
      year: 2026,
      month: 10,
      limit: Money.zero("CLP"),
    })
    let result = await f.read()
    assert.equal(result.view.spent, 0)
    assert.equal(result.view.committed, 0)
    assert.equal(result.summary.expense, 0)
    assert.equal(result.dailyTotal, 0)
    f.limits[1].limit = Money.of(100000, "CLP")
    result = await f.read()
    assert.equal(result.view.spent, 10000)
    assert.equal(result.view.committed, 4000)
    assert.equal(result.summary.expense, 10000)
    assert.equal(result.dailyTotal, 10000)
  })

  test(`${mode}: el exceso cuenta completo y la deuda siguiente excluye gastos sin tope`, async () => {
    const f = fixture(mode)
    f.txs[0].amount = Money.of(120000, "CLP")
    const { view, summary, dailyTotal } = await f.read()
    assert.equal(view.spent, 120000)
    assert.equal(summary.expense, 120000)
    assert.equal(dailyTotal, 120000)
    assert.equal(view.capsOverspend, 20000)
    assert.equal(view.monthOverspend, 20000)
    assert.equal(await getPreviousMonthDebt(f.deps, "u1", 2026, 11), 20000)
  })

  test(`${mode}: barras y resumen respetan el mismo rango y conversión USD`, async () => {
    const f = fixture(mode)
    f.txs[0].date = new Date("2026-09-25T00:00:00Z")
    f.txs[0].amount = Money.of(10, "USD")
    const { view, summary, dailyTotal } = await f.read()
    const expected = mode === "card_cycle" ? 9500 : 0
    assert.equal(view.spent, expected)
    assert.equal(summary.expense, expected)
    assert.equal(dailyTotal, expected)
  })
}


for (const mode of ["calendar", "card_cycle"] as const) {
  test(`${mode}: corriente y tarjeta participan juntas; el modo solo cambia fechas`, async () => {
    const { txs, read } = fixture(mode)
    const base = txs[0]
    txs.push({ ...base, id: "tarjeta", accountId: "credit-card", amount: Money.of(7000, "CLP") })
    txs.push({ ...base, id: "corriente-septiembre", accountId: "checking", date: new Date("2026-09-25T00:00:00Z"), amount: Money.of(3000, "CLP") })
    const result = await read()
    const expected = mode === "calendar" ? 17000 : 20000
    assert.equal(result.view.spent, expected)
    assert.equal(result.summary.expense, expected)
  })
}
