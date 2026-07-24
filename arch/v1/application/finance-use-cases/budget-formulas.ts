// Fórmulas financieras puras. Sin IO: reciben datos ya cargados y devuelven derivados.
// Reglas clave: la caja activa es solo saldo positivo de cuentas corrientes (el cupo no
// es dinero); un saldo negativo es deuda de sobregiro, no caja; la posición neta combina
// ambas. El uso por categoría se calcula desde los movimientos, no se persiste.

import type {
  Account,
  CategoryLimit,
  MonthlyBudget,
  Transaction,
  CategoryStatus,
} from "../../domain/finance/finance.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"

/** Caja activa: Σ saldo POSITIVO de cuentas `checking` de la moneda dada. Cupos y negativos no cuentan. */
export function computeActiveCash(
  accounts: Account[],
  currency: CurrencyCode
): Money {
  return accounts
    .filter(
      (a) =>
        a.accountType === "checking" &&
        a.currency === currency &&
        a.balance.isPositive
    )
    .reduce((sum, a) => sum.add(a.balance), Money.zero(currency))
}

/** Sobregiro de una cuenta: usado = |saldo| si es negativo; disponible = límite − usado. */
export function computeOverdraft(account: Account): {
  used: Money
  available: Money
} {
  const used = account.balance.isNegative
    ? account.balance.negate()
    : Money.zero(account.currency)
  return { used, available: account.overdraftLimit.subtract(used) }
}

/** Deuda de sobregiro total: Σ saldos negativos de cuentas `checking` de la moneda dada. */
export function computeOverdraftDebt(
  accounts: Account[],
  currency: CurrencyCode
): Money {
  return accounts
    .filter(
      (a) =>
        a.accountType === "checking" &&
        a.currency === currency &&
        a.balance.isNegative
    )
    .reduce((sum, a) => sum.add(computeOverdraft(a).used), Money.zero(currency))
}

/** Posición neta = caja activa − deuda de sobregiro. Puede ser negativa (aquí aparece el rojo). */
export function computeNetPosition(
  accounts: Account[],
  currency: CurrencyCode
): Money {
  return computeActiveCash(accounts, currency).subtract(
    computeOverdraftDebt(accounts, currency)
  )
}

/**
 * Deuda de tarjeta de crédito POR TARJETA (saldo negativo de cada cuenta `credit_card`), separada
 * de la deuda de sobregiro: no pesan igual. El gasto con TC igual cuenta en el presupuesto del mes.
 */
export function creditCardDebts(
  accounts: Account[]
): { account: Account; debt: Money }[] {
  return accounts
    .filter((a) => a.accountType === "credit_card" && a.balance.isNegative)
    .map((a) => ({ account: a, debt: a.balance.negate() }))
}

/** Uso de una categoría en un mes: Σ gastos (`debit`) asociados; disponible = límite − usado. */
export function computeCategoryUsage(
  categoryId: string,
  limit: Money,
  transactions: Transaction[],
  year: number,
  month: number,
  // Dirección que "usa" la categoría: gastos suman débitos; categorías de ingreso suman créditos.
  direction: "debit" | "credit" = "debit"
): { used: Money; available: Money } {
  const used = transactions
    .filter(
      (t) =>
        t.categoryId === categoryId &&
        t.direction === direction &&
        t.status === "confirmed" &&
        !t.isInternal &&
        t.amount.currency === limit.currency &&
        // UTC: las fechas de movimientos se guardan y muestran en UTC; con getters locales un
        // movimiento a medianoche UTC del día 1 caía en el mes anterior (Chile UTC-4).
        t.date.getUTCFullYear() === year &&
        t.date.getUTCMonth() + 1 === month
    )
    .reduce((sum, t) => sum.add(t.amount), Money.zero(limit.currency))
  return { used, available: limit.subtract(used) }
}

/**
 * Comprometido de una categoría en un mes: Σ movimientos `pending` no internos (los que una
 * plantilla recurrente ya materializó pero el banco aún no cobra). NO se suma al usado: son dos
 * capas distintas. Un movimiento sin categoría no compromete nada, igual que no gasta nada.
 */
export function computeCategoryCommitted(
  categoryId: string,
  currency: CurrencyCode,
  transactions: Transaction[],
  year: number,
  month: number,
  direction: "debit" | "credit" = "debit"
): Money {
  return transactions
    .filter(
      (t) =>
        t.categoryId === categoryId &&
        t.direction === direction &&
        t.status === "pending" &&
        !t.isInternal &&
        t.amount.currency === currency &&
        // UTC: mismo criterio que computeCategoryUsage.
        t.date.getUTCFullYear() === year &&
        t.date.getUTCMonth() + 1 === month
    )
    .reduce((sum, t) => sum.add(t.amount), Money.zero(currency))
}

/** Estado por % usado: bueno ≤50%, moderado >50% y <100%, completado =100%, excedido >100%. */
export function categoryStatus(used: Money, limit: Money): CategoryStatus {
  if (limit.isZero) return used.isPositive ? "excedido" : "bueno"
  const cmp = used.compare(limit)
  if (cmp > 0) return "excedido"
  if (cmp === 0) return "completado"
  const ratio = Number(used.minor) / Number(limit.minor)
  return ratio <= 0.5 ? "bueno" : "moderado"
}

// Índice de mes comparable (año*12+mes) para ordenar límites.
const monthIndex = (year: number, month: number) => year * 12 + (month - 1)

// Registro más reciente con (year, month) ≤ objetivo — la base del carry-forward.
// Exportado: lo comparten los límites de categoría, el presupuesto global y los ingresos.
export function latestUpTo<T extends { year: number; month: number }>(
  records: T[],
  year: number,
  month: number
): T | undefined {
  const target = monthIndex(year, month)
  return records
    .filter((r) => monthIndex(r.year, r.month) <= target)
    .sort(
      (a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month)
    )[0]
}

/**
 * Límite EFECTIVO de una categoría para (year, month): el registro de ese mes si existe; si no,
 * hereda el del mes anterior más reciente (carry-forward). Sin ninguno, 0 CLP.
 */
export function effectiveLimit(
  limits: CategoryLimit[],
  categoryId: string,
  year: number,
  month: number
): Money {
  return (
    latestUpTo(
      limits.filter((l) => l.categoryId === categoryId),
      year,
      month
    )?.limit ?? Money.zero("CLP")
  )
}

/**
 * Límite global EFECTIVO del presupuesto para (year, month): el registro de ese mes o el del mes
 * anterior más reciente (carry-forward). Sin ningún registro, `null` = no definido (distinto de 0).
 */
export function effectiveGlobalLimit(
  budgets: MonthlyBudget[],
  year: number,
  month: number
): Money | null {
  return latestUpTo(budgets, year, month)?.globalLimit ?? null
}

/**
 * Restante por presupuestar = límite global − asignado (Σ límites de las categorías de GASTO).
 * `null` sin límite global; puede ser negativo (sobre-asignado ⇒ alerta, nunca bloquea).
 */
export function remainingToAllocate(
  globalLimit: Money | null,
  allocated: Money
): Money | null {
  return globalLimit === null ? null : globalLimit.subtract(allocated)
}
