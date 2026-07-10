// Asignar/cambiar la categoría de un movimiento. Es la ÚNICA edición permitida sobre movimientos
// de cuentas conectadas (fintoc); también sirve para los manuales. Valida ownership del movimiento
// y de la categoría. No toca el saldo.
import {
  AccountNotFoundError,
  NotOwnerError,
  CategoryNotFoundError,
  type CategoryRepository,
  type TransactionRepository,
  type Transaction,
} from "../../domain/finance/finance.domain.ts";

export async function categorizeTransaction(
  deps: { transactions: TransactionRepository; categories: CategoryRepository },
  userId: string,
  transactionId: string,
  categoryId: string | null,
): Promise<Transaction> {
  const tx = await deps.transactions.findById(transactionId);
  if (!tx) throw new AccountNotFoundError(transactionId);
  if (tx.userId !== userId) throw new NotOwnerError();
  if (categoryId) {
    const cat = await deps.categories.findById(categoryId);
    if (!cat) throw new CategoryNotFoundError(categoryId);
    if (cat.userId !== userId) throw new NotOwnerError();
  }
  return deps.transactions.setCategory(transactionId, categoryId);
}
