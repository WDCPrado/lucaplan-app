// Montos de saldo informados por el usuario (o por la herramienta MCP) → saldos del dominio. PURO:
// sin Prisma, sin HTTP. QUÉ se puede calcular con los montos que llegaron se decide acá.
//
// Casi nunca llegan todas las variables: a veces el disponible y no el usado, a veces al revés, a
// veces los dos. Por eso no hay una fórmula sino una escalera: se usa la primera que se pueda armar.
//
// El CUPO TOTAL no participa de esa escalera: lo fija el banco, vive en la cuenta y no cambia de una
// actualización a otra. Es el dato fijo con el que se despeja el que falta, nunca algo que el
// cliente pueda sobrescribir.
import { CURRENCY_DECIMALS, Money, type CurrencyCode } from "./money.ts"

// Montos de un cupo/línea, en unidad mayor (CLP entero, USD con decimales).
// `null` = no se informó, que es distinto de cero.
export type BucketReading = {
  limit: number | null // cupo/línea total autorizado
  available: number | null // disponible que muestra el banco
  used: number | null // utilizado/deuda
}

export const EMPTY_BUCKET: BucketReading = {
  limit: null,
  available: null,
  used: null,
}

// Montos de una cuenta. La cuenta corriente usa `cash` + `overdraft`; la tarjeta de
// crédito, `national` (CLP) + `international` (USD).
export type BalanceReading = {
  last4: string | null // últimos 4 del instrumento, si se informaron
  cash: number | null // saldo firmado de la cuenta corriente, independiente de la línea
  overdraft: BucketReading
  national: BucketReading
  international: BucketReading
}

// Medición resuelta de un bucket: siempre cuadra `available = limit − used`.
export type ResolvedBucket = {
  limitAmount: Money
  used: Money
  available: Money
}

export class AccountBalanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccountBalanceError"
  }
}

// Un monto con más decimales de los que la moneda admite es la FIRMA de un error de transcripción, no
// un redondeo: en Chile el punto separa miles, así que "$1.334.697" leído como decimal da 1,334697 —y
// Money, que en CLP no tiene decimales, lo redondearía a $1 sin que ninguna otra validación lo note.
// Por eso se rechaza acá, antes de construir el Money.
function amount(value: number, currency: CurrencyCode): Money {
  const decimals = CURRENCY_DECIMALS[currency]
  const text = String(value)
  const dot = text.indexOf(".")
  if (dot !== -1 && text.length - dot - 1 > decimals)
    throw new AccountBalanceError(
      decimals === 0
        ? `El monto ${text} tiene decimales y los pesos no los usan: se leyó mal el separador de miles`
        : `El monto ${text} tiene más de ${decimals} decimales`
    )
  return Money.of(value, currency)
}

// Escalera de fórmulas para un bucket. Devuelve null cuando lo informado no alcanza para calcular nada
// —ahí el bucket se deja intacto, que es mejor que inventar un saldo—.
//
// `savedLimit` es el cupo de la cuenta y NO se toca: el disponible y el usado son complementos suyos,
// así que basta con uno de los dos. El disponible va primero porque es el que la app del banco
// muestra siempre; si además vino el usado, se recalcula desde el cupo. Única excepción: una cuenta
// que todavía no tiene cupo guardado —ahí no hay nada que proteger y los montos lo estrenan—.
export function resolveBucket(
  reading: BucketReading,
  savedLimit: Money | null,
  currency: CurrencyCode
): ResolvedBucket | null {
  const money = (v: number | null) => (v === null ? null : amount(v, currency))
  const available = money(reading.available)
  const used = money(reading.used)
  const limit = savedLimit?.isPositive
    ? savedLimit
    : available && used
      ? available.add(used)
      : money(reading.limit)
  if (!limit) return null

  const resolved: ResolvedBucket | null = available
    ? { limitAmount: limit, available, used: limit.subtract(available) }
    : used
      ? { limitAmount: limit, used, available: limit.subtract(used) }
      : null

  if (!resolved) return null
  // Un monto que se sale del cupo significa que se anotó mal algo: es preferible fallar visible a
  // guardar un saldo imposible.
  if (resolved.limitAmount.isNegative)
    throw new AccountBalanceError("Los montos dan un cupo negativo")
  if (resolved.used.isNegative)
    throw new AccountBalanceError("El disponible supera el cupo total")
  if (resolved.available.isNegative)
    throw new AccountBalanceError("El utilizado supera el cupo total")
  return resolved
}

// El saldo de la cuenta y la línea son mediciones independientes. Un saldo negativo puede
// coexistir con la línea sin uso: se conserva su signo y nunca se deduce deuda de él.
// Sin datos suficientes de la línea, resolveBucket devuelve null y se deja intacta.
export function resolveChecking(
  reading: BalanceReading,
  currentOverdraftLimit: Money | null
): { cash: Money; overdraft: ResolvedBucket | null } | null {
  if (reading.cash === null) return null
  const cash = amount(reading.cash, "CLP")
  const overdraft = resolveBucket(
    reading.overdraft,
    currentOverdraftLimit,
    "CLP"
  )
  return { cash, overdraft }
}

