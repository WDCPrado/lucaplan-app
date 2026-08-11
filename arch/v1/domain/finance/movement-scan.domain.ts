// Lectura de una foto de la cartola del banco → movimientos candidatos. PURO: sin IA, sin Prisma,
// sin HTTP. La IA solo aporta filas sueltas (`MovementReading`); QUÉ se acepta, con qué fecha y qué
// ya está registrado se decide acá.
//
// Existe porque el aviso del banco a veces no llega y ese cargo queda fuera de la app: el alta
// manual no acepta cargos en una cuenta conectada, porque los duplicaría cuando el correo aparezca.
// Esta vía es la excepción explícita, y la deduplicación contra lo ya registrado es lo que la hace
// segura: sin ella se reintroduce justo el doble conteo que esa regla evita.
import { CURRENCY_DECIMALS, type CurrencyCode } from "./money.ts"
import type { Direction } from "./finance.domain.ts"

// Una fila tal como la leyó la IA. Todo puede venir null: `null` es "no lo pude leer", nunca cero.
// La fecha llega en campos separados a propósito — un string "05/01/2026" obligaría a adivinar si el
// formato es chileno o americano, y esa ambigüedad no se puede resolver después.
export type MovementReading = {
  day: number | null
  month: number | null
  year: number | null // las cartolas suelen omitirlo
  description: string | null
  amount: number | null
  kind: "cargo" | "abono" | null
}

// Port del lector de fotos. La implementación (IA) decide cómo leer; el dominio solo pide filas.
// Lista vacía = no reconoció nada; ahí no se propone ningún movimiento.
export interface MovementScanReader {
  // Una o varias fotos de la cartola/historial. No se persisten.
  read(input: { imageDataUrls: string[] }): Promise<MovementReading[]>
}

// Tope de movimientos por escaneo: acota la respuesta de la IA y la lista que hay que revisar a ojo.
export const MAX_SCAN_MOVEMENTS = 50

export class MovementScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MovementScanError"
  }
}

// Candidato listo para que el usuario revise. Nada se persiste hasta que confirma.
export type ScannedMovement = {
  date: string // YYYY-MM-DD (mismo formato que manda el formulario manual)
  description: string
  amount: number // unidad mayor, siempre positivo
  direction: Direction
  duplicate: boolean // ya hay uno igual registrado ⇒ la UI lo destilda
}

// Lo ya registrado en la cuenta, para contrastar.
export type ExistingMovement = {
  date: Date
  amount: number
  direction: Direction
}

const MAX_DESCRIPTION = 120

// Los movimientos se guardan a medianoche UTC y se muestran en esa misma zona (ver DatePicker):
// comparar por el día UTC es comparar lo que el usuario ve.
const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

const key = (m: {
  date: string
  amount: number
  direction: Direction
}): string => `${m.date}|${m.amount}|${m.direction}`

// Un monto con más decimales de los que la moneda admite es la FIRMA de un error de lectura, no un
// redondeo: en Chile el punto separa miles, así que "$13.590" leído como decimal da 13,59 — un monto
// perfectamente válido que nadie notaría. La fila se descarta; el usuario la agrega a mano si quiere.
function readAmount(
  value: number | null,
  currency: CurrencyCode
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const amount = Math.abs(value)
  if (amount <= 0) return null
  const decimals = CURRENCY_DECIMALS[currency]
  const text = String(amount)
  const dot = text.indexOf(".")
  if (dot !== -1 && text.length - dot - 1 > decimals) return null
  return amount
}

const int = (value: number | null, min: number, max: number): number | null =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= min &&
  value <= max
    ? value
    : null

// Fecha de la fila. La cartola suele mostrar "05/01" sin año: se toma el año que NO deja la fecha en
// el futuro (un cargo del 28/12 leído en enero es del año pasado). Una fecha futura explícita se
// descarta: o se leyó mal, o no es un movimiento ya ocurrido.
function readDate(reading: MovementReading, today: Date): string | null {
  const day = int(reading.day, 1, 31)
  const month = int(reading.month, 1, 12)
  if (!day || !month) return null
  const hoy = isoDay(today)

  const build = (year: number): string | null => {
    const date = new Date(Date.UTC(year, month - 1, day))
    // Date desborda en silencio (31/02 → 3 de marzo): si el día cambió, esa fecha no existe.
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
      return null
    return isoDay(date)
  }

  const year = int(reading.year, 2000, today.getUTCFullYear() + 1)
  if (year) {
    const iso = build(year)
    return iso && iso <= hoy ? iso : null
  }
  const thisYear = build(today.getUTCFullYear())
  if (thisYear && thisYear <= hoy) return thisYear
  return build(today.getUTCFullYear() - 1)
}

// Filas leídas → candidatos revisables. Descarta lo que no se puede afirmar (montos y fechas
// ilegibles) y marca como duplicado lo que ya está registrado. `skipped` es lo descartado: se dice,
// no se esconde, porque el usuario tiene que saber que esa línea de la foto no llegó a la lista.
export function toScannedMovements(
  readings: MovementReading[],
  opts: {
    currency: CurrencyCode
    existing: ExistingMovement[]
    today: Date
  }
): { movements: ScannedMovement[]; skipped: number } {
  // Multiset de lo ya registrado: dos cargos iguales el mismo día son dos movimientos reales, así
  // que cada existente marca UN candidato, no todos los que se le parezcan.
  const pending = new Map<string, number>()
  for (const m of opts.existing) {
    const k = key({
      date: isoDay(m.date),
      amount: m.amount,
      direction: m.direction,
    })
    pending.set(k, (pending.get(k) ?? 0) + 1)
  }

  const movements: ScannedMovement[] = []
  let skipped = 0
  for (const reading of readings) {
    const amount = readAmount(reading.amount, opts.currency)
    const date = readDate(reading, opts.today)
    if (!amount || !date || movements.length >= MAX_SCAN_MOVEMENTS) {
      skipped++
      continue
    }
    // Por defecto cargo: esta vía existe para los gastos que el banco no avisó. Un monto negativo
    // es un cargo aunque la fila diga otra cosa.
    const direction: Direction =
      reading.kind === "abono" && (reading.amount ?? 0) > 0 ? "credit" : "debit"
    const left = pending.get(key({ date, amount, direction })) ?? 0
    if (left > 0) pending.set(key({ date, amount, direction }), left - 1)
    movements.push({
      date,
      description:
        (reading.description ?? "").trim().slice(0, MAX_DESCRIPTION) ||
        "Movimiento del banco",
      amount,
      direction,
      duplicate: left > 0,
    })
  }
  return { movements, skipped }
}
