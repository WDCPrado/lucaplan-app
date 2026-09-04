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
} from "./finance-read.ts"

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
      return rows.slice(0, filters.limit)
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
// entren al gasto del mes, que las de gasto sin tope sí entren al gasto pero no al excedente de
// topes, y que los internos no cuenten en ninguna de las dos. Un cambio en cualquiera de esas
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
  // Gasto del mes = Σ usado de las categorías de GASTO (130.000 + 20.000 + 200.000). El sueldo
  // queda fuera: si entrara, el excedente del mes se dispararía.
  assert.equal(view.monthOverspend, 50000) // 350.000 − 300.000
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
// La fórmula (`computeMonthOverspend`) ya se prueba en finance.test.ts, y el excedente del mes con
// su cableado en los tests de arriba. Lo que se fija acá es que la deuda salga del mes ANTERIOR y
// no del que está en pantalla, que enero mire a diciembre del año pasado, y que siga siendo el
// excedente del MES —gasto contra presupuesto global— sin que los ingresos participen.

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

// `listByUserPeriod` respeta (year, month) a propósito: si el cableado pidiera el mes equivocado,
// unos deps que devuelven siempre lo mismo lo taparían.
function debtDeps(budgets: MonthlyBudget[]) {
  return {
    categories: {
      async listByUser() {
        return DEBT_CATS
      },
      async listLimitsByUser() {
        return [] // sin topes por categoría: acá solo se mide contra el presupuesto global
      },
    },
    transactions: {
      async listByUserPeriod(_userId: string, year: number, month: number) {
        return DEBT_TXS[`${year}-${month}`] ?? []
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

test("getPreviousMonthDebt: el mes anterior excedido deja su exceso como deuda", async () => {
  const debt = await getPreviousMonthDebt(
    debtDeps([monthBudget(2026, 7, 950000), monthBudget(2026, 8, 1000000)]),
    "u1",
    2026,
    8
  )
  // Julio gastó 1.100.000 de 950.000. El sueldo de 1.350.000 no entra: si se sumara al gasto la
  // deuda sería 1.500.000, y si se restara del gasto sería 0.
  assert.equal(debt, 150000)
})

test("getPreviousMonthDebt: el mes anterior dentro de su presupuesto no debe nada", async () => {
  const debt = await getPreviousMonthDebt(
    debtDeps([monthBudget(2026, 7, 1500000), monthBudget(2026, 8, 1000000)]),
    "u1",
    2026,
    8
  )
  assert.equal(debt, 0)
})

test("getPreviousMonthDebt: sin presupuesto en el mes anterior no hay de qué pasarse", async () => {
  // Solo agosto tiene presupuesto: julio no lo hereda (el carry-forward mira hacia atrás, no hacia
  // adelante), así que sus 1.100.000 de gasto no generan deuda.
  const debt = await getPreviousMonthDebt(
    debtDeps([monthBudget(2026, 8, 1000000)]),
    "u1",
    2026,
    8
  )
  assert.equal(debt, 0)
})

test("getPreviousMonthDebt: la deuda es del mes anterior, no del que se está mirando", async () => {
  const budgets = [monthBudget(2026, 7, 1500000), monthBudget(2026, 8, 50000)]
  // Agosto sí está excedido (100.000 de 50.000)…
  const agosto = await getBudgetView(debtDeps(budgets), "u1", 2026, 8)
  assert.equal(agosto.monthOverspend, 50000)
  // …pero la deuda que hereda mira a julio, que cerró holgado.
  assert.equal(await getPreviousMonthDebt(debtDeps(budgets), "u1", 2026, 8), 0)
})

test("getPreviousMonthDebt: en enero el mes anterior es diciembre del año pasado", async () => {
  const debt = await getPreviousMonthDebt(
    debtDeps([monthBudget(2025, 12, 600000)]),
    "u1",
    2026,
    1
  )
  assert.equal(debt, 200000) // 800.000 − 600.000 de diciembre 2025
})

// El ritmo reparte el tope del mes entre los días o las semanas que quedan. Hay categorías donde
// ese reparto no describe nada —una suscripción se cobra un día y listo—, y ahí se apaga.
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
    { frequency: "weekly", today: { year: 2026, month: 8, day: 15 } }
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
    today: { year: 2026, month: 8, day: 15 },
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
    { frequency: "weekly", today: { year: 2026, month: 8, day: 15 } }
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
    { frequency: "weekly", today: { year: 2026, month: 8, day: 15 } }
  )

  // c-super primero: es la de la transacción más reciente del mes.
  assert.deepEqual(
    view.categories.map((c) => c.id),
    ["c-super", "c-comida"]
  )
})
