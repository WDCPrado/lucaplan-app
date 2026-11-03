import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { daysOf, type PeriodRange } from "../arch/shared/billing-cycle.ts"

/** Fecha civil "YYYY-MM-DD" de un movimiento: `date` es el ISO de un @db.Date, así que va en el texto. */
export function dateOf(tx: Pick<TransactionDTO, "date">): string {
  return tx.date.slice(0, 10)
}

/** Días que quedan del rango, hoy incluido: 0 si hoy cae fuera de él. */
export function daysLeftIn(range: PeriodRange, today: string): number {
  if (today < range.start || today > range.end) return 0
  return daysOf({ start: today, end: range.end }).length
}

/**
 * Cuánto se puede gastar hoy: lo libre del mes (presupuesto − gastado − comprometido) repartido
 * en los días que quedan, hoy incluido. Nunca negativo: pasado el presupuesto la respuesta es $0,
 * y cuánto se pasó lo anuncia la banda de excedente, no este número.
 */
export function dailyAllowance(free: number, daysLeft: number): number {
  if (daysLeft <= 0 || free <= 0) return 0
  return Math.round(free / daysLeft)
}
