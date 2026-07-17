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
import { applyInternalCredit, type BucketAmounts } from "./email-projection.ts"

export type CreateTransactionInput = {
  accountId: string
  categoryId: string | null
  amount: number // unidad mayor (ej. 20000 CLP)
  currency: CurrencyCode
  direction: Direction
  description: string
  date: Date
}

// Crea un movimiento: valida ownership + moneda vs. cuenta, y el adapter ajusta el saldo atómicamente
// (débito resta → en credit_card sube su deuda; crédito suma).
//
// Cuentas conectadas: fintoc sigue de solo lectura. Las conectadas por correo aceptan SOLO
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
  // Conectadas: solo abonos manuales a la corriente por correo; todo lo demás llega por sync.
  if (
    connected &&
    (account.provider === "fintoc" ||
      input.direction !== "credit" ||
      account.accountType !== "checking")
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
    const buckets = await deps.balanceBuckets.listByAccount(account.id)
    const cash = buckets.find((b) => b.kind === "cash")
    if (cash) {
      const od = buckets.find((b) => b.kind === "overdraft") ?? null
      const amounts = (b: {
        limitAmount: Money
        used: Money
        available: Money
      }): BucketAmounts => ({
        limitAmount: b.limitAmount,
        used: b.used,
        available: b.available,
      })
      const res = applyInternalCredit(
        amounts(cash),
        od ? amounts(od) : null,
        Money.of(input.amount, input.currency)
      )
      const asOf = new Date()
      await deps.balanceBuckets.updateAmounts(cash.id, { ...res.cash, asOf })
      if (od && res.overdraft)
        await deps.balanceBuckets.updateAmounts(od.id, {
          ...res.overdraft,
          asOf,
        })
      await deps.accounts.setBalance(account.id, res.cash.available)
    }
  }
  return tx
}
