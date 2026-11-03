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
import type { PeriodMode } from "../../../shared/billing-cycle.ts"
import {
  getBudgetView,
  getMonthlySummary,
  getPreviousMonthDebt,
} from "./finance-read.ts"
import { inRange } from "./budget-formulas.ts"

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
    return { view, summary, dailyTotal: view.globalPace.daily.reduce((s, n) => s + n, 0) }
  }
  return { txs, limits, deps, read }
}

for (const mode of ["calendar", "card_cycle"] as const) {
  // WDC-171 (invierte WDC-165): el gastado es todo gasto real, con o sin categoría y con o sin tope.
  test(`${mode}: resumen, presupuesto y barras suman todo gasto real, con o sin tope ni categoría`, async () => {
    const { read } = fixture(mode)
    const { view, summary, dailyTotal } = await read()
    // 10.000 con tope + 20.000 sin tope + 30.000 sin categoría; ni pendientes, ni interno, ni reversado, ni duplicado.
    assert.equal(view.spent, 60000)
    assert.equal(summary.expense, 60000)
    assert.equal(dailyTotal, 60000)
    // El comprometido también cuenta lo pendiente sin tope: 4.000 + 50.000.
    assert.equal(view.committed, 54000)
    assert.equal(view.globalLimit! - view.spent - view.committed, -14000)
    assert.equal(summary.income, 90000)
    // Fuera del plan sigue siendo consultable: se excluye del total, no se borra su historial.
    assert.equal(view.categories.find((c) => c.id === "sin-tope")!.used, 20000)
    assert.equal(
      view.categories.find((c) => c.id === "sin-tope")!.committed,
      50000
    )
  })

  test(`${mode}: quitar o reasignar la categoría no cambia el gastado (WDC-171)`, async () => {
    const f = fixture(mode)
    for (const categoryId of [null, "sin-tope", "plan"]) {
      f.txs[0].categoryId = categoryId
      const result = await f.read()
      assert.equal(result.view.spent, 60000, `categoría ${categoryId}`)
      assert.equal(result.summary.expense, 60000, `categoría ${categoryId}`)
      assert.equal(result.dailyTotal, 60000, `categoría ${categoryId}`)
    }
  })

  test(`${mode}: las cuotas pendientes comprometen el plan con o sin tope (WDC-171)`, async () => {
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
    const plans = [plan("plan", 6000), plan("sin-tope", 8000)]
    f.deps.installments = {
      async listByUser() {
        return plans
      },
    } as unknown as InstallmentPlanRepository
    const { view } = await f.read()
    assert.equal(view.spent, 60000)
    assert.equal(view.committed, 68000) // pendientes 4.000 + 50.000 y cuotas 6.000 + 8.000
    assert.equal(
      view.categories.find((c) => c.id === "sin-tope")!.committed,
      58000
    )
    f.txs[0].amount = Money.of(100000, "CLP")
    // Déficit de octubre: 100.000 + 20.000 + 30.000 gastados − 90.000 de ingreso.
    assert.equal(await getPreviousMonthDebt(f.deps, "u1", 2026, 11), 60000)
    plans[0].items[0].transactionId = "cuota-pagada"
    f.txs.push({ ...f.txs[0], id: "cuota-pagada", installmentItemId: "plan", amount: Money.of(6000, "CLP"), date: new Date("2026-10-15") })
    assert.equal(await getPreviousMonthDebt(f.deps, "u1", 2026, 11), 66000)
  })

  test(`${mode}: poner tope cero no retira gastos ni comprometidos (WDC-171)`, async () => {
    const f = fixture(mode)
    f.limits.push({
      id: "cero",
      categoryId: "plan",
      year: 2026,
      month: 10,
      limit: Money.zero("CLP"),
    })
    let result = await f.read()
    assert.equal(result.view.spent, 60000)
    assert.equal(result.view.committed, 54000)
    assert.equal(result.summary.expense, 60000)
    assert.equal(result.dailyTotal, 60000)
    f.limits[1].limit = Money.of(100000, "CLP")
    result = await f.read()
    assert.equal(result.view.spent, 60000)
    assert.equal(result.view.committed, 54000)
    assert.equal(result.summary.expense, 60000)
    assert.equal(result.dailyTotal, 60000)
  })

  test(`${mode}: el exceso cuenta completo y la deuda siguiente incluye gastos sin tope (WDC-171)`, async () => {
    const f = fixture(mode)
    f.txs[0].amount = Money.of(120000, "CLP")
    const { view, summary, dailyTotal } = await f.read()
    assert.equal(view.spent, 170000)
    assert.equal(summary.expense, 170000)
    assert.equal(dailyTotal, 170000)
    assert.equal(view.capsOverspend, 40000) // 20.000 sobre el tope + 20.000 de la sin tope (WDC-177)
    assert.equal(view.monthOverspend, 70000)
    assert.equal(await getPreviousMonthDebt(f.deps, "u1", 2026, 11), 80000)
  })

  test(`${mode}: barras y resumen respetan el mismo rango y conversión USD`, async () => {
    const f = fixture(mode)
    f.txs[0].date = new Date("2026-09-25T00:00:00Z")
    f.txs[0].amount = Money.of(10, "USD")
    const { view, summary, dailyTotal } = await f.read()
    const expected = (mode === "card_cycle" ? 9500 : 0) + 50000 // WDC-171: + sin tope y sin categoría
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
    const expected = (mode === "calendar" ? 17000 : 20000) + 50000 // WDC-171: + sin tope y sin categoría
    assert.equal(result.view.spent, expected)
    assert.equal(result.summary.expense, expected)
  })
}
