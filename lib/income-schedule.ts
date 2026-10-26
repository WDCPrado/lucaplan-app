// Estado de la fecha de pago de un ingreso recurrente para un mes, respecto a "hoy".
// El día efectivo se recorta al último día del mes (día 31 en febrero → 28/29), igual que el backend.
//   past   → la fecha ya pasó (o es un mes anterior): generar directo, marcar atrasado
//   today  → es hoy: generar directo
//   future → aún no llega (o es un mes futuro): pedir confirmación antes de generar
export type PayDayState = "past" | "today" | "future"

export function payDayState(
  period: { year: number; month: number },
  dayOfMonth: number,
  now: Date
): PayDayState {
  const perIdx = period.year * 12 + (period.month - 1)
  const nowIdx = now.getFullYear() * 12 + now.getMonth()
  if (perIdx < nowIdx) return "past"
  if (perIdx > nowIdx) return "future"
  // Mismo mes: comparar el día efectivo (recortado al último del mes) con el día de hoy.
  const lastDay = new Date(period.year, period.month, 0).getDate()
  const day = Math.min(dayOfMonth, lastDay)
  const today = now.getDate()
  return day < today ? "past" : day > today ? "future" : "today"
}

/**
 * Días desde hoy hasta la fecha de pago del ingreso en el mes (period): positivo si falta,
 * 0 si es hoy, negativo si pasó. Cuenta días reales y no resta días del mes: en modo tarjeta,
 * con octubre en pantalla y hoy 28/09, un ingreso del día 5 (5/10) está a 7 días.
 * El día se recorta al último del mes (31 en febrero → 28/29), igual que el backend.
 */
export function daysUntilPayDay(
  period: { year: number; month: number },
  dayOfMonth: number,
  today: string // "YYYY-MM-DD" civil (todayKey)
): number {
  const lastDay = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()
  const pay = Date.UTC(period.year, period.month - 1, Math.min(dayOfMonth, lastDay))
  return Math.round((pay - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/** Fecha efectiva del ingreso dentro del ciclo: 23/oct–20/nov y día 25 => 25/oct. */
export function incomeDueDateInRange(
  period: { year: number; month: number },
  dayOfMonth: number,
  range?: { start: string; end: string }
): string {
  if (!range) {
    const last = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()
    return `${period.year}-${String(period.month).padStart(2, "0")}-${String(Math.min(dayOfMonth, last)).padStart(2, "0")}`
  }
  const first = new Date(`${range.start}T00:00:00Z`)
  for (let m = 0; m < 3; m++) {
    const year = first.getUTCFullYear()
    const month = first.getUTCMonth() + m
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const candidate = new Date(Date.UTC(year, month, Math.min(dayOfMonth, last))).toISOString().slice(0, 10)
    if (candidate >= range.start && candidate <= range.end) return candidate
  }
  throw new Error("Día de ingreso fuera del ciclo")
}
