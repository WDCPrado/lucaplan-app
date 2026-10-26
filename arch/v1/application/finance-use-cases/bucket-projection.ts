// Proyección con IO sobre los buckets de una cuenta: aplica un abono (sube la caja sin amortizar la línea) o un cargo (consume caja, el exceso usa sobregiro) y fija el saldo
// derivado de la cuenta (balance = caja disponible). En una tarjeta de crédito —que no tiene caja—
// el cargo consume cupo y el abono lo paga. Sin buckets —cuentas manuales— es no-op: ahí la
// columna balance ya la ajustó el adapter. La usan el abono manual, el generar/deshacer del ingreso
// mensual y el registro de movimientos por foto.
import type {
  AccountRepository,
  BalanceBucketRepository,
} from "../../domain/finance/finance.domain.ts"
import type { Money } from "../../domain/finance/money.ts"
import {
  applyCreditPurchase,
  applyDebitToCash,
  applyInternalCredit,
  applyInternalPayment,
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
  const amounts = (b: {
    limitAmount: Money
    used: Money
    available: Money
  }): BucketAmounts => ({
    limitAmount: b.limitAmount,
    used: b.used,
    available: b.available,
  })
  const cash = buckets.find((b) => b.kind === "cash")
  if (!cash) {
    // Tarjeta de crédito: sin caja, el movimiento va contra el cupo de SU moneda (el nacional es
    // CLP y el internacional USD; nunca se suman). El saldo de la tarjeta es su deuda en negativo,
    // misma regla que usa el correo.
    const kind =
      amount.currency === "USD" ? "credit_international" : "credit_national"
    const card = buckets.find((b) => b.kind === kind)
    if (!card) return
    const next =
      direction === "debit"
        ? applyCreditPurchase(amounts(card), amount)
        : applyInternalPayment(amounts(card), amount)
    await deps.balanceBuckets.updateAmounts(card.id, {
      ...next,
      asOf: new Date(),
    })
    if (kind === "credit_national")
      await deps.accounts.setBalance(accountId, next.used.negate())
    return
  }
  const od = buckets.find((b) => b.kind === "overdraft") ?? null
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

