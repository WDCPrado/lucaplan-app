// Proyección PURA de balances estimados para el método correo. Los buckets guardan la última
// medición; estas reglas pequeñas y deterministas la avanzan con cada evento POSTERIOR al snapshot
// manual vigente. Nunca convierten monedas ni inventan ajustes: lo ambiguo se corrige reemplazando
// el snapshot ("Actualizar saldos").
import { Money } from "../../domain/finance/money.ts"

// Montos de un bucket (misma forma que BalanceBucket, sin identidad).
export type BucketAmounts = {
  limitAmount: Money
  used: Money
  available: Money
}

function max(a: Money, b: Money): Money {
  return a.compare(b) >= 0 ? a : b
}

// Débito CLP en la corriente (cargo/transferencia): consume primero la caja; el exceso aumenta el
// sobregiro usado. Sin bucket de sobregiro, la caja queda negativa (visible, no se oculta).
export function applyDebitToCash(
  cash: BucketAmounts,
  overdraft: BucketAmounts | null,
  amount: Money
): { cash: BucketAmounts; overdraft: BucketAmounts | null } {
  const zero = Money.zero(amount.currency)
  const remaining = cash.available.subtract(amount)
  if (!overdraft || remaining.compare(zero) >= 0) {
    return { cash: { ...cash, available: remaining }, overdraft }
  }
  const excess = remaining.negate()
  const used = overdraft.used.add(excess)
  return {
    cash: { ...cash, available: zero },
    overdraft: {
      ...overdraft,
      used,
      available: overdraft.limitAmount.subtract(used),
    },
  }
}

// Un abono aumenta caja. La línea solo se amortiza ante un pago explícito del banco:
// caja positiva y deuda de sobregiro pueden coexistir.
export function applyInternalCredit(
  cash: BucketAmounts,
  overdraft: BucketAmounts | null,
  amount: Money
): { cash: BucketAmounts; overdraft: BucketAmounts | null } {
  return {
    cash: { ...cash, available: cash.available.add(amount) },
    overdraft,
  }
}

// Compra con tarjeta: aumenta el usado y reduce el disponible del cupo de SU moneda (nacional CLP o
// internacional USD). El disponible puede quedar negativo si se excede el cupo (se muestra, no se
// oculta).
export function applyCreditPurchase(
  bucket: BucketAmounts,
  amount: Money
): BucketAmounts {
  const used = bucket.used.add(amount)
  return { ...bucket, used, available: bucket.limitAmount.subtract(used) }
}

// Pago interno inequívoco de tarjeta/línea: reduce la deuda del bucket, nunca bajo cero.
export function applyInternalPayment(
  bucket: BucketAmounts,
  amount: Money
): BucketAmounts {
  const used = max(bucket.used.subtract(amount), Money.zero(amount.currency))
  return { ...bucket, used, available: bucket.limitAmount.subtract(used) }
}

