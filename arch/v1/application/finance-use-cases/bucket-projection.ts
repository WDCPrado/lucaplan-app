// Proyección con IO sobre los buckets de una cuenta: aplica un abono (paga sobregiro primero,
// el resto sube la caja) o un cargo (consume caja, el exceso usa sobregiro) y fija el saldo
// derivado de la cuenta (balance = caja disponible). Sin bucket de caja —cuentas manuales— es
// no-op: ahí la columna balance ya la ajustó el adapter. La usan el abono manual y el
// generar/deshacer del ingreso mensual.
import type {
  AccountRepository,
  BalanceBucketRepository,
} from "../../domain/finance/finance.domain.ts"
import type { Money } from "../../domain/finance/money.ts"
import {
  applyDebitToCash,
  applyInternalCredit,
  type BucketAmounts,
} from "./email-projection.ts"

export async function projectCashEvent(
  deps: {
    accounts: AccountRepository
    balanceBuckets: BalanceBucketRepository
  },
  accountId: string,
  amount: Money,
  direction: "credit" | "debit"
): Promise<void> {
  const buckets = await deps.balanceBuckets.listByAccount(accountId)
  const cash = buckets.find((b) => b.kind === "cash")
  if (!cash) return
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
  const res =
    direction === "credit"
      ? applyInternalCredit(amounts(cash), od ? amounts(od) : null, amount)
      : applyDebitToCash(amounts(cash), od ? amounts(od) : null, amount)
  const asOf = new Date()
  await deps.balanceBuckets.updateAmounts(cash.id, { ...res.cash, asOf })
  if (od && res.overdraft)
    await deps.balanceBuckets.updateAmounts(od.id, { ...res.overdraft, asOf })
  await deps.accounts.setBalance(accountId, res.cash.available)
}
