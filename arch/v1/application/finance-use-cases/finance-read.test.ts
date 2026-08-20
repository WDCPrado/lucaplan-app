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
function budgetDeps(budgets: MonthlyBudget[]) {
  return {
    categories: {
      async listByUser() {
        return CATS
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
