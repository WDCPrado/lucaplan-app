import { isDuplicateInstallmentPayment } from "./duplicate-installment-payment.ts"
import type { BudgetPeriodDeps } from "./budget-period-use-cases.ts"
// Editar un movimiento MANUAL (los de cuentas conectadas son de solo lectura → se rechazan).
// Borrar admite además cuentas conectadas: ABONOS, CARGOS SIN CATEGORÍA y cobros históricos
// duplicados de una cuota ya saldada por otro movimiento. El repo reajusta el saldo de la cuenta
// atómicamente.
import {
  type Account,
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

type Deps = BudgetPeriodDeps & {
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
  if (editRejection(loaded.account)) throw new ConnectedAccountReadOnlyError()
  return loaded
}

// Motivo por el que un movimiento NO se puede editar, o null. Lo usan el caso de uso y quien
// muestra las capacidades del movimiento (plugin), para que ambos digan lo mismo.
export function editRejection(account: Pick<Account, "provider">): string | null {
  return account.provider !== "manual"
    ? "Es de una cuenta conectada por correo: solo se puede cambiar su categoría"
    : null
}

// Motivo por el que un movimiento NO se puede borrar, o null. Manual: siempre. Conectada: abonos,
// cargos sin categoría y cobros sobrantes de una cuota ya saldada (`duplicateInstallment`).
export function deleteRejection(
  account: Pick<Account, "provider">,
  tx: Pick<Transaction, "direction" | "categoryId">,
  duplicateInstallment: boolean
): string | null {
  if (
    account.provider !== "manual" &&
    tx.direction !== "credit" &&
    tx.categoryId &&
    !duplicateInstallment
  )
    return "Es un cargo categorizado de una cuenta conectada: el banco es la fuente y no se borra"
  return null
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
  // Manual: se borra todo. Conectada: los abonos (los ingresa el usuario) y los cargos SIN
  // categoría — ruido del banco que nadie clasificó; borrarlos revierte el saldo hacia arriba.
  // Un cargo categorizado solo se borra si es un sobrante de una cuota ya saldada.
  // ponytail: no revierte los buckets (mismo techo que ungenerateMonthly); se corrigen con
  // "Actualizar saldos".
  const { tx, account } = await loadOwned(deps, userId, transactionId)
  const duplicate =
    account.provider !== "manual" &&
    tx.direction !== "credit" &&
    !!tx.categoryId &&
    (await isDuplicateInstallmentPayment(deps, userId, tx))
  if (deleteRejection(account, tx, duplicate))
    throw new ConnectedAccountReadOnlyError()
  await deps.transactions.delete(transactionId)
}
