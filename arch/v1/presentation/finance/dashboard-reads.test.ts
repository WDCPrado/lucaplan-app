// Cuenta las LLAMADAS A REPOSITORIO que emite UNA carga del dashboard, y comprueba el contrato del
// ámbito de memoización.
//
// No son consultas SQL y no se reportan como tales: la mayoría de estos métodos es un findMany o un
// aggregate, pero los que usan `include` (planes de cuotas, ingresos) pueden emitir una consulta
// extra con la estrategia por defecto de Prisma, y el fixture deja fuera `materializeUserPeriods` y
// `getPaceFrequency`, que en una carga real también van a la base. La dirección y la proporción se
// sostienen; la equivalencia una-a-una no.
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
import { cache } from "react"

import {
  memoizeReads,
  type MemoizedPorts,
  type MemoStore,
} from "./request-memo.ts"
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

// Las deps del fixture traen solo los métodos que la carga usa, no los puertos completos: el tipo
// se fuerza una vez acá en vez de escribir cuarenta stubs que nadie llama. Si a alguno le faltara
// un método de la tabla, `memoizeReads` revienta — que es justo lo que queremos que pase.
const memoizado = (deps: object, scope: () => MemoStore): MemoizedPorts =>
  memoizeReads(deps as unknown as MemoizedPorts, scope)

// Un ámbito compartido, como el de un render.
const unAmbito = () => {
  const store: MemoStore = new Map()
  return () => store
}

// Un ámbito nuevo por llamada: el modo degradado, que es como se comporta `cache` de React fuera de
// un render de servidor.
const sinAmbito = () => (): MemoStore => new Map()

const distintas = (calls: string[]) => [...new Set(calls)].sort()

test("la carga del dashboard repite lecturas idénticas y la memoización las deja en una sola", async () => {
  const sin = makeDeps()
  await loadDashboard(sin.deps)
  const con = makeDeps()
  await loadDashboard(memoizado(con.deps, unAmbito()))

  // Se piden exactamente las mismas lecturas: la memoización no se salta ninguna, solo evita
  // repetirlas. Sin esta comparación, "menos lecturas" también podría significar "leyó de menos".
  assert.deepEqual(distintas(con.calls), distintas(sin.calls))
  // Con memoización, cada lectura distinta se emite una única vez.
  assert.equal(con.calls.length, distintas(con.calls).length)
  // Y sin ella se emiten bastantes más: es la repetición que esta tarjeta viene a sacar.
  assert.ok(
    sin.calls.length > con.calls.length,
    `el fixture ya no reproduce la repetición (sin memo ${sin.calls.length}, con memo ${con.calls.length})`
  )
  if (process.env.PRINT_READS)
    console.log(
      `llamadas a repositorio — sin memo: ${sin.calls.length} · con memo: ${con.calls.length}`
    )
})

test("memoizar no cambia ninguna cifra del dashboard", async () => {
  const sin = await loadDashboard(makeDeps().deps)
  const con = await loadDashboard(memoizado(makeDeps().deps, unAmbito()))
  assert.deepEqual(con, sin)
})

// --- El ámbito: es donde vive el riesgo, porque de él depende que dos lecturas se compartan ---

test("con un ámbito nuevo por llamada no memoiza nada: el modo degradado sigue funcionando", async () => {
  const crudo = makeDeps()
  await loadDashboard(crudo.deps)
  const degradado = makeDeps()
  await loadDashboard(memoizado(degradado.deps, sinAmbito()))
  // Mismas lecturas y las mismas veces que sin envolver nada. Es lo que corre en cualquier contexto
  // donde `cache` de React no tiene ámbito, y tiene que comportarse como antes de esta tarjeta.
  assert.deepEqual(degradado.calls, crudo.calls)
})

test("dos ámbitos distintos no se cruzan las claves", async () => {
  const { deps, calls } = makeDeps()
  const primero = memoizado(deps, unAmbito())
  const segundo = memoizado(deps, unAmbito())

  // La misma lectura, con los mismos argumentos, en dos ámbitos: dos llamadas de verdad.
  await primero.categories.listByUser("u1")
  await primero.categories.listByUser("u1")
  await segundo.categories.listByUser("u1")

  assert.deepEqual(calls, [
    'categories.listByUser(["u1"])',
    'categories.listByUser(["u1"])',
  ])
})

test("un rechazo no se queda pegado al ámbito: el siguiente lector reintenta", async () => {
  let intentos = 0
  const deps = {
    ...makeDeps().deps,
    categories: {
      listByUser: async () => {
        intentos++
        if (intentos === 1) throw new Error("caída transitoria")
        return categories
      },
      listLimitsByUser: async () => limits,
    },
  }
  const memo = memoizado(deps, unAmbito())

  // Quien lee primero se come el fallo con su propio catch, como hace el dashboard con
  // `getPreviousMonthDebt`...
  await assert.rejects(() => memo.categories.listByUser("u1"))
  // ...y no se lo impone al siguiente, que no tiene catch y antes de esta tarjeta habría ido solo.
  assert.deepEqual(await memo.categories.listByUser("u1"), categories)
  assert.equal(intentos, 2)
})

test("fuera de un render, `cache` de React entrega un almacén nuevo en cada llamada", () => {
  // Es la red de seguridad de la que depende `requestStore` en finance-http.ts, y la razón por la
  // que memoizar no puede filtrar datos entre requests ni entre usuarios. Se afirma contra el React
  // real, no contra una suposición.
  const store = cache((): MemoStore => new Map())
  assert.notEqual(store(), store())
})
