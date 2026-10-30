// Lectura de una captura de pantalla de la app del banco → saldos del dominio. PURO: sin IA, sin
// Prisma, sin HTTP. La IA solo aporta números sueltos (`BalanceReading`); QUÉ se puede calcular con
// ellos se decide acá.
//
// El problema real: las capturas casi nunca traen todas las variables. La app del banco muestra el
// disponible pero no el usado; a veces al revés; a veces los dos. Por eso no hay una fórmula sino
// una escalera: se usa la primera que se pueda armar con lo que llegó.
//
// El CUPO TOTAL no participa de esa escalera: lo fija el banco, vive en la cuenta y no cambia de una
// captura a otra. Es el dato fijo con el que se despeja el que falta —y con el que se comprueba lo
// leído (`limitMismatch`)—, nunca algo que la foto pueda sobrescribir.
import { CURRENCY_DECIMALS, Money, type CurrencyCode } from "./money.ts"

// Lo que la IA pudo leer de un cupo/línea, en unidad mayor (CLP entero, USD con decimales).
// `null` = no aparece en la imagen, que es distinto de cero.
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

// Lectura completa de una captura. La cuenta corriente usa `cash` + `overdraft`; la tarjeta de
// crédito, `national` (CLP) + `international` (USD).
export type BalanceReading = {
  last4: string | null // últimos 4 del instrumento que muestra la captura
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

// Port del lector de capturas. La implementación (IA) decide cómo leer; el dominio solo pide números.
// Devuelve null cuando no reconoció nada: ahí no se toca ningún saldo.
export interface BalanceScanReader {
  read(input: {
    // Una o varias capturas del MISMO instrumento, que se leen juntas: el banco reparte los datos
    // entre pantallas (el cupo internacional suele estar aparte del nacional). No se persisten.
    imageDataUrls: string[]
    accountType: "checking" | "credit_card" // acota qué campos tiene sentido buscar
  }): Promise<BalanceReading | null>
}

// Tope de capturas por lectura. Cada imagen cuesta, y más de esto ya no es "el dato está repartido"
// sino un álbum: con 5 pantallas se cubren nacional, internacional, línea y detalle.
export const MAX_SCAN_IMAGES = 5

export class BalanceScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BalanceScanError"
  }
}

// Un monto con más decimales de los que la moneda admite es la FIRMA de un error de lectura, no un
// redondeo: en Chile el punto separa miles, así que "$1.334.697" leído como decimal da 1,334697 —y
// Money, que en CLP no tiene decimales, lo redondearía a $1 sin que ninguna otra validación lo note.
// Por eso se rechaza acá, antes de construir el Money.
function amount(value: number, currency: CurrencyCode): Money {
  const decimals = CURRENCY_DECIMALS[currency]
  const text = String(value)
  const dot = text.indexOf(".")
  if (dot !== -1 && text.length - dot - 1 > decimals)
    throw new BalanceScanError(
      decimals === 0
        ? `El monto ${text} tiene decimales y los pesos no los usan: se leyó mal el separador de miles`
        : `El monto ${text} tiene más de ${decimals} decimales`
    )
  return Money.of(value, currency)
}

// Comprueba la captura contra el cupo total guardado, que es el que manda. Dos formas de contrastar,
// la que alcance: si la imagen trae disponible Y usado tienen que sumar ese total; si trae el cupo
// total, tiene que ser ese mismo.
//
// Es la ÚNICA forma automática de cazar un dígito mal leído: con un solo valor, un $1.834.697 en vez
// de $1.334.697 es aritméticamente impecable y no hay con qué contrastarlo. Devuelve la diferencia
// (guardado − leído, para poder decirla) o null si cuadra o si no hay con qué comparar.
export function limitMismatch(
  reading: BucketReading,
  savedLimit: Money | null,
  currency: CurrencyCode
): Money | null {
  if (!savedLimit || !savedLimit.isPositive) return null
  const { limit, available, used } = reading
  const seen =
    available !== null && used !== null
      ? amount(available, currency).add(amount(used, currency))
      : limit !== null
        ? amount(limit, currency)
        : null
  if (!seen) return null
  // Money opera en unidad mínima con BigInt: la comparación es exacta, sin tolerancia que calibrar.
  const diff = savedLimit.subtract(seen)
  return diff.isZero ? null : diff
}

// Escalera de fórmulas para un bucket. Devuelve null cuando lo leído no alcanza para calcular nada
// —ahí el bucket se deja intacto, que es mejor que inventar un saldo—.
//
// `savedLimit` es el cupo de la cuenta y NO se toca: el disponible y el usado son complementos suyos,
// así que basta con leer uno de los dos. El disponible va primero porque es el que la app del banco
// muestra siempre; si además vino el usado, ese solo sirvió para comprobar (ver `limitMismatch`).
// Única excepción: una cuenta que todavía no tiene cupo guardado —ahí no hay nada que proteger y la
// captura lo estrena—.
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
  // Un monto que se sale del cupo significa que se leyó mal algo: es preferible fallar visible a
  // guardar un saldo imposible.
  if (resolved.limitAmount.isNegative)
    throw new BalanceScanError("Los montos leídos dan un cupo negativo")
  if (resolved.used.isNegative)
    throw new BalanceScanError("El disponible leído supera el cupo total")
  if (resolved.available.isNegative)
    throw new BalanceScanError("El utilizado leído supera el cupo total")
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

