import {
  type AccountRepository,
  type TransactionRepository,
  type Transaction,
  type Direction,
  AccountNotFoundError,
  NotOwnerError,
  TransactionCurrencyMismatchError,
  ConnectedAccountReadOnlyError,
} from "../../domain/finance/finance.domain.ts";
import { Money, type CurrencyCode } from "../../domain/finance/money.ts";

export type CreateTransactionInput = {
  accountId: string;
  categoryId: string | null;
  amount: number; // unidad mayor (ej. 20000 CLP)
  currency: CurrencyCode;
  direction: Direction;
  description: string;
  date: Date;
};

// Crea un movimiento: valida ownership + moneda vs. cuenta, y el adapter ajusta el saldo atómicamente
// (débito resta → en credit_card sube su deuda; crédito suma).
export async function createTransaction(
  deps: { accounts: AccountRepository; transactions: TransactionRepository },
  userId: string,
  input: CreateTransactionInput,
): Promise<Transaction> {
  const account = await deps.accounts.findById(input.accountId);
  if (!account) throw new AccountNotFoundError(input.accountId);
  if (account.userId !== userId) throw new NotOwnerError();
  // Las cuentas conectadas (fintoc) son de solo lectura: sus movimientos solo llegan por sync.
  if (account.provider === "fintoc") throw new ConnectedAccountReadOnlyError();
  if (input.currency !== account.currency) throw new TransactionCurrencyMismatchError();

  return deps.transactions.create({
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    date: input.date,
    description: input.description,
    amount: Money.of(input.amount, input.currency),
    direction: input.direction,
  });
}
