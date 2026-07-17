import {
  accountHasCard,
  CardLast4RequiredError,
  type AccountRepository,
  type BankRepository,
  type Account,
  type AccountType,
} from "../../domain/finance/finance.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"

export type CreateAccountInput = {
  bankName: string
  name: string
  accountType: AccountType
  currency: CurrencyCode
  balance: number
  overdraftLimit?: number
  color?: string | null
  cardLast4?: string | null // requerido para tipos con tarjeta (checking/credit_card)
}

// Normaliza el número de tarjeta a exactamente 4 dígitos, o null si no hay/insuficiente.
function normalizeLast4(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "")
  return digits.length >= 4 ? digits.slice(-4) : null
}

// Crea una cuenta para el usuario. Reutiliza el banco si ya existe por nombre; si no, lo crea.
// Permite a un usuario nuevo (sin datos) arrancar desde cero.
export async function createAccount(
  deps: { banks: BankRepository; accounts: AccountRepository },
  userId: string,
  input: CreateAccountInput
): Promise<Account> {
  // Tarjeta: obligatoria (4 dígitos) para tipos con tarjeta; nula para el resto.
  const cardLast4 = accountHasCard(input.accountType)
    ? normalizeLast4(input.cardLast4)
    : null
  if (accountHasCard(input.accountType) && !cardLast4)
    throw new CardLast4RequiredError()

  const banks = await deps.banks.listByUser(userId)
  const bank =
    banks.find((b) => b.name === input.bankName) ??
    (await deps.banks.create({ userId, name: input.bankName }))
  return deps.accounts.create({
    userId,
    bankId: bank.id,
    name: input.name,
    accountType: input.accountType,
    currency: input.currency,
    balance: Money.of(input.balance, input.currency),
    overdraftLimit: Money.of(input.overdraftLimit ?? 0, input.currency),
    color: input.color ?? null,
    cardLast4,
  })
}
