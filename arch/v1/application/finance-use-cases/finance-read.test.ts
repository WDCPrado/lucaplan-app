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
  getPreviousMonthDebt,
  listUncategorized,
  searchTransactions,
  searchTransactionsPage,
} from "./finance-read.ts"
import { inRange } from "./budget-formulas.ts"
import { scopeBudgetPeriod } from "./budget-period-use-cases.ts"
import { planTotal, shouldSuggest } from "../../../../lib/plan-total.ts"
import type { PeriodMode, PeriodRange } from "../../../shared/billing-cycle.ts"

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

test("getBudgetView: el excedente de topes suma lo confirmado sobre el tope y nada más", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(300000)),
    "u1",
    2026,
    8
  )
  // Solo Supermercado se pasó: 130.000 de 100.000. Ni el pending de 40.000, ni el interno de
  // 500.000, ni los 200.000 de la categoría sin tope, ni el sueldo.
  assert.equal(view.capsOverspend, 30000)
  // Solo las categorías de gasto CON presupuesto: 130.000 + 20.000.
  assert.equal(view.spent, 150000)
  assert.equal(view.committed, 40000)
  assert.equal(view.monthOverspend, 0)
})

test("getBudgetView: pasarse del presupuesto global cuenta todo el gasto incluido", async () => {
  const view = await getBudgetView(
    budgetDeps(globalBudget(100000)), "u1", 2026, 8
  )
  assert.equal(view.spent, 150000)
  assert.equal(view.monthOverspend, 50000)
  assert.equal(view.capsOverspend, 30000)
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
  assert.equal(view.capsOverspend, 30000)
  assert.equal(view.monthOverspend, 0) // el mes todavía alcanza: son dos cifras independientes
})

test("getBudgetView: sin presupuesto del mes el excedente del mes es 0, no el gasto entero", async () => {
  const view = await getBudgetView(budgetDeps([]), "u1", 2026, 8)
  assert.equal(view.globalLimit, null)
  assert.equal(view.capsOverspend, 30000)
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
    assert.equal(view.income, 3182394)
    assert.equal(view.spent, 2832794)
    assert.equal(view.income - view.spent, 349600)
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
  { name: "sin tope", planned: 40000, active: true, category: "c-transfer", incomeId: "refund", expected: 0 },
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
    assert.equal(result.spent, scenario.category === "c-super" ? 20000 : 0)
    assert.equal(result.reimbursementAdjustment, scenario.expected)
    deps.monthlyBudgets.listByUser = async () => [monthBudget(2026, 8, 10000)]
    assert.equal(await getPreviousMonthDebt(deps, "u1", 2026, 9), scenario.category === "c-super" ? 20000 : 0,
      "el reembolso compensa una sola vez: no es ingreso libre además de reducir el gasto")
    assert.equal(rows[0].amount.toMajor(), 60000, "no altera el movimiento bancario")
    rows[1].date = new Date("2026-09-01")
    assert.equal((await getBudgetView(deps, "u1", 2026, 8)).reimbursementAdjustment, 0, "otro ciclo no cuenta dos veces")
  })
}

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
