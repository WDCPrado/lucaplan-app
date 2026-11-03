import type {
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { daysOf, type PeriodRange } from "../arch/shared/billing-cycle.ts"

/** Fecha civil "YYYY-MM-DD" de un movimiento: `date` es el ISO de un @db.Date, así que va en el texto. */
export function dateOf(tx: Pick<TransactionDTO, "date">): string {
  return tx.date.slice(0, 10)
}

/**
 * Gasto por fecha, en CLP, para la curva de gasto del Inicio: una cifra por cada fecha de `days`, en su orden.
 * Todo cargo confirmado, con o sin categoría o tope (mismo criterio que el gastado del plan), sin ajustes de saldo
 * y con el equivalente CLP cuando la moneda es otra; sin dólar observado (`amountClp` null) queda fuera. Agrupa por fecha y no por día del mes: un ciclo de tarjeta cruza dos meses y el
 * 25/09 no es el 25/10.
 */
export function spendByDate(
  transactions: (Pick<
    TransactionDTO,
    | "date"
    | "direction"
    | "status"
    | "isInternal"
    | "amount"
    | "amountClp"
  > & { currency?: string })[],
  days: string[],
  // Ya no filtra: se mantiene para no romper a quien la llama (WDC-171).
  _categories?: Pick<CategoryDTO, "id" | "type" | "limit">[]
): number[] {
  const index = new Map(days.map((d, i) => [d, i]))
  const out = new Array<number>(days.length).fill(0)
  for (const t of transactions) {
    if (
      t.direction !== "debit" ||
      t.status !== "confirmed" ||
      t.isInternal ||
      (t.currency !== undefined && t.currency !== "CLP" && t.amountClp == null)
    )
      continue
    const i = index.get(dateOf(t))
    if (i !== undefined) out[i] += Math.abs(t.amountClp ?? t.amount)
  }
  return out
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
