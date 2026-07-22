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
import {
  executionDateFor,
  periodKeyFor,
  toleranceRange,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import type { ExchangeRateProvider } from "../../domain/finance/exchange.domain.ts"
import { toClp } from "../../domain/finance/exchange.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import {
  computeActiveCash,
  computeNetPosition,
  computeOverdraftDebt,
  creditCardDebts,
  computeCategoryUsage,
  computeCategoryCommitted,
  categoryStatus,
  effectiveLimit,
  effectiveGlobalLimit,
  remainingToAllocate,
} from "./budget-formulas.ts"

const CLP = "CLP" as const

type ReadDeps = {
  // Opcional: solo las vistas que muestran movimientos marcan su estado de recurrencia.
  recurring?: RecurringTemplateRepository
  accounts: AccountRepository
  banks: BankRepository
  categories: CategoryRepository
  transactions: TransactionRepository
  monthlyBudgets: MonthlyBudgetRepository
  exchangeRates: ExchangeRateProvider
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
  amountClp?: number | null // equivalente CLP ESTIMADO si la moneda no es CLP (dólar del día); null si ya es CLP
  recurringTemplateId?: string | null // plantilla que lo generó; la UI marca el movimiento y ofrece pausar/eliminar
  recurringIsActive?: boolean | null // ¿esa plantilla está activa o pausada? null si no es recurrente
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
  committed: number // comprometido: Σ pending del mes (recurrentes aún no cobradas); capa aparte del usado
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
  editable: boolean,
  amountClp: number | null = null
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
    amountClp,
    recurringTemplateId: t.recurringTemplateId ?? null,
  }
}

// Lleva a CLP los montos en otra moneda usando el dólar observado de la FECHA de cada movimiento
// (el histórico no cambia → el CLP estimado es estable entre vistas). Devuelve, alineado a `txs`:
// las tx con amount en CLP para las FÓRMULAS, y el CLP estimado por tx para el DTO (null si ya venía
// en CLP). Los rates se cachean por año en el adapter: muchas fechas del mismo año pegan a la red una vez.
async function clpView(
  provider: ExchangeRateProvider,
  txs: Transaction[]
): Promise<{ clpTxs: Transaction[]; clpAmounts: (number | null)[] }> {
  const rates = await Promise.all(
    txs.map((t) =>
      t.amount.currency === "CLP"
        ? Promise.resolve(0)
        : provider.clpPerUsdAt(t.date)
    )
  )
  const clpTxs = txs.map((t, i) =>
    t.amount.currency === "CLP" ? t : { ...t, amount: toClp(t.amount, rates[i]) }
  )
  const clpAmounts = txs.map((t, i) =>
    t.amount.currency === "CLP" ? null : clpTxs[i].amount.toMajor()
  )
  return { clpTxs, clpAmounts }
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
  // Montos en otra moneda (USD) convertidos a CLP por el dólar de su fecha, para que cuenten.
  const { clpTxs } = await clpView(deps.exchangeRates, txs)

  // Solo movimientos CON categoría: los totales del resumen usan el mismo criterio que el
  // presupuesto (uso por categoría). Lo sin categoría no cuenta hasta clasificarse (triage).
  const sumClp = (dir: string) =>
    clpTxs
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
  const { clpTxs, clpAmounts } = await clpView(deps.exchangeRates, txs)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const catById = new Map(withLimit.map((x) => [x.category.id, x.category]))
  const limitById = new Map(withLimit.map((x) => [x.category.id, x.limit]))
  // "Quedan" histórico en CLP (USD ya convertidos), indexado por id.
  const remaining = historicalRemaining(clpTxs, (id) => limitById.get(id) ?? null)
  // La lista no muestra reversados ni duplicados (ruido); sí muestra confirmed y pending.
  const dtos = txs
    .map((t, i) => ({ t, clp: clpAmounts[i] }))
    .filter(({ t }) => t.status !== "reversed" && t.status !== "duplicated")
    .map(({ t, clp }) =>
      txToDTO(
        t,
        t.categoryId ? catById.get(t.categoryId) : undefined,
        remaining.get(t.id) ?? null,
        t.categoryId ? (limitById.get(t.categoryId)?.toMajor() ?? null) : null,
        manual.has(t.accountId),
        clp
      )
    )
  return withRecurringState(deps, userId, dtos)
}

// Marca en cada DTO si su plantilla recurrente está activa o pausada. Se resuelve en el servidor
// (una consulta por vista) para que el modal no tenga que ir a buscarlo al montarse.
async function withRecurringState(
  deps: { recurring?: RecurringTemplateRepository },
  userId: string,
  dtos: TransactionDTO[]
): Promise<TransactionDTO[]> {
  if (!deps.recurring || !dtos.some((d) => d.recurringTemplateId)) return dtos
  const activeById = new Map(
    (await deps.recurring.listByUser(userId)).map((t) => [t.id, t.isActive])
  )
  return dtos.map((d) => ({
    ...d,
    recurringIsActive: d.recurringTemplateId
      ? (activeById.get(d.recurringTemplateId) ?? null)
      : null,
  }))
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
  const { clpAmounts } = await clpView(deps.exchangeRates, txs)
  const catById = new Map(cats.map((c) => [c.id, c]))
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const dtos = txs.map((t, i) =>
    txToDTO(
      t,
      t.categoryId ? catById.get(t.categoryId) : undefined,
      null,
      null,
      manual.has(t.accountId),
      clpAmounts[i]
    )
  )
  return withRecurringState(deps, userId, dtos)
}

export type AmountBoundsDTO = { min: number; max: number }

// Rango de montos (magnitudes) del usuario para acotar el slider del buscador. {0,0} si aún no
// hay movimientos (o el repo no soporta el aggregate).
export async function getAmountBounds(
  deps: { transactions: TransactionRepository },
  userId: string
): Promise<AmountBoundsDTO> {
  const b = await deps.transactions.amountBounds?.(userId)
  return b ?? { min: 0, max: 0 }
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
  // USD → CLP por fecha para que el uso por categoría cuente esos movimientos.
  const { clpTxs } = await clpView(deps.exchangeRates, txs)
  const categories = withLimit.map(({ category, limit }): CategoryDTO => {
    const direction = category.type === "income" ? "credit" : "debit"
    const { used, available } = computeCategoryUsage(
      category.id,
      limit,
      clpTxs,
      year,
      month,
      direction
    )
    const committed = computeCategoryCommitted(
      category.id,
      limit.currency,
      clpTxs,
      year,
      month,
      direction
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
      committed: committed.toMajor(),
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

export type RecurringDTO = {
  id: string
  description: string
  accountId: string
  accountName: string
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  direction: string
  baseAmount: number
  minAmount: number // extremos del rango de match, ya calculados para mostrarlos
  maxAmount: number
  currency: string
  tolerancePct: number
  periodicity: string
  dayOfMonth: number | null
  startDate: string // ISO: el cliente no recibe Date de un server component
  isActive: boolean
  nextExecution: string // ISO del próximo cobro esperado: lo que el usuario viene a mirar
}

// Plantillas recurrentes del usuario con nombres resueltos y el rango de tolerancia ya derivado,
// para la vista /recurring.
export async function listRecurringView(
  deps: {
    recurring: RecurringTemplateRepository
    accounts: AccountRepository
    categories: CategoryRepository
  },
  userId: string,
  today = new Date()
): Promise<RecurringDTO[]> {
  const [templates, accounts, categories] = await Promise.all([
    deps.recurring.listByUser(userId),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  const accById = new Map(accounts.map((a) => [a.id, a]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  return templates.map((t): RecurringDTO => {
    const cat = catById.get(t.categoryId)
    const { min, max } = toleranceRange(t)
    // Próximo cobro: la ejecución del período en curso si aún no pasó; si ya pasó, la del siguiente.
    const thisPeriod = executionDateFor(t, periodKeyFor(t, today))
    const next =
      thisPeriod >= today
        ? thisPeriod
        : executionDateFor(t, periodKeyFor(t, nextPeriodDate(t, today)))
    return {
      id: t.id,
      description: t.description,
      accountId: t.accountId,
      accountName: accById.get(t.accountId)?.name ?? "",
      categoryId: t.categoryId,
      categoryName: cat?.name ?? "",
      categoryIcon: cat?.icon ?? null,
      categoryColor: cat?.color ?? null,
      direction: t.direction,
      baseAmount: t.baseAmount.toMajor(),
      minAmount: min.toMajor(),
      maxAmount: max.toMajor(),
      currency: t.currency,
      tolerancePct: t.tolerancePct,
      periodicity: t.periodicity,
      dayOfMonth: t.dayOfMonth,
      startDate: t.startDate.toISOString(),
      isActive: t.isActive,
      nextExecution: next.toISOString(),
    }
  })
}

// Un día dentro del período siguiente al que contiene a `from` (basta para derivar su clave).
function nextPeriodDate(
  template: { periodicity: string },
  from: Date
): Date {
  const d = new Date(from)
  if (template.periodicity === "biweekly") d.setDate(d.getDate() + 14)
  else if (template.periodicity === "yearly") d.setFullYear(d.getFullYear() + 1)
  else d.setMonth(d.getMonth() + 1, 1)
  return d
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
  const { clpTxs, clpAmounts } = await clpView(deps.exchangeRates, txs)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const { used, available } = computeCategoryUsage(
    categoryId,
    limit,
    clpTxs,
    year,
    month,
    category.type === "income" ? "credit" : "debit"
  )
  const remaining = historicalRemaining(clpTxs, () => limit)
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    icon: category.icon,
    color: category.color,
    description: category.description,
    limit: limit.toMajor(),
    used: used.toMajor(),
    committed: computeCategoryCommitted(
      categoryId,
      limit.currency,
      clpTxs,
      year,
      month,
      category.type === "income" ? "credit" : "debit"
    ).toMajor(),
    available: available.toMajor(),
    status: categoryStatus(used, limit),
    transactions: txs
      .map((t, i) => ({ t, clp: clpAmounts[i] }))
      .filter(({ t }) => t.status !== "reversed" && t.status !== "duplicated")
      .map(({ t, clp }) =>
        txToDTO(
          t,
          category,
          remaining.get(t.id) ?? null,
          limit.toMajor(),
          manual.has(t.accountId),
          clp
        )
      ),
  }
}
