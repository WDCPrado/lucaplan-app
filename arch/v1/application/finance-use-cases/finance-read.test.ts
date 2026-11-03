// Lectura de sin categoría para el triage: filtro delegado al repo y "hay más" vía limit+1.
// Corre con: node --test arch/v1/application/finance-use-cases/finance-read.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Category,
  CategoryLimit,
  CategoryType,
  MonthlyBudget,
  Transaction,
  TransactionRepository,
  TransactionSearchFilters,
} from "../../domain/finance/finance.domain.ts"
import {
  getBudgetView,
  getCategoryDetail,
  getPreviousMonthDebt,
  listUncategorized,
  searchTransactions,
  searchTransactionsPage,
} from "./finance-read.ts"
import { inRange } from "./budget-formulas.ts"
import { scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { planTotal, shouldSuggest } from "../../../../lib/plan-total.ts"
import { calculateFinancialOverview } from "../../../../lib/financial-health.ts"
import type { InstallmentPlan } from "../../domain/finance/installment.domain.ts"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { PeriodMode, PeriodRange } from "../../../shared/billing-cycle.ts"
import { daysOf } from "../../../shared/billing-cycle.ts"

const mov = (id: string, accountId = "a1"): Transaction => ({
  id,
  userId: "u1",
  accountId,
  categoryId: null,
  date: new Date("2026-07-01"),
  description: `mov ${id}`,
  amount: Money.of(1000, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
})

const account = (id: string, provider: "manual" | "bancochile"): Account => ({
  id,
  userId: "u1",
  bankId: "b1",
  name: id,
  accountType: "checking",
  currency: "CLP",
  balance: Money.of(0, "CLP"),
  overdraftLimit: Money.of(0, "CLP"),
  color: null,
  cardLast4: null,
  provider,
  externalId: null,
})

// Deps con un repo que simula el `take` de Prisma y registra los filtros recibidos.
function makeDeps(rows: Transaction[], accounts: Account[]) {
  let received: TransactionSearchFilters | null = null
  const transactions: TransactionRepository = {
    async searchByUser(_userId, filters) {
      received = filters
      const from = filters.offset ?? 0
      return rows.slice(from, from + (filters.limit ?? rows.length))
    },
    async countByUser() {
      return rows.length
    },
    async listByUserPeriod() {
      return []
    },
    async listByCategoryPeriod() {
      return []
    },
    async findById() {
      return null
    },
    async create(): Promise<never> {
      throw new Error("no usado")
    },
    async update(): Promise<never> {
      throw new Error("no usado")
    },
    async setCategory(): Promise<never> {
      throw new Error("no usado")
    },
    async setCategoryIfUncategorized(): Promise<never> {
      throw new Error("no usado")
    },
    async delete() {},
  }
  const accountsRepo: AccountRepository = {
    async listByUser() {
      return accounts
    },
    async findById() {
      return null
    },
    async create(): Promise<never> {
      throw new Error("no usado")
    },
    async listByBank() {
      return []
    },
    async setBalance() {},
  }
  return {
    deps: { transactions, accounts: accountsRepo },
    filters: () => received,
  }
}

test("searchTransactions: pide solo movimientos ocurridos (sin las recurrentes por cobrar)", async () => {
  const { deps, filters } = makeDeps([mov("t1")], [account("a1", "bancochile")])
  await searchTransactions(
    {
      ...deps,
      categories: {
        async listByUser() {
          return []
        },
      },
      exchangeRates: {
        async clpPerUsdAt() {
          return 950
        },
      },
    } as unknown as Parameters<typeof searchTransactions>[0],
    "u1",
    { query: "jumbo", limit: 20 }
  )
  assert.equal(filters()?.settledOnly, true)
  assert.equal(filters()?.query, "jumbo") // el resto del filtro llega intacto
})

// Deps completas para el buscador (categorías y tipo de cambio no influyen en la paginación).
function searchDeps(rows: Transaction[]) {
  const { deps, filters } = makeDeps(rows, [account("a1", "bancochile")])
  return {
    deps: {
      ...deps,
      categories: {
        async listByUser() {
          return []
        },
      },
      exchangeRates: {
        async clpPerUsdAt() {
          return 950
        },
      },
    } as unknown as Parameters<typeof searchTransactionsPage>[0],
    filters,
  }
}

test("searchTransactionsPage: total real, páginas sin repetir ni saltar filas y en orden", async () => {
  const rows = ["t1", "t2", "t3", "t4", "t5"].map((id) => mov(id))
  const { deps, filters } = searchDeps(rows)
  const p1 = await searchTransactionsPage(deps, "u1", { query: "x" }, 1, 2)
  assert.equal(filters()?.settledOnly, true)
  assert.equal(filters()?.query, "x")
  assert.equal(filters()?.offset, 0)
  assert.equal(filters()?.limit, 2)
  const p2 = await searchTransactionsPage(deps, "u1", {}, 2, 2)
  assert.equal(filters()?.offset, 2)
  const p3 = await searchTransactionsPage(deps, "u1", {}, 3, 2)
  assert.deepEqual(
    [p1, p2, p3].map((p) => ({
      total: p.total,
      page: p.page,
      pageSize: p.pageSize,
    })),
    [
      { total: 5, page: 1, pageSize: 2 },
      { total: 5, page: 2, pageSize: 2 },
      { total: 5, page: 3, pageSize: 2 },
    ]
  )
  assert.deepEqual(
    [...p1.items, ...p2.items, ...p3.items].map((t) => t.id),
    ["t1", "t2", "t3", "t4", "t5"]
  )
})

test("searchTransactionsPage: página pasada del final devuelve vacío con el total", async () => {
  const { deps } = searchDeps([mov("t1"), mov("t2")])
  const p = await searchTransactionsPage(deps, "u1", {}, 9, 20)
  assert.deepEqual(p.items, [])
  assert.equal(p.total, 2)
  assert.equal(p.page, 9)
})

test("searchTransactionsPage: page y pageSize inválidos caen a 1 y 20", async () => {
  const { deps, filters } = searchDeps([mov("t1")])
  for (const [page, size] of [
    [0, 0],
    [-3, 101],
    [1.5, 2.5],
    [Number.NaN, Number.NaN],
  ]) {
    const p = await searchTransactionsPage(deps, "u1", {}, page, size)
    assert.equal(p.page, 1)
    assert.equal(p.pageSize, 20)
    assert.equal(filters()?.offset, 0)
    assert.equal(filters()?.limit, 20)
  }
})

test("listUncategorized: acota al mes (from/to), delega el criterio y pide limit+1 (51)", async () => {
  const { deps, filters } = makeDeps([mov("t1")], [account("a1", "bancochile")])
  await listUncategorized(deps, "u1", 2026, 7)
  assert.equal(filters()?.uncategorized, true)
  assert.equal(filters()?.limit, 51)
  // Ventana del mes en vista: [1 jul, 31 jul].
  assert.equal(filters()?.from?.toISOString(), "2026-07-01T00:00:00.000Z")
  assert.equal(filters()?.to?.toISOString(), "2026-07-31T00:00:00.000Z")
})

test("listUncategorized: con más filas que el tope devuelve 50 y hasMore", async () => {
  const rows = Array.from({ length: 60 }, (_, i) => mov(`t${i}`))
  const { deps } = makeDeps(rows, [account("a1", "bancochile")])
  const result = await listUncategorized(deps, "u1", 2026, 7)
  assert.equal(result.transactions.length, 50)
  assert.equal(result.hasMore, true)
})

test("listUncategorized: bajo el tope devuelve todas sin hasMore, con DTO mapeado", async () => {
  const { deps } = makeDeps(
    [mov("t1", "a1"), mov("t2", "a2")],
    [account("a1", "manual"), account("a2", "bancochile")]
  )
  const result = await listUncategorized(deps, "u1", 2026, 7)
  assert.equal(result.transactions.length, 2)
  assert.equal(result.hasMore, false)
  assert.equal(result.transactions[0].amount, 1000)
  assert.equal(result.transactions[0].categoryId, null)
  assert.equal(result.transactions[0].editable, true) // cuenta manual
  assert.equal(result.transactions[1].editable, false) // cuenta conectada
})

// --- getBudgetView: los excedentes del mes, con el cableado real ---
// Las fórmulas puras ya se prueban en finance.test.ts. Lo que se fija acá es lo que ELIGE
// getBudgetView al llamarlas: que sume `used` y no `committed`, que las categorías de ingreso no
// entren al gasto del mes, que las de gasto sin tope queden fuera del plan y sus excedentes,
// y que los internos no cuenten en ninguna de las dos. Un cambio en cualquiera de esas
// decisiones deja este test en rojo aunque las fórmulas sigan bien.

const cat = (id: string, type: CategoryType, name = id): Category => ({
  id,
  userId: "u1",
  name,
  type,
  icon: null,
  color: null,
  description: null,
  paceEnabled: true,
})

const budgetTx = (
  over: Partial<Transaction> & { id: string }
): Transaction => ({
  userId: "u1",
  accountId: "a1",
  categoryId: null,
  date: new Date(Date.UTC(2026, 7, 10)),
  description: `mov ${over.id}`,
  amount: Money.of(1000, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  ...over,
})

// Mes de agosto 2026 con las cuatro formas de categoría que importan y los dos estados que no
// deben contar (pending e interno).
const CATS: Category[] = [
  cat("c-sueldo", "income", "Sueldo"),
  cat("c-super", "expense", "Supermercado"),
  cat("c-comida", "expense", "Comida"),
  cat("c-transfer", "expense", "Transferencias"), // de gasto y SIN tope
]
const LIMITS: CategoryLimit[] = [
  {
    id: "l1",
    categoryId: "c-super",
    year: 2026,
    month: 8,
    limit: Money.of(100000, "CLP"),
  },
  {
    id: "l2",
    categoryId: "c-comida",
    year: 2026,
    month: 8,
    limit: Money.of(50000, "CLP"),
  },
]
const TXS: Transaction[] = [
  budgetTx({
    id: "t1",
    categoryId: "c-super",
    amount: Money.of(130000, "CLP"),
  }), // +30.000 sobre el tope
  budgetTx({
    id: "t2",
    categoryId: "c-super",
    amount: Money.of(40000, "CLP"),
    status: "pending",
  }), // comprometido
  budgetTx({
    id: "t3",
    categoryId: "c-comida",
    amount: Money.of(20000, "CLP"),
  }), // bajo el tope
  budgetTx({
    id: "t4",
    categoryId: "c-transfer",
    amount: Money.of(200000, "CLP"),
  }), // sin tope
  budgetTx({
    id: "t5",
    categoryId: "c-sueldo",
    amount: Money.of(1400000, "CLP"),
    direction: "credit",
  }),
  budgetTx({
    id: "t6",
    categoryId: "c-super",
    amount: Money.of(500000, "CLP"),
    isInternal: true,
  }),
]

// getBudgetView solo toca estos cuatro puertos; el resto de ReadDeps (cuentas, bancos) no se
// invoca en esta vista, así que no se le escriben stubs que nadie llamaría.
function budgetDeps(budgets: MonthlyBudget[], cats: Category[] = CATS) {
  return {
    categories: {
      async listByUser() {
        return cats
      },
      async listLimitsByUser() {
        return LIMITS
      },
    },
    transactions: {
      async listByUserPeriod() {
        return TXS
      },
    },
    monthlyBudgets: {
      async listByUser() {
        return budgets
      },
    },
    exchangeRates: {
      async clpPerUsdAt(): Promise<never> {
        throw new Error("no usado: todo el fixture es CLP")
      },
    },
  } as unknown as Parameters<typeof getBudgetView>[0]
}

const globalBudget = (amount: number): MonthlyBudget[] => [
  {
    id: "mb1",
    userId: "u1",
    year: 2026,
    month: 8,
    globalLimit: Money.of(amount, "CLP"),
  },
]

test("getBudgetView: el excedente de topes suma lo confirmado sobre el tope (todo lo usado en una sin tope del plan)", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000)),
    "u1",
    2026,
    8
  )
  // Supermercado se pasó 30.000 (130.000 de 100.000) y la sin tope entra al plan con tope 0:
  // sus 200.000 son exceso (WDC-177). Ni el pending de 40.000, ni el interno de 500.000, ni el sueldo.
  assert.equal(view.capsOverspend, 230000)
  // WDC-171: el gastado suma todo gasto real, también la categoría sin tope: 130.000 + 20.000 + 200.000.
  assert.equal(view.spent, 350000)
  assert.equal(view.committed, 40000)
  assert.equal(view.monthOverspend, 50000)
})

test("getBudgetView: pasarse del presupuesto global cuenta todo el gasto incluido", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(100000)), "u1", 2026, 8
  )
  // WDC-171: incluye los 200.000 de la categoría sin tope.
  assert.equal(view.spent, 350000)
  assert.equal(view.monthOverspend, 250000)
  assert.equal(view.capsOverspend, 230000) // 30.000 de Supermercado + 200.000 de la sin tope
})

test("getBudgetView: el DTO de la categoría excedida conserva sus cifras", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000)),
    "u1",
    2026,
    8
  )
  const super_ = view.categories.find((c) => c.id === "c-super")!
  assert.equal(super_.limit, 100000)
  assert.equal(super_.used, 130000) // el interno no suma
  assert.equal(super_.committed, 40000) // el pending vive en su propia capa
  assert.equal(super_.available, -30000)
  assert.equal(super_.status, "excedido")
})

test("getBudgetView: con el gasto bajo el presupuesto solo queda el excedente de topes", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(1000000)),
    "u1",
    2026,
    8
  )
  assert.equal(view.capsOverspend, 230000) // 30.000 de Supermercado + 200.000 de la sin tope
  assert.equal(view.monthOverspend, 0) // el mes todavía alcanza: son dos cifras independientes
})

test("getBudgetView: sin presupuesto del mes el excedente del mes es 0, no el gasto entero", async () => {
  const view = await getBudgetView(budgetDeps([]), "u1", 2026, 8)
  assert.equal(view.globalLimit, null)
  assert.equal(view.capsOverspend, 230000) // 30.000 de Supermercado + 200.000 de la sin tope
  assert.equal(view.monthOverspend, 0)
})

test("getBudgetView: sin categorías pasadas de tope ambos excedentes quedan en 0", async () => {
  const deps = {
    categories: {
      async listByUser() {
        return [cat("c-super", "expense", "Supermercado")]
      },
      async listLimitsByUser() {
        return LIMITS
      },
    },
    transactions: {
      async listByUserPeriod() {
        return [
          budgetTx({
            id: "t1",
            categoryId: "c-super",
            amount: Money.of(40000, "CLP"),
          }),
        ]
      },
    },
    monthlyBudgets: {
      async listByUser() {
        return globalBudget(300000)
      },
    },
    exchangeRates: {
      async clpPerUsdAt(): Promise<never> {
        throw new Error("no usado")
      },
    },
  } as unknown as Parameters<typeof getBudgetView>[0]
  const view = await getBudgetView(deps, "u1", 2026, 8)
  assert.equal(view.capsOverspend, 0)
  assert.equal(view.monthOverspend, 0)
})

// --- getPreviousMonthDebt: la deuda que un mes hereda del anterior ---
// El arrastre compara gastos realizados contra ingresos del período anterior, no contra topes.

const DEBT_CATS: Category[] = [
  cat("c-super", "expense", "Supermercado"),
  cat("c-sueldo", "income", "Sueldo"),
]

// Julio 2026 gastó 1.100.000 y recibió 1.350.000 de sueldo; agosto 2026 lleva 100.000.
const DEBT_TXS: Record<string, Transaction[]> = {
  "2026-7": [
    budgetTx({
      id: "d1",
      categoryId: "c-super",
      amount: Money.of(1100000, "CLP"),
      date: new Date(Date.UTC(2026, 6, 12)),
    }),
    budgetTx({
      id: "d2",
      categoryId: "c-sueldo",
      amount: Money.of(1350000, "CLP"),
      direction: "credit",
      date: new Date(Date.UTC(2026, 6, 5)),
    }),
  ],
  "2026-8": [
    budgetTx({
      id: "d3",
      categoryId: "c-super",
      amount: Money.of(100000, "CLP"),
      date: new Date(Date.UTC(2026, 7, 3)),
    }),
  ],
  "2025-12": [
    budgetTx({
      id: "d4",
      categoryId: "c-super",
      amount: Money.of(800000, "CLP"),
      date: new Date(Date.UTC(2025, 11, 20)),
    }),
  ],
}

// `listByUserPeriod` respeta el rango a propósito: si el cableado pidiera el mes equivocado, unos
// deps que devuelven siempre lo mismo lo taparían.
function debtDeps(
  budgets: MonthlyBudget[],
  txs: Transaction[] = Object.values(DEBT_TXS).flat(),
  mode: PeriodMode = "calendar"
) {
  return {
    categories: {
      async listByUser() {
        return DEBT_CATS
      },
      async listLimitsByUser() {
        // Pertenece al plan desde diciembre; el carry mantiene ese alcance en los meses siguientes.
        return [{
          id: "debt-limit", categoryId: "c-super", year: 2025, month: 12,
          limit: Money.of(100000, "CLP"),
        }]
      },
    },
    transactions: {
      async listByUserPeriod(_userId: string, range: PeriodRange) {
        return txs.filter((t) => inRange(t.date, range))
      },
    },
    monthlyBudgets: {
      async listByUser() {
        return budgets
      },
    },
    exchangeRates: {
      async clpPerUsdAt(): Promise<never> {
        throw new Error("no usado: todo el fixture es CLP")
      },
    },
    budgetPeriod: {
      async get() {
        return { mode, overrides: {} }
      },
    },
  } as unknown as Parameters<typeof getPreviousMonthDebt>[0]
}

const monthBudget = (
  year: number,
  month: number,
  amount: number
): MonthlyBudget => ({
  id: `mb-${year}-${month}`,
  userId: "u1",
  year,
  month,
  globalLimit: Money.of(amount, "CLP"),
})

test("getPreviousMonthDebt: gastos por encima de ingresos generan déficit sin depender del límite global", async () => {
  const rows = DEBT_TXS["2026-7"].map(t => t.direction === "credit" ? { ...t, amount: Money.of(950000, "CLP") } : t)
  for (const budgets of [[], [monthBudget(2026, 7, 1500000)], [monthBudget(2026, 7, 500000)]]) {
    assert.equal(await getPreviousMonthDebt(debtDeps(budgets, rows), "u1", 2026, 8), 150000)
  }
})

test("getPreviousMonthDebt: ingresos que cubren gastos no generan descuento aunque el presupuesto sea menor", async () => {
  for (const budgets of [[], [monthBudget(2026, 7, 950000)]]) {
    assert.equal(await getPreviousMonthDebt(debtDeps(budgets), "u1", 2026, 8), 0)
  }
})

test("getPreviousMonthDebt: la deuda es del mes anterior, no del que se está mirando", async () => {
  const budgets = [monthBudget(2026, 7, 1500000), monthBudget(2026, 8, 50000)]
  // Agosto sí está excedido (100.000 de 50.000)…
  const agosto = await getBudgetView(debtDeps(budgets), "u1", 2026, 8)
  assert.equal(agosto.monthOverspend, 50000)
  // …pero la deuda que hereda mira a julio, que cerró holgado.
  assert.equal(await getPreviousMonthDebt(debtDeps(budgets), "u1", 2026, 8), 0)
})

for (const sourceState of ["activa", "inactiva", "terminada", "sin-monto-vigente", "ausente"] as const) {
  test(`ingresos del ciclo: abono vinculado a fuente ${sourceState} cuenta una sola vez`, async () => {
    const rows = [
      budgetTx({ id: "gastos", categoryId: "c-super", date: new Date("2026-10-22"), amount: Money.of(2832794, "CLP") }),
      budgetTx({ id: "sueldo-recibido", categoryId: "c-sueldo", incomeId: "sueldo", direction: "credit", date: new Date("2026-09-25"), amount: Money.of(1800000, "CLP") }),
      budgetTx({ id: "abono", categoryId: "c-sueldo", incomeId: "extra", direction: "credit", date: new Date("2026-09-25"), amount: Money.of(1000000, "CLP") }),
      budgetTx({ id: "usd", categoryId: "c-sueldo", direction: "credit", date: new Date("2026-09-25"), amount: Money.of(20, "USD") }),
    ]
    const deps = debtDeps([monthBudget(2026, 10, 2416505)], rows, "card_cycle")
    const salary = { id: "sueldo", userId: "u1", accountId: "a1", categoryId: "c-sueldo", name: "Sueldo", currency: "CLP", dayOfMonth: 25, isActive: true, endedYear: null, endedMonth: null }
    deps.incomes = {
      listByUser: async () => [salary, ...(sourceState === "ausente" ? [] : [{
        ...salary, id: "extra", isActive: sourceState !== "inactiva",
        endedYear: sourceState === "terminada" ? 2026 : null,
        endedMonth: sourceState === "terminada" ? 10 : null,
      }])],
      listAmountsByUser: async () => [
        { incomeId: "sueldo", year: 2026, month: 9, amount: Money.of(2182394, "CLP") },
        { incomeId: "extra", year: 2026, month: sourceState === "sin-monto-vigente" ? 11 : 9, amount: Money.of(1000000, "CLP") },
      ],
    } as unknown as NonNullable<typeof deps.incomes>
    deps.exchangeRates = { clpPerUsdAt: async () => 950 }
    const view = await getBudgetView(deps, "u1", 2026, 10)
    assert.equal(view.income, 3201394) // + abono US$20 convertido a 950
    assert.equal(view.spent, 2832794)
    assert.equal(view.income - view.spent, 368600)
    assert.equal(view.monthOverspend, 416289, "el exceso sobre el tope no es déficit de ingresos")
    const debt = await getPreviousMonthDebt(deps, "u1", 2026, 11)
    assert.equal(debt, 0)
    assert.equal(planTotal(2321762, debt), 2321762)
    assert.equal(shouldSuggest(planTotal(2321762, debt), 1905473), true)
    rows.push(budgetTx({ id: "ciclo-siguiente", categoryId: "c-super", date: new Date("2026-10-23"), amount: Money.of(900000, "CLP") }))
    assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 11), 0)
  })
}

test("getPreviousMonthDebt: en enero el mes anterior es diciembre del año pasado", async () => {
  const debt = await getPreviousMonthDebt(
    debtDeps([monthBudget(2025, 12, 600000)]),
    "u1",
    2026,
    1
  )
  assert.equal(debt, 800000) // diciembre 2025 no tuvo ingresos; su tope no los sustituye
})

for (const mode of ["calendar", "card_cycle"] as const) {
  test(`getPreviousMonthDebt ${mode}: cuenta gastos realizados, no pendientes ni topes`, async () => {
    const rows = [
      budgetTx({ id: "gastado", categoryId: "c-super", date: new Date("2026-10-10"), amount: Money.of(90000, "CLP") }),
      budgetTx({ id: "pendiente", categoryId: "c-super", date: new Date("2026-10-15"), amount: Money.of(30000, "CLP"), status: "pending" }),
      budgetTx({ id: "ingreso", categoryId: "c-sueldo", date: new Date("2026-10-10"), amount: Money.of(100000, "CLP"), direction: "credit" }),
    ]
    const deps = debtDeps([monthBudget(2026, 10, 100000)], rows, mode)
    assert.equal((await getBudgetView(deps, "u1", 2026, 10)).monthOverspend, 0)
    assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 11), 0)
    rows[1].status = "confirmed"
    assert.equal((await getBudgetView(deps, "u1", 2026, 10)).committed, 0)
    assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 11), 20000)
  })

  test(`getPreviousMonthDebt ${mode}: pendientes solos no generan descuento`, async () => {
    const rows = [budgetTx({ id: "pendiente", categoryId: "c-super", date: new Date("2026-10-15"), amount: Money.of(30000, "CLP"), status: "pending" })]
    for (const budgets of [[], [monthBudget(2026, 10, 30000)], [monthBudget(2026, 10, 100000)]]) {
      assert.equal(await getPreviousMonthDebt(debtDeps(budgets, rows, mode), "u1", 2026, 11), 0)
    }
  })
}

// El ritmo reparte el tope del mes entre los días o las semanas que quedan. Hay categorías donde
// ese reparto no describe nada —una suscripción se cobra un día y listo—, y ahí se apaga.
for (const scenario of [
  { mode: "card_cycle", month: 11, today: "2026-10-29", frequency: "weekly", nextResetDate: "2026-10-30" },
  { mode: "card_cycle", month: 11, today: "2026-11-20", frequency: "weekly", nextResetDate: "2026-11-21" },
  { mode: "calendar", month: 10, today: "2026-10-29", frequency: "weekly", nextResetDate: "2026-11-01" },
  { mode: "calendar", month: 10, today: "2026-10-22", frequency: "weekly", nextResetDate: "2026-10-26" },
  { mode: "calendar", month: 12, today: "2026-12-31", frequency: "daily", nextResetDate: "2027-01-01" },
] as const) {
  test(`getBudgetView: reinicio ${scenario.mode} ${scenario.frequency} desde ${scenario.today}`, async () => {
    const deps = {
      ...budgetDeps(globalBudget(300000)),
      budgetPeriod: {
        get: async () => ({ mode: scenario.mode, overrides: {} }),
        setMode: async () => {}, setClosing: async () => {},
      },
    }
    const view = await getBudgetView(deps, "u1", 2026, scenario.month, {
      frequency: scenario.frequency, today: scenario.today,
    })
    assert.equal(view.categories.find((c) => c.id === "c-super")!.pace?.nextResetDate, scenario.nextResetDate)
  })
}

test("el ritmo semanal usa el modo capturado aunque cambie la configuración", async () => {
  let mode: PeriodMode = "card_cycle"
  let reads = 0
  const deps = {
    ...budgetDeps(globalBudget(300000)),
    budgetPeriod: {
      get: async () => { reads++; return { mode, overrides: {} } },
      setMode: async () => {}, setClosing: async () => {},
    },
  }
  const scoped = await scopeBudgetPeriod(deps)
  const pace = { frequency: "weekly" as const, today: "2026-08-15" }
  const expected = await getBudgetView(scoped, "u1", 2026, 8, pace)
  mode = "calendar"
  assert.deepEqual(await getBudgetView(scoped, "u1", 2026, 8, pace), expected)
  assert.equal(reads, 1)
})

test("getBudgetView: el ritmo se omite en la categoría que lo tiene apagado", async () => {
  const cats: Category[] = [
    { ...cat("c-super", "expense", "Supermercado"), paceEnabled: true },
    { ...cat("c-comida", "expense", "Comida"), paceEnabled: false },
  ]
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000), cats),
    "u1",
    2026,
    8,
    { frequency: "weekly", today: "2026-08-15" }
  )

  assert.ok(
    view.categories.find((c) => c.id === "c-super")!.pace,
    "la que lo tiene activo sigue trayendo su ritmo"
  )
  assert.equal(view.categories.find((c) => c.id === "c-comida")!.pace, null)
})

test("getBudgetView: apagar el ritmo no toca las cifras del presupuesto", async () => {
  const apagada: Category[] = [
    { ...cat("c-super", "expense", "Supermercado"), paceEnabled: false },
  ]
  const encendida: Category[] = [
    { ...cat("c-super", "expense", "Supermercado"), paceEnabled: true },
  ]
  const hoy = {
    frequency: "weekly" as const,
    today: "2026-08-15",
  }
  const off = await getBudgetView(budgetDeps(globalBudget(300000), apagada), "u1", 2026, 8, hoy)
  const on = await getBudgetView(budgetDeps(globalBudget(300000), encendida), "u1", 2026, 8, hoy)

  const a = off.categories[0]
  const b = on.categories[0]
  assert.deepEqual(
    [a.limit, a.used, a.committed, a.available, a.status],
    [b.limit, b.used, b.committed, b.available, b.status]
  )
  assert.equal(off.capsOverspend, on.capsOverspend)
  assert.equal(off.monthOverspend, on.monthOverspend)
})

test("getBudgetView: las categorías con ritmo van primero, y dentro de cada grupo manda la recencia", async () => {
  // c-super tiene la transacción más reciente del mes (t1, la primera de TXS) pero el ritmo
  // apagado; c-comida no tiene ninguna, pero sí ritmo. El ritmo manda sobre la recencia.
  const cats: Category[] = [
    { ...cat("c-super", "expense", "Supermercado"), paceEnabled: false },
    { ...cat("c-comida", "expense", "Comida"), paceEnabled: true },
  ]
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000), cats),
    "u1",
    2026,
    8,
    { frequency: "weekly", today: "2026-08-15" }
  )

  assert.deepEqual(
    view.categories.map((c) => c.id),
    ["c-comida", "c-super"]
  )
})

test("getBudgetView: sin ritmo en ninguna, el orden es el de siempre (recencia)", async () => {
  // Es el caso de un mes pasado o de todas apagadas: nada debe moverse respecto a hoy.
  const cats: Category[] = [
    { ...cat("c-comida", "expense", "Comida"), paceEnabled: false },
    { ...cat("c-super", "expense", "Supermercado"), paceEnabled: false },
  ]
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000), cats),
    "u1",
    2026,
    8,
    { frequency: "weekly", today: "2026-08-15" }
  )

  // c-super primero: es la de la transacción más reciente del mes.
  assert.deepEqual(
    view.categories.map((c) => c.id),
    ["c-super", "c-comida"]
  )
})

// --- Modo tarjeta: el mes del presupuesto es el ciclo de facturación ---
// Cierres estimados de 2026: agosto 21/08, septiembre 22/09, octubre 22/10. Así, en modo tarjeta
// septiembre va del 22/08 al 22/09 y octubre del 23/09 al 22/10.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const spentIn = async (
  txs: Transaction[],
  mode: PeriodMode,
  month: number
) =>
  (await getBudgetView(debtDeps([], txs, mode), "u1", 2026, month)).categories.find(
    (c) => c.id === "c-super"
  )!

test("modo tarjeta: un gasto después del cierre cuenta en el mes siguiente", async () => {
  const txs = [budgetTx({ id: "k1", categoryId: "c-super", date: day("2026-09-25") })]
  assert.equal((await spentIn(txs, "card_cycle", 10)).used, 1000)
  assert.equal((await spentIn(txs, "card_cycle", 9)).used, 0)
  // Mismo gasto, modo débito: septiembre, como antes de este cambio.
  assert.equal((await spentIn(txs, "calendar", 9)).used, 1000)
  assert.equal((await spentIn(txs, "calendar", 10)).used, 0)
})

test("modo tarjeta: el gasto del día del cierre cuenta en ese mes", async () => {
  const txs = [budgetTx({ id: "k2", categoryId: "c-super", date: day("2026-09-22") })]
  assert.equal((await spentIn(txs, "card_cycle", 9)).used, 1000)
  assert.equal((await spentIn(txs, "card_cycle", 10)).used, 0)
})

test("modo tarjeta: la recurrente que vence el 25/09 es comprometido de octubre", async () => {
  const txs = [
    budgetTx({
      id: "k3",
      categoryId: "c-super",
      date: day("2026-09-25"),
      status: "pending",
      amount: Money.of(15000, "CLP"),
    }),
  ]
  assert.equal((await spentIn(txs, "card_cycle", 10)).committed, 15000)
  assert.equal((await spentIn(txs, "card_cycle", 9)).committed, 0)
  assert.equal((await spentIn(txs, "calendar", 9)).committed, 15000)
})

test("modo tarjeta: la deuda del mes anterior mide el ciclo anterior (22/08 → 22/09)", async () => {
  const txs = [
    // Ciclo de agosto (termina el 21/08): no es de septiembre.
    budgetTx({ id: "k4", categoryId: "c-super", date: day("2026-08-21"), amount: Money.of(900000, "CLP") }),
    // Ciclo de septiembre: 150.000 contra un límite de 100.000.
    budgetTx({ id: "k5", categoryId: "c-super", date: day("2026-08-22"), amount: Money.of(150000, "CLP") }),
    // Después del cierre de septiembre: ya es octubre.
    budgetTx({ id: "k6", categoryId: "c-super", date: day("2026-09-25"), amount: Money.of(900000, "CLP") }),
    budgetTx({ id: "ingreso", categoryId: "c-sueldo", date: day("2026-09-10"), amount: Money.of(100000, "CLP"), direction: "credit" }),
  ]
  const budgets = [monthBudget(2026, 9, 100000)]
  assert.equal(
    await getPreviousMonthDebt(debtDeps(budgets, txs, "card_cycle"), "u1", 2026, 10),
    50000
  )
  // En modo débito septiembre es 1/09 → 30/09: solo entra el del 25/09.
  assert.equal(
    await getPreviousMonthDebt(debtDeps(budgets, txs, "calendar"), "u1", 2026, 10),
    800000
  )
})

test("la deuda del ciclo 23 sep–22 oct no crece con gastos ni pendientes posteriores al cierre", async () => {
  const rows = [
    budgetTx({ id: "inicio", categoryId: "c-super", date: day("2026-09-23"), amount: Money.of(60000, "CLP") }),
    budgetTx({ id: "cierre", categoryId: "c-super", date: day("2026-10-22"), amount: Money.of(60000, "CLP") }),
    budgetTx({ id: "ingreso", categoryId: "c-sueldo", date: day("2026-10-10"), amount: Money.of(100000, "CLP"), direction: "credit" }),
  ]
  const budgets = [monthBudget(2026, 10, 100000)]
  const cycle = debtDeps(budgets, rows, "card_cycle")
  const calendar = debtDeps(budgets, rows, "calendar")
  assert.equal(await getPreviousMonthDebt(cycle, "u1", 2026, 11), 20000)
  assert.equal(await getPreviousMonthDebt(calendar, "u1", 2026, 11), 0)
  rows.push(
    budgetTx({ id: "nuevo-gasto", categoryId: "c-super", date: day("2026-10-23"), amount: Money.of(60000, "CLP") }),
    budgetTx({ id: "nuevo-pendiente", categoryId: "c-super", date: day("2026-10-31"), amount: Money.of(50000, "CLP"), status: "pending" }),
  )
  assert.equal(await getPreviousMonthDebt(cycle, "u1", 2026, 11), 20000)
  assert.equal(await getPreviousMonthDebt(calendar, "u1", 2026, 11), 20000)
  rows.push(budgetTx({ id: "nuevo-ingreso", categoryId: "c-sueldo", date: day("2026-10-23"), amount: Money.of(10000, "CLP"), direction: "credit" }))
  assert.equal(await getPreviousMonthDebt(cycle, "u1", 2026, 11), 20000)
  assert.equal(await getPreviousMonthDebt(calendar, "u1", 2026, 11), 10000)
})

test("modo tarjeta: el triage acota al rango del ciclo", async () => {
  const { deps, filters } = makeDeps([mov("t1")], [account("a1", "bancochile")])
  await listUncategorized(
    {
      ...deps,
      budgetPeriod: {
        async get() {
          return { mode: "card_cycle" as const, overrides: {} }
        },
        async setMode() {},
        async setClosing() {},
      },
    },
    "u1",
    2026,
    10
  )
  assert.equal(filters()?.from?.toISOString(), "2026-09-23T00:00:00.000Z")
  assert.equal(filters()?.to?.toISOString(), "2026-10-22T00:00:00.000Z")
})


for (const scenario of [
  { name: "planificado", planned: 40000, active: true, category: "c-super", incomeId: "refund", expected: 40000 },
  { name: "parcial", planned: 15000, active: true, category: "c-super", incomeId: "refund", expected: 15000 },
  { name: "sin fuente", planned: 40000, active: true, category: "c-super", incomeId: null, expected: 40000 },
  { name: "fuente ausente", planned: 40000, active: true, category: "c-super", incomeId: "missing", expected: 40000 },
  { name: "inactivo", planned: 40000, active: false, category: "c-super", incomeId: "refund", expected: 40000 },
  { name: "sin tope", planned: 40000, active: true, category: "c-transfer", incomeId: "refund", expected: 40000 },
]) {
  test(`reembolso ${scenario.name}: conserva neto por categoría y neutraliza solo ingreso incluido`, async () => {
    const rows = [
      budgetTx({ id: "expense", categoryId: scenario.category, amount: Money.of(60000, "CLP") }),
      budgetTx({ id: "credit", direction: "credit", categoryId: "c-sueldo", incomeId: scenario.incomeId, amount: Money.of(40000, "CLP") }),
    ]
    const deps = budgetDeps([])
    deps.transactions.listByUserPeriod = async () => rows
    deps.incomes = {
      listByUser: async () => scenario.incomeId === "refund" ? [{ id: "refund", userId: "u1", accountId: "a1", categoryId: "c-sueldo", name: "Reembolso", currency: "CLP", dayOfMonth: 10, isActive: scenario.active, endedYear: null, endedMonth: null }] : [],
      listAmountsByUser: async () => [{ incomeId: "refund", year: 2026, month: 8, amount: Money.of(scenario.planned, "CLP") }],
    } as unknown as NonNullable<typeof deps.incomes>
    deps.reimbursements = { listForTransactions: async () => [{ expenseId: "expense", creditId: "credit", amount: 40000 }] }
    const result = await getBudgetView(deps, "u1", 2026, 8)
    assert.equal(result.spent, 20000)
    assert.equal(result.reimbursementAdjustment, scenario.expected)
    deps.monthlyBudgets.listByUser = async () => [monthBudget(2026, 8, 10000)]
    assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 9), 20000,
      "el reembolso compensa una sola vez: no es ingreso libre además de reducir el gasto")
    assert.equal(rows[0].amount.toMajor(), 60000, "no altera el movimiento bancario")
    rows[1].date = new Date("2026-09-01")
    assert.equal((await getBudgetView(deps, "u1", 2026, 8)).reimbursementAdjustment, 0, "otro ciclo no cuenta dos veces")
  })
}

for (const treatment of ["automatic", "manual"] as const) {
  for (const planned of [false, true]) {
    test(`reembolso ${treatment}, fuente ${planned}: gasto bruto, aumento único y sin compensación extra`, async () => {
      const deps = budgetDeps(globalBudget(100000))
      deps.categories.listLimitsByUser = async () => [
        { id: "base", categoryId: "c-super", year: 2026, month: 7, limit: Money.of(treatment === "manual" ? 120000 : 100000, "CLP") },
        ...(treatment === "automatic" ? [{ id: "refund", categoryId: "c-super", year: 2026, month: 8, limit: Money.of(20000, "CLP"), periodOnly: true }] : []),
      ]
      const rows = [
        budgetTx({ id: "expense", categoryId: "c-super", amount: Money.of(60000, "CLP") }),
        budgetTx({ id: "credit", direction: "credit", categoryId: "c-sueldo", incomeId: planned ? "source" : null, amount: Money.of(20000, "CLP") }),
      ]
      deps.transactions.listByUserPeriod = async () => rows
      if (planned) deps.incomes = {
        listByUser: async () => [{ id: "source", userId: "u1", categoryId: "c-sueldo", isActive: true, endedYear: null, endedMonth: null }],
        listAmountsByUser: async () => [{ incomeId: "source", year: 2026, month: 8, amount: Money.of(20000, "CLP") }],
      } as unknown as NonNullable<typeof deps.incomes>
      deps.reimbursements = { listForTransactions: async () => [{ expenseId: "expense", creditId: "credit", amount: 20000,
        effects: [{ mode: "calendar", year: 2026, month: 8, categoryId: "c-super", treatment }] }] }
      const view = await getBudgetView(deps, "u1", 2026, 8)
      assert.equal(view.allocated, 120000)
      assert.equal(view.spent, 60000)
      assert.equal(view.categories.find(c => c.id === "c-super")?.available, 60000)
      assert.equal(view.income, 20000)
      assert.equal(view.reimbursementAdjustment, 0)
      assert.equal(view.remainingToAllocate, -20000)
      assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 9), 40000)
      assert.equal(rows[0].amount.toMajor(), 60000)
      if (treatment === "automatic") assert.equal((await getBudgetView(deps, "u1", 2026, 9)).allocated, 100000)
    })
  }
}

test("mezcla legado y suplemento: netea únicamente el vínculo sin tratamiento del modo", async () => {
  const deps = budgetDeps(globalBudget(100000))
  deps.transactions.listByUserPeriod = async () => [
    budgetTx({ id: "expense", categoryId: "c-super", amount: Money.of(60000, "CLP") }),
    budgetTx({ id: "credit", direction: "credit", categoryId: "c-sueldo", amount: Money.of(30000, "CLP") }),
  ]
  deps.reimbursements = { listForTransactions: async () => [
    { expenseId: "expense", creditId: "credit", amount: 20000, effects: [{ mode: "calendar", year: 2026, month: 8, categoryId: "c-super", treatment: "automatic" }] },
    { expenseId: "expense", creditId: "credit", amount: 10000 },
  ] }
  const view = await getBudgetView(deps, "u1", 2026, 8)
  assert.equal(view.spent, 50000)
  assert.equal(view.reimbursementAdjustment, 10000)
  assert.equal(view.income, 30000)
})

test("resumen y plan usan los mismos buckets aunque el saldo legado esté desactualizado", async () => {
  const { getMonthlySummary } = await import("./finance-read.ts")
  const deps = budgetDeps([])
  deps.accounts = { listByUser: async () => [
    { ...account("a1", "bancochile"), balance: Money.of(999999, "CLP") },
    { ...account("card", "bancochile"), accountType: "credit_card", balance: Money.of(-999999, "CLP") },
  ] } as unknown as typeof deps.accounts
  deps.balanceBuckets = { listByUser: async () => [
    { accountId: "a1", kind: "cash", currency: "CLP", available: Money.of(80000, "CLP") },
    { accountId: "a1", kind: "overdraft", currency: "CLP", used: Money.of(200000, "CLP"), available: Money.of(800000, "CLP") },
    { accountId: "card", kind: "credit_national", currency: "CLP", used: Money.of(300000, "CLP"), available: Money.of(700000, "CLP") },
    { accountId: "card", kind: "credit_international", currency: "USD", used: Money.of(125, "USD"), available: Money.of(875, "USD") },
  ] } as unknown as NonNullable<typeof deps.balanceBuckets>
  const result = await getMonthlySummary(deps, "u1", 2026, 8)
  assert.equal(result.activeCash, 80000)
  assert.equal(result.overdraftDebt, 200000)
  assert.equal(result.netPosition, -120000)
  assert.deepEqual(result.creditCardDebts, [{ accountId: "card", name: "card", debt: 300000 }])
})

// --- WDC-171 · presupuesto, ritmo y titular del Inicio ---
// Noviembre 2026, mes calendario. Hogar tiene tope 450.000 y paga un arriendo recurrente de 400.000.
// Hoy es lunes 2-nov: del 2 al 30 quedan 29 días (hoy incluido).

const NOV_TODAY = { frequency: "daily" as const, today: "2026-11-02" }
const novTx = (over: Partial<Transaction> & { id: string }) =>
  budgetTx({ date: new Date(Date.UTC(2026, 10, 2)), ...over })
const limitOf = (categoryId: string, amount: number, year = 2026, month = 11): CategoryLimit => ({
  id: `l-${categoryId}-${year}-${month}`, categoryId, year, month, limit: Money.of(amount, "CLP"),
})
const cuota = (paid: boolean): InstallmentPlan => ({
  id: "plan-sillon", userId: "u1", kind: "loan", accountId: "a1", categoryId: "c-hogar",
  sourceTransactionId: null, description: "Sillón", totalAmount: Money.of(60000, "CLP"), currency: "CLP",
  installmentsCount: 3, startDate: new Date(Date.UTC(2026, 9, 10)), dayOfMonth: 10, tolerancePct: 0,
  completedAt: null,
  items: [{
    id: "item-nov", index: 2, dueDate: new Date(Date.UTC(2026, 10, 10)), amount: Money.of(20000, "CLP"),
    transactionId: paid ? "t-cuota" : null, paidOutsideApp: false,
  }],
})

// `listByUserPeriod` respeta el rango: así el arrastre del mes anterior (regla 6) tiene que pedirlo.
function wdc171Deps(opts: {
  txs: Transaction[]
  cats?: Category[]
  limits?: CategoryLimit[]
  budgets?: MonthlyBudget[]
  plans?: InstallmentPlan[]
}) {
  return {
    categories: {
      async listByUser() {
        return opts.cats ?? [cat("c-hogar", "expense", "Hogar")]
      },
      async listLimitsByUser() {
        return opts.limits ?? [limitOf("c-hogar", 450000)]
      },
    },
    transactions: {
      async listByUserPeriod(_userId: string, range: PeriodRange) {
        return opts.txs.filter((t) => inRange(t.date, range))
      },
    },
    monthlyBudgets: {
      async listByUser() {
        return opts.budgets ?? []
      },
    },
    installments: {
      async listByUser() {
        return opts.plans ?? []
      },
    },
    exchangeRates: {
      async clpPerUsdAt(): Promise<never> {
        throw new Error("no usado: todo el fixture es CLP")
      },
    },
  } as unknown as Parameters<typeof getBudgetView>[0]
}

// Lo que la fila dice que «quedan»: tope − usado − comprometido.
const quedan = (c: { limit: number; used: number; committed: number }) => c.limit - c.used - c.committed

const hogarOf = async (deps: Parameters<typeof getBudgetView>[0], year = 2026, month = 11, pace = NOV_TODAY) =>
  (await getBudgetView(deps, "u1", year, month, pace)).categories.find((c) => c.id === "c-hogar")!

test("pres-ritmo-comprometido: el ritmo y el «quedan» de Hogar descuentan el arriendo y la cuota que faltan pagar", async () => {
  const arriendoPendiente = novTx({
    id: "t-arriendo", categoryId: "c-hogar", amount: Money.of(400000, "CLP"),
    status: "pending", recurringTemplateId: "rec-arriendo", date: new Date(Date.UTC(2026, 10, 5)),
  })
  const soloArriendo = await hogarOf(wdc171Deps({ txs: [arriendoPendiente] }))
  assert.equal(soloArriendo.committed, 400000)
  assert.equal(soloArriendo.available, 450000, "`available` sigue siendo tope − usado (sirve para «sobre el tope»)")
  assert.equal(quedan(soloArriendo), 50000, "quedan = 450.000 − 0 usado − 400.000 comprometido")
  assert.equal(soloArriendo.pace?.budget, Math.floor(50000 / 29), "1.724 por día, no 15.517")

  // La cuota del sillón que vence el 10-nov y aún no se paga también es comprometido de Hogar.
  const conCuota = await hogarOf(wdc171Deps({ txs: [arriendoPendiente], plans: [cuota(false)] }))
  assert.equal(conCuota.committed, 420000)
  assert.equal(quedan(conCuota), 30000)
  assert.equal(conCuota.pace?.budget, Math.floor(30000 / 29))

  // La fila del Inicio pinta «quedan» con tope − usado − comprometido, no con `available`.
  const dashboard = readFileSync(join(import.meta.dirname, "../../../../components/finance/dashboard.tsx"), "utf8")
  const shown = dashboard.match(/quedan <span className="tabular">\{formatCLP\(([^)]*)\)\}/)?.[1]
  assert.ok(shown, "la fila sigue diciendo «quedan $X»")
  assert.notEqual(shown.trim(), "c.available")
})

test("pres-pagar-recurrente: pagar el arriendo y la cuota no pinta el ritmo ni mueve lo que queda de Hogar", async () => {
  const pendientes = await hogarOf(wdc171Deps({
    txs: [novTx({ id: "t-arriendo", categoryId: "c-hogar", amount: Money.of(400000, "CLP"), status: "pending", recurringTemplateId: "rec-arriendo" })],
    plans: [cuota(false)],
  }))
  const pagados = (extra: Transaction[] = [], arriendo = 400000) => wdc171Deps({
    txs: [
      novTx({ id: "t-arriendo", categoryId: "c-hogar", amount: Money.of(arriendo, "CLP"), recurringTemplateId: "rec-arriendo" }),
      novTx({ id: "t-cuota", categoryId: "c-hogar", amount: Money.of(20000, "CLP"), installmentItemId: "item-nov" }),
      ...extra,
    ],
    plans: [cuota(true)],
  })
  const hoy = await hogarOf(pagados())
  assert.equal(hoy.used, 420000, "lo pagado sí es usado de la categoría")
  assert.equal(hoy.committed, 0, "y deja de estar comprometido")
  assert.equal(quedan(hoy), quedan(pendientes), "lo que queda no cambia al pagar por su monto")
  assert.equal(hoy.pace?.spent, 0, "el ritmo de hoy no cuenta el arriendo ni la cuota")
  assert.equal(hoy.pace?.budget, pendientes.pace?.budget, "la meta del día tampoco se mueve")
  assert.equal(hoy.pace?.status, "ok")

  // Bordes del ritmo con un gasto variable del mismo día: justo en la meta es alerta, $1 más es excedido.
  const meta = Math.floor(30000 / 29)
  const justo = await hogarOf(pagados([novTx({ id: "t-pan", categoryId: "c-hogar", amount: Money.of(meta, "CLP") })]))
  assert.equal(justo.pace?.spent, meta)
  assert.equal(justo.pace?.status, "alerta")
  const pasado = await hogarOf(pagados([novTx({ id: "t-pan", categoryId: "c-hogar", amount: Money.of(meta + 1, "CLP") })]))
  assert.equal(pasado.pace?.status, "excedido")

  // Si el arriendo se cobra por más de lo esperado, la diferencia sí sale de lo que queda.
  const caro = await hogarOf(pagados([], 410000))
  assert.equal(quedan(caro), quedan(pendientes) - 10000)
})

test("pres-gastado-todo: el gastado del Inicio suma todo gasto real en CLP, con o sin categoría y con o sin tope", async () => {
  const view = await getBudgetView(wdc171Deps({
    cats: [cat("c-hogar", "expense", "Hogar"), cat("c-regalos", "expense", "Regalos"), cat("c-sueldo", "income", "Sueldo")],
    txs: [
      novTx({ id: "con-tope", categoryId: "c-hogar", amount: Money.of(100000, "CLP") }),
      novTx({ id: "sin-tope", categoryId: "c-regalos", amount: Money.of(50000, "CLP") }),
      novTx({ id: "sin-categoria", categoryId: null, amount: Money.of(30000, "CLP") }),
      novTx({ id: "interno", categoryId: "c-hogar", amount: Money.of(500000, "CLP"), isInternal: true }),
      novTx({ id: "pendiente", categoryId: "c-hogar", amount: Money.of(40000, "CLP"), status: "pending" }),
      novTx({ id: "pendiente-sin-tope", categoryId: "c-regalos", amount: Money.of(10000, "CLP"), status: "pending", recurringTemplateId: "rec-regalo" }),
      novTx({ id: "sueldo", categoryId: "c-sueldo", amount: Money.of(1000000, "CLP"), direction: "credit" }),
    ],
  }), "u1", 2026, 11, NOV_TODAY)
  assert.equal(view.spent, 180000, "100.000 + 50.000 + 30.000; ni el interno, ni los pendientes, ni el sueldo")
  assert.equal(view.committed, 50000, "el comprometido también cuenta la recurrente pendiente sin tope")
  assert.equal(view.categories.find((c) => c.id === "c-regalos")!.pace, null, "sin tope no hay ritmo")
})

test("pres-banda-y-titular: con tope de gasto 500.000, ingreso 1.000.000 y gastado 600.000, la banda dice $100.000 sobre el tope y el titular $400.000", async () => {
  const mes = (sinTope: number) => wdc171Deps({
    cats: [cat("c-hogar", "expense", "Hogar"), cat("c-regalos", "expense", "Regalos"), cat("c-sueldo", "income", "Sueldo")],
    budgets: [{ id: "mb-nov", userId: "u1", year: 2026, month: 11, globalLimit: Money.of(500000, "CLP") }],
    txs: [
      novTx({ id: "hogar", categoryId: "c-hogar", amount: Money.of(450000, "CLP") }),
      novTx({ id: "regalos", categoryId: "c-regalos", amount: Money.of(sinTope, "CLP") }),
      novTx({ id: "sueldo", categoryId: "c-sueldo", amount: Money.of(1000000, "CLP"), direction: "credit" }),
    ],
  })
  const view = await getBudgetView(mes(150000), "u1", 2026, 11)
  assert.equal(view.spent, 600000)
  assert.equal(view.monthOverspend, 100000, "la banda mide el tope de gasto global")
  const titular = calculateFinancialOverview({
    cash: 0, overdraftDebt: 0, income: view.income, spent: view.spent,
    committed: view.committed, reimbursementAdjustment: view.reimbursementAdjustment,
  })
  assert.equal(titular.balance, 400000, "el titular lee `balance`")

  // Bordes del tope de gasto: gastar justo 500.000 no muestra banda; $1 más, $1.
  assert.equal((await getBudgetView(mes(50000), "u1", 2026, 11)).monthOverspend, 0)
  assert.equal((await getBudgetView(mes(50001), "u1", 2026, 11)).monthOverspend, 1)

  // El texto de la banda habla del tope de gasto, no del presupuesto ni del plan.
  const banner = readFileSync(join(import.meta.dirname, "../../../../components/finance/overspend-banner.tsx"), "utf8")
  assert.match(banner, /tope de gasto/)
  assert.doesNotMatch(banner, /del presupuesto de/)
  assert.doesNotMatch(banner, /El presupuesto del mes todavía alcanza/)
})

test("pres-aviso-plugin: el aviso del plan en el plugin ya no dice que solo cuentan gastos de categorías con tope", () => {
  const tools = readFileSync(join(import.meta.dirname, "../../infrastructure/plugin/finance-tools.ts"), "utf8")
  const schema = readFileSync(join(import.meta.dirname, "../../../../lib/schemas/plugin.ts"), "utf8")
  // includes y no match: el mensaje de un match fallido vuelca el archivo entero.
  assert.ok(!tools.includes("solo cuentan gastos de categorías presupuestadas"), "finance-tools.ts: notice de lucaplan_medidor_financiero")
  assert.ok(!schema.includes("gastos confirmados de categorías con tope >0"), "lib/schemas/plugin.ts: descripción de lucaplan_medidor_financiero")
})

// --- WDC-171 · USD: se convierte con el dólar observado, pero nunca con una tasa inventada ---
// Propuesta de contrato: `clpPerUsdAt` devuelve `null` cuando no hay dólar observado, y la vista
// trae `exchangeRateUnavailable: true` con los montos USD fuera de los totales.
const withRate = (deps: Parameters<typeof getBudgetView>[0], rate: number | null) =>
  ({ ...deps, exchangeRates: { clpPerUsdAt: async () => rate } }) as unknown as Parameters<typeof getBudgetView>[0]
const rateFlag = (view: object) => (view as { exchangeRateUnavailable?: boolean }).exchangeRateUnavailable

test("pres-usd-sin-tasa: si el dólar observado no responde, el gasto en USD queda fuera con aviso y no se convierte a una tasa fija", async () => {
  const mes = (txs: Transaction[]) => wdc171Deps({ txs })
  const txs = [
    novTx({ id: "clp", categoryId: "c-hogar", amount: Money.of(100000, "CLP") }),
    novTx({ id: "usd", categoryId: "c-hogar", amount: Money.of(10, "USD") }),
  ]
  const conTasa = await getBudgetView(withRate(mes(txs), 950), "u1", 2026, 11)
  assert.equal(conTasa.spent, 109500, "US$10 × 950 del día")
  assert.equal(rateFlag(conTasa), false)

  const sinTasa = await getBudgetView(withRate(mes(txs), null), "u1", 2026, 11)
  assert.equal(sinTasa.spent, 100000, "el USD no entra con una tasa inventada")
  assert.equal(sinTasa.categories.find((c) => c.id === "c-hogar")!.used, 100000)
  assert.equal(rateFlag(sinTasa), true, "la vista avisa que falta el dólar observado")

  // Borde: sin movimientos en USD no hay nada que avisar aunque el proveedor no responda.
  assert.equal(rateFlag(await getBudgetView(withRate(mes([txs[0]]), null), "u1", 2026, 11)), false)
})

test("pres-usd-ingreso: un abono en USD suma a los ingresos convertido con el dólar del día, igual que un gasto", async () => {
  const deps = wdc171Deps({
    cats: [cat("c-hogar", "expense", "Hogar"), cat("c-sueldo", "income", "Sueldo")],
    txs: [
      novTx({ id: "abono-clp", categoryId: "c-sueldo", direction: "credit", amount: Money.of(500000, "CLP") }),
      novTx({ id: "abono-usd", categoryId: "c-sueldo", direction: "credit", amount: Money.of(100, "USD") }),
    ],
  })
  const conTasa = await getBudgetView(withRate(deps, 950), "u1", 2026, 11)
  assert.equal(conTasa.income, 595000, "500.000 + US$100 × 950")
  const sinTasa = await getBudgetView(withRate(deps, null), "u1", 2026, 11)
  assert.equal(sinTasa.income, 500000)
  assert.equal(rateFlag(sinTasa), true)
})

test("pres-detalle-cuadra: el detalle de Hogar dice el mismo comprometido y «libre» que la vista del mes, con la cuota del sillón por cobrar", async () => {
  const txs = [
    novTx({ id: "t-arriendo", categoryId: "c-hogar", amount: Money.of(400000, "CLP"), status: "pending", recurringTemplateId: "rec-arriendo" }),
    novTx({ id: "t-super", categoryId: "c-hogar", amount: Money.of(10000, "CLP") }),
  ]
  const base = wdc171Deps({ txs, plans: [cuota(false)] }) as unknown as Record<string, Record<string, unknown>>
  const deps = {
    ...base,
    categories: { ...base.categories, findById: async (id: string) => (id === "c-hogar" ? cat("c-hogar", "expense", "Hogar") : null) },
    transactions: {
      ...base.transactions,
      listByCategoryPeriod: async (categoryId: string, range: PeriodRange) =>
        txs.filter((t) => t.categoryId === categoryId && inRange(t.date, range)),
    },
    accounts: { listByUser: async () => [] },
  } as unknown as Parameters<typeof getBudgetView>[0]
  const fila = await hogarOf(deps)
  const detalle = await getCategoryDetail(deps, "u1", "c-hogar", 2026, 11)
  assert.equal(fila.committed, 420000, "arriendo 400.000 + cuota 20.000")
  assert.equal(detalle.committed, fila.committed)
  assert.equal(detalle.free, fila.free)
  assert.equal(detalle.used, fila.used)
})

// --- WDC-177 · disponible para gastar (titular del Inicio) y ritmo global ---
// Noviembre 2026, mes calendario; hoy lunes 2-nov (índice 1 de los 30 días del mes).
const sueldo = (amount: number, date = new Date(Date.UTC(2026, 10, 1))) =>
  novTx({ id: `sueldo-${amount}`, categoryId: "c-sueldo", direction: "credit", amount: Money.of(amount, "CLP"), date })
const HOGAR_REGALOS = [cat("c-hogar", "expense", "Hogar"), cat("c-regalos", "expense", "Regalos"), cat("c-sueldo", "income", "Sueldo")]
const viewOf = (deps: Parameters<typeof getBudgetView>[0], pace: { frequency: "daily" | "weekly"; today: string } = NOV_TODAY, month = 11) =>
  getBudgetView(deps, "u1", 2026, month, pace)
const catOf = (view: Awaited<ReturnType<typeof getBudgetView>>, id: string) => view.categories.find((c) => c.id === id)!
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const NOV_2 = 1

test("disp-falta-repartir: ingresos 2.000.000, arriendo comprometido 600.000 y supermercado 300.000 gastado de un tope de 1.200.000: el disponible es 900.000, limitado por el plan", async () => {
  const mes = (topeSuper: number) => wdc171Deps({
    cats: [cat("c-hogar", "expense", "Hogar"), cat("c-super", "expense", "Supermercado"), cat("c-sueldo", "income", "Sueldo")],
    limits: [limitOf("c-hogar", 600000), limitOf("c-super", topeSuper)],
    txs: [
      sueldo(2000000),
      novTx({ id: "arriendo", categoryId: "c-hogar", amount: Money.of(600000, "CLP"), status: "pending", recurringTemplateId: "rec-arriendo" }),
      novTx({ id: "super", categoryId: "c-super", amount: Money.of(300000, "CLP") }),
    ],
  })
  const view = await viewOf(mes(1200000))
  // Topes 1.800.000 de 2.000.000: los 200.000 sin repartir no se ofrecen para gastar.
  assert.deepEqual(view.spendable, { amount: 900000, margin: 1100000, plannedLeft: 900000, limitedBy: "plan" })
  const titular = calculateFinancialOverview({
    cash: 0, overdraftDebt: 0, income: view.income, spent: view.spent,
    committed: view.committed, reimbursementAdjustment: view.reimbursementAdjustment,
  })
  assert.equal(view.spendable.margin, titular.balance, "el margen es el balance del medidor")
})

test("disp-repartio-de-mas: con el mismo mes pero el supermercado con tope 2.500.000, manda el margen: 1.100.000", async () => {
  const view = await viewOf(wdc171Deps({
    cats: [cat("c-hogar", "expense", "Hogar"), cat("c-super", "expense", "Supermercado"), cat("c-sueldo", "income", "Sueldo")],
    limits: [limitOf("c-hogar", 600000), limitOf("c-super", 2500000)],
    txs: [
      sueldo(2000000),
      novTx({ id: "arriendo", categoryId: "c-hogar", amount: Money.of(600000, "CLP"), status: "pending", recurringTemplateId: "rec-arriendo" }),
      novTx({ id: "super", categoryId: "c-super", amount: Money.of(300000, "CLP") }),
    ],
  }))
  assert.deepEqual(view.spendable, { amount: 1100000, margin: 1100000, plannedLeft: 2200000, limitedBy: "margin" })
})

test("disp-sin-tope-con-gasto: Regalos no tiene tope y se gastan 50.000: entra al plan con tope 0 y el disponible baja de 450.000 a 400.000", async () => {
  const cats = [...HOGAR_REGALOS, cat("c-viajes", "expense", "Viajes")]
  const sinGasto = await viewOf(wdc171Deps({ cats, txs: [sueldo(1000000)] }))
  assert.equal(sinGasto.spendable.amount, 450000)
  assert.equal(catOf(sinGasto, "c-hogar").inPlan, true, "con tope está en el plan aunque no tenga movimientos")
  assert.equal(catOf(sinGasto, "c-regalos").inPlan, false)

  const view = await viewOf(wdc171Deps({ cats, txs: [sueldo(1000000), novTx({ id: "regalo", categoryId: "c-regalos", amount: Money.of(50000, "CLP") })] }))
  const regalos = catOf(view, "c-regalos")
  assert.equal(regalos.inPlan, true)
  assert.equal(regalos.limit, 0, "entra con tope 0")
  assert.equal(regalos.free, -50000, "todo su gasto es exceso")
  assert.deepEqual(view.spendable, { amount: 400000, margin: 950000, plannedLeft: 400000, limitedBy: "plan" })
  assert.equal(catOf(view, "c-viajes").inPlan, false, "sin tope y sin movimientos sigue «sin tope»")
  assert.equal(catOf(view, "c-sueldo").inPlan, false, "una categoría de ingreso no es parte del plan de gasto")

  // Borde: $1 gastado basta para entrar.
  const unPeso = await viewOf(wdc171Deps({ cats, txs: [sueldo(1000000), novTx({ id: "regalo", categoryId: "c-regalos", amount: Money.of(1, "CLP") })] }))
  assert.equal(catOf(unPeso, "c-regalos").inPlan, true)
  assert.equal(unPeso.spendable.amount, 449999)
})

test("disp-sin-tope-vuelve: si se elimina o se recategoriza el único gasto de Regalos, vuelve a «sin tope» y el disponible se recupera", async () => {
  const mes = (regalo: Transaction | null) =>
    viewOf(wdc171Deps({ cats: HOGAR_REGALOS, txs: regalo ? [sueldo(1000000), regalo] : [sueldo(1000000)] }))
  const regalo = (categoryId: string | null) => novTx({ id: "regalo", categoryId, amount: Money.of(50000, "CLP") })

  const eliminado = await mes(null)
  assert.equal(catOf(eliminado, "c-regalos").inPlan, false)
  assert.equal(eliminado.spendable.amount, 450000)

  const aHogar = await mes(regalo("c-hogar"))
  assert.equal(catOf(aHogar, "c-regalos").inPlan, false, "recategorizado a Hogar: Regalos queda sin movimientos")
  assert.equal(aHogar.spendable.plannedLeft, 400000, "ahora lo descuenta el tope de Hogar")

  const aSinCategoria = await mes(regalo(null))
  assert.equal(catOf(aSinCategoria, "c-regalos").inPlan, false)
  assert.equal(aSinCategoria.spendable.plannedLeft, 450000, "sin categoría no resta del plan")
  assert.equal(aSinCategoria.spendable.margin, 950000, "pero sí del margen: es plata que salió")
})

test("disp-sin-tope-comprometido: Regalos sin tope solo tiene una recurrente de 30.000 por cobrar: entra al plan y el disponible baja a 420.000", async () => {
  const view = await viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    txs: [sueldo(1000000), novTx({ id: "regalo-rec", categoryId: "c-regalos", amount: Money.of(30000, "CLP"), status: "pending", recurringTemplateId: "rec-regalo" })],
  }))
  const regalos = catOf(view, "c-regalos")
  assert.equal(regalos.inPlan, true)
  assert.equal(regalos.committed, 30000)
  assert.equal(view.spendable.plannedLeft, 420000)
  assert.equal(view.spendable.amount, 420000)
})

test("disp-negativo: el disponible puede quedar bajo cero, por el margen o por el plan, y no se recorta a 0", async () => {
  // Por el margen: ingresos 300.000 y Hogar gastó su tope entero de 450.000.
  const sinPlata = await viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    txs: [sueldo(300000), novTx({ id: "hogar", categoryId: "c-hogar", amount: Money.of(450000, "CLP") })],
  }))
  assert.deepEqual(sinPlata.spendable, { amount: -150000, margin: -150000, plannedLeft: 0, limitedBy: "margin" })

  // Por el plan: ingresos 1.000.000, Hogar intacto y Regalos (sin tope) gastó 600.000.
  const sinPlan = await viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    txs: [sueldo(1000000), novTx({ id: "regalos", categoryId: "c-regalos", amount: Money.of(600000, "CLP") })],
  }))
  assert.deepEqual(sinPlan.spendable, { amount: -150000, margin: 400000, plannedLeft: -150000, limitedBy: "plan" })
})

test("ritmo-pagar-compromiso: pagar el arriendo de 400.000 y la cuota del sillón de 20.000 no suma al ritmo ni mueve la meta de la curva", async () => {
  const mes = (arriendoPagado: boolean, cuotaPagada: boolean, extra: Transaction[] = []) => viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    plans: [cuota(cuotaPagada)],
    txs: [
      sueldo(1000000),
      novTx({ id: "t-arriendo", categoryId: "c-hogar", amount: Money.of(400000, "CLP"), recurringTemplateId: "rec-arriendo", status: arriendoPagado ? "confirmed" : "pending" }),
      ...(cuotaPagada ? [novTx({ id: "t-cuota", categoryId: "c-hogar", amount: Money.of(20000, "CLP"), installmentItemId: "item-nov" })] : []),
      ...extra,
    ],
  }))
  const antes = await mes(false, false)
  assert.equal(antes.spendable.amount, 30000, "450.000 − 400.000 − 20.000 por cobrar")
  assert.equal(antes.globalPace.budget, 30000)
  assert.equal(antes.globalPace.daily.length, 30)

  const arriendo = await mes(true, false)
  assert.equal(sum(arriendo.globalPace.daily), 0, "el arriendo conciliado no es gasto del ritmo")
  assert.equal(arriendo.globalPace.budget, antes.globalPace.budget)
  assert.equal(arriendo.spendable.amount, antes.spendable.amount)

  const ambos = await mes(true, true)
  assert.equal(ambos.spent, 420000, "sí es gastado del mes")
  assert.equal(sum(ambos.globalPace.daily), 0, "la cuota pagada tampoco")
  assert.equal(ambos.globalPace.budget, antes.globalPace.budget)

  // Un gasto variable el mismo día sí pinta el ritmo.
  const conPan = await mes(true, true, [novTx({ id: "pan", categoryId: "c-hogar", amount: Money.of(5000, "CLP") })])
  assert.equal(conPan.globalPace.daily[NOV_2], 5000)
  assert.equal(conPan.globalPace.budget, antes.globalPace.budget)
})

test("ritmo-meta-estable: un gasto de 20.000 hoy sube lo gastado del ritmo, pero la meta de la curva sigue en 450.000", async () => {
  const mes = (txs: Transaction[]) => viewOf(wdc171Deps({ cats: HOGAR_REGALOS, txs: [sueldo(1000000), ...txs] }))
  const antes = await mes([])
  assert.equal(antes.globalPace.budget, 450000)

  const ayer = novTx({ id: "ayer", categoryId: "c-hogar", amount: Money.of(10000, "CLP"), date: new Date(Date.UTC(2026, 10, 1)) })
  const hoy = novTx({ id: "hoy", categoryId: "c-hogar", amount: Money.of(20000, "CLP") })
  const despues = await mes([ayer, hoy])
  assert.equal(despues.globalPace.daily[0], 10000, "1-nov")
  assert.equal(despues.globalPace.daily[NOV_2], 20000, "2-nov")
  assert.equal(despues.spendable.amount, 420000)
  assert.equal(despues.globalPace.budget, despues.spendable.amount + sum(despues.globalPace.daily))
  assert.equal(despues.globalPace.budget, 450000, "registrar gastos no mueve la meta")

  // Lo pendiente no es gasto del ritmo (aún no salió).
  const pendiente = await mes([novTx({ id: "pend", categoryId: "c-hogar", amount: Money.of(40000, "CLP"), status: "pending" })])
  assert.equal(sum(pendiente.globalPace.daily), 0)
})

test("ritmo-sin-tope-global: el tope de gasto global ya no fija la meta de la curva; con tope de 100.000 o sin él, la meta es la misma", async () => {
  const mes = (budgets: MonthlyBudget[]) => viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    budgets,
    txs: [sueldo(1000000), novTx({ id: "hoy", categoryId: "c-hogar", amount: Money.of(20000, "CLP") })],
  }))
  const sinTope = await mes([])
  const conTope = await mes([{ id: "mb-nov", userId: "u1", year: 2026, month: 11, globalLimit: Money.of(100000, "CLP") }])
  assert.equal(sinTope.globalPace.budget, 450000)
  assert.equal(conTope.globalPace.budget, 450000)
  assert.deepEqual(conTope.spendable, sinTope.spendable)
})

test("disp-modo-tarjeta: en el ciclo 23-sep a 22-oct, un regalo del 25-sep cuenta en «octubre» y uno del 25-oct no", async () => {
  const txs = [
    novTx({ id: "sueldo", categoryId: "c-sueldo", direction: "credit", amount: Money.of(1000000, "CLP"), date: day("2026-09-24") }),
    novTx({ id: "regalo-sep", categoryId: "c-regalos", amount: Money.of(30000, "CLP"), date: day("2026-09-25") }),
    novTx({ id: "hogar-oct", categoryId: "c-hogar", amount: Money.of(9000, "CLP"), date: day("2026-10-25") }),
  ]
  const deps = (mode: PeriodMode) => ({
    ...wdc171Deps({ cats: HOGAR_REGALOS, limits: [limitOf("c-hogar", 450000, 2026, 10)], txs }),
    budgetPeriod: { get: async () => ({ mode, overrides: {} }), setMode: async () => {}, setClosing: async () => {} },
  }) as unknown as Parameters<typeof getBudgetView>[0]
  const today = { frequency: "daily" as const, today: "2026-10-01" }

  const ciclo = await viewOf(deps("card_cycle"), today, 10)
  const dias = daysOf({ start: "2026-09-23", end: "2026-10-22" })
  assert.equal(ciclo.globalPace.daily.length, dias.length)
  assert.equal(ciclo.globalPace.daily[dias.indexOf("2026-09-25")], 30000)
  assert.equal(sum(ciclo.globalPace.daily), 30000, "el 25-oct es del ciclo siguiente")
  assert.equal(catOf(ciclo, "c-regalos").inPlan, true)
  assert.deepEqual(ciclo.spendable, { amount: 420000, margin: 970000, plannedLeft: 420000, limitedBy: "plan" })

  // Mismo mes en modo débito (1 al 31 de octubre): el regalo es de septiembre y el gasto del 25-oct sí entra.
  const mesCalendario = await viewOf(deps("calendar"), today, 10)
  assert.equal(mesCalendario.globalPace.daily.length, 31)
  assert.equal(mesCalendario.globalPace.daily[24], 9000)
  assert.equal(catOf(mesCalendario, "c-regalos").inPlan, false)
})

test("disp-usd-sin-tasa: un regalo de US$10 entra convertido con el dólar del día; sin dólar observado queda fuera del plan, del disponible y del ritmo", async () => {
  const deps = wdc171Deps({ cats: HOGAR_REGALOS, txs: [sueldo(1000000), novTx({ id: "usd", categoryId: "c-regalos", amount: Money.of(10, "USD") })] })
  const conTasa = await viewOf(withRate(deps, 950))
  assert.equal(catOf(conTasa, "c-regalos").inPlan, true)
  assert.equal(conTasa.spendable.plannedLeft, 450000 - 9500)
  assert.equal(conTasa.globalPace.daily[NOV_2], 9500)

  const sinTasa = await viewOf(withRate(deps, null))
  assert.equal(catOf(sinTasa, "c-regalos").inPlan, false, "sin tasa no hay gasto que cuente")
  assert.deepEqual(sinTasa.spendable, { amount: 450000, margin: 1000000, plannedLeft: 450000, limitedBy: "plan" })
  assert.equal(sum(sinTasa.globalPace.daily), 0)
})

test("disp-interno: un movimiento interno de 500.000 en Regalos no la mete al plan ni toca el disponible ni el ritmo", async () => {
  const base = await viewOf(wdc171Deps({ cats: HOGAR_REGALOS, txs: [sueldo(1000000)] }))
  const view = await viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    txs: [
      sueldo(1000000),
      novTx({ id: "int-regalos", categoryId: "c-regalos", amount: Money.of(500000, "CLP"), isInternal: true }),
      novTx({ id: "int-hogar", categoryId: "c-hogar", amount: Money.of(500000, "CLP"), isInternal: true }),
    ],
  }))
  assert.equal(catOf(view, "c-regalos").inPlan, false)
  assert.deepEqual(view.spendable, base.spendable)
  assert.equal(sum(view.globalPace.daily), 0)
  assert.equal(view.globalPace.budget, base.globalPace.budget)
})

test("disp-sin-ningun-tope: usuario nuevo sin topes con 50.000 en Regalos: el disponible es el margen 950.000 y manda el margen", async () => {
  const view = await viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    limits: [],
    txs: [sueldo(1000000), novTx({ id: "regalo", categoryId: "c-regalos", amount: Money.of(50000, "CLP") })],
  }))
  assert.deepEqual(view.spendable, { amount: 950000, margin: 950000, plannedLeft: -50000, limitedBy: "margin" })
  assert.equal(view.globalPace.budget, 1000000, "la meta del ritmo es el margen más lo ya gastado")
  // Sin plan ninguna categoría entra: Regalos no se pinta como excedida ni suma exceso.
  assert.equal(view.categories.find((c) => c.id === "c-regalos")?.inPlan, false)
  assert.equal(view.capsOverspend, 0)
})

test("caps-sin-tope-en-el-plan: Regalos sin tope con 50.000 gastados cuenta 50.000 de exceso; Viajes sin tope ni gasto no suma", async () => {
  const view = await viewOf(wdc171Deps({
    cats: [...HOGAR_REGALOS, cat("c-viajes", "expense", "Viajes")],
    txs: [
      sueldo(1000000),
      novTx({ id: "hogar", categoryId: "c-hogar", amount: Money.of(100000, "CLP") }),
      novTx({ id: "regalo", categoryId: "c-regalos", amount: Money.of(50000, "CLP") }),
    ],
  }))
  assert.equal(view.capsOverspend, 50000)
})

test("ritmo-meta-estable-margen: con topes por encima de los ingresos manda el margen, y un gasto de 20.000 en Hogar no mueve la meta", async () => {
  const mes = (txs: Transaction[]) => viewOf(wdc171Deps({
    cats: HOGAR_REGALOS,
    limits: [limitOf("c-hogar", 2000000)],
    txs: [sueldo(1000000), ...txs],
  }))
  const antes = await mes([])
  assert.equal(antes.spendable.limitedBy, "margin")
  assert.equal(antes.globalPace.budget, 1000000)

  const despues = await mes([novTx({ id: "hoy", categoryId: "c-hogar", amount: Money.of(20000, "CLP") })])
  assert.equal(despues.spendable.limitedBy, "margin")
  assert.equal(despues.spendable.amount, 980000)
  assert.equal(despues.globalPace.daily[NOV_2], 20000)
  assert.equal(despues.globalPace.budget, antes.globalPace.budget)
})
