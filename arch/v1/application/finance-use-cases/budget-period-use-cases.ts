// Período del presupuesto (mes calendario o ciclo de la tarjeta). Depende solo de domain y de la
// función pura del rango en `arch/shared`.
import {
  InvalidBudgetPeriodError,
  PERIOD_MODES,
  type BudgetPeriodRepository,
} from "../../domain/finance/budget-period.domain.ts"
import {
  closingOf,
  isValidClosing,
  periodOfDay,
  periodRange,
  type ClosingOverrides,
  type PeriodMode,
  type PeriodRange,
} from "../../../shared/billing-cycle.ts"

// Opcional a propósito: sin el repo el período es el mes calendario, que es lo que siguen usando
// los caminos que no son el presupuesto (recordatorios de vencimiento, dedupe de fotos).
export type BudgetPeriodDeps = { budgetPeriod?: BudgetPeriodRepository }

export type BudgetPeriodSettings = {
  mode: PeriodMode
  overrides: ClosingOverrides
}

/** Modo y cierres guardados; sin modo configurado, mes calendario. */
export async function getBudgetPeriod(
  deps: BudgetPeriodDeps
): Promise<BudgetPeriodSettings> {
  if (!deps.budgetPeriod) return { mode: "calendar", overrides: {} }
  const { mode, overrides } = await deps.budgetPeriod.get()
  return { mode: mode ?? "calendar", overrides }
}

/** Rango de fechas del mes (year, month) del presupuesto según el modo guardado. */
export async function rangeOf(
  deps: BudgetPeriodDeps,
  year: number,
  month: number
): Promise<PeriodRange> {
  const { mode, overrides } = await getBudgetPeriod(deps)
  return periodRange(year, month, mode, overrides)
}

/** Mes del presupuesto en curso para el día civil `today` ("YYYY-MM-DD"), con su rango. */
export async function currentBudgetPeriod(
  deps: BudgetPeriodDeps,
  today: string
): Promise<{ year: number; month: number; range: PeriodRange }> {
  const { mode, overrides } = await getBudgetPeriod(deps)
  const { year, month } = periodOfDay(today, mode, overrides)
  return { year, month, range: periodRange(year, month, mode, overrides) }
}

export async function setBudgetPeriodMode(
  deps: { budgetPeriod: BudgetPeriodRepository },
  mode: string
): Promise<PeriodMode> {
  if (!(PERIOD_MODES as readonly string[]).includes(mode))
    throw new InvalidBudgetPeriodError(
      `El modo debe ser uno de: ${PERIOD_MODES.join(", ")}`
    )
  await deps.budgetPeriod.setMode(mode as PeriodMode)
  return mode as PeriodMode
}

/**
 * Corrige el cierre de (year, month) o, con `date: null`, vuelve al estimado. Devuelve el cierre
 * efectivo tras guardar. Una fecha fuera del mes se rechaza y no se guarda nada.
 */
export async function setCardClosing(
  deps: { budgetPeriod: BudgetPeriodRepository },
  year: number,
  month: number,
  date: string | null
): Promise<{ date: string; estimated: boolean }> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new InvalidBudgetPeriodError("Año inválido")
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new InvalidBudgetPeriodError("Mes inválido")
  if (date !== null && !isValidClosing(year, month, date))
    throw new InvalidBudgetPeriodError(
      "El cierre debe ser una fecha dentro de ese mes"
    )
  await deps.budgetPeriod.setClosing(year, month, date)
  const key = `${year}-${String(month).padStart(2, "0")}`
  return closingOf(year, month, date === null ? {} : { [key]: date })
}
