// El tope global sigue al ingreso (WDC-178): con la marca `followsIncome` (o sin tope) sigue al
// total del plan; sin la marca no se toca; solo el período en curso; con déficit usa ingreso − déficit.
// Corre con: node --test arch/v1/application/finance-use-cases/follow-income.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../domain/finance/money.ts"
import type { MonthlyBudget, Transaction } from "../../domain/finance/finance.domain.ts"
import type { Income, IncomeAmount } from "../../domain/finance/income.domain.ts"
import type { PeriodMode } from "../../../shared/billing-cycle.ts"
import { followIncome, type FollowIncomeDeps } from "./follow-income.ts"

const TODAY = "2026-10-15" // calendario: período en curso = octubre 2026

const tx = (id: string, date: string, amount: number, over: Partial<Transaction> = {}): Transaction => ({
  id, userId: "u1", accountId: "a1", categoryId: "sueldo", date: new Date(`${date}T00:00:00Z`),
  description: id, amount: Money.of(amount, "CLP"), direction: "credit", status: "confirmed",
  isInternal: false, externalId: null, ...over,
})

type Row = MonthlyBudget & { mode: PeriodMode }
type Seed = { year: number; month: number; limit: number; follows: boolean; mode?: PeriodMode }

// Sueldo planificado de 1.000.000 desde enero en el modo calendario.
function fixture(budgets: Seed[], txs: Transaction[] = []) {
  const income: Income = { id: "inc1", userId: "u1", accountId: "a1", categoryId: "sueldo", name: "Sueldo",
    currency: "CLP", dayOfMonth: 5, isActive: true, endedYear: null, endedMonth: null }
  const amounts: IncomeAmount[] = [{ incomeId: "inc1", year: 2026, month: 1, amount: Money.of(1_000_000, "CLP") }]
  const stored: Row[] = budgets.map((b, i) => ({
    id: `mb${i}`, userId: "u1", year: b.year, month: b.month, globalLimit: Money.of(b.limit, "CLP"),
    followsIncome: b.follows, mode: b.mode ?? "calendar",
  }))
  const writes: Array<{ mode: PeriodMode; year: number; month: number; limit: number }> = []
  const find = (mode: PeriodMode, year: number, month: number) =>
    stored.findIndex((b) => b.mode === mode && b.year === year && b.month === month)
  const categories = [
    { id: "sueldo", type: "income" },
    { id: "gasto", type: "expense" },
  ].map((c) => ({ ...c, userId: "u1", name: c.id, icon: null, color: null, description: null, paceEnabled: true }))
  const monthlyBudgets = {
    async listByUser(_u: string, mode: PeriodMode): Promise<Row[]> {
      return stored.filter((b) => b.mode === mode).map((b) => ({ ...b }))
    },
    async set() { throw new Error("el seguimiento no escribe con set") },
    // Igual que el repo real: nunca pisa una fila sin la marca.
    async setFollowingIncome(input: { mode: PeriodMode; userId: string; year: number; month: number; globalLimit: Money }) {
      const i = find(input.mode, input.year, input.month)
      if (i >= 0 && !stored[i].followsIncome) return false
      const row: Row = { id: `w${writes.length}`, userId: input.userId, year: input.year, month: input.month,
        globalLimit: input.globalLimit, followsIncome: true, mode: input.mode }
      if (i >= 0) stored[i] = row
      else stored.push(row)
      writes.push({ mode: input.mode, year: input.year, month: input.month, limit: input.globalLimit.toMajor() })
      return true
    },
  }
  const deps = {
    accounts: { async listByUser() { return [] } },
    categories: { async listByUser() { return categories }, async listLimitsByUser() { return [] } },
    transactions: {
      async listByUserPeriod(_u: string, range: { start: string; end: string }) {
        return txs.filter((t) => { const d = t.date.toISOString().slice(0, 10); return d >= range.start && d <= range.end })
      },
    },
    incomes: {
      async listByUser(_u: string, mode: PeriodMode) { return mode === "calendar" ? [income] : [] },
      async listAmountsByUser(_u: string, mode: PeriodMode) { return mode === "calendar" ? amounts : [] },
    },
    monthlyBudgets,
    exchangeRates: { async clpPerUsdAt() { return 950 } },
    budgetPeriod: { async get() { return { mode: "calendar", overrides: {} } } },
  } as unknown as FollowIncomeDeps
  const run = (mutate: () => Promise<unknown>, allModes = true) =>
    followIncome(deps, "u1", mutate, { allModes, today: TODAY })
  const add = (t: Transaction) => async () => { txs.push(t) }
  const abono = (date: string, amount: number) => add(tx(`abono-${date}-${amount}`, date, amount))
  const row = (year: number, month: number, mode: PeriodMode = "calendar") => stored[find(mode, year, month)]
  return { writes, run, add, abono, row, stored, monthlyBudgets }
}

test("tope con la marca + abono nuevo → sigue al nuevo total", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000, follows: true }])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_200_000 }])
  assert.deepEqual(seed, { seeded: true, total: 1_200_000 })
})

test("tope con la marca heredado de un mes anterior, aunque no calce con el total de este mes, sigue", async () => {
  // Agosto se igualó a 900.000; octubre ya tenía un extra de 150.000, así que su total era otro.
  const f = fixture([{ year: 2026, month: 8, limit: 900_000, follows: true }], [tx("extra", "2026-10-02", 150_000)])
  await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_350_000 }])
  assert.equal(f.row(2026, 8).globalLimit.toMajor(), 900_000) // el mes pasado no cambia
})

test("tope sin la marca (fijado a mano) → no se toca", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000, follows: false }])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [])
  assert.deepEqual(seed, { seeded: false, total: 1_000_000 })
})

test("sin tope → se fija con el total del plan y queda con la marca", async () => {
  const f = fixture([])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_200_000 }])
  assert.equal(f.row(2026, 10).followsIncome, true)
  assert.equal(seed?.seeded, true)
})

test("el total baja a 0 con la marca → escribe 0, y después vuelve a seguir", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000, follows: true }])
  // Gasto de 2.500.000 en septiembre: el déficit de 1.500.000 se come el ingreso de octubre.
  await f.run(f.add(tx("gasto-sep", "2026-09-20", 2_500_000, { direction: "debit", categoryId: "gasto" })))
  assert.equal(f.row(2026, 10).globalLimit.toMajor(), 0)
  await f.run(f.abono("2026-10-12", 2_000_000))
  assert.equal(f.row(2026, 10).globalLimit.toMajor(), 1_500_000)
  assert.deepEqual(f.writes.map((w) => w.limit), [0, 1_500_000])
})

test("un tope a mano que llega entre la lectura y la escritura no se pisa", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000, follows: true }])
  const list = f.monthlyBudgets.listByUser
  f.monthlyBudgets.listByUser = async (u, mode) => {
    const snapshot = await list(u, mode)
    // Otra pestaña guarda 777.000 a mano justo después de que el seguimiento leyó.
    const i = f.stored.findIndex((b) => b.mode === mode && b.year === 2026 && b.month === 10)
    if (i >= 0) f.stored[i] = { ...f.stored[i], globalLimit: Money.of(777_000, "CLP"), followsIncome: false }
    return snapshot
  }
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.equal(f.row(2026, 10).globalLimit.toMajor(), 777_000)
  assert.equal(f.row(2026, 10).followsIncome, false)
  assert.equal(seed?.seeded, false)
})

test("un abono de un período pasado no toca el tope de ese período ni el del curso", async () => {
  const f = fixture([
    { year: 2026, month: 9, limit: 1_000_000, follows: true },
    { year: 2026, month: 10, limit: 1_000_000, follows: true },
  ])
  // Septiembre gana ingreso; sin gastos su déficit sigue en 0, así que octubre no se mueve.
  await f.run(f.abono("2026-09-10", 300_000))
  assert.deepEqual(f.writes, [])
})

test("con déficit del período anterior usa ingreso − déficit", async () => {
  // Septiembre: 1.000.000 de ingreso y 1.100.000 de gasto → déficit 100.000.
  const f = fixture(
    [{ year: 2026, month: 10, limit: 900_000, follows: true }],
    [tx("gasto-sep", "2026-09-20", 1_100_000, { direction: "debit", categoryId: "gasto" })]
  )
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_100_000 }])
  assert.deepEqual(seed, { seeded: true, total: 1_100_000 })
})

test("el otro modo sin tope no recibe uno", async () => {
  const f = fixture([])
  await f.run(f.abono("2026-10-12", 200_000))
  assert.ok(f.writes.every((w) => w.mode === "calendar"))
})

test("si el otro modo falla, el resultado del modo de la vista se devuelve igual", async () => {
  const f = fixture([
    { year: 2026, month: 10, limit: 1_000_000, follows: true },
    { year: 2026, month: 1, limit: 5, follows: true, mode: "card_cycle" },
  ])
  const list = f.monthlyBudgets.listByUser
  f.monthlyBudgets.listByUser = async (u, mode) => {
    if (mode === "card_cycle") throw new Error("db caída")
    return list(u, mode)
  }
  const original = console.error
  console.error = () => {}
  try {
    const { seed } = await f.run(f.abono("2026-10-12", 200_000))
    assert.deepEqual(seed, { seeded: true, total: 1_200_000 })
  } finally {
    console.error = original
  }
})

test("un error de la escritura se propaga y no se sigue", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000, follows: true }])
  let calls = 0
  await assert.rejects(f.run(async () => { calls++; throw new Error("rechazada") }), /rechazada/)
  assert.equal(calls, 1)
  assert.deepEqual(f.writes, [])
})
