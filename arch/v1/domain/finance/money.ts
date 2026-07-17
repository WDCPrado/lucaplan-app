// Value object de dinero. Guarda el monto en la unidad mínima de la moneda (enteros
// vía bigint) para evitar errores de float. Prohíbe operar entre monedas distintas:
// sumar CLP + USD lanza error en vez de producir un total sin sentido.

export const CURRENCY_DECIMALS = { CLP: 0, USD: 2 } as const
export type CurrencyCode = keyof typeof CURRENCY_DECIMALS

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`No se pueden operar montos de distinta moneda: ${a} vs ${b}`)
    this.name = "CurrencyMismatchError"
  }
}

function toMinor(value: number | string, decimals: number): bigint {
  if (typeof value === "number")
    return BigInt(Math.round(value * 10 ** decimals))
  const trimmed = value.trim()
  const neg = trimmed.startsWith("-")
  const [intPart, fracPart = ""] = trimmed.replace(/^[-+]/, "").split(".")
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals)
  const minor =
    BigInt(intPart || "0") * BigInt(10) ** BigInt(decimals) +
    BigInt(frac || "0")
  return neg ? -minor : minor
}

export class Money {
  readonly minor: bigint
  readonly currency: CurrencyCode

  private constructor(minor: bigint, currency: CurrencyCode) {
    this.minor = minor
    this.currency = currency
  }

  /** Construye desde unidad mayor (ej. 19.10 USD, 19005 CLP) o string decimal. */
  static of(value: number | string, currency: CurrencyCode): Money {
    return new Money(toMinor(value, CURRENCY_DECIMALS[currency]), currency)
  }

  /** Construye desde la unidad MÍNIMA ya entera (centavos USD, pesos CLP). */
  static fromMinor(minor: number | bigint, currency: CurrencyCode): Money {
    return new Money(
      typeof minor === "bigint" ? minor : BigInt(Math.round(minor)),
      currency
    )
  }

  static zero(currency: CurrencyCode): Money {
    return new Money(BigInt(0), currency)
  }

  private guard(other: Money): void {
    if (this.currency !== other.currency)
      throw new CurrencyMismatchError(this.currency, other.currency)
  }

  add(other: Money): Money {
    this.guard(other)
    return new Money(this.minor + other.minor, this.currency)
  }

  subtract(other: Money): Money {
    this.guard(other)
    return new Money(this.minor - other.minor, this.currency)
  }

  negate(): Money {
    return new Money(-this.minor, this.currency)
  }

  get isPositive(): boolean {
    return this.minor > BigInt(0)
  }

  get isNegative(): boolean {
    return this.minor < BigInt(0)
  }

  get isZero(): boolean {
    return this.minor === BigInt(0)
  }

  /** -1, 0, 1 comparando con otro monto de la misma moneda. */
  compare(other: Money): number {
    this.guard(other)
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0
  }

  /** Monto en unidad mayor, para display/tests (puede perder precisión en floats grandes). */
  toMajor(): number {
    return Number(this.minor) / 10 ** CURRENCY_DECIMALS[this.currency]
  }

  /** Decimal string exacto (sin float), para persistir en columnas NUMERIC. Ej. "19.10", "-100000". */
  toDecimalString(): string {
    const decimals = CURRENCY_DECIMALS[this.currency]
    const neg = this.minor < BigInt(0)
    const digits = (neg ? -this.minor : this.minor)
      .toString()
      .padStart(decimals + 1, "0")
    if (decimals === 0) return (neg ? "-" : "") + digits
    const int = digits.slice(0, -decimals)
    const frac = digits.slice(-decimals)
    return `${neg ? "-" : ""}${int}.${frac}`
  }

  toString(): string {
    return `${this.toMajor()} ${this.currency}`
  }
}
