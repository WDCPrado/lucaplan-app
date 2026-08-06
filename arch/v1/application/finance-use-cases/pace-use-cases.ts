// Preferencia de frecuencia del ritmo de gasto (diario/semanal). Depende solo de domain.
import {
  DEFAULT_PACE_FREQUENCY,
  InvalidPaceFrequencyError,
  PACE_FREQUENCIES,
  type PaceFrequency,
  type PaceFrequencyRepository,
} from "../../domain/finance/pace.domain.ts"

export type PaceDeps = { paceFrequency: PaceFrequencyRepository }

/** Frecuencia configurada; sin configurar, semanal (el valor por defecto). */
export async function getPaceFrequency(deps: PaceDeps): Promise<PaceFrequency> {
  return (await deps.paceFrequency.get()) ?? DEFAULT_PACE_FREQUENCY
}

export async function setPaceFrequency(
  deps: PaceDeps,
  frequency: string
): Promise<PaceFrequency> {
  if (!(PACE_FREQUENCIES as readonly string[]).includes(frequency))
    throw new InvalidPaceFrequencyError()
  await deps.paceFrequency.set(frequency as PaceFrequency)
  return frequency as PaceFrequency
}
