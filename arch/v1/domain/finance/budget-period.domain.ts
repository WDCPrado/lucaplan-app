// Período del presupuesto: mes calendario (débito) o ciclo de facturación de la tarjeta, más los
// cierres corregidos a mano por mes. Preferencia GLOBAL de la app, como el ritmo y los umbrales:
// la app tiene un usuario y hay un solo cierre por mes para todo el presupuesto.
import type {
  ClosingOverrides,
  PeriodMode,
} from "../../../shared/billing-cycle.ts"

export const PERIOD_MODES = ["calendar", "card_cycle"] as const

export class InvalidBudgetPeriodError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidBudgetPeriodError"
  }
}

export interface BudgetPeriodRepository {
  /** `mode: null` = nunca se configuró; el caso de uso resuelve el valor por defecto. */
  get(): Promise<{ mode: PeriodMode | null; overrides: ClosingOverrides }>
  setMode(mode: PeriodMode): Promise<void>
  /** Fija el cierre de (year, month); `null` borra la corrección y vuelve al estimado. */
  setClosing(year: number, month: number, date: string | null): Promise<void>
}
