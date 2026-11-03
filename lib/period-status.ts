import { formatCLP, monthName } from "./finance-format.ts"

type Period = { year: number; month: number }

/** ¿`period` es posterior al período en curso? Un mes futuro todavía no tiene gasto que contar. */
export function isFuturePeriod(period: Period, current: Period): boolean {
  return period.year * 12 + period.month > current.year * 12 + current.month
}

/**
 * Línea con que el Inicio resume un período que no es el en curso. Un período futuro todavía no
 * cerró; uno pasado dice cuánto quedó sin gastar bajo el tope de gasto o, si se pasó, por cuánto.
 * `committed` no se resta: un compromiso que nunca se cobró no es plata gastada.
 */
export function closedPeriodLine(input: {
  period: Period
  current: Period
  globalLimit: number
  spent: number
  committed: number
}): string {
  const { period, current, globalLimit, spent } = input
  const name = `${monthName(period.month)} ${period.year}`
  if (isFuturePeriod(period, current)) return `${name} todavía no empieza`
  const free = globalLimit - spent
  return free < 0
    ? `${name} cerró ${formatCLP(-free)} por sobre el tope de gasto`
    : `${name} cerró con ${formatCLP(free)} sin gastar`
}
