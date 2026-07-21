// Casos de uso de fuentes de ingreso: CRUD, generación manual del ingreso del mes y siembra del
// límite global del presupuesto. Depende solo de domain (+ ports). Sin IO directo.
import {
  type Account,
  type AccountRepository,
  type Category,
  type CategoryRepository,
  type MonthlyBudgetRepository,
  AccountNotFoundError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import {
  type Income,
  type IncomeRepository,
  InvalidIncomeError,
  IncomeNotFoundError,
  accountAcceptsIncome,
  isValidDayOfMonth,
} from "../../domain/finance/income.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { effectiveGlobalLimit } from "./budget-formulas.ts"

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
  deps: { incomes: IncomeRepository },
  userId: string,
  year: number,
  month: number
): Promise<Array<Income & { generated: boolean }>> {
  validatePeriod(year, month)
  const incomes = await deps.incomes.listByUser(userId)
  // ponytail: hasGeneratedFor por fuente; son pocas por usuario. Batch si algún usuario tiene muchas.
  return Promise.all(
    incomes.map(async (income) => ({
      ...income,
      generated: await deps.incomes.hasGeneratedFor(income.id, year, month),
    }))
  )
}

export async function createIncome(
  deps: IncomeDeps,
  userId: string,
  input: IncomeInput
): Promise<Income> {
  const { money } = await validateInput(deps, userId, input)
  return deps.incomes.create({
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    name: input.name.trim(),
    amount: money,
    dayOfMonth: input.dayOfMonth,
  })
}

export async function updateIncome(
  deps: IncomeDeps,
  userId: string,
  input: IncomeInput & { id: string; isActive: boolean }
): Promise<Income> {
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
  })
}

export async function deleteIncome(
  deps: { incomes: IncomeRepository },
  userId: string,
  id: string
): Promise<{ ok: true }> {
  const existing = await deps.incomes.findById(id)
  if (!existing) throw new IncomeNotFoundError(id)
  if (existing.userId !== userId) throw new NotOwnerError()
  await deps.incomes.delete(id)
  return { ok: true }
}

// Genera el movimiento de ingreso de un mes desde una fuente (idempotente en el repo).
export async function generateMonthlyIncome(
  deps: { incomes: IncomeRepository },
  userId: string,
  input: { incomeId: string; year: number; month: number }
): Promise<{ transactionId: string; created: boolean }> {
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId)
  if (!income) throw new IncomeNotFoundError(input.incomeId)
  if (income.userId !== userId) throw new NotOwnerError()
  return deps.incomes.generateMonthly(income, input.year, input.month)
}

// Deshace el movimiento de ingreso de un mes (por si se generó por error). Idempotente en el repo.
export async function ungenerateMonthlyIncome(
  deps: { incomes: IncomeRepository },
  userId: string,
  input: { incomeId: string; year: number; month: number }
): Promise<{ deleted: boolean }> {
  validatePeriod(input.year, input.month)
  const income = await deps.incomes.findById(input.incomeId)
  if (!income) throw new IncomeNotFoundError(input.incomeId)
  if (income.userId !== userId) throw new NotOwnerError()
  return deps.incomes.ungenerateMonthly(input.incomeId, input.year, input.month)
}

// Suma (CLP) de las fuentes de ingreso activas del usuario. El límite global es CLP; solo los ingresos
// CLP lo alimentan (la conversión multi-moneda se resolverá cuando exista).
export async function sumActiveIncomesCLP(
  deps: { incomes: IncomeRepository },
  userId: string
): Promise<Money> {
  const incomes = await deps.incomes.listByUser(userId)
  return incomes
    .filter((i) => i.isActive && i.currency === CLP)
    .reduce((acc, i) => acc.add(i.amount), Money.zero(CLP))
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
  const total = await sumActiveIncomesCLP(deps, userId)
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
