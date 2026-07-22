// Editar/borrar un movimiento MANUAL. Los movimientos de cuentas conectadas son de solo lectura →
// se rechazan. El repo reajusta el saldo de la cuenta atómicamente.
import {
  type AccountRepository,
  type TransactionRepository,
  type Transaction,
  type Direction,
  AccountNotFoundError,
  NotOwnerError,
  ConnectedAccountReadOnlyError,
} from "../../domain/finance/finance.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { RecurringCategoryRequiredError } from "../../domain/finance/recurring.domain.ts"

export type UpdateTransactionInput = {
  transactionId: string
  description: string
  amount: number // unidad mayor, en la moneda de la cuenta
  direction: Direction
  categoryId: string | null
  date: Date
}

type Deps = { accounts: AccountRepository; transactions: TransactionRepository }

// Carga el movimiento y valida que sea editable (existe, es del usuario, y su cuenta es manual).
// En cuentas conectadas por correo editar/borrar ajustaría la columna de saldo por fuera de
// la proyección de buckets → todo queda de solo lectura; los abonos manuales se corrigen con
// "Actualizar saldos".
async function loadEditable(deps: Deps, userId: string, transactionId: string) {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  const account = await deps.accounts.findById(tx.accountId)
  if (!account) throw new AccountNotFoundError(tx.accountId)
  if (account.provider !== "manual") throw new ConnectedAccountReadOnlyError()
  return { tx, account }
}

export async function updateTransaction(
  deps: Deps,
  userId: string,
  input: UpdateTransactionInput
): Promise<Transaction> {
  const { tx, account } = await loadEditable(deps, userId, input.transactionId)
  if (!input.categoryId && tx.recurringTemplateId)
    throw new RecurringCategoryRequiredError()
  return deps.transactions.update({
    id: input.transactionId,
    description: input.description,
    date: input.date,
    amount: Money.of(input.amount, account.currency), // misma moneda de la cuenta
    direction: input.direction,
    categoryId: input.categoryId,
  })
}

export async function deleteTransaction(
  deps: Deps,
  userId: string,
  transactionId: string
): Promise<void> {
  await loadEditable(deps, userId, transactionId)
  await deps.transactions.delete(transactionId)
}
