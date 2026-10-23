import type { Direction } from "../arch/v1/domain/finance/finance.domain.ts"

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
export function reconcileBankRows(bank: BankRow[], existing: RegisteredRow[]): Reconciliation[] {
  const used = new Set<string>()
  return bank.map((b, index) => {
    const candidates = existing.filter(e => {
      if (used.has(e.id) || e.amount !== b.amount || e.direction !== b.direction) return false
      const delta = Math.abs(Date.parse(e.date + "T00:00:00Z") - Date.parse(b.date + "T00:00:00Z"))
      return delta <= 86400000
    })
    if (candidates.length !== 1) {
      return { index, status: candidates.length ? "ambiguous" : "missing",
        candidateIds: candidates.map(c => c.id) }
    }
    used.add(candidates[0].id)
    return { index, status: "matched", candidateIds: [candidates[0].id] }
  })
}
