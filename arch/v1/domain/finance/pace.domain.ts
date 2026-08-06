// Ritmo de gasto por categoría: compara lo gastado del período en curso (hoy o la semana
// calendario) contra el presupuesto de ese período. La frecuencia es una preferencia GLOBAL de la
// app (Configuración), como los umbrales de alerta: no cuelga de un usuario ni de un mes.

export const PACE_FREQUENCIES = ["daily", "weekly"] as const
export type PaceFrequency = (typeof PACE_FREQUENCIES)[number]

// Semanal por defecto: el día a día tiene demasiado ruido (un supermercado grande "revienta" el
// día); la semana absorbe esos picos y sigue siendo accionable.
export const DEFAULT_PACE_FREQUENCY: PaceFrequency = "weekly"

export class InvalidPaceFrequencyError extends Error {
  constructor() {
    super(`La frecuencia debe ser una de: ${PACE_FREQUENCIES.join(", ")}`)
    this.name = "InvalidPaceFrequencyError"
  }
}

export interface PaceFrequencyRepository {
  /** `null` = nunca se configuró; el caso de uso resuelve el valor por defecto. */
  get(): Promise<PaceFrequency | null>
  set(frequency: PaceFrequency): Promise<void>
}
