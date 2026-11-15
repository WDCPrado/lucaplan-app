// Ingreso programado (WDC-185): lo que se espera recibir cada mes (el sueldo). Es una EXPECTATIVA:
// nunca crea dinero ni movimientos. El plan cuenta su monto en cada período donde tiene una
// ocurrencia, hasta que llega un abono de ingreso vinculado a él (ver `planIncome`).
import type { Money, CurrencyCode } from "./money.ts"
import type { PeriodRange } from "../../../shared/billing-cycle.ts"

export type IncomeSource = {
  id: string
  userId: string
  name: string
  categoryId: string
  currency: CurrencyCode
  amount: Money // esperado por ocurrencia
  dayOfMonth: number // 1–31; en un mes más corto, el último día
  startsOn: string // YYYY-MM-DD
  endsOn: string | null // YYYY-MM-DD; null = indefinido
  // Montos de meses calendario que reemplazan al base (una cuota que cambia). Orden por mes.
  amounts: { month: string; amount: Money }[] // month YYYY-MM
}

export type NewIncomeSource = Omit<IncomeSource, "id" | "amounts">
export type IncomeSourcePatch = Partial<Omit<IncomeSource, "id" | "userId" | "amounts">>

export interface IncomeSourceRepository {
  listByUser(userId: string): Promise<IncomeSource[]>
  findById(id: string): Promise<IncomeSource | null>
  create(input: NewIncomeSource): Promise<IncomeSource>
  update(id: string, userId: string, patch: IncomeSourcePatch): Promise<IncomeSource>
  // ¿Cuántos abonos lo referencian? Con alguno, borrar se convierte en terminar su vigencia.
  countLinked(id: string): Promise<number>
  delete(id: string, userId: string): Promise<void>
  // Fija (amount) o quita (null) el monto de un mes calendario YYYY-MM. Upsert.
  setMonthAmount(id: string, userId: string, month: string, amount: Money | null): Promise<void>
  // Vincula (o desvincula con null) un abono propio de ingreso. Solo escribe el vínculo.
  linkCredit(transactionId: string, userId: string, incomeSourceId: string | null): Promise<void>
}

/**
 * Fechas esperadas (YYYY-MM-DD) del programado dentro del período: una por mes calendario, el día
 * `dayOfMonth` (o el último del mes si es más corto), entre `startsOn` y `endsOn`. Un ciclo de
 * tarjeta que cruza dos meses puede tener dos ocurrencias, o ninguna.
 */
export function occurrencesIn(
  source: Pick<IncomeSource, "dayOfMonth" | "startsOn" | "endsOn">,
  range: PeriodRange
): string[] {
  const out: string[] = []
  let [y, m] = range.start.split("-").map(Number)
  const [endY, endM] = range.end.split("-").map(Number)
  while (y < endY || (y === endY && m <= endM)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const day = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(source.dayOfMonth, last)).padStart(2, "0")}`
    if (
      day >= range.start &&
      day <= range.end &&
      day >= source.startsOn &&
      (source.endsOn === null || day <= source.endsOn)
    )
      out.push(day)
    if (++m > 12) {
      m = 1
      y++
    }
  }
  return out
}

/**
 * La ocurrencia más cercana a `day` (un abono que llega antes o después de la fecha esperada), a lo
 * más `maxDays` días; null si no hay. Empate: la anterior.
 */
export function nearestOccurrence(
  source: Pick<IncomeSource, "dayOfMonth" | "startsOn" | "endsOn">,
  day: string,
  maxDays: number
): string | null {
  const shift = (n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
  const distance = (d: string) => Math.abs(Date.parse(d) - Date.parse(day))
  return (
    occurrencesIn(source, { start: shift(-maxDays), end: shift(maxDays) }).sort(
      (a, b) => distance(a) - distance(b) || a.localeCompare(b)
    )[0] ?? null
  )
}

/** Esperado de una ocurrencia: el monto de su mes calendario si se fijó, si no el base. */
export function expectedAt(source: Pick<IncomeSource, "amount" | "amounts">, day: string): Money {
  const month = day.slice(0, 7)
  return source.amounts.find((a) => a.month === month)?.amount ?? source.amount
}

export class IncomeSourceNotFoundError extends Error {
  constructor(id: string) {
    super(`Ingreso programado no encontrado: ${id}`)
    this.name = "IncomeSourceNotFoundError"
  }
}

// Regla de negocio (→ 422): categoría que no es de ingreso, abono que no es ingreso, moneda distinta.
export class InvalidIncomeSourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidIncomeSourceError"
  }
}
