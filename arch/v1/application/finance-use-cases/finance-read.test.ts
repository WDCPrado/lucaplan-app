// Lectura de sin categoría para el triage: filtro delegado al repo y "hay más" vía limit+1.
// Corre con: node --test arch/v1/application/finance-use-cases/finance-read.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Transaction,
  TransactionRepository,
  TransactionSearchFilters,
} from "../../domain/finance/finance.domain.ts"
import { listUncategorized, searchTransactions } from "./finance-read.ts"

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
      exchangeRates: { async clpPerUsdAt() { return 950 } },
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
