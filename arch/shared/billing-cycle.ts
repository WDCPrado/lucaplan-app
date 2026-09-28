// Período del presupuesto: mes calendario (débito) o ciclo de facturación de la tarjeta.
// Todo en fechas civiles "YYYY-MM-DD"; la aritmética va en UTC para no depender de la zona.

export type PeriodMode = "calendar" | "card_cycle"

/** Cierres corregidos a mano, por mes: { "2026-05": "2026-05-20" }. */
export type ClosingOverrides = Record<string, string>

/** Rango civil del mes del presupuesto. `start` y `end` inclusive. */
export type PeriodRange = { start: string; end: string }

const key = (d: Date) => d.toISOString().slice(0, 10)
const monthKey = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return key(d)
}

function prevMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
}

function nextMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }
}

/**
 * Cierre estimado del mes: el 7.º día lunes a viernes contando hacia atrás desde el último día.
 * Acierta los cierres de Banco de Chile de 2026 salvo cuando un feriado lo corre (mayo: 21 vs 20).
 * ponytail: sin tabla de feriados; el usuario corrige a mano el mes que falle.
 */
export function estimateClosing(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0))
  for (let n = 0; ; d.setUTCDate(d.getUTCDate() - 1)) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6 && ++n === 7) return key(d)
  }
}

/** Cierre efectivo del mes: la corrección guardada o, sin ella, el estimado. */
export function closingOf(
  year: number,
  month: number,
  overrides: ClosingOverrides
): { date: string; estimated: boolean } {
  const saved = overrides[monthKey(year, month)]
  return saved
    ? { date: saved, estimated: false }
    : { date: estimateClosing(year, month), estimated: true }
}

/** Una corrección válida del cierre de M es una fecha real dentro de M. */
export function isValidClosing(year: number, month: number, date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  if (key(new Date(`${date}T00:00:00Z`)) !== date) return false
  return date.startsWith(`${monthKey(year, month)}-`)
}

/** Rango del mes (year, month) según el modo. */
export function periodRange(
  year: number,
  month: number,
  mode: PeriodMode,
  overrides: ClosingOverrides
): PeriodRange {
  if (mode === "calendar") {
    return {
      start: `${monthKey(year, month)}-01`,
      end: key(new Date(Date.UTC(year, month, 0))),
    }
  }
  const p = prevMonth(year, month)
  return {
    start: addDays(closingOf(p.year, p.month, overrides).date, 1),
    end: closingOf(year, month, overrides).date,
  }
}

/** Mes del presupuesto al que pertenece un día civil. */
export function periodOfDay(
  day: string,
  mode: PeriodMode,
  overrides: ClosingOverrides
): { year: number; month: number } {
  const year = Number(day.slice(0, 4))
  const month = Number(day.slice(5, 7))
  if (mode === "calendar" || day <= closingOf(year, month, overrides).date)
    return { year, month }
  return nextMonth(year, month)
}

/** Días del rango, en orden: "YYYY-MM-DD"[]. */
export function daysOf(range: PeriodRange): string[] {
  const out: string[] = []
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) out.push(d)
  return out
}
