// WDC-183 · Ingreso del plan (3.5): suma de abonos `income` confirmados, no internos, del período y
// por moneda; y cambiarTipoAbono (ingreso ↔ reembolso), que lo mueve y arrastra el tope que sigue al
// ingreso. incomeOfPeriod vive en budget-formulas.ts y changeCreditKind en credit-kind-use-cases.ts
// (nombres que el contrato no fijaba).
// Corre con: node --test arch/v1/application/finance-use-cases/wdc-183/ingreso-del-plan.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { Money } from "../../../domain/finance/money.ts"
import type { MonthlyBudget, Transaction } from "../../../domain/finance/finance.domain.ts"
import type { PeriodMode } from "../../../../shared/billing-cycle.ts"
import { incomeOfPeriod } from "../budget-formulas.ts"
import { changeCreditKind } from "../credit-kind-use-cases.ts"
import { getBudgetView } from "../finance-read.ts"
import type { FollowIncomeDeps } from "../follow-income.ts"

const tx = (
  id: string,
  date: string,
  amount: number,
  over: Partial<Transaction> = {}
): Transaction => ({
  id,
  userId: "u1",
  accountId: "corriente",
  categoryId: "sueldo",
  date: new Date(`${date}T00:00:00Z`),
  description: id,
  amount: Money.of(amount, over.amount?.currency ?? "CLP"),
  direction: "credit",
  status: "confirmed",
  isInternal: false,
  externalId: null,
  origin: "statement",
  creditKind: "income",
  ...over,
})

const major = (m: Money | number) => (typeof m === "number" ? m : m.toMajor())

test("ingreso del período: suma los abonos de ingreso confirmados con fecha en el período (mes o ciclo), sin reembolsos, reversos, internos ni anulados, CLP y USD por separado", () => {
  const txs = [
    tx("sueldo", "2026-11-05", 1_500_000),
    tx("ultimo-dia", "2026-11-30", 200_000), // en el borde final del mes
    tx("primer-dia", "2026-11-01", 100_000), // en el borde inicial
    tx("octubre", "2026-10-31", 300_000), // justo antes
    tx("diciembre", "2026-12-01", 400_000), // justo después
    tx("reembolso", "2026-11-08", 25_000, { creditKind: "reimbursement", categoryId: null }),
    tx("reverso", "2026-11-09", 12_000, { creditKind: "reversal", categoryId: null }),
    tx("traspaso", "2026-11-10", 50_000, { isInternal: true, creditKind: null, internalKind: "own_transfer", categoryId: null }),
    tx("giro-linea", "2026-11-11", 80_000, { isInternal: true, creditKind: null, internalKind: "overdraft_draw", categoryId: null }),
    tx("anulado", "2026-11-12", 70_000, { status: "reversed" }),
    tx("pendiente", "2026-11-13", 60_000, { status: "pending" }),
    tx("usd", "2026-11-14", 120, { amount: Money.of(120, "USD") }),
    tx("cargo", "2026-11-15", 9_000, { direction: "debit", creditKind: null, categoryId: "gasto" }),
  ]
  const noviembre = { start: "2026-11-01", end: "2026-11-30" }
  assert.equal(major(incomeOfPeriod(txs, noviembre, "CLP")), 1_800_000)
  assert.equal(major(incomeOfPeriod(txs, noviembre, "USD")), 120)
  // Ciclo de facturación 26-oct → 25-nov: entra octubre 31, sale el 30 de noviembre.
  const ciclo = { start: "2026-10-26", end: "2026-11-25" }
  assert.equal(major(incomeOfPeriod(txs, ciclo, "CLP")), 1_900_000)
})

// Plan calendario de noviembre 2026 sin fuentes de ingreso: el ingreso sale solo de los abonos.
const TODAY = "2026-11-15"
type Row = MonthlyBudget & { mode: PeriodMode }

function fixture(txs: Transaction[], budgets: Row[]) {
  const categories = [
    { id: "sueldo", type: "income" },
    { id: "gasto", type: "expense" },
  ].map((c) => ({ ...c, userId: "u1", name: c.id, icon: null, color: null, description: null, paceEnabled: true }))
  const find = (mode: PeriodMode, year: number, month: number) =>
    budgets.findIndex((b) => b.mode === mode && b.year === year && b.month === month)
  const deps = {
    accounts: { async listByUser() { return [] } },
    categories: { async listByUser() { return categories }, async listLimitsByUser() { return [] } },
    transactions: {
      async listByUserPeriod(u: string, range: { start: string; end: string }) {
        return txs.filter((t) => {
          const d = t.date.toISOString().slice(0, 10)
          return t.userId === u && d >= range.start && d <= range.end
        })
      },
      async findById(id: string) {
        return txs.find((t) => t.id === id) ?? null
      },
      async setCreditKind(id: string, creditKind: Transaction["creditKind"]) {
        const i = txs.findIndex((t) => t.id === id)
        txs[i] = { ...txs[i], creditKind }
        return txs[i]
      },
    },
    monthlyBudgets: {
      async listByUser(_u: string, mode: PeriodMode) {
        return budgets.filter((b) => b.mode === mode).map((b) => ({ ...b }))
      },
      async setFollowingIncome(input: { mode: PeriodMode; userId: string; year: number; month: number; globalLimit: Money }) {
        const i = find(input.mode, input.year, input.month)
        if (i >= 0 && !budgets[i].followsIncome) return false
        const row: Row = { id: `w-${input.year}-${input.month}`, ...input, followsIncome: true }
        if (i >= 0) budgets[i] = row
        else budgets.push(row)
        return true
      },
    },
    exchangeRates: { async clpPerUsdAt() { return 950 } },
    budgetPeriod: { async get() { return { mode: "calendar", overrides: {} } } },
  } as unknown as FollowIncomeDeps
  const tope = () => budgets[find("calendar", 2026, 11)].globalLimit.toMajor()
  return { deps, txs, tope }
}

test("pasar un abono de ingreso a reembolso lo saca del ingreso del plan y el tope que sigue al ingreso baja solo; un cargo, un interno, un reverso o un abono ajeno no se reclasifican", async () => {
  const f = fixture(
    [
      tx("sueldo", "2026-11-05", 1_000_000),
      tx("transf-juan", "2026-11-12", 200_000, { description: "TRANSF DE JUAN PEREZ" }),
      tx("reembolso", "2026-11-08", 50_000, { creditKind: "reimbursement", categoryId: null }),
      tx("cargo", "2026-11-09", 9_000, { direction: "debit", creditKind: null, categoryId: "gasto" }),
      tx("traspaso", "2026-11-10", 50_000, { isInternal: true, creditKind: null, internalKind: "own_transfer", categoryId: null }),
      tx("reverso", "2026-11-11", 12_000, { creditKind: "reversal", categoryId: null }),
      tx("ajeno", "2026-11-11", 30_000, { userId: "otro" }),
    ],
    [{ id: "mb1", userId: "u1", year: 2026, month: 11, globalLimit: Money.of(1_200_000, "CLP"), followsIncome: true, mode: "calendar" }]
  )
  // Antes: el reembolso ya no cuenta como ingreso.
  assert.equal((await getBudgetView(f.deps, "u1", 2026, 11)).income, 1_200_000)

  await changeCreditKind(f.deps, "u1", { transactionId: "transf-juan", creditKind: "reimbursement" }, { today: TODAY })
  assert.equal(f.txs.find((t) => t.id === "transf-juan")?.creditKind, "reimbursement")
  assert.equal((await getBudgetView(f.deps, "u1", 2026, 11)).income, 1_000_000)
  assert.equal(f.tope(), 1_000_000)

  for (const id of ["cargo", "traspaso", "reverso", "ajeno", "no-existe"])
    await assert.rejects(
      changeCreditKind(f.deps, "u1", { transactionId: id, creditKind: "reimbursement" }, { today: TODAY }),
      Error,
      `debía rechazar ${id}`
    )
  assert.equal(f.tope(), 1_000_000)
})
