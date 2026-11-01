import type { PeriodMode } from "../../../shared/billing-cycle.ts"

export type ReimbursementEffect = {
  mode: PeriodMode
  year: number
  month: number
  categoryId: string
  treatment: "automatic" | "manual"
}

export type ReimbursementRead = {
  expenseId: string
  creditId: string
  amount: number
  effects?: ReimbursementEffect[]
}

/** Sin marca en este modo conserva el contrato histórico (gasto neto). */
export function usesGrossExpense(row: ReimbursementRead, mode: PeriodMode): boolean {
  return row.effects?.some(effect => effect.mode === mode) ?? false
}
