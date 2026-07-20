// Use-cases de lectura financiera. DTOs con montos en unidad mayor (number). Ownership por userId.
// Categorías GLOBALES del usuario; el límite es por mes con carry-forward (ver effectiveLimit).
import type {
  Account,
  AccountRepository,
  BalanceBucketRepository,
  BankRepository,
  Category,
  CategoryRepository,
  MonthlyBudgetRepository,
  Transaction,
  TransactionRepository,
  TransactionSearchFilters,
} from "../../domain/finance/finance.domain.ts"
import {
  NotOwnerError,
  CategoryNotFoundError,
} from "../../domain/finance/finance.domain.ts"
import type { IncomeRepository } from "../../domain/finance/income.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import {
  computeActiveCash,
  computeNetPosition,
  computeOverdraftDebt,
  creditCardDebts,
  computeCategoryUsage,
  categoryStatus,
  effectiveLimit,
  effectiveGlobalLimit,
  remainingToAllocate,
} from "./budget-formulas.ts"

const CLP = "CLP" as const

type ReadDeps = {
  accounts: AccountRepository
  banks: BankRepository
  categories: CategoryRepository
  transactions: TransactionRepository
  monthlyBudgets: MonthlyBudgetRepository
}

export type MonthlySummaryDTO = {
  activeCash: number
  netPosition: number
  overdraftDebt: number
  creditCardDebts: { accountId: string; name: string; debt: number }[]
  income: number
  expense: number
  totalBudget: number
}

export type AccountDTO = {
  id: string
  bankId: string
  bankName: string
  name: string
  accountType: string
  currency: string
  balance: number
  color: string | null
  cardLast4: string | null
  provider: string // "manual" | "bancochile"; las conectadas son de solo lectura (badge)
  connectionMethod?: string | null // "email" (solo conectadas) = saldos ESTIMADOS
  lastSyncedAt: string | null // ISO; última sync del banco conectado (null en cuentas manuales)
  buckets?: BucketDTO[] // saldos/cupos por bucket (solo cuentas conectadas). Montos en unidad mayor.
}

// Saldo/cupo para la UI: cash | overdraft | credit_national | credit_international.
export type BucketDTO = {
  kind: string
  currency: string
  limit: number
  used: number
  available: number
  asOf: string | null
}

export type TransactionDTO = {
  id: string
  accountId: string
  currency: string
  editable: boolean // true solo si su cuenta es manual (las conectadas son de solo lectura)
  description: string
  amount: number
  direction: string
  date: string
  status: string // confirmed | pending | reversed | duplicated (solo confirmed cuenta)
  isInternal?: boolean // ajuste de saldo; no participa en ingresos, gastos ni presupuesto
  categoryId: string | null
  categoryName: string | null
  categoryIcon: string | null
  categoryColor: string | null
  remaining: number | null // histórico: lo que quedaba de la categoría justo tras este movimiento
  categoryLimit: number | null // límite efectivo del mes de su categoría (para el arco); null si no aplica
}

export type CategoryDTO = {
  id: string
  name: string
  type: string // "income" (ingreso) | "expense" (gasto)
  icon: string | null
  color: string | null
  description: string | null // contexto para la IA; se edita en el modal
  limit: number
  used: number
  available: number
  status: string
}

export type BudgetViewDTO = {
  categories: CategoryDTO[]
  globalLimit: number | null // límite global efectivo del mes (carry); null = no definido
  allocated: number // Σ límites efectivos de las categorías de GASTO
  remainingToAllocate: number | null // globalLimit − allocated; null sin límite global
}

function txToDTO(
  t: Transaction,
  cat: Category | undefined,
  remaining: number | null,
  categoryLimit: number | null,
  editable: boolean
): TransactionDTO {
  return {
    id: t.id,
    accountId: t.accountId,
    currency: t.amount.currency,
    editable,
    description: t.description,
    amount: t.amount.toMajor(),
    direction: t.direction,
    date: t.date.toISOString(),
    status: t.status,
    isInternal: t.isInternal,
    categoryId: t.categoryId,
    categoryName: cat?.name ?? null,
    categoryIcon: cat?.icon ?? null,
    categoryColor: cat?.color ?? null,
    remaining,
    categoryLimit,
  }
}

// "Quedan" histórico: recorre los gastos (débito) de más antiguo a más nuevo acumulando por
// categoría; a cada movimiento le asigna limit − acumulado hasta ese punto. `txs` viene más-nuevo
// primero (orden del repo), así que se recorre en reversa.
function historicalRemaining(
  txs: Transaction[],
  limitOf: (categoryId: string) => Money | null
): Map<string, number> {
  const acc = new Map<string, Money>()
  const out = new Map<string, number>()
  for (let i = txs.length - 1; i >= 0; i--) {
    const t = txs[i]
    if (
      t.direction !== "debit" ||
      !t.categoryId ||
      t.status !== "confirmed" ||
      t.isInternal
    )
      continue
    const limit = limitOf(t.categoryId)
    if (!limit || t.amount.currency !== limit.currency) continue
    const spent = (acc.get(t.categoryId) ?? Money.zero(limit.currency)).add(
      t.amount
    )
    acc.set(t.categoryId, spent)
    out.set(t.id, limit.subtract(spent).toMajor())
  }
  return out
}

// Categorías del usuario con su límite EFECTIVO para (year, month) — carry-forward incluido.
async function categoriesWithLimit(
  deps: { categories: CategoryRepository },
  userId: string,
  year: number,
  month: number
): Promise<{ category: Category; limit: Money }[]> {
  const [cats, limits] = await Promise.all([
    deps.categories.listByUser(userId),
    deps.categories.listLimitsByUser(userId),
  ])
  return cats.map((category) => ({
    category,
    limit: effectiveLimit(limits, category.id, year, month),
  }))
}

export async function getMonthlySummary(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<MonthlySummaryDTO> {
  const accounts = await deps.accounts.listByUser(userId)
  const txs = await deps.transactions.listByUserPeriod(userId, year, month)
  const withLimit = await categoriesWithLimit(deps, userId, year, month)

  // Solo movimientos CON categoría: los totales del resumen usan el mismo criterio que el
  // presupuesto (uso por categoría). Lo sin categoría no cuenta hasta clasificarse (triage).
  const sumClp = (dir: string) =>
    txs
      .filter(
        (t) =>
          t.direction === dir &&
          t.categoryId !== null &&
          t.amount.currency === CLP &&
          t.status === "confirmed" &&
          !t.isInternal
      )
      .reduce((s, t) => s.add(t.amount), Money.zero(CLP))

  return {
    activeCash: computeActiveCash(accounts, CLP).toMajor(),
    netPosition: computeNetPosition(accounts, CLP).toMajor(),
    overdraftDebt: computeOverdraftDebt(accounts, CLP).toMajor(),
    creditCardDebts: creditCardDebts(accounts).map((d) => ({
      accountId: d.account.id,
      name: d.account.name,
      debt: d.debt.toMajor(),
    })),
    income: sumClp("credit").toMajor(),
    expense: sumClp("debit").toMajor(),
    // Solo categorías de gasto: mismo criterio que `allocated` en la vista de presupuestos.
    totalBudget: withLimit
      .filter((x) => x.category.type === "expense")
      .reduce((s, x) => s.add(x.limit), Money.zero(CLP))
      .toMajor(),
  }
}

export async function listAccounts(
  deps: {
    accounts: AccountRepository
    banks: BankRepository
    balanceBuckets: BalanceBucketRepository
  },
  userId: string
): Promise<AccountDTO[]> {
  const [accounts, banks, allBuckets] = await Promise.all([
    deps.accounts.listByUser(userId),
    deps.banks.listByUser(userId),
    deps.balanceBuckets.listByUser(userId),
  ])
  const bankById = new Map(banks.map((b) => [b.id, b]))
  const bucketsByAccount = new Map<string, BucketDTO[]>()
  for (const b of allBuckets) {
    const arr = bucketsByAccount.get(b.accountId) ?? []
    arr.push({
      kind: b.kind,
      currency: b.currency,
      limit: b.limitAmount.toMajor(),
      used: b.used.toMajor(),
      available: b.available.toMajor(),
      asOf: b.asOf?.toISOString() ?? null,
    })
    bucketsByAccount.set(b.accountId, arr)
  }
  return accounts.map((a: Account): AccountDTO => {
    const bank = bankById.get(a.bankId)
    return {
      id: a.id,
      bankId: a.bankId,
      bankName: bank?.name ?? "",
      name: a.name,
      accountType: a.accountType,
      currency: a.currency,
      balance: a.balance.toMajor(),
      color: a.color,
      cardLast4: a.cardLast4,
      provider: a.provider,
      connectionMethod: bank?.connectionMethod ?? null,
      lastSyncedAt: bank?.lastSyncedAt?.toISOString() ?? null,
      buckets: bucketsByAccount.get(a.id) ?? [],
    }
  })
}

export async function listTransactions(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<TransactionDTO[]> {
  const txs = await deps.transactions.listByUserPeriod(userId, year, month)
  const withLimit = await categoriesWithLimit(deps, userId, year, month)
  const accounts = await deps.accounts.listByUser(userId)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const catById = new Map(withLimit.map((x) => [x.category.id, x.category]))
  const limitById = new Map(withLimit.map((x) => [x.category.id, x.limit]))
  const remaining = historicalRemaining(txs, (id) => limitById.get(id) ?? null)
  // La lista no muestra reversados ni duplicados (ruido); sí muestra confirmed y pending.
  return txs
    .filter((t) => t.status !== "reversed" && t.status !== "duplicated")
    .map((t) =>
      txToDTO(
        t,
        t.categoryId ? catById.get(t.categoryId) : undefined,
        remaining.get(t.id) ?? null,
        t.categoryId ? (limitById.get(t.categoryId)?.toMajor() ?? null) : null,
        manual.has(t.accountId)
      )
    )
}

// Tope del triage: se piden TRIAGE_LIMIT+1 filas para señalar "hay más" sin count.
const TRIAGE_LIMIT = 50

export type UncategorizedDTO = {
  transactions: TransactionDTO[]
  hasMore: boolean
}

// Movimientos sin categoría elegibles del usuario, ACOTADOS al mes (year, month) —más nuevos
// primero— para el triage del dashboard. Solo el mes en vista: los pendientes de meses anteriores no
// abruman el triage inicial. El criterio de elegibilidad vive en el filtro `uncategorized` del repo.
export async function listUncategorized(
  deps: { transactions: TransactionRepository; accounts: AccountRepository },
  userId: string,
  year: number,
  month: number
): Promise<UncategorizedDTO> {
  const [txs, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, {
      uncategorized: true,
      from: new Date(Date.UTC(year, month - 1, 1)),
      to: new Date(Date.UTC(year, month, 0)), // último día del mes
      limit: TRIAGE_LIMIT + 1,
    }),
    deps.accounts.listByUser(userId),
  ])
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  return {
    transactions: txs
      .slice(0, TRIAGE_LIMIT)
      .map((t) => txToDTO(t, undefined, null, null, manual.has(t.accountId))),
    hasMore: txs.length > TRIAGE_LIMIT,
  }
}

// Búsqueda de movimientos con filtros combinados. Devuelve TransactionDTO[] (sin "quedan" histórico,
// que es propio de la vista por periodo). editable según el origen de la cuenta.
export async function searchTransactions(
  deps: ReadDeps,
  userId: string,
  filters: TransactionSearchFilters
): Promise<TransactionDTO[]> {
  const [txs, cats, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, filters),
    deps.categories.listByUser(userId),
    deps.accounts.listByUser(userId),
  ])
  const catById = new Map(cats.map((c) => [c.id, c]))
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  return txs.map((t) =>
    txToDTO(
      t,
      t.categoryId ? catById.get(t.categoryId) : undefined,
      null,
      null,
      manual.has(t.accountId)
    )
  )
}

export async function getBudgetView(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<BudgetViewDTO> {
  const [withLimit, txs, budgets] = await Promise.all([
    categoriesWithLimit(deps, userId, year, month),
    deps.transactions.listByUserPeriod(userId, year, month),
    deps.monthlyBudgets.listByUser(userId),
  ])
  const categories = withLimit.map(({ category, limit }): CategoryDTO => {
    const { used, available } = computeCategoryUsage(
      category.id,
      limit,
      txs,
      year,
      month,
      category.type === "income" ? "credit" : "debit"
    )
    return {
      id: category.id,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      description: category.description,
      limit: limit.toMajor(),
      used: used.toMajor(),
      available: available.toMajor(),
      status: categoryStatus(used, limit),
    }
  })
  // Orden (WDC-13): categoría con la transacción más reciente del mes primero. `txs` viene
  // más-nuevo primero, así que el primer encuentro de cada categoría marca su recencia; las sin
  // movimiento este mes quedan al final en su orden original (sort estable).
  const recencyRank = new Map<string, number>()
  txs.forEach((t, i) => {
    if (t.categoryId && !recencyRank.has(t.categoryId)) recencyRank.set(t.categoryId, i)
  })
  categories.sort(
    (a, b) =>
      (recencyRank.get(a.id) ?? txs.length) - (recencyRank.get(b.id) ?? txs.length)
  )
  const allocated = withLimit
    .filter((x) => x.category.type === "expense")
    .reduce((s, x) => s.add(x.limit), Money.zero(CLP))
  const globalLimit = effectiveGlobalLimit(budgets, year, month)
  const remaining = remainingToAllocate(globalLimit, allocated)
  return {
    categories,
    globalLimit: globalLimit === null ? null : globalLimit.toMajor(),
    allocated: allocated.toMajor(),
    remainingToAllocate: remaining === null ? null : remaining.toMajor(),
  }
}

export type IncomeDTO = {
  id: string
  name: string
  accountId: string
  accountName: string
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  amount: number
  currency: string
  dayOfMonth: number
  isActive: boolean
  generated: boolean // ¿ya se generó el movimiento de ingreso de este mes?
}

// Fuentes de ingreso del usuario con nombres resueltos y la marca de si su movimiento del mes
// (year, month) ya fue generado. Para la sección "Ingresos del mes" y el paso de onboarding.
export async function listIncomesView(
  deps: {
    incomes: IncomeRepository
    accounts: AccountRepository
    categories: CategoryRepository
  },
  userId: string,
  year: number,
  month: number
): Promise<IncomeDTO[]> {
  const [incomes, accounts, categories] = await Promise.all([
    deps.incomes.listByUser(userId),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  const accById = new Map(accounts.map((a) => [a.id, a]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  return Promise.all(
    incomes.map(async (i): Promise<IncomeDTO> => {
      const cat = catById.get(i.categoryId)
      return {
        id: i.id,
        name: i.name,
        accountId: i.accountId,
        accountName: accById.get(i.accountId)?.name ?? "",
        categoryId: i.categoryId,
        categoryName: cat?.name ?? "",
        categoryIcon: cat?.icon ?? null,
        categoryColor: cat?.color ?? null,
        amount: i.amount.toMajor(),
        currency: i.currency,
        dayOfMonth: i.dayOfMonth,
        isActive: i.isActive,
        generated: await deps.incomes.hasGeneratedFor(i.id, year, month),
      }
    })
  )
}

export async function getCategoryDetail(
  deps: ReadDeps,
  userId: string,
  categoryId: string,
  year: number,
  month: number
): Promise<CategoryDTO & { transactions: TransactionDTO[] }> {
  const category = await deps.categories.findById(categoryId)
  if (!category) throw new CategoryNotFoundError(categoryId)
  if (category.userId !== userId) throw new NotOwnerError()

  const limits = await deps.categories.listLimitsByUser(userId)
  const limit = effectiveLimit(limits, categoryId, year, month)
  const txs = await deps.transactions.listByCategoryPeriod(
    categoryId,
    year,
    month
  )
  const accounts = await deps.accounts.listByUser(userId)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const { used, available } = computeCategoryUsage(
    categoryId,
    limit,
    txs,
    year,
    month,
    category.type === "income" ? "credit" : "debit"
  )
  const remaining = historicalRemaining(txs, () => limit)
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    description: category.description,
    limit: limit.toMajor(),
    used: used.toMajor(),
    available: available.toMajor(),
    status: categoryStatus(used, limit),
    transactions: txs
      .filter((t) => t.status !== "reversed" && t.status !== "duplicated")
      .map((t) =>
        txToDTO(
          t,
          category,
          remaining.get(t.id) ?? null,
          limit.toMajor(),
          manual.has(t.accountId)
        )
      ),
  }
}
