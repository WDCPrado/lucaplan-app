// Corre con: node --test arch/v1/application/finance-use-cases/reimbursement-candidates.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { rankReimbursementCandidates, type CandidateRow } from "./reimbursement-candidates.ts"

const row = (id: string, date: string, amount: number, linked = 0): CandidateRow =>
  ({ id, date, description: id, amount, linked, categoryName: "Comida" })

test("Dado un abono de $20.000, cuando busca gastos, entonces primero van los de saldo libre igual y luego los más cercanos en fecha", () => {
  const out = rankReimbursementCandidates("2026-11-10", 20000, [
    row("lejano", "2026-08-01", 50000),
    row("cercano", "2026-11-09", 30000),
    row("igual-lejano", "2026-09-01", 25000, 5000),
    row("igual-cercano", "2026-11-12", 20000),
    row("siguiente", "2026-11-13", 9000),
  ])
  assert.deepEqual(out.map((c) => c.id), ["igual-cercano", "igual-lejano", "cercano", "siguiente", "lejano"])
  assert.equal(out[1].free, 20000, "el saldo libre descuenta lo ya vinculado")
  assert.equal("linked" in out[0], false)
})

test("Dado un gasto ya devuelto entero, cuando busca gastos, entonces no aparece", () => {
  const out = rankReimbursementCandidates("2026-11-10", 5000, [row("devuelto", "2026-11-01", 8000, 8000)])
  assert.deepEqual(out, [])
})

test("Dado un abono sin saldo libre, cuando busca gastos, entonces no propone ninguno", () => {
  assert.deepEqual(rankReimbursementCandidates("2026-11-10", 0, [row("a", "2026-11-01", 8000)]), [])
})

test("Dado más de 50 gastos posibles, cuando busca, entonces devuelve los 50 más cercanos", () => {
  const rows = Array.from({ length: 60 }, (_, i) =>
    row(`g${String(i).padStart(2, "0")}`, new Date(Date.UTC(2026, 10, 10) - i * 86_400_000).toISOString().slice(0, 10), 1000))
  const out = rankReimbursementCandidates("2026-11-10", 999, rows)
  assert.equal(out.length, 50)
  assert.equal(out.at(-1)?.id, "g49")
})
