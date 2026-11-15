// WDC-183: la conciliación no anula (retención ni reverso) un cargo vinculado a una cuota o a una
// recurrente: dejaría la cuota o el período pagados por un movimiento anulado. Se desvincula antes.
import test from "node:test"
import assert from "node:assert/strict"
import { planBankReconciliation } from "./bank-reconciliation.ts"
import type {
  ReconciliationMovement,
  ReconciliationState,
} from "../../domain/finance/bank-reconciliation.domain.ts"
import type { BankReconciliationInput } from "../../../../lib/schemas/bank-reconciliation.ts"

const NOW = new Date("2026-11-12T15:00:00Z")
const cargo = (id: string, over: Partial<ReconciliationMovement> = {}): ReconciliationMovement => ({
  id,
  date: "2026-11-04",
  description: "ARRIENDO DEPTO",
  amount: 350_000,
  currency: "CLP",
  direction: "debit",
  categoryId: "vivienda",
  bucketId: "cash",
  status: "confirmed",
  isInternal: false,
  bankReceivedAt: null,
  linked: false,
  reimbursementAmount: 0,
  updatedAt: "2026-11-10T00:00:00Z",
  origin: "email",
  ...over,
})
const state = (movements: ReconciliationMovement[]): ReconciliationState => ({
  accountType: "checking",
  reconciledUntil: null,
  buckets: [{ id: "cash", kind: "cash", currency: "CLP", reconciledAt: null }],
  movements,
  categories: [{ id: "vivienda", type: "expense" }],
})
const input = (over: Partial<BankReconciliationInput>): BankReconciliationInput => ({
  accountId: "corriente",
  snapshotAt: "2026-11-10T18:00:00-03:00",
  source: "Cartola nov",
  includedSameDayIds: [],
  buckets: [{ kind: "cash", currency: "CLP", limit: 0, used: 0, available: 400_000 }],
  corrections: [],
  additions: [],
  ...over,
})
const reverso = (of: string) => ({
  date: "2026-11-06",
  description: "ARRIENDO DEPTO",
  amount: 350_000,
  currency: "CLP" as const,
  categoryId: null,
  evidence: "Cartola nov, fila 3",
  direction: "credit" as const,
  isInternal: false,
  creditKind: "reversal" as const,
  reversalOfId: of,
})

test("un cargo vinculado a una recurrente o a una cuota no se retiene ni se revierte; uno libre sí", () => {
  const recurrente = cargo("recurrente", { linked: true, recurringOnly: true })
  const cuota = cargo("cuota", { linked: true, installmentItemId: "item-3", installmentOnly: true })
  for (const m of [recurrente, cuota]) {
    assert.throws(
      () => planBankReconciliation(state([m]), input({ retentions: [{ transactionId: m.id, evidence: "x" }] }), NOW),
      /vinculado a una cuota o a una recurrente/
    )
    assert.throws(
      () => planBankReconciliation(state([m]), input({ additions: [reverso(m.id)] }), NOW),
      /vinculado a una cuota o a una recurrente/
    )
  }
  const libre = planBankReconciliation(
    state([cargo("libre")]),
    input({ retentions: [{ transactionId: "libre", evidence: "x" }] }),
    NOW
  )
  assert.deepEqual(libre.retentions.map((r) => r.before.id), ["libre"])
})
