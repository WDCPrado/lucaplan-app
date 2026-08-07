// Lectura de una captura de pantalla de la app del banco → saldos del dominio. PURO: sin IA, sin
// Prisma, sin HTTP. La IA solo aporta números sueltos (`BalanceReading`); QUÉ se puede calcular con
// ellos se decide acá.
//
// El problema real: las capturas casi nunca traen todas las variables. La app del banco muestra el
// disponible pero no el cupo total; a veces muestra el usado; a veces solo el saldo. Por eso no hay
// una fórmula sino una escalera: se usa la primera que se pueda armar con lo que llegó, y lo ya
// guardado en la app solo rellena lo que la imagen no dice.
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
  cash: number | null // saldo de la cuenta corriente; NEGATIVO = está girando contra la línea
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

// Cuando la captura trae el cupo, el disponible Y el usado hay redundancia: los tres tienen que
// cumplir `cupo = disponible + usado`. Si no cuadran, alguno se leyó mal.
//
// Es la ÚNICA forma automática de cazar un dígito mal leído: con solo dos valores, un $1.834.697 en
// vez de $1.334.697 es aritméticamente impecable y no hay con qué contrastarlo. Devuelve la
// diferencia (para poder decirla) o null si cuadra o si no vinieron los tres.
export function bucketMismatch(
  reading: BucketReading,
  currency: CurrencyCode
): Money | null {
  const { limit, available, used } = reading
  if (limit === null || available === null || used === null) return null
  // Money opera en unidad mínima con BigInt: la comparación es exacta, sin tolerancia que calibrar.
  const diff = amount(limit, currency).subtract(
    amount(available, currency).add(amount(used, currency))
  )
  return diff.isZero ? null : diff
}

// Escalera de fórmulas para un bucket. Devuelve null cuando lo leído no alcanza para calcular nada
// —ahí el bucket se deja intacto, que es mejor que inventar un saldo—. `currentLimit` es el cupo ya
// guardado: solo se usa si la imagen no trae uno.
export function resolveBucket(
  reading: BucketReading,
  currentLimit: Money | null,
  currency: CurrencyCode
): ResolvedBucket | null {
  const money = (v: number | null) => (v === null ? null : amount(v, currency))
  const limit = money(reading.limit)
  const available = money(reading.available)
  const used = money(reading.used)

  // Orden deliberado: lo que la imagen dice explícitamente gana sobre lo derivado, y lo derivado de
  // la imagen gana sobre el cupo guardado (que puede estar viejo).
  const resolved = ((): ResolvedBucket | null => {
    if (limit && available)
      return { limitAmount: limit, available, used: limit.subtract(available) }
    if (limit && used)
      return { limitAmount: limit, used, available: limit.subtract(used) }
    // Sin cupo en la imagen: el total es lo disponible más lo usado.
    if (available && used)
      return { limitAmount: available.add(used), available, used }
    if (!currentLimit) return null
    if (available)
      return {
        limitAmount: currentLimit,
        available,
        used: currentLimit.subtract(available),
      }
    if (used)
      return {
        limitAmount: currentLimit,
        used,
        available: currentLimit.subtract(used),
      }
    return null
  })()

  if (!resolved) return null
  // Un cupo negativo o un disponible mayor que el total significan que se leyó mal algo: es preferible
  // fallar visible a guardar un saldo imposible.
  if (resolved.limitAmount.isNegative || resolved.used.isNegative)
    throw new BalanceScanError("Los montos leídos dan un cupo o un usado negativo")
  if (resolved.available.isNegative)
    throw new BalanceScanError("El disponible leído supera el cupo total")
  return resolved
}

// Cuenta corriente: caja + línea de crédito. Un saldo negativo NO es caja negativa: significa que la
// caja está en cero y esa plata se debe a la línea. Ese mismo saldo es entonces el `usado` de la
// línea, y con el disponible de la línea que muestra la captura el cupo total sale solo
// (cupo = disponible + usado), sin depender de lo guardado.
export function resolveChecking(
  reading: BalanceReading,
  currentOverdraftLimit: Money | null
): { cash: Money; overdraft: ResolvedBucket | null } | null {
  if (reading.cash === null) return null
  const balance = amount(reading.cash, "CLP")
  const cash = balance.isNegative ? Money.zero("CLP") : balance
  const overdraft = resolveBucket(
    {
      ...reading.overdraft,
      // El saldo negativo es deuda de la línea; solo se usa si la imagen no trae el usado explícito.
      used: reading.overdraft.used ?? (balance.isNegative ? -reading.cash : null),
    },
    currentOverdraftLimit,
    "CLP"
  )
  return { cash, overdraft }
}
