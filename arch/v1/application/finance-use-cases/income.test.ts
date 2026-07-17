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
import type {
  Income,
  IncomeRepository,
} from "../../domain/finance/income.domain.ts"
import {
  createIncome,
  generateMonthlyIncome,
  seedGlobalLimitFromIncomes,
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
function incomesRepo(seed: Income[] = []): IncomeRepository {
  const store = new Map(seed.map((i) => [i.id, i]))
  const generated = new Map<string, string>() // `${incomeId}:${year}-${month}` -> txId
  let n = 0
  const key = (id: string, y: number, m: number) => `${id}:${y}-${m}`
  return {
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
        amount: input.amount,
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
        isActive: true,
      }
      store.set(income.id, income)
      return income
    },
    update: async (input) => {
      const prev = store.get(input.id)!
      const next: Income = {
        ...prev,
        accountId: input.accountId,
        categoryId: input.categoryId,
        name: input.name,
        amount: input.amount,
        currency: input.amount.currency,
        dayOfMonth: input.dayOfMonth,
        isActive: input.isActive,
      }
      store.set(next.id, next)
      return next
    },
    delete: async (id) => {
      store.delete(id)
    },
    hasGeneratedFor: async (id, y, m) => generated.has(key(id, y, m)),
    generateMonthly: async (income, y, m) => {
      const k = key(income.id, y, m)
      const existing = generated.get(k)
      if (existing) return { transactionId: existing, created: false }
      const txId = `tx${generated.size + 1}`
      generated.set(k, txId)
      return { transactionId: txId, created: true }
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
}

// --- validación ---

test("createIncome crea una fuente válida", async () => {
  const income = await createIncome(baseDeps(), "u1", validInput)
  assert.equal(income.name, "Sueldo")
  assert.equal(income.amount.toMajor(), 900000)
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
