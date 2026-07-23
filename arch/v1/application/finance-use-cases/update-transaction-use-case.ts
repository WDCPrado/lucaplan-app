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
import {
  InstallmentAmountReadOnlyError,
  InstallmentCategoryRequiredError,
  type InstallmentPlanRepository,
} from "../../domain/finance/installment.domain.ts"

export type UpdateTransactionInput = {
  transactionId: string
  description: string
  amount: number // unidad mayor, en la moneda de la cuenta
  direction: Direction
  categoryId: string | null
  date: Date
}

type Deps = {
  accounts: AccountRepository
  transactions: TransactionRepository
  installments?: InstallmentPlanRepository // opcional: propaga la categoría al plan de cuotas
}

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
  const amount = Money.of(input.amount, account.currency) // misma moneda de la cuenta
  // Movimiento de una cuota: la categoría es del plan (no puede quedar sin ella) y el monto es un
  // espejo del cronograma — se corrige en el plan, que sincroniza el movimiento, nunca al revés.
  if (tx.installmentItemId) {
    if (!input.categoryId) throw new InstallmentCategoryRequiredError()
    if (amount.compare(tx.amount) !== 0)
      throw new InstallmentAmountReadOnlyError()
  }
  const updated = await deps.transactions.update({
    id: input.transactionId,
    description: input.description,
    date: input.date,
    amount,
    direction: input.direction,
    categoryId: input.categoryId,
  })
  // Recategorizar una cuota recategoriza su plan completo, igual que desde el modal conectado.
  if (
    tx.installmentItemId &&
    input.categoryId &&
    input.categoryId !== tx.categoryId &&
    deps.installments
  ) {
    const plan = await deps.installments.findByTransaction(tx.id)
    if (plan) await deps.installments.setCategory(plan.id, input.categoryId)
  }
  return updated
}

export async function deleteTransaction(
  deps: Deps,
  userId: string,
  transactionId: string
): Promise<void> {
  await loadEditable(deps, userId, transactionId)
  await deps.transactions.delete(transactionId)
}
