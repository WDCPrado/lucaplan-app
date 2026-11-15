// Gastos que un abono puede devolver (WDC-184). La lectura (ventana de fechas, dueño, categoría de
// gasto activa) la hace la base; aquí queda la regla: saldo libre y orden.

export const CANDIDATES_DAYS_BEFORE = 120
export const CANDIDATES_DAYS_AFTER = 7
export const MAX_CANDIDATES = 50

export type CandidateRow = {
  id: string
  date: string // YYYY-MM-DD
  description: string
  amount: number
  linked: number // suma de vínculos del gasto
  categoryName: string
}

export type ReimbursementCandidate = Omit<CandidateRow, "linked"> & { free: number }

const DAY = 86_400_000

/** Primero los de saldo libre igual al del abono, luego por cercanía de fecha; máximo 50. */
export function rankReimbursementCandidates(
  creditDate: string,
  creditFree: number,
  rows: CandidateRow[]
): ReimbursementCandidate[] {
  if (creditFree <= 0) return []
  const at = Date.parse(creditDate)
  const distance = (date: string) => Math.abs(Date.parse(date) - at) / DAY
  return rows
    .map(({ linked, ...row }) => ({ ...row, free: row.amount - linked }))
    .filter((row) => row.free > 0)
    .sort(
      (a, b) =>
        Number(b.free === creditFree) - Number(a.free === creditFree) ||
        distance(a.date) - distance(b.date) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, MAX_CANDIDATES)
}
