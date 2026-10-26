// Ingresos: validación (cuenta destino no-crédito, categoría income, día, monto), generación mensual
// idempotente y siembra del límite global (solo si no está definido; no pisa lo existente).
// Corre con: node --test arch/v1/application/finance-use-cases/income.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type {
  Account,
  AccountRepository,
  Category,
  CategoryRepository,
  MonthlyBudget,
  MonthlyBudgetRepository,
} from "../../domain/finance/finance.domain.ts"
import {
  isIncomeEndedAt,
  type Income,
  type IncomeAmount,
  type IncomeRepository,
} from "../../domain/finance/income.domain.ts"
import {
  createIncome,
  generateMonthlyIncome,
  ungenerateMonthlyIncome,
  seedGlobalLimitFromIncomes,
  effectiveIncomeAmount,
  sumActiveIncomesCLP,
  updateIncome,
  deleteIncome,
} from "./income-use-cases.ts"

// --- fakes ---

const account = (over: Partial<Account> = {}): Account => ({
  id: "acc1",
  userId: "u1",
  bankId: "b1",
  name: "Cuenta Corriente",
  accountType: "checking",
  currency: "CLP",
  balance: Money.zero("CLP"),
  overdraftLimit: Money.zero("CLP"),
  color: null,
  cardLast4: null,
  provider: "manual",
  externalId: null,
  ...over,
})

const category = (over: Partial<Category> = {}): Category => ({
  id: "cat1",
  userId: "u1",
  name: "Sueldo",
  type: "income",
  paceEnabled: true,
  icon: null,
  color: null,
  description: null,
  ...over,
})

const accountsRepo = (a: Account): AccountRepository =>
  ({
    findById: async (id) => (id === a.id ? a : null),
  }) as AccountRepository

const categoriesRepo = (c: Category): CategoryRepository =>
  ({
    findById: async (id) => (id === c.id ? c : null),
  }) as CategoryRepository

// Repo de ingresos in-memory con generación idempotente por (incomeId, year, month).
function incomesRepo(
  seed: Income[] = [],
  seedAmounts: IncomeAmount[] = []
): IncomeRepository {
  const store = new Map(seed.map((i) => [i.id, i]))
  const amounts = [...seedAmounts]
  // `${incomeId}:${year}-${month}` -> movimiento generado (como el repo real: monto congelado).
  const generated = new Map<string, { txId: string; amount: Money }>()
  let n = 0
  const key = (id: string, y: number, m: number) => `${id}:${y}-${m}`
  // Upsert por (fuente, mes), igual que el repo real: editar un mes no toca los otros.
  const putAmount = (a: IncomeAmount) => {
    const i = amounts.findIndex(
      (x) => x.incomeId === a.incomeId && x.year === a.year && x.month === a.month
    )
    if (i === -1) amounts.push(a)
    else amounts[i] = a
  }
  return {
    listAmountsByUser: async () => amounts,
    listByUser: async (userId) =>
      [...store.values()].filter((i) => i.userId === userId),
    findById: async (id) => store.get(id) ?? null,
    create: async (input) => {
      const income: Income = {
        id: `inc${++n}`,
        userId: input.userId,
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
        isActive: true,
        endedYear: null,
        endedMonth: null,
      }
      store.set(income.id, income)
      putAmount({
        incomeId: income.id,
        year: input.year,
        month: input.month,
        amount: input.amount,
      })
      return income
    },
    update: async (input) => {
      const prev = store.get(input.id)!
      const next: Income = {
        ...prev,
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
        isActive: input.isActive,
      }
      store.set(next.id, next)
      putAmount({
        incomeId: next.id,
        year: input.year,
        month: input.month,
        amount: input.amount,
      })
      return next
    },
    delete: async (id) => {
      store.delete(id)
    },
    endFrom: async (id, year, month) => {
      const prev = store.get(id)!
      store.set(id, { ...prev, endedYear: year, endedMonth: month })
    },
    hasGeneratedFor: async (id, y, m) => generated.has(key(id, y, m)),
    generateMonthly: async (income, y, m) => {
      const k = key(income.id, y, m)
      const existing = generated.get(k)
      if (existing)
        return {
          transactionId: existing.txId,
          created: false,
          amount: existing.amount,
        }
      const txId = `tx${generated.size + 1}`
      const amount =
        effectiveIncomeAmount(amounts, income.id, y, m) ??
        Money.zero(income.currency)
      generated.set(k, { txId, amount })
      return { transactionId: txId, created: true, amount }
    },
    ungenerateMonthly: async (id, y, m) => {
      const entry = generated.get(key(id, y, m))
      if (!entry) return { deleted: false }
      generated.delete(key(id, y, m))
      return {
        deleted: true,
        amount: entry.amount,
        accountId: store.get(id)?.accountId,
      }
    },
  }
}

function budgetsRepo(seed: MonthlyBudget[] = []): MonthlyBudgetRepository {
  const store = [...seed]
  return {
    listByUser: async (userId) => store.filter((b) => b.userId === userId),
    set: async (input) => {
      const row: MonthlyBudget = {
        id: `mb${store.length + 1}`,
        userId: input.userId,
        year: input.year,
        month: input.month,
        globalLimit: input.globalLimit,
      }
      const idx = store.findIndex(
        (b) =>
          b.userId === input.userId &&
          b.year === input.year &&
          b.month === input.month
      )
      if (idx >= 0) store[idx] = row
      else store.push(row)
      return row
    },
  }
}

const baseDeps = (over: Partial<Account> = {}, cat: Category = category()) => ({
  incomes: incomesRepo(),
  accounts: accountsRepo(account(over)),
  categories: categoriesRepo(cat),
})

const validInput = {
  accountId: "acc1",
  categoryId: "cat1",
  name: "Sueldo",
  amount: 900000,
  dayOfMonth: 5,
  year: 2026,
  month: 7,
}

// --- validación ---

test("createIncome crea una fuente válida", async () => {
  const income = await createIncome(baseDeps(), "u1", validInput)
  assert.equal(income.name, "Sueldo")
  assert.equal(income.currency, "CLP")
})

test("createIncome rechaza cuenta de crédito", async () => {
  await assert.rejects(
    createIncome(baseDeps({ accountType: "credit_card" }), "u1", validInput),
    /crédito/
  )
})

test("createIncome rechaza categoría de gasto", async () => {
  await assert.rejects(
    createIncome(baseDeps({}, category({ type: "expense" })), "u1", validInput),
    /ingreso/
  )
})

test("createIncome rechaza día fuera de rango", async () => {
  await assert.rejects(
    createIncome(baseDeps(), "u1", { ...validInput, dayOfMonth: 32 }),
    /día/i
  )
})

test("createIncome rechaza monto <= 0", async () => {
  await assert.rejects(
    createIncome(baseDeps(), "u1", { ...validInput, amount: 0 }),
    /monto/i
  )
})

// --- generación mensual idempotente ---

test("generateMonthlyIncome crea el movimiento y no duplica", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", validInput)

  const first = await generateMonthlyIncome({ incomes: deps.incomes }, "u1", {
    incomeId: income.id,
    year: 2026,
    month: 7,
  })
  assert.equal(first.created, true)

  const second = await generateMonthlyIncome({ incomes: deps.incomes }, "u1", {
    incomeId: income.id,
    year: 2026,
    month: 7,
  })
  assert.equal(second.created, false)
  assert.equal(second.transactionId, first.transactionId)
})

test("ungenerateMonthlyIncome deshace la generación y permite regenerar", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", validInput)
  const period = { incomeId: income.id, year: 2026, month: 7 }

  await generateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  const undo = await ungenerateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  assert.equal(undo.deleted, true)

  // Tras deshacer, ya no hay movimiento: se puede volver a generar (created=true).
  const again = await generateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  assert.equal(again.created, true)

  // Deshacer cuando no hay nada generado: deleted=false.
  await ungenerateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  const noop = await ungenerateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  assert.equal(noop.deleted, false)
})

// --- proyección sobre buckets (cuentas conectadas: el saldo de la tarjeta vive ahí) ---

import type {
  BalanceBucket,
  BalanceBucketRepository,
} from "../../domain/finance/finance.domain.ts"

const clp = (n: number) => Money.of(n, "CLP")

const bucket = (over: Partial<BalanceBucket>): BalanceBucket => ({
  id: "bk1",
  userId: "u1",
  accountId: "acc1",
  cardId: null,
  kind: "cash",
  currency: "CLP",
  limitAmount: clp(0),
  used: clp(0),
  available: clp(0),
  asOf: null,
  ...over,
})

class FakeBuckets implements BalanceBucketRepository {
  updated: { id: string; used: number; available: number }[] = []
  private list: BalanceBucket[]
  constructor(list: BalanceBucket[]) {
    this.list = list
  }
  async listByUser() {
    return this.list
  }
  async listByAccount(accountId: string) {
    return this.list.filter((b) => b.accountId === accountId)
  }
  async updateAmounts(id: string, amounts: { used: Money; available: Money }) {
    this.updated.push({
      id,
      used: amounts.used.toMajor(),
      available: amounts.available.toMajor(),
    })
  }
}

// Cuenta conectada + registro de setBalance (balance derivado = caja disponible).
function connectedDeps(buckets: FakeBuckets, balances: number[]) {
  const a = account({ provider: "bancochile" })
  const accounts = {
    findById: async (id: string) => (id === a.id ? a : null),
    setBalance: async (_id: string, b: Money) => {
      balances.push(b.toMajor())
    },
  } as AccountRepository
  return {
    incomes: incomesRepo(),
    accounts,
    categories: categoriesRepo(category()),
    balanceBuckets: buckets,
  }
}

test("generateMonthlyIncome en cuenta conectada conserva el sobregiro y fija balance = caja", async () => {
  const balances: number[] = []
  const buckets = new FakeBuckets([
    bucket({ id: "cash", kind: "cash", available: clp(0) }),
    bucket({
      id: "od",
      kind: "overdraft",
      limitAmount: clp(1000000),
      used: clp(290967),
      available: clp(709033),
    }),
  ])
  const deps = connectedDeps(buckets, balances)
  const income = await createIncome(deps, "u1", validInput) // 900.000 CLP

  await generateMonthlyIncome(deps, "u1", {
    incomeId: income.id,
    year: 2026,
    month: 7,
  })
  // El ingreso aumenta caja; no constituye un pago de la línea.
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "od"),
    { id: "od", used: 290967, available: 709033 }
  )
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "cash"),
    { id: "cash", used: 0, available: 900000 }
  )
  assert.deepEqual(balances, [900000])
})

test("regenerar un mes ya generado no proyecta el abono dos veces", async () => {
  const balances: number[] = []
  const buckets = new FakeBuckets([bucket({ id: "cash", kind: "cash" })])
  const deps = connectedDeps(buckets, balances)
  const income = await createIncome(deps, "u1", validInput)
  const period = { incomeId: income.id, year: 2026, month: 7 }

  await generateMonthlyIncome(deps, "u1", period)
  const updates = buckets.updated.length
  const second = await generateMonthlyIncome(deps, "u1", period)
  assert.equal(second.created, false)
  assert.equal(buckets.updated.length, updates)
  assert.equal(balances.length, 1)
})

test("ungenerateMonthlyIncome revierte la proyección: la caja baja y conserva la deuda previa", async () => {
  const balances: number[] = []
  // Estado post-generación: caja con el sueldo y deuda previa intacta.
  const buckets = new FakeBuckets([
    bucket({ id: "cash", kind: "cash", available: clp(900000) }),
    bucket({
      id: "od",
      kind: "overdraft",
      limitAmount: clp(1000000),
      used: clp(290967),
      available: clp(709033),
    }),
  ])
  const deps = connectedDeps(buckets, balances)
  const income = await createIncome(deps, "u1", validInput)
  const period = { incomeId: income.id, year: 2026, month: 7 }

  // Generar sin proyectar (deps mínimos) para aislar la reversión sobre el estado sembrado.
  await generateMonthlyIncome({ incomes: deps.incomes }, "u1", period)
  const undo = await ungenerateMonthlyIncome(deps, "u1", period)
  assert.equal(undo.deleted, true)
  // Deshacer el ingreso consume la caja y conserva el sobregiro previo.
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "cash"),
    { id: "cash", used: 0, available: 0 }
  )
  assert.deepEqual(
    buckets.updated.find((u) => u.id === "od"),
    { id: "od", used: 290967, available: 709033 }
  )
  assert.deepEqual(balances, [0])
})

// --- siembra del límite global ---

test("seed siembra el límite global cuando no está definido", async () => {
  const deps = baseDeps()
  await createIncome(deps, "u1", validInput) // 900.000
  await createIncome(deps, "u1", { ...validInput, name: "Arriendo", amount: 300000 })

  const budgets = budgetsRepo()
  const res = await seedGlobalLimitFromIncomes(
    { incomes: deps.incomes, monthlyBudgets: budgets },
    "u1",
    { year: 2026, month: 7 }
  )
  assert.equal(res.seeded, true)
  assert.equal(res.total, 1200000)
  const stored = await budgets.listByUser("u1")
  assert.equal(stored[0].globalLimit.toMajor(), 1200000)
})

test("seed NO pisa un límite global ya definido", async () => {
  const deps = baseDeps()
  await createIncome(deps, "u1", validInput) // 900.000
  const budgets = budgetsRepo([
    {
      id: "mb0",
      userId: "u1",
      year: 2026,
      month: 7,
      globalLimit: Money.of(700000, "CLP"),
    },
  ])
  const res = await seedGlobalLimitFromIncomes(
    { incomes: deps.incomes, monthlyBudgets: budgets },
    "u1",
    { year: 2026, month: 7 }
  )
  assert.equal(res.seeded, false)
  assert.equal(res.alreadyDefined, true)
  assert.equal(res.total, 900000) // total sugerido para la UI
  const stored = await budgets.listByUser("u1")
  assert.equal(stored[0].globalLimit.toMajor(), 700000) // intacto
})

// --- monto por mes con carry-forward (WDC-30) ---
// El monto de una fuente vive por mes, igual que el límite de una categoría: editar agosto no
// reescribe julio, y una fuente creada en agosto no existe en julio.

test("editar el ingreso de un mes no cambia los meses anteriores", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })

  await updateIncome(deps, "u1", {
    ...validInput,
    id: income.id,
    amount: 1_200_000,
    isActive: true,
    year: 2026,
    month: 8,
  })

  const amounts = await deps.incomes.listAmountsByUser("u1")
  assert.equal(
    effectiveIncomeAmount(amounts, income.id, 2026, 7)?.toMajor(),
    900_000
  )
  assert.equal(
    effectiveIncomeAmount(amounts, income.id, 2026, 8)?.toMajor(),
    1_200_000
  )
})

test("un mes sin registro hereda el último previo (carry-forward)", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })
  const amounts = await deps.incomes.listAmountsByUser("u1")
  assert.equal(
    effectiveIncomeAmount(amounts, income.id, 2026, 11)?.toMajor(),
    900_000
  )
})

test("antes del primer registro la fuente no existía", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })
  const amounts = await deps.incomes.listAmountsByUser("u1")
  assert.equal(effectiveIncomeAmount(amounts, income.id, 2026, 6), null)
})

test("la siembra del presupuesto usa el monto vigente de ese mes", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })
  await updateIncome(deps, "u1", {
    ...validInput,
    id: income.id,
    amount: 1_200_000,
    isActive: true,
    year: 2026,
    month: 8,
  })

  assert.equal((await sumActiveIncomesCLP(deps, "u1", 2026, 7)).toMajor(), 900_000)
  assert.equal((await sumActiveIncomesCLP(deps, "u1", 2026, 8)).toMajor(), 1_200_000)
  assert.equal((await sumActiveIncomesCLP(deps, "u1", 2026, 6)).toMajor(), 0)
})

// --- eliminar conserva la historia (WDC-30) ---

test("eliminar desde un mes posterior conserva los meses anteriores", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })

  const out = await deleteIncome(deps, "u1", income.id, { year: 2026, month: 9 })

  assert.equal(out.ended, true)
  const still = await deps.incomes.findById(income.id)
  assert.ok(still, "la fuente se conserva para la historia")
  assert.equal(isIncomeEndedAt(still, 2026, 8), false) // agosto seguía vigente
  assert.equal(isIncomeEndedAt(still, 2026, 9), true) // desde septiembre ya no
  assert.equal(isIncomeEndedAt(still, 2026, 10), true)
  const amounts = await deps.incomes.listAmountsByUser("u1")
  assert.equal(
    effectiveIncomeAmount(amounts, income.id, 2026, 7)?.toMajor(),
    900_000
  )
})

test("eliminar en el mismo mes en que se creó la borra de verdad", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })

  const out = await deleteIncome(deps, "u1", income.id, { year: 2026, month: 7 })

  assert.equal(out.ended, false)
  assert.equal(await deps.incomes.findById(income.id), null)
})

test("una fuente terminada deja de sumar en el presupuesto desde su mes de fin", async () => {
  const deps = baseDeps()
  const income = await createIncome(deps, "u1", { ...validInput, year: 2026, month: 7 })
  await deleteIncome(deps, "u1", income.id, { year: 2026, month: 9 })

  assert.equal((await sumActiveIncomesCLP(deps, "u1", 2026, 8)).toMajor(), 900_000)
  assert.equal((await sumActiveIncomesCLP(deps, "u1", 2026, 9)).toMajor(), 0)
})

