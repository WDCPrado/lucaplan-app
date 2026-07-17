// Mapeo puro: datos crudos de Fintoc → dominio. Sin IO. Reglas: vista/corriente = caja (checking);
// monto de Fintoc en unidad mínima con signo (+ ingreso / − gasto); solo monedas soportadas.
import {
  Money,
  CURRENCY_DECIMALS,
  type CurrencyCode,
} from "../../domain/finance/money.ts"
import type {
  AccountType,
  Direction,
  ImportMovement,
  MovementStatus,
} from "../../domain/finance/finance.domain.ts"
import type {
  ProviderAccount,
  ProviderMovement,
} from "../../domain/finance/bank-aggregation.port.ts"

// Tipo de cuenta crudo de Fintoc → nuestro AccountType.
export function mapAccountType(rawType: string): AccountType {
  switch (rawType) {
    case "checking_account":
    case "sight_account":
      return "checking" // corriente/vista = caja activa
    case "savings_account":
      return "savings"
    case "credit_card":
      return "credit_card"
    case "line_of_credit":
      return "credit_line"
    default:
      return "wallet" // desconocido: no cuenta como caja ni deuda
  }
}

export function isSupportedCurrency(c: string): c is CurrencyCode {
  return c in CURRENCY_DECIMALS
}

export function mapStatus(
  raw: string | null,
  pending: boolean
): MovementStatus {
  if (
    raw === "confirmed" ||
    raw === "pending" ||
    raw === "reversed" ||
    raw === "duplicated"
  )
    return raw
  return pending ? "pending" : "confirmed"
}

// ProviderAccount → campos de cuenta conectada, o null si la moneda no está soportada (se omite).
export function mapProviderAccount(a: ProviderAccount): {
  accountType: AccountType
  currency: CurrencyCode
  balance: Money
  overdraftLimit: Money
  cardLast4: string | null
} | null {
  if (!isSupportedCurrency(a.currency)) return null
  const currency = a.currency
  return {
    accountType: mapAccountType(a.rawType),
    currency,
    balance: Money.fromMinor(a.balanceCurrent, currency), // saldo del proveedor (autoritativo)
    overdraftLimit: Money.fromMinor(a.balanceLimit ?? 0, currency),
    cardLast4: a.numberLast4,
  }
}

// ProviderMovement → ImportMovement, o null si la moneda no está soportada. Signo → direction.
export function mapProviderMovement(
  m: ProviderMovement
): ImportMovement | null {
  if (!isSupportedCurrency(m.currency)) return null
  const currency = m.currency
  const direction: Direction = m.amount >= 0 ? "credit" : "debit"
  return {
    externalId: m.externalId,
    date: new Date(m.transactionDate ?? m.postDate),
    description: m.description,
    amount: Money.fromMinor(Math.abs(m.amount), currency),
    direction,
    status: mapStatus(m.status, m.pending),
  }
}
