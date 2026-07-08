import type { AccountRepository, BankRepository, Account, AccountType } from "../../domain/finance/finance.domain.ts";
import { Money, type CurrencyCode } from "../../domain/finance/money.ts";

export type CreateAccountInput = {
  bankName: string;
  name: string;
  accountType: AccountType;
  currency: CurrencyCode;
  balance: number;
  overdraftLimit?: number;
  color?: string | null;
};

// Crea una cuenta para el usuario. Reutiliza el banco si ya existe por nombre; si no, lo crea.
// Permite a un usuario nuevo (sin datos) arrancar desde cero.
export async function createAccount(
  deps: { banks: BankRepository; accounts: AccountRepository },
  userId: string,
  input: CreateAccountInput,
): Promise<Account> {
  const banks = await deps.banks.listByUser(userId);
  const bank = banks.find((b) => b.name === input.bankName) ?? (await deps.banks.create({ userId, name: input.bankName }));
  return deps.accounts.create({
    userId,
    bankId: bank.id,
    name: input.name,
    accountType: input.accountType,
    currency: input.currency,
    balance: Money.of(input.balance, input.currency),
    overdraftLimit: Money.of(input.overdraftLimit ?? 0, input.currency),
    color: input.color ?? null,
  });
}
