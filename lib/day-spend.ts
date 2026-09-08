import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

/** Día civil (1–31) de un movimiento: `date` es el ISO de un @db.Date, así que el día va en el texto. */
export function dayOf(tx: Pick<TransactionDTO, "date">): number {
  return Number(tx.date.slice(8, 10))
}

/**
 * Gasto por día del mes, en CLP, para la tira de días: solo cargos confirmados, sin ajustes de
 * saldo (no son gasto) y con el equivalente CLP cuando la moneda es otra. Índice = día del mes.
 */
export function spendByDay(
  transactions: Pick<
    TransactionDTO,
    "date" | "direction" | "status" | "isInternal" | "amount" | "amountClp"
  >[],
  daysInMonth: number
): number[] {
  const out = new Array<number>(daysInMonth + 1).fill(0)
  for (const t of transactions) {
    if (t.direction !== "debit" || t.status !== "confirmed" || t.isInternal)
      continue
    const day = dayOf(t)
    if (day < 1 || day > daysInMonth) continue
    out[day] += Math.abs(t.amountClp ?? t.amount)
  }
  return out
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
