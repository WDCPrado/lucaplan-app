// El tope global sigue al ingreso (WDC-178): igualado o sin definir → sigue; a mano → no se toca;
// solo el período en curso; con déficit previo usa ingreso − déficit.
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

// Sueldo planificado de 1.000.000 desde enero en el modo calendario.
function fixture(budgets: Array<{ year: number; month: number; limit: number }>, txs: Transaction[] = []) {
  const income: Income = { id: "inc1", userId: "u1", accountId: "a1", categoryId: "sueldo", name: "Sueldo",
    currency: "CLP", dayOfMonth: 5, isActive: true, endedYear: null, endedMonth: null }
  const amounts: IncomeAmount[] = [{ incomeId: "inc1", year: 2026, month: 1, amount: Money.of(1_000_000, "CLP") }]
  const stored: Array<MonthlyBudget & { mode: PeriodMode }> = budgets.map((b, i) => ({
    id: `mb${i}`, userId: "u1", year: b.year, month: b.month, globalLimit: Money.of(b.limit, "CLP"), mode: "calendar",
  }))
  const writes: Array<{ mode: PeriodMode; year: number; month: number; limit: number }> = []
  const categories = [
    { id: "sueldo", type: "income" },
    { id: "gasto", type: "expense" },
  ].map((c) => ({ ...c, userId: "u1", name: c.id, icon: null, color: null, description: null, paceEnabled: true }))
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
    monthlyBudgets: {
      async listByUser(_u: string, mode: PeriodMode) { return stored.filter((b) => b.mode === mode) },
      async set(input: { mode: PeriodMode; userId: string; year: number; month: number; globalLimit: Money }) {
        writes.push({ mode: input.mode, year: input.year, month: input.month, limit: input.globalLimit.toMajor() })
        const row = { id: `w${writes.length}`, userId: input.userId, year: input.year, month: input.month, globalLimit: input.globalLimit, mode: input.mode }
        const i = stored.findIndex((b) => b.mode === row.mode && b.year === row.year && b.month === row.month)
        if (i >= 0) stored[i] = row
        else stored.push(row)
        return row
      },
    },
    exchangeRates: { async clpPerUsdAt() { return 950 } },
    budgetPeriod: { async get() { return { mode: "calendar", overrides: {} } } },
  } as unknown as FollowIncomeDeps
  const run = (mutate: () => Promise<unknown>, allModes = true) =>
    followIncome(deps, "u1", mutate, { allModes, today: TODAY })
  const abono = (date: string, amount: number) => async () => { txs.push(tx(`abono-${date}`, date, amount)) }
  return { deps, writes, run, abono, txs }
}

test("tope igualado al ingreso + abono nuevo → el tope sube al nuevo total", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000 }])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_200_000 }])
  assert.deepEqual(seed, { seeded: true, total: 1_200_000 })
})

test("tope heredado de un mes anterior e igualado también sigue (se fija en el período en curso)", async () => {
  const f = fixture([{ year: 2026, month: 8, limit: 1_000_000 }])
  await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_200_000 }])
})

test("tope fijado a mano (distinto del ingreso) → no cambia", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 800_000 }])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [])
  assert.deepEqual(seed, { seeded: false, total: 1_200_000 })
})

test("sin tope → se fija con el total del plan", async () => {
  const f = fixture([])
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_200_000 }])
  assert.equal(seed?.seeded, true)
})

test("el otro modo sin tope no recibe uno", async () => {
  const f = fixture([])
  await f.run(f.abono("2026-10-12", 200_000))
  assert.ok(f.writes.every((w) => w.mode === "calendar"))
})

test("un abono de un período pasado no toca el tope de ese período ni el del curso", async () => {
  const f = fixture([
    { year: 2026, month: 9, limit: 1_000_000 },
    { year: 2026, month: 10, limit: 1_000_000 },
  ])
  // Septiembre gana ingreso; sin gastos su déficit sigue en 0, así que octubre no se mueve.
  await f.run(f.abono("2026-09-10", 300_000))
  assert.deepEqual(f.writes, [])
})

test("con déficit del período anterior usa ingreso − déficit", async () => {
  // Septiembre: 1.000.000 de ingreso y 1.100.000 de gasto → déficit 100.000. Octubre igualado a 900.000.
  const f = fixture(
    [{ year: 2026, month: 10, limit: 900_000 }],
    [tx("gasto-sep", "2026-09-20", 1_100_000, { direction: "debit", categoryId: "gasto" })]
  )
  const { seed } = await f.run(f.abono("2026-10-12", 200_000))
  assert.deepEqual(f.writes, [{ mode: "calendar", year: 2026, month: 10, limit: 1_100_000 }])
  assert.deepEqual(seed, { seeded: true, total: 1_100_000 })
})

test("si ajustar el tope falla, la escritura ya hecha se conserva", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000 }])
  ;(f.deps.monthlyBudgets as { set: unknown }).set = async () => { throw new Error("db caída") }
  const original = console.error
  console.error = () => {}
  try {
    const { result, seed } = await f.run(async () => { await f.abono("2026-10-12", 200_000)(); return "ok" })
    assert.equal(result, "ok")
    assert.equal(seed, null)
    assert.equal(f.txs.length, 1)
  } finally {
    console.error = original
  }
})

test("un error de la escritura se propaga y no se reintenta", async () => {
  const f = fixture([{ year: 2026, month: 10, limit: 1_000_000 }])
  let calls = 0
  await assert.rejects(f.run(async () => { calls++; throw new Error("rechazada") }), /rechazada/)
  assert.equal(calls, 1)
  assert.deepEqual(f.writes, [])
})
