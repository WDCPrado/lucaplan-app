// Lectura de una captura de pantalla de la app del banco → saldos del dominio. PURO: sin IA, sin
// Prisma, sin HTTP. La IA solo aporta números sueltos (`BalanceReading`); QUÉ se puede calcular con
// ellos se decide acá.
//
// El problema real: las capturas casi nunca traen todas las variables. La app del banco muestra el
// disponible pero no el cupo total; a veces muestra el usado; a veces solo el saldo. Por eso no hay
// una fórmula sino una escalera: se usa la primera que se pueda armar con lo que llegó, y lo ya
// guardado en la app solo rellena lo que la imagen no dice.
import { Money, type CurrencyCode } from "./money.ts"

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
    imageDataUrl: string // data: URL con la captura (no se persiste en ningún lado)
    accountType: "checking" | "credit_card" // acota qué campos tiene sentido buscar
  }): Promise<BalanceReading | null>
}

export class BalanceScanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BalanceScanError"
  }
}

// Escalera de fórmulas para un bucket. Devuelve null cuando lo leído no alcanza para calcular nada
// —ahí el bucket se deja intacto, que es mejor que inventar un saldo—. `currentLimit` es el cupo ya
// guardado: solo se usa si la imagen no trae uno.
export function resolveBucket(
  reading: BucketReading,
  currentLimit: Money | null,
  currency: CurrencyCode
): ResolvedBucket | null {
  const money = (v: number | null) => (v === null ? null : Money.of(v, currency))
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
  const balance = Money.of(reading.cash, "CLP")
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
