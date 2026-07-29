// Umbral de aviso del presupuesto mensual: el % del límite global que, al ser CRUZADO por un
// gasto, dispara la notificación. Configurable y GLOBAL (no cuelga de un usuario ni de un mes):
// es una preferencia de la app.

export type BudgetAlert = {
  id: string
  percent: number
}

// Rango permitido. Bajo el 5% cualquier gasto dispararía el aviso; el 100% es el techo porque el
// aviso de sobrepaso ya reporta el % real alcanzado (125%, 180%…), así que un umbral sobre 100 no
// agrega nada. Enteros: medio punto porcentual no cambia ninguna decisión.
export const MIN_ALERT_PERCENT = 5
export const MAX_ALERT_PERCENT = 100

export class InvalidBudgetAlertError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidBudgetAlertError"
  }
}

export class DuplicateBudgetAlertError extends Error {
  constructor(percent: number) {
    super(`Ya existe una alerta al ${percent}%`)
    this.name = "DuplicateBudgetAlertError"
  }
}

export interface BudgetAlertRepository {
  list(): Promise<BudgetAlert[]>
  /** Crea el umbral o cambia el % de uno existente (`id`). El % es único. */
  save(input: { id?: string; percent: number }): Promise<BudgetAlert>
  delete(id: string): Promise<void>
}
