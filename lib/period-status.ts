import { formatCLP, monthName } from "./finance-format.ts"

type Period = { year: number; month: number }

/**
 * Línea con que el Inicio resume un período que no es el en curso. Un período futuro todavía no
 * cerró; uno pasado dice cuánto quedó sin gastar o, si se pasó del presupuesto, por cuánto.
 */
export function closedPeriodLine(input: {
  period: Period
  current: Period
  globalLimit: number
  spent: number
  committed: number
}): string {
  const { period, current, globalLimit, spent, committed } = input
  const name = `${monthName(period.month)} ${period.year}`
  if (period.year * 12 + period.month > current.year * 12 + current.month)
    return `${name} todavía no empieza`
  const free = globalLimit - spent - committed
  return free < 0
    ? `${name} cerró ${formatCLP(-free)} sobre el tope de gasto`
    : `${name} cerró con ${formatCLP(free)} sin gastar`
}
