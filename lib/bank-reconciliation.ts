import type { Direction } from "../arch/v1/domain/finance/finance.domain.ts"
import { isSameBankMovement } from "../arch/v1/domain/finance/bank-reconciliation.domain.ts"

export type BankRow = {
  date: string
  description: string
  amount: number
  direction: Direction
}
export type RegisteredRow = BankRow & { id: string }
export type Reconciliation = {
  index: number
  status: "matched" | "ambiguous" | "missing"
  candidateIds: string[]
}

// A bank line can consume at most one existing movement, even when names differ.
// Ambiguity is intentionally not resolved by guessing.
// Una sola moneda: quien llama filtra los registrados por la moneda de la cartola.
export function reconcileBankRows(bank: BankRow[], existing: RegisteredRow[]): Reconciliation[] {
  const used = new Set<string>()
  return bank.map((b, index) => {
    const candidates = existing.filter(e => !used.has(e.id) &&
      isSameBankMovement({ ...b, currency: "" }, { ...e, currency: "" }, { days: 1, match: "amount" }))
    if (candidates.length !== 1) {
      return { index, status: candidates.length ? "ambiguous" : "missing",
        candidateIds: candidates.map(c => c.id) }
    }
    used.add(candidates[0].id)
    return { index, status: "matched", candidateIds: [candidates[0].id] }
  })
}
