// Fórmulas financieras puras. Sin IO: reciben datos ya cargados y devuelven derivados.
// Reglas clave: la caja activa es solo saldo positivo de cuentas corrientes (el cupo no
// es dinero); un saldo negativo es deuda de sobregiro, no caja; la posición neta combina
// ambas. El uso por categoría se calcula desde los movimientos, no se persiste.

import type { Account, Category, Budget, Transaction, CategoryStatus } from "../../domain/finance/finance.domain.ts";
import { Money, type CurrencyCode } from "../../domain/finance/money.ts";

/** Caja activa: Σ saldo POSITIVO de cuentas `checking` de la moneda dada. Cupos y negativos no cuentan. */
export function computeActiveCash(accounts: Account[], currency: CurrencyCode): Money {
  return accounts
    .filter((a) => a.accountType === "checking" && a.currency === currency && a.balance.isPositive)
    .reduce((sum, a) => sum.add(a.balance), Money.zero(currency));
}

/** Sobregiro de una cuenta: usado = |saldo| si es negativo; disponible = límite − usado. */
export function computeOverdraft(account: Account): { used: Money; available: Money } {
  const used = account.balance.isNegative ? account.balance.negate() : Money.zero(account.currency);
  return { used, available: account.overdraftLimit.subtract(used) };
}

/** Deuda de sobregiro total: Σ saldos negativos de cuentas `checking` de la moneda dada. */
export function computeOverdraftDebt(accounts: Account[], currency: CurrencyCode): Money {
  return accounts
    .filter((a) => a.accountType === "checking" && a.currency === currency && a.balance.isNegative)
    .reduce((sum, a) => sum.add(computeOverdraft(a).used), Money.zero(currency));
}

/** Posición neta = caja activa − deuda de sobregiro. Puede ser negativa (aquí aparece el rojo). */
export function computeNetPosition(accounts: Account[], currency: CurrencyCode): Money {
  return computeActiveCash(accounts, currency).subtract(computeOverdraftDebt(accounts, currency));
}

/** Uso de una categoría en el mes de su presupuesto: Σ gastos (`debit`) asociados; disponible = límite − usado. */
export function computeCategoryUsage(
  category: Category,
  transactions: Transaction[],
  year: number,
  month: number,
): { used: Money; available: Money } {
  const used = transactions
    .filter(
      (t) =>
        t.categoryId === category.id &&
        t.direction === "debit" &&
        t.date.getFullYear() === year &&
        t.date.getMonth() + 1 === month,
    )
    .reduce((sum, t) => sum.add(t.amount), Money.zero(category.limit.currency));
  return { used, available: category.limit.subtract(used) };
}

/** Estado por % usado: bueno ≤50%, moderado >50% y <100%, completado =100%, excedido >100%. */
export function categoryStatus(used: Money, limit: Money): CategoryStatus {
  if (limit.isZero) return used.isPositive ? "excedido" : "bueno";
  const cmp = used.compare(limit);
  if (cmp > 0) return "excedido";
  if (cmp === 0) return "completado";
  const ratio = Number(used.minor) / Number(limit.minor);
  return ratio <= 0.5 ? "bueno" : "moderado";
}

export type CategorySummary = {
  category: Category;
  used: Money;
  available: Money;
  status: CategoryStatus;
};

export type BudgetSummary = {
  budget: Budget;
  categories: CategorySummary[];
  totalLimit: Money;
  totalUsed: Money;
};

/** Resumen de un presupuesto: uso/disponible/estado por categoría + totales. No persiste. */
export function summarizeBudget(budget: Budget, categories: Category[], transactions: Transaction[]): BudgetSummary {
  const currency = categories[0]?.limit.currency ?? "CLP";
  const rows = categories.map((category): CategorySummary => {
    const { used, available } = computeCategoryUsage(category, transactions, budget.year, budget.month);
    return { category, used, available, status: categoryStatus(used, category.limit) };
  });
  return {
    budget,
    categories: rows,
    totalLimit: categories.reduce((s, c) => s.add(c.limit), Money.zero(currency)),
    totalUsed: rows.reduce((s, r) => s.add(r.used), Money.zero(currency)),
  };
}
