// Cuenta las lecturas a repositorio que emite UNA carga del dashboard. Cada método de estos repos
// es exactamente una consulta a la base (un findMany/aggregate en los adapters de Prisma), así que
// contar llamadas es contar consultas.
// Corre con: node --test arch/v1/presentation/finance/dashboard-reads.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  Bank,
  Category,
  CategoryLimit,
  MonthlyBudget,
  Transaction,
} from "../../domain/finance/finance.domain.ts"
import type {
  Income,
  IncomeAmount,
} from "../../domain/finance/income.domain.ts"
import { memoizeReads } from "./request-memo.ts"
import {
  getBudgetView,
  getMonthlySummary,
  getPreviousMonthDebt,
  listAccounts,
  listTransactions,
  listUncategorized,
  listIncomesView,
  getAmountBounds,
} from "../../application/finance-use-cases/finance-read.ts"

const USER = "u1"
const YEAR = 2026
const MONTH = 8

const bank: Bank = {
  id: "b1",
  userId: USER,
  name: "Banco",
  isActive: true,
  provider: "manual",
  connectionMethod: null,
  lastSyncedAt: null,
}

const account: Account = {
  id: "a1",
  userId: USER,
  bankId: "b1",
  name: "Corriente",
  accountType: "checking",
  currency: "CLP",
  balance: Money.of(500000, "CLP"),
  overdraftLimit: Money.of(0, "CLP"),
  color: null,
  cardLast4: null,
  provider: "manual",
  externalId: null,
}

const categories: Category[] = [
  {
    id: "c-super",
    userId: USER,
    name: "Supermercado",
    type: "expense",
    icon: null,
    color: null,
    description: null,
  },
  {
    id: "c-sueldo",
    userId: USER,
    name: "Sueldo",
    type: "income",
    icon: null,
    color: null,
    description: null,
  },
]

const limits: CategoryLimit[] = [
  {
    id: "l1",
    categoryId: "c-super",
    year: YEAR,
    month: MONTH,
    limit: Money.of(100000, "CLP"),
  },
]

const budgets: MonthlyBudget[] = [
  {
    id: "mb1",
    userId: USER,
    year: YEAR,
    month: MONTH,
    globalLimit: Money.of(300000, "CLP"),
  },
]

const tx = (id: string, day: number): Transaction => ({
  id,
  userId: USER,
  accountId: "a1",
  categoryId: "c-super",
  date: new Date(Date.UTC(YEAR, MONTH - 1, day)),
  description: `mov ${id}`,
  amount: Money.of(30000, "CLP"),
  direction: "debit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
})

const incomes: Income[] = [
  {
    id: "i1",
    userId: USER,
    accountId: "a1",
    categoryId: "c-sueldo",
    name: "Sueldo",
    currency: "CLP",
    dayOfMonth: 5,
    isActive: true,
    endedYear: null,
    endedMonth: null,
  },
]

const incomeAmounts: IncomeAmount[] = [
  { incomeId: "i1", year: YEAR, month: 1, amount: Money.of(1400000, "CLP") },
]

// Repos falsos con la forma justa que usa la carga del dashboard. Cada método registra su llamada
// con los argumentos: dos llamadas idénticas son la MISMA consulta repetida.
function makeDeps() {
  const calls: string[] = []
  const log =
    <A extends unknown[], R>(key: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      calls.push(`${key}(${JSON.stringify(args)})`)
      return fn(...args)
    }

  const deps = {
    accounts: {
      listByUser: log("accounts.listByUser", async () => [account]),
    },
    banks: {
      listByUser: log("banks.listByUser", async () => [bank]),
    },
    balanceBuckets: {
      listByUser: log("balanceBuckets.listByUser", async () => []),
    },
    categories: {
      listByUser: log("categories.listByUser", async () => categories),
      listLimitsByUser: log("categories.listLimitsByUser", async () => limits),
    },
    monthlyBudgets: {
      listByUser: log("monthlyBudgets.listByUser", async () => budgets),
    },
    transactions: {
      listByUserPeriod: log(
        "transactions.listByUserPeriod",
        async (_u: string, year: number, month: number) =>
          year === YEAR && month === MONTH ? [tx("t1", 10), tx("t2", 20)] : []
      ),
      searchByUser: log("transactions.searchByUser", async () => []),
      amountBounds: log("transactions.amountBounds", async () => ({
        min: 0,
        max: 100000,
      })),
    },
    incomes: {
      listByUser: log("incomes.listByUser", async () => incomes),
      listAmountsByUser: log(
        "incomes.listAmountsByUser",
        async () => incomeAmounts
      ),
      hasGeneratedFor: log("incomes.hasGeneratedFor", async () => false),
    },
    installments: {
      listByUser: log("installments.listByUser", async () => []),
    },
    recurring: {
      listByUser: log("recurring.listByUser", async () => []),
    },
    exchangeRates: {
      async clpPerUsdAt(): Promise<never> {
        throw new Error("no usado: todo el fixture es CLP")
      },
    },
  }
  return { deps, calls }
}

// La misma secuencia de lecturas que hace app/dashboard/page.tsx.
async function loadDashboard(deps: unknown) {
  const d = deps as Parameters<typeof getBudgetView>[0]
  const [
    summary,
    accounts,
    budget,
    transactions,
    uncategorized,
    incomesView,
    amountBounds,
    previousMonthDebt,
  ] = await Promise.all([
    getMonthlySummary(d, USER, YEAR, MONTH),
    listAccounts(d as unknown as Parameters<typeof listAccounts>[0], USER),
    getBudgetView(d, USER, YEAR, MONTH),
    listTransactions(d, USER, YEAR, MONTH),
    listUncategorized(
      d as unknown as Parameters<typeof listUncategorized>[0],
      USER,
      YEAR,
      MONTH
    ),
    listIncomesView(
      d as unknown as Parameters<typeof listIncomesView>[0],
      USER,
      YEAR,
      MONTH
    ),
    getAmountBounds(d, USER),
    getPreviousMonthDebt(d, USER, YEAR, MONTH),
  ])
  return {
    summary,
    accounts,
    budget,
    transactions,
    uncategorized,
    incomesView,
    amountBounds,
    previousMonthDebt,
  }
}

const conMemo = () => {
  const store = new Map<string, Promise<unknown>>()
  return () => store
}

const distintas = (calls: string[]) => [...new Set(calls)].sort()

test("la carga del dashboard repite consultas idénticas y la memoización las deja en una sola", async () => {
  const sin = makeDeps()
  await loadDashboard(sin.deps)
  const con = makeDeps()
  await loadDashboard(memoizeReads(con.deps, conMemo()))

  // Se piden exactamente las mismas consultas: la memoización no se salta ninguna, solo evita
  // repetirlas. Sin esta comparación, "menos consultas" también podría significar "leyó de menos".
  assert.deepEqual(distintas(con.calls), distintas(sin.calls))
  // Con memoización, cada consulta distinta se emite una única vez.
  assert.equal(con.calls.length, distintas(con.calls).length)
  // Y sin ella se emiten bastantes más: es la repetición que esta tarjeta viene a sacar.
  assert.ok(
    sin.calls.length > con.calls.length,
    `el fixture ya no reproduce la repetición (sin memo ${sin.calls.length}, con memo ${con.calls.length})`
  )
  if (process.env.PRINT_READS)
    console.log(
      `lecturas — sin memo: ${sin.calls.length} · con memo: ${con.calls.length}`
    )
})

test("memoizar no cambia ninguna cifra del dashboard", async () => {
  const sin = await loadDashboard(makeDeps().deps)
  const con = await loadDashboard(memoizeReads(makeDeps().deps, conMemo()))
  assert.deepEqual(con, sin)
})
