// Anticipación del recordatorio de pagos por vencer (recurrentes y cuotas): cuántos días antes del
// vencimiento se avisa. Configurable y GLOBAL, igual que los umbrales de presupuesto: es una
// preferencia de la app, no cuelga de un usuario ni de un mes.

// Rango permitido. 0 = avisar solo el mismo día; sobre 14 el aviso llega tan lejos del cobro que
// deja de ser un recordatorio. Enteros: medio día no cambia ninguna decisión.
export const MIN_DUE_DAYS = 0
export const MAX_DUE_DAYS = 14
export const DEFAULT_DUE_DAYS = 2

export class InvalidDueDaysError extends Error {
  constructor() {
    super(`Los días deben estar entre ${MIN_DUE_DAYS} y ${MAX_DUE_DAYS}`)
    this.name = "InvalidDueDaysError"
  }
}

export interface DueReminderRepository {
  /** `null` = nunca se configuró; el caso de uso resuelve el valor por defecto. */
  getDays(): Promise<number | null>
  setDays(days: number): Promise<void>
}
