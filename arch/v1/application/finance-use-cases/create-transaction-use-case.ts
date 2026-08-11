import {
  type AccountRepository,
  type BalanceBucketRepository,
  type TransactionRepository,
  type Transaction,
  type Direction,
  AccountNotFoundError,
  NotOwnerError,
  TransactionCurrencyMismatchError,
  ConnectedAccountReadOnlyError,
} from "../../domain/finance/finance.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import { projectCashEvent } from "./bucket-projection.ts"

export type CreateTransactionInput = {
  accountId: string
  categoryId: string | null
  amount: number // unidad mayor (ej. 20000 CLP)
  currency: CurrencyCode
  direction: Direction
  description: string
  date: Date
  // Vía por la que entra el movimiento. "bank-scan" es la única que puede registrar un cargo en una
  // cuenta conectada: son los movimientos que el banco no avisó, leídos de una foto de la cartola y
  // ya contrastados contra lo registrado. Por defecto "manual".
  source?: "manual" | "bank-scan"
}

// Crea un movimiento: valida ownership + moneda vs. cuenta, y el adapter ajusta el saldo atómicamente
// (débito resta → en credit_card sube su deuda; crédito suma).
//
// Cuentas conectadas por correo: aceptan SOLO
// ingresos (credit) en la cuenta corriente — el banco no notifica abonos por correo, así que se
// registran a mano; los cargos sí llegan solos y no se duplican. El abono se proyecta en los
// buckets igual que un abono del banco (paga sobregiro primero, el resto sube la caja) y el saldo
// de la cuenta queda = caja disponible (pisa el ajuste de columna del adapter).
export async function createTransaction(
  deps: {
    accounts: AccountRepository
    transactions: TransactionRepository
    balanceBuckets?: BalanceBucketRepository // requerido en la práctica para cuentas conectadas
  },
  userId: string,
  input: CreateTransactionInput
): Promise<Transaction> {
  const account = await deps.accounts.findById(input.accountId)
  if (!account) throw new AccountNotFoundError(input.accountId)
  if (account.userId !== userId) throw new NotOwnerError()
  const connected = account.provider !== "manual"
  // Conectadas: solo abonos manuales a la corriente por correo; todo lo demás llega por sync. La
  // excepción es la foto de la cartola, que existe justo para lo que el banco NO avisó y ya pasó
  // por la deduplicación contra lo registrado.
  if (
    connected &&
    input.source !== "bank-scan" &&
    (input.direction !== "credit" || account.accountType !== "checking")
  )
    throw new ConnectedAccountReadOnlyError()
  if (input.currency !== account.currency)
    throw new TransactionCurrencyMismatchError()

  const tx = await deps.transactions.create({
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    date: input.date,
    description: input.description,
    amount: Money.of(input.amount, input.currency),
    direction: input.direction,
  })

  if (connected && deps.balanceBuckets) {
    // ponytail: create + proyección no son atómicos; si esto falla, "Actualizar saldos" reconcilia.
    await projectCashEvent(
      { accounts: deps.accounts, balanceBuckets: deps.balanceBuckets },
      account.id,
      Money.of(input.amount, input.currency),
      input.direction
    )
  }
  return tx
}
