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
  IncomeAmount,
  IncomeRepository,
} from "../../domain/finance/income.domain.ts"
import {
  createIncome,
  generateMonthlyIncome,
  ungenerateMonthlyIncome,
  seedGlobalLimitFromIncomes,
  effectiveIncomeAmount,
  sumActiveIncomesCLP,
  updateIncome,
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
function incomesRepo(
  seed: Income[] = [],
  seedAmounts: IncomeAmount[] = []
): IncomeRepository {
  const store = new Map(seed.map((i) => [i.id, i]))
  const amounts = [...seedAmounts]
  const generated = new Map<string, string>() // `${incomeId}:${year}-${month}` -> txId
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
    hasGeneratedFor: async (id, y, m) => generated.has(key(id, y, m)),
    generateMonthly: async (income, y, m) => {
      const k = key(income.id, y, m)
      const existing = generated.get(k)
      if (existing) return { transactionId: existing, created: false }
      const txId = `tx${generated.size + 1}`
      generated.set(k, txId)
      return { transactionId: txId, created: true }
    },
    ungenerateMonthly: async (id, y, m) => ({
      deleted: generated.delete(key(id, y, m)),
    }),
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
