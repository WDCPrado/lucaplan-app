// Casos de uso de fuentes de ingreso: CRUD, generación manual del ingreso del mes y siembra del
// límite global del presupuesto. Depende solo de domain (+ ports). Sin IO directo.
import {
  type Account,
  type AccountRepository,
  type BalanceBucketRepository,
  type Category,
  type CategoryRepository,
  type MonthlyBudgetRepository,
  AccountNotFoundError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import {
  type Income,
  type IncomeAmount,
  type IncomeRepository,
  InvalidIncomeError,
  IncomeNotFoundError,
  accountAcceptsIncome,
  isIncomeEndedAt,
  isValidDayOfMonth,
} from "../../domain/finance/income.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { effectiveGlobalLimit, latestUpTo } from "./budget-formulas.ts"
import { projectCashEvent } from "./bucket-projection.ts"
import { rangeOf } from "./budget-period-use-cases.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"

const CLP = "CLP" as const

type IncomeDeps = {
  incomes: IncomeRepository
  accounts: AccountRepository
  categories: CategoryRepository
}

type IncomeInput = {
  accountId: string
  categoryId: string
  name: string
  amount: number
  dayOfMonth: number
  // Mes que el usuario está viendo: define desde cuándo rige el monto.
  year: number
  month: number
}

/**
 * Monto EFECTIVO de una fuente para (year, month): el registro de ese mes si existe; si no, el del
 * mes anterior más reciente (carry-forward). `null` si la fuente aún no existía ese mes — así
 * navegar hacia atrás no muestra ingresos que se crearon después.
 */
export function effectiveIncomeAmount(
  amounts: IncomeAmount[],
  incomeId: string,
  year: number,
  month: number
): Money | null {
  return (
    latestUpTo(
      amounts.filter((a) => a.incomeId === incomeId),
      year,
      month
    )?.amount ?? null
  )
}

function validatePeriod(year: number, month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12)
    throw new InvalidIncomeError("Mes inválido (1–12)")
  if (!Number.isInteger(year) || year < 2000 || year > 2100)
    throw new InvalidIncomeError("Año inválido")
}

// Valida cuenta destino (existe, del usuario, no de crédito), categoría (existe, del usuario, income),
// día y monto. Devuelve el Money en la moneda de la cuenta. La validación va ANTES de construir Money.
async function validateInput(
  deps: IncomeDeps,
  userId: string,
  input: IncomeInput
): Promise<{ account: Account; category: Category; money: Money }> {
  const account = await deps.accounts.findById(input.accountId)
  if (!account) throw new AccountNotFoundError(input.accountId)
  if (account.userId !== userId) throw new NotOwnerError()
  if (!accountAcceptsIncome(account.accountType))
    throw new InvalidIncomeError(
      "La cuenta destino no puede ser de crédito"
    )

  const category = await deps.categories.findById(input.categoryId)
  if (!category) throw new CategoryNotFoundError(input.categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  if (category.type !== "income")
    throw new InvalidIncomeError("La categoría debe ser de ingreso")

  if (!isValidDayOfMonth(input.dayOfMonth))
    throw new InvalidIncomeError("El día de ingreso debe estar entre 1 y 31")
  if (!input.name.trim())
    throw new InvalidIncomeError("La fuente de ingreso necesita un nombre")
  if (!Number.isFinite(input.amount) || input.amount <= 0)
    throw new InvalidIncomeError("El monto del ingreso debe ser mayor que 0")

  return { account, category, money: Money.of(input.amount, account.currency) }
}

export async function listIncomes(
  deps: { incomes: IncomeRepository },
  userId: string
): Promise<Income[]> {
  return deps.incomes.listByUser(userId)
}

// Lista las fuentes con la marca de si su ingreso de (year, month) ya fue generado (para el dashboard).
export async function listIncomesForMonth(
  deps: { incomes: IncomeRepository; budgetPeriod?: BudgetPeriodRepository },
  userId: string,
  year: number,
  month: number
): Promise<Array<Income & { generated: boolean }>> {
  validatePeriod(year, month)
  const incomes = await deps.incomes.listByUser(userId)
  const range = await rangeOf(deps, year, month)
  // ponytail: hasGeneratedFor por fuente; son pocas por usuario. Batch si algún usuario tiene muchas.
  return Promise.all(
    incomes.map(async (income) => ({
      ...income,
      generated: await deps.incomes.hasGeneratedFor(income.id, year, month, range),
    }))
  )
}

export async function createIncome(
  deps: IncomeDeps,
  userId: string,
  input: IncomeInput
): Promise<Income> {
  const { money } = await validateInput(deps, userId, input)
  validatePeriod(input.year, input.month)
  return deps.incomes.create({
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    name: input.name.trim(),
    amount: money,
    dayOfMonth: input.dayOfMonth,
    year: input.year,
    month: input.month,
  })
}

export async function updateIncome(
  deps: IncomeDeps,
  userId: string,
  input: IncomeInput & { id: string; isActive: boolean }
): Promise<Income> {
  validatePeriod(input.year, input.month)
  const existing = await deps.incomes.findById(input.id)
  if (!existing) throw new IncomeNotFoundError(input.id)
  if (existing.userId !== userId) throw new NotOwnerError()
  const { money } = await validateInput(deps, userId, input)
  return deps.incomes.update({
    id: input.id,
    accountId: input.accountId,
    categoryId: input.categoryId,
    name: input.name.trim(),
    amount: money,
    dayOfMonth: input.dayOfMonth,
    isActive: input.isActive,
    year: input.year,
    month: input.month,
  })
}

/**
 * Eliminar una fuente desde el mes (year, month): deja de existir de ahí en adelante y los meses
 * anteriores conservan su monto y sus movimientos — el mismo criterio que editar, que solo escribe
 * en el mes en curso. Solo se borra de verdad cuando no hay historia previa que conservar (se creó
 * y se elimina dentro del mismo mes).
 */
export async function deleteIncome(
  deps: { incomes: IncomeRepository },
  userId: string,
  id: string,
  period: { year: number; month: number }
): Promise<{ ok: true; ended: boolean }> {
  validatePeriod(period.year, period.month)
  const existing = await deps.incomes.findById(id)
  if (!existing) throw new IncomeNotFoundError(id)
  if (existing.userId !== userId) throw new NotOwnerError()

  const amounts = await deps.incomes.listAmountsByUser(userId)
  const hasHistory = amounts.some(
    (a) =>
      a.incomeId === id &&
      a.year * 12 + a.month < period.year * 12 + period.month
  )
  if (!hasHistory) {
    await deps.incomes.delete(id)
    return { ok: true, ended: false }
  }
  await deps.incomes.endFrom(id, period.year, period.month)
  return { ok: true, ended: true }
}

// Genera el movimiento de ingreso de un mes desde una fuente (idempotente en el repo). En cuentas
// conectadas el saldo vive en los buckets (caja + sobregiro): el abono se proyecta ahí —paga
// sobregiro primero, como un abono manual— y el balance queda = caja. En manuales no hay buckets
// y la columna balance ya la ajustó el repo (la proyección es no-op).
export async function generateMonthlyIncome(
  deps: {
    incomes: IncomeRepository
    accounts?: AccountRepository // requeridos en la práctica para cuentas conectadas
    balanceBuckets?: BalanceBucketRepository
    budgetPeriod?: BudgetPeriodRepository
  },
  userId: string,
  input: { incomeId: string; year: number; month: number }
): Promise<{ transactionId: string; created: boolean }> {
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId)
  if (!income) throw new IncomeNotFoundError(input.incomeId)
  if (income.userId !== userId) throw new NotOwnerError()
  const range = await rangeOf(deps, input.year, input.month)
  const res = await deps.incomes.generateMonthly(income, input.year, input.month, range)
  // Solo si escribió: regenerar un mes ya generado no debe abonar dos veces.
  // ponytail: create + proyección no son atómicos; si esto falla, "Actualizar saldos" reconcilia.
  if (res.created && deps.accounts && deps.balanceBuckets)
    await projectCashEvent(
      { accounts: deps.accounts, balanceBuckets: deps.balanceBuckets },
      income.accountId,
      res.amount,
      "credit"
    )
  return { transactionId: res.transactionId, created: res.created }
}

// Deshace el movimiento de ingreso de un mes (por si se generó por error). Idempotente en el repo.
// Revierte también la proyección: el débito consume caja y, si no alcanza, vuelve al sobregiro.
export async function ungenerateMonthlyIncome(
  deps: {
    incomes: IncomeRepository
    accounts?: AccountRepository
    balanceBuckets?: BalanceBucketRepository
  },
  userId: string,
  input: { incomeId: string; year: number; month: number }
): Promise<{ deleted: boolean }> {
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId)
  if (!income) throw new IncomeNotFoundError(input.incomeId)
  if (income.userId !== userId) throw new NotOwnerError()
  const res = await deps.incomes.ungenerateMonthly(
    input.incomeId,
    input.year,
    input.month,
    await rangeOf(deps, input.year, input.month)
  )
  // accountId del movimiento borrado (la fuente pudo cambiar de cuenta después de generar).
  if (res.deleted && res.amount && deps.accounts && deps.balanceBuckets)
    await projectCashEvent(
      { accounts: deps.accounts, balanceBuckets: deps.balanceBuckets },
      res.accountId ?? income.accountId,
      res.amount,
      "debit"
    )
  return { deleted: res.deleted }
}

// Suma (CLP) de las fuentes de ingreso activas del usuario. El límite global es CLP; solo los ingresos
// CLP lo alimentan (la conversión multi-moneda se resolverá cuando exista).
export async function sumActiveIncomesCLP(
  deps: { incomes: IncomeRepository },
  userId: string,
  year: number,
  month: number
): Promise<Money> {
  const [incomes, amounts] = await Promise.all([
    deps.incomes.listByUser(userId),
    deps.incomes.listAmountsByUser(userId),
  ])
  return incomes
    .filter(
      (i) => i.isActive && i.currency === CLP && !isIncomeEndedAt(i, year, month)
    )
    .reduce((acc, i) => {
      const amount = effectiveIncomeAmount(amounts, i.id, year, month)
      return amount ? acc.add(amount) : acc
    }, Money.zero(CLP))
}

// Siembra el límite global del mes con la suma de ingresos activos SOLO si aún no está definido (ni
// propio ni heredado por carry). Si ya existe, no lo pisa; devuelve el total sugerido para que la UI
// ofrezca actualizarlo con acción explícita.
export async function seedGlobalLimitFromIncomes(
  deps: { incomes: IncomeRepository; monthlyBudgets: MonthlyBudgetRepository },
  userId: string,
  input: { year: number; month: number }
): Promise<{ seeded: boolean; total: number; alreadyDefined: boolean }> {
  validatePeriod(input.year, input.month)
  const total = await sumActiveIncomesCLP(deps, userId, input.year, input.month)
  const budgets = await deps.monthlyBudgets.listByUser(userId)
  const defined =
    effectiveGlobalLimit(budgets, input.year, input.month) !== null
  if (defined || total.isZero)
    return {
      seeded: false,
      total: total.toMajor(),
      alreadyDefined: defined,
    }
  await deps.monthlyBudgets.set({
    userId,
    year: input.year,
    month: input.month,
    globalLimit: total,
  })
  return { seeded: true, total: total.toMajor(), alreadyDefined: false }
}
