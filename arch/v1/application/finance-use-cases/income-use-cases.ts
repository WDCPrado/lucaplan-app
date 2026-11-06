// Casos de uso de fuentes de ingreso: CRUD y generación manual del ingreso del mes. El tope global
// que sigue al ingreso vive en `follow-income.ts`. Depende solo de domain (+ ports). Sin IO directo.
import {
  type Account,
  type AccountRepository,
  type BalanceBucketRepository,
  type Category,
  type CategoryRepository,
  AccountNotFoundError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import {
  type Income,
  type IncomeAmount,
  type IncomeSource,
  type IncomeRepository,
  InvalidIncomeError,
  IncomeNotFoundError,
  accountAcceptsIncome,
  isIncomeEndedAt,
  isValidDayOfMonth,
} from "../../domain/finance/income.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { latestUpTo } from "./budget-formulas.ts"
import { projectCashEvent } from "./bucket-projection.ts"
import { rangeOf, getBudgetPeriod, scopeBudgetPeriod, type BudgetPeriodDeps } from "./budget-period-use-cases.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"

type IncomeDeps = BudgetPeriodDeps & {
  incomes: IncomeRepository
  accounts: AccountRepository
  categories: CategoryRepository
}

type IncomeInput = {
  sourceId?: string
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
  deps: { incomes: IncomeRepository } & BudgetPeriodDeps,
  userId: string
): Promise<Income[]> {
  return deps.incomes.listByUser(userId, (await getBudgetPeriod(deps)).mode)
}

export async function listAvailableIncomeSources(
  deps: { incomes: IncomeRepository } & BudgetPeriodDeps,
  userId: string
): Promise<IncomeSource[]> {
  return deps.incomes.listAvailableSources(userId, (await getBudgetPeriod(deps)).mode)
}

// Lista las fuentes con la marca de si su ingreso de (year, month) ya fue generado (para el dashboard).
export async function listIncomesForMonth(
  deps: { incomes: IncomeRepository; budgetPeriod?: BudgetPeriodRepository },
  userId: string,
  year: number,
  month: number
): Promise<Array<Income & { generated: boolean }>> {
  deps = await scopeBudgetPeriod(deps)
  validatePeriod(year, month)
  const incomes = await deps.incomes.listByUser(userId, (await getBudgetPeriod(deps)).mode)
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
  deps = await scopeBudgetPeriod(deps)
  if (input.sourceId) {
    const source = (await listAvailableIncomeSources(deps, userId)).find(source => source.id === input.sourceId)
    if (!source) throw new InvalidIncomeError("La fuente no está disponible para agregarla a este modo")
    // Incorporar solo agrega el monto del plan; no modifica la identidad compartida.
    input = { ...input, accountId: source.accountId, categoryId: source.categoryId, name: source.name, dayOfMonth: source.dayOfMonth }
  }
  const { money } = await validateInput(deps, userId, input)
  validatePeriod(input.year, input.month)
  return deps.incomes.create({
    mode: (await getBudgetPeriod(deps)).mode,
    sourceId: input.sourceId,
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
  deps = await scopeBudgetPeriod(deps)
  validatePeriod(input.year, input.month)
  const existing = await deps.incomes.findById(input.id, (await getBudgetPeriod(deps)).mode)
  if (!existing) throw new IncomeNotFoundError(input.id)
  if (existing.userId !== userId) throw new NotOwnerError()
  const { money } = await validateInput(deps, userId, input)
  return deps.incomes.update({
    mode: (await getBudgetPeriod(deps)).mode,
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
 * anteriores conservan su monto y sus movimientos. La identidad compartida se conserva incluso
 * al eliminar desde el primer mes: el otro modo o un cobro real pueden seguir usándola.
 */
export async function deleteIncome(
  deps: { incomes: IncomeRepository } & BudgetPeriodDeps,
  userId: string,
  id: string,
  period: { year: number; month: number }
): Promise<{ ok: true; ended: boolean }> {
  deps = await scopeBudgetPeriod(deps)
  validatePeriod(period.year, period.month)
  const existing = await deps.incomes.findById(id, (await getBudgetPeriod(deps)).mode)
  if (!existing) throw new IncomeNotFoundError(id)
  if (existing.userId !== userId) throw new NotOwnerError()

  await deps.incomes.endFrom(id, period.year, period.month, (await getBudgetPeriod(deps)).mode)
  return { ok: true, ended: true }
}

// Genera el movimiento de ingreso de un mes desde una fuente (idempotente en el repo). En cuentas
// conectadas el saldo vive en los buckets (caja + sobregiro): el abono se proyecta ahí —aumenta
// la caja sin amortizar sobregiro, como un abono manual— y el balance queda = caja. En manuales no hay buckets
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
  deps = await scopeBudgetPeriod(deps)
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId, (await getBudgetPeriod(deps)).mode)
  if (!income) throw new IncomeNotFoundError(input.incomeId)
  if (income.userId !== userId) throw new NotOwnerError()
  if (!income.isActive || isIncomeEndedAt(income, input.year, input.month))
    throw new InvalidIncomeError("El ingreso no está vigente en este plan y período")
  const range = await rangeOf(deps, input.year, input.month)
  const res = await deps.incomes.generateMonthly(income, (await getBudgetPeriod(deps)).mode, input.year, input.month, range)
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
    budgetPeriod?: BudgetPeriodRepository
  },
  userId: string,
  input: { incomeId: string; year: number; month: number }
): Promise<{ deleted: boolean }> {
  deps = await scopeBudgetPeriod(deps)
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId, (await getBudgetPeriod(deps)).mode)
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
