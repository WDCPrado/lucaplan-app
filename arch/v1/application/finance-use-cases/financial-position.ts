import type {
  Account,
  BalanceBucket,
} from "../../domain/finance/finance.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"

const CURRENCIES: CurrencyCode[] = ["CLP", "USD"]

export type CurrencyPosition = {
  currency: CurrencyCode
  cash: number // saldo firmado de cuentas corrientes, separado de la línea
  overdraftUsed: number // deuda de sobregiro: NO es caja
  overdraftAvailable: number // línea disponible: capacidad de endeudarse, NO es caja
  cardDebt: number // deuda de tarjetas de crédito en esta moneda
  cardAvailable: number // cupo disponible de tarjetas conectadas: NO es caja
  otherBalances: number // ahorro, billeteras e inversiones (no cuentan como caja activa)
}

/**
 * Posición por moneda. Cuentas conectadas: caja, sobregiro y cupos salen de sus buckets (el saldo
 * de caja conserva su signo y no se convierte en deuda de línea). Cuentas manuales sin buckets: el saldo
 * negativo de una corriente es sobregiro usado, y el de una tarjeta, su deuda.
 */
export function currencyPositions(
  accounts: Account[],
  buckets: BalanceBucket[]
): CurrencyPosition[] {
  const pos = new Map(
    CURRENCIES.map((currency) => [
      currency,
      {
        currency,
        cash: Money.zero(currency),
        overdraftUsed: Money.zero(currency),
        overdraftAvailable: Money.zero(currency),
        cardDebt: Money.zero(currency),
        cardAvailable: Money.zero(currency),
        otherBalances: Money.zero(currency),
      },
    ])
  )
  const add = (
    currency: CurrencyCode,
    field: Exclude<keyof CurrencyPosition, "currency">,
    amount: Money
  ) => {
    const p = pos.get(currency)
    if (p) p[field] = p[field].add(amount)
  }
  for (const account of accounts) {
    const own = buckets.filter((b) => b.accountId === account.id)
    const zero = Money.zero(account.currency)
    if (account.accountType === "checking") {
      const cash = own.find((b) => b.kind === "cash")
      const od = own.find((b) => b.kind === "overdraft")
      if (cash) {
        add(cash.currency, "cash", cash.available)
        if (od) {
          add(od.currency, "overdraftUsed", od.used)
          add(od.currency, "overdraftAvailable", od.available)
        }
      } else if (account.balance.isNegative) {
        const used = account.balance.negate()
        add(account.currency, "overdraftUsed", used)
        add(
          account.currency,
          "overdraftAvailable",
          account.overdraftLimit.subtract(used)
        )
      } else {
        add(account.currency, "cash", account.balance)
        add(account.currency, "overdraftAvailable", account.overdraftLimit)
      }
    } else if (account.accountType === "credit_card") {
      const cards = own.filter(
        (b) => b.kind === "credit_national" || b.kind === "credit_international"
      )
      if (cards.length > 0)
        for (const b of cards) {
          add(b.currency, "cardDebt", b.used)
          add(b.currency, "cardAvailable", b.available)
        }
      else if (account.balance.isNegative)
        add(account.currency, "cardDebt", account.balance.negate())
    } else if (account.accountType === "credit_line") {
      if (account.balance.isNegative)
        add(account.currency, "overdraftUsed", account.balance.negate())
    } else if (account.balance.compare(zero) !== 0) {
      add(account.currency, "otherBalances", account.balance)
    }
  }
  return [...pos.values()].map((p) => ({
    currency: p.currency,
    cash: p.cash.toMajor(),
    overdraftUsed: p.overdraftUsed.toMajor(),
    overdraftAvailable: p.overdraftAvailable.toMajor(),
    cardDebt: p.cardDebt.toMajor(),
    cardAvailable: p.cardAvailable.toMajor(),
    otherBalances: p.otherBalances.toMajor(),
  }))
}
