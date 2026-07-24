// Editar/borrar un movimiento MANUAL (los de cuentas conectadas son de solo lectura → se
// rechazan), con una excepción: los ABONOS de cuentas conectadas también se pueden borrar,
// porque los ingresa el usuario (el banco no los notifica por correo). El repo reajusta el
// saldo de la cuenta atómicamente.
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

// Carga el movimiento y valida dueño y cuenta; la editabilidad se decide en cada operación.
async function loadOwned(deps: Deps, userId: string, transactionId: string) {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx) throw new AccountNotFoundError(transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  const account = await deps.accounts.findById(tx.accountId)
  if (!account) throw new AccountNotFoundError(tx.accountId)
  return { tx, account }
}

// Editable = cuenta manual. En cuentas conectadas por correo editar ajustaría la columna de
// saldo por fuera de la proyección de buckets → solo lectura; los saldos se corrigen con
// "Actualizar saldos".
async function loadEditable(deps: Deps, userId: string, transactionId: string) {
  const loaded = await loadOwned(deps, userId, transactionId)
  if (loaded.account.provider !== "manual")
    throw new ConnectedAccountReadOnlyError()
  return loaded
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
  // Manual: se borra todo. Conectada: solo abonos — los ingresó el usuario y borrarlos revierte
  // el saldo, igual que deshacer un ingreso generado (ungenerateMonthly).
  // ponytail: no revierte los buckets del abono (mismo techo que ungenerateMonthly); se corrigen
  // con "Actualizar saldos".
  const { tx, account } = await loadOwned(deps, userId, transactionId)
  if (account.provider !== "manual" && tx.direction !== "credit")
    throw new ConnectedAccountReadOnlyError()
  await deps.transactions.delete(transactionId)
}
