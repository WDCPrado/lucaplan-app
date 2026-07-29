import {
  DuplicateBudgetAlertError,
  InvalidBudgetAlertError,
  MAX_ALERT_PERCENT,
  MIN_ALERT_PERCENT,
  type BudgetAlert,
  type BudgetAlertRepository,
} from "../../domain/notifications/budget-alert.domain.ts"

export type BudgetAlertDeps = { budgetAlerts: BudgetAlertRepository }

/** Umbrales configurados, de menor a mayor (orden de lectura en la UI). */
export async function listBudgetAlerts(
  deps: BudgetAlertDeps
): Promise<BudgetAlert[]> {
  const alerts = await deps.budgetAlerts.list()
  return alerts.sort((a, b) => a.percent - b.percent)
}

/**
 * Crea un umbral o mueve uno existente. El % es único: dos alertas iguales avisarían lo mismo dos
 * veces, así que se rechaza en vez de duplicar silenciosamente.
 */
export async function saveBudgetAlert(
  deps: BudgetAlertDeps,
  input: { id?: string; percent: number }
): Promise<BudgetAlert> {
  const percent = Math.round(input.percent)
  if (
    !Number.isFinite(percent) ||
    percent < MIN_ALERT_PERCENT ||
    percent > MAX_ALERT_PERCENT
  )
    throw new InvalidBudgetAlertError(
      `El porcentaje debe estar entre ${MIN_ALERT_PERCENT} y ${MAX_ALERT_PERCENT}`
    )

  const existing = await deps.budgetAlerts.list()
  if (existing.some((a) => a.percent === percent && a.id !== input.id))
    throw new DuplicateBudgetAlertError(percent)

  return deps.budgetAlerts.save({ id: input.id, percent })
}

export async function deleteBudgetAlert(
  deps: BudgetAlertDeps,
  id: string
): Promise<void> {
  await deps.budgetAlerts.delete(id)
}
