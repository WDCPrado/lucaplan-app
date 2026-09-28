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
import {
  isIncomeEndedAt,
  type Income,
  type IncomeRepository,
} from "../../domain/finance/income.domain.ts"
import { effectiveIncomeAmount } from "./income-use-cases.ts"
import {
  executionDateFor,
  hasEnded,
  periodKeyFor,
  toleranceRange,
  InvalidRecurringTemplateError,
  RecurringTemplateNotFoundError,
  type RecurringTemplateRepository,
} from "../../domain/finance/recurring.domain.ts"
import {
  committedForMonth,
  dueUnsettledItems,
  itemStatus,
  outstanding,
  progress,
  type InstallmentPlanRepository,
  type ItemStatus,
} from "../../domain/finance/installment.domain.ts"
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
  computeCategoryPace,
  categoryStatus,
  computeCapsOverspend,
  computeMonthOverspend,
  effectiveLimit,
  effectiveGlobalLimit,
  paceStatus,
  remainingToAllocate,
} from "./budget-formulas.ts"
import type { PaceFrequency } from "../../domain/finance/pace.domain.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"
import type { PeriodRange } from "../../../shared/billing-cycle.ts"
import { rangeOf } from "./budget-period-use-cases.ts"
import { todayKey } from "../../../shared/today.ts"

const CLP = "CLP" as const

type ReadDeps = {
  // Opcional: solo las vistas que muestran movimientos marcan su estado de recurrencia.
  recurring?: RecurringTemplateRepository
  // Opcional: el presupuesto suma las cuotas del mes al comprometido de su categoría.
  installments?: InstallmentPlanRepository
  // Opcional: la meta de una categoría de ingreso es la suma de sus ingresos del mes.
  incomes?: IncomeRepository
  // Opcional: modo del período (calendario o ciclo de la tarjeta). Sin él, mes calendario.
  budgetPeriod?: BudgetPeriodRepository
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
  recurringEndDate?: string | null // ISO del término de esa plantilla; null = indefinido
  installmentItemId?: string | null // cuota de un plan que este movimiento salda; null si no lo es
  installmentSourceCount?: number | null // esta compra se transformó en un plan de N cuotas; null si no
  // Fila DERIVADA (no es una transacción real): la cuota que vence este mes y aún no se paga, para
  // mostrarla como "Por cobrar" igual que una recurrente. Abre el modal como cualquier movimiento.
  installmentForecast?: boolean
  // Solo en filas forecast: el plan dueño de la cuota, para recategorizarlo desde el modal (una
  // fila derivada no tiene transacción propia que recategorizar).
  installmentPlanId?: string | null
}

export type CategoryDTO = {
  id: string
  name: string
  type: string // "income" (ingreso) | "expense" (gasto)
  icon: string | null
  color: string | null
  description: string | null // contexto para la IA; se edita en el modal
  paceEnabled: boolean // ¿muestra el ritmo del período? Se apaga por categoría en su modal
  limit: number
  used: number
  committed: number // comprometido: Σ pending del mes (recurrentes aún no cobradas); capa aparte del usado
  available: number
  status: string
  // Ritmo del período en curso (hoy / esta semana): gastado vs presupuesto, con su semáforo.
  // Solo en categorías de gasto con tope, mirando el mes actual; null/ausente en el resto.
  pace?: PaceDTO | null
}

export type PaceDTO = {
  frequency: PaceFrequency
  spent: number // gastado en el período (hoy o desde el lunes)
  budget: number // presupuesto del período; estable durante el período
  status: "ok" | "alerta" | "excedido" // silencio <80%, alerta 80–100%, excedido >100%
}

export type BudgetViewDTO = {
  categories: CategoryDTO[]
  globalLimit: number | null // límite global efectivo del mes (carry); null = no definido
  allocated: number // Σ límites efectivos de las categorías de GASTO
  remainingToAllocate: number | null // globalLimit − allocated; null sin límite global
  // Los dos excedentes del mes, que NO son lo mismo y pueden convivir (la UI no los suma):
  // descuadre entre categorías vs. plata que de verdad no había. 0 = nadie se pasó.
  capsOverspend: number // Σ max(0, usado − tope) de las categorías de gasto con tope
  monthOverspend: number // max(0, gasto del mes − límite global); 0 sin límite global
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
    installmentItemId: t.installmentItemId ?? null,
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
    t.amount.currency === "CLP"
      ? t
      : { ...t, amount: toClp(t.amount, rates[i]) }
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
  const range = await rangeOf(deps, year, month)
  const txs = await deps.transactions.listByUserPeriod(userId, range)
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
  const range = await rangeOf(deps, year, month)
  const txs = await deps.transactions.listByUserPeriod(userId, range)
  const withLimit = await categoriesWithLimit(deps, userId, year, month)
  const accounts = await deps.accounts.listByUser(userId)
  const { clpTxs, clpAmounts } = await clpView(deps.exchangeRates, txs)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const catById = new Map(withLimit.map((x) => [x.category.id, x.category]))
  const limitById = new Map(withLimit.map((x) => [x.category.id, x.limit]))
  // "Quedan" histórico en CLP (USD ya convertidos), indexado por id.
  const remaining = historicalRemaining(
    clpTxs,
    (id) => limitById.get(id) ?? null
  )
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
  const withState = await withRecurringState(deps, userId, dtos)
  // Cuotas por cobrar del mes: filas DERIVADAS, no transacciones. Se anticipan como "Por cobrar"
  // igual que una recurrente y desaparecen solas al pagarse (ahí nace la transacción real). No se
  // persiste nada: por eso el disparo por correo sigue intacto y no hay doble conteo.
  const forecast = await installmentForecastRows(deps, userId, range, catById)
  // Orden por fecha desc para TODO el conjunto: la lista agrupa por día filas CONTIGUAS, así que
  // un forecast fuera de orden partiría un día en dos grupos (keys duplicadas en React) y además
  // mostraría la cuota lejos de su fecha. El sort es estable: dentro del día, forecast primero.
  return [...forecast, ...withState].sort((a, b) =>
    b.date.localeCompare(a.date)
  )
}

// Construye las filas de pronóstico de las cuotas que vencen en el rango del mes y aún no se pagan.
async function installmentForecastRows(
  deps: { installments?: InstallmentPlanRepository },
  userId: string,
  range: PeriodRange,
  catById: Map<string, Category>
): Promise<TransactionDTO[]> {
  if (!deps.installments) return []
  const plans = await deps.installments.listByUser(userId)
  const rows: TransactionDTO[] = []
  for (const plan of plans) {
    const cat = catById.get(plan.categoryId)
    for (const item of dueUnsettledItems(plan, range)) {
      rows.push({
        id: `forecast:${item.id}`,
        accountId: plan.accountId,
        currency: plan.currency,
        editable: false,
        description: `${plan.description} · cuota ${item.index}/${plan.installmentsCount}`,
        amount: item.amount.toMajor(),
        direction: "debit",
        date: item.dueDate.toISOString(),
        status: "pending",
        isInternal: false,
        categoryId: plan.categoryId,
        categoryName: cat?.name ?? null,
        categoryIcon: cat?.icon ?? null,
        categoryColor: cat?.color ?? null,
        remaining: null,
        categoryLimit: null,
        installmentForecast: true,
        installmentItemId: item.id,
        installmentPlanId: plan.id,
      })
    }
  }
  return rows
}

// Marca en cada DTO si su plantilla recurrente está activa o pausada. Se resuelve en el servidor
// (una consulta por vista) para que el modal no tenga que ir a buscarlo al montarse.
async function withRecurringState(
  deps: {
    recurring?: RecurringTemplateRepository
    installments?: InstallmentPlanRepository
  },
  userId: string,
  dtos: TransactionDTO[]
): Promise<TransactionDTO[]> {
  const hasRecurring = deps.recurring && dtos.some((d) => d.recurringTemplateId)
  // Una compra transformada en cuotas queda neutralizada: sin este sello se vería como un gasto
  // interno cualquiera, sin explicar por qué no cuenta. La cuota en sí ya se marca por su ítem.
  const hasInstallments = deps.installments && dtos.length > 0
  if (!hasRecurring && !hasInstallments) return dtos

  const [templates, plans] = await Promise.all([
    hasRecurring ? deps.recurring!.listByUser(userId) : Promise.resolve([]),
    hasInstallments
      ? deps.installments!.listByUser(userId)
      : Promise.resolve([]),
  ])
  const byId = new Map(templates.map((t) => [t.id, t]))
  // Compra origen → cuántas cuotas, para el sello "Compra en N cuotas" en el movimiento.
  const sourceCount = new Map<string, number>()
  for (const p of plans)
    if (p.sourceTransactionId)
      sourceCount.set(p.sourceTransactionId, p.installmentsCount)

  return dtos.map((d) => {
    const template = d.recurringTemplateId
      ? byId.get(d.recurringTemplateId)
      : undefined
    return {
      ...d,
      recurringIsActive: template ? template.isActive : null,
      recurringEndDate: template?.endDate
        ? template.endDate.toISOString()
        : null,
      installmentSourceCount: sourceCount.get(d.id) ?? null,
    }
  })
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
  deps: {
    transactions: TransactionRepository
    accounts: AccountRepository
    budgetPeriod?: BudgetPeriodRepository
  },
  userId: string,
  year: number,
  month: number
): Promise<UncategorizedDTO> {
  const range = await rangeOf(deps, year, month)
  const [txs, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, {
      uncategorized: true,
      from: new Date(`${range.start}T00:00:00Z`),
      to: new Date(`${range.end}T00:00:00Z`), // último día del mes, inclusive
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
    // El buscador mira la cartola: solo lo que ya ocurrió. Se fuerza acá (no en el endpoint) para
    // que ninguna llamada pueda pedir las recurrentes por cobrar por accidente.
    deps.transactions.searchByUser(userId, { ...filters, settledOnly: true }),
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
  month: number,
  // Ritmo del período (dashboard): frecuencia configurada + "hoy" ("YYYY-MM-DD") del calendario
  // del usuario. Sin esto (u otras vistas/meses pasados) las categorías no llevan `pace`.
  pace?: { frequency: PaceFrequency; today: string }
): Promise<BudgetViewDTO> {
  const range = await rangeOf(deps, year, month)
  const [withLimit, txs, budgets, plans, incomesList, incomeAmounts] =
    await Promise.all([
      categoriesWithLimit(deps, userId, year, month),
      deps.transactions.listByUserPeriod(userId, range),
      deps.monthlyBudgets.listByUser(userId),
      deps.installments?.listByUser(userId) ?? Promise.resolve([]),
      deps.incomes?.listByUser(userId) ?? Promise.resolve([]),
      deps.incomes?.listAmountsByUser(userId) ?? Promise.resolve([]),
    ])
  // USD → CLP por fecha para que el uso por categoría cuente esos movimientos.
  const { clpTxs } = await clpView(deps.exchangeRates, txs)
  // Comprometido de cuotas por categoría: la cuota que vence en el rango y aún no se paga se anticipa
  // como comprometida, igual que una recurrente. Derivado, no filas: al pagarse pasa a `used` y
  // desaparece de aquí, sin doble conteo.
  const installmentCommitted = new Map<string, Money>()
  for (const plan of plans) {
    const amount = committedForMonth(plan, range)
    if (amount.isZero) continue
    const prev = installmentCommitted.get(plan.categoryId)
    installmentCommitted.set(plan.categoryId, prev ? prev.add(amount) : amount)
  }
  // Meta de cada categoría de ingreso = suma de sus ingresos vigentes del mes. Derivada, no
  // persistida: agregar/editar/eliminar un ingreso la actualiza sola.
  // ponytail: suma solo CLP; una fuente en otra moneda no entra a la meta.
  const incomeGoal = new Map<string, Money>()
  for (const inc of incomesList) {
    if (!inc.isActive || isIncomeEndedAt(inc, year, month)) continue
    const amount = effectiveIncomeAmount(incomeAmounts, inc.id, year, month)
    if (!amount || amount.currency !== CLP) continue
    const prev = incomeGoal.get(inc.categoryId)
    incomeGoal.set(inc.categoryId, prev ? prev.add(amount) : amount)
  }
  // Cifras por categoría en Money, ANTES de bajarlas al DTO: los excedentes del mes se suman
  // desde acá en vez de recalcular el uso o reconstruir montos desde los números del DTO.
  const computed = withLimit.map(({ category, limit: catLimit }) => {
    const direction = category.type === "income" ? "credit" : "debit"
    const limit =
      category.type === "income"
        ? (incomeGoal.get(category.id) ?? Money.zero(CLP))
        : catLimit
    const { used, available } = computeCategoryUsage(
      category.id,
      limit,
      clpTxs,
      range,
      direction
    )
    const fromInstallments = installmentCommitted.get(category.id)
    const committed = computeCategoryCommitted(
      category.id,
      limit.currency,
      clpTxs,
      range,
      direction
    ).add(
      // Solo si coinciden la moneda de la categoría y la del plan (el comprometido es por moneda).
      fromInstallments && fromInstallments.currency === limit.currency
        ? fromInstallments
        : Money.zero(limit.currency)
    )
    // Ritmo del período: solo gasto con tope y solo si la vista mira el mes de "hoy". El DTO
    // se recalcula en cada lectura (router.refresh tras registrar un gasto lo actualiza solo).
    const paceDTO =
      pace &&
      category.type === "expense" &&
      // Apagado en esta categoría: se gasta de una vez (una suscripción se cobra un día del mes),
      // así que repartir su tope por día o por semana solo produce un semáforo que miente.
      category.paceEnabled &&
      limit.isPositive &&
      pace.today >= range.start &&
      pace.today <= range.end
        ? (() => {
            const p = computeCategoryPace(
              category.id,
              available,
              clpTxs,
              pace.today,
              pace.frequency,
              range
            )
            return {
              frequency: pace.frequency,
              spent: p.spent.toMajor(),
              budget: p.budget.toMajor(),
              status: paceStatus(p.spent, p.budget),
            }
          })()
        : null
    return { category, limit, used, available, committed, paceDTO }
  })
  const categories = computed.map(
    ({
      category,
      limit,
      used,
      available,
      committed,
      paceDTO,
    }): CategoryDTO => ({
      id: category.id,
      name: category.name,
      type: category.type,
      icon: category.icon,
      color: category.color,
      description: category.description,
      paceEnabled: category.paceEnabled,
      limit: limit.toMajor(),
      used: used.toMajor(),
      committed: committed.toMajor(),
      available: available.toMajor(),
      // Ingreso: llegar a la meta es bueno, no "excedido" — el semáforo es solo de gastos.
      status:
        category.type === "income" ? "bueno" : categoryStatus(used, limit),
      pace: paceDTO,
    })
  )
  // Orden, en dos niveles:
  //  1) las que muestran RITMO del período arriba — son las accionables hoy; las que no lo tienen
  //     (apagado, sin tope, o un mes que no es el actual) caen debajo sin mezclarse;
  //  2) dentro de cada grupo, WDC-13: la de la transacción más reciente del mes primero. `txs`
  //     viene más-nuevo primero, así que el primer encuentro de cada categoría marca su recencia;
  //     las sin movimiento este mes quedan al final de su grupo (sort estable).
  const recencyRank = new Map<string, number>()
  txs.forEach((t, i) => {
    if (t.categoryId && !recencyRank.has(t.categoryId))
      recencyRank.set(t.categoryId, i)
  })
  categories.sort((a, b) => {
    const byPace = Number(!!b.pace) - Number(!!a.pace)
    if (byPace !== 0) return byPace
    return (
      (recencyRank.get(a.id) ?? txs.length) -
      (recencyRank.get(b.id) ?? txs.length)
    )
  })
  const allocated = withLimit
    .filter((x) => x.category.type === "expense")
    .reduce((s, x) => s.add(x.limit), Money.zero(CLP))
  const globalLimit = effectiveGlobalLimit(budgets, year, month)
  const remaining = remainingToAllocate(globalLimit, allocated)
  // Gasto del mes: el mismo Σ usado de las categorías de GASTO que la UI muestra como "Gastado"
  // (los límites de categoría no llevan moneda: siempre CLP). Con él se mide el excedente del mes.
  const spent = computed
    .filter(({ category }) => category.type === "expense")
    .reduce((s, { used }) => s.add(used), Money.zero(CLP))
  return {
    categories,
    globalLimit: globalLimit === null ? null : globalLimit.toMajor(),
    allocated: allocated.toMajor(),
    remainingToAllocate: remaining === null ? null : remaining.toMajor(),
    capsOverspend: computeCapsOverspend(
      computed.map(({ category, used, limit }) => ({
        type: category.type,
        used,
        limit,
      })),
      CLP
    ).toMajor(),
    monthOverspend: computeMonthOverspend(spent, globalLimit).toMajor(),
  }
}

/**
 * Deuda que el mes anterior le deja a (year, month): su EXCEDENTE DEL MES, o sea
 * `max(0, gasto − límite global)` del mes anterior. Es plata que ya se gastó —salió del colchón o
 * de la tarjeta— y que por lo tanto este mes no está disponible para repartir. Vale 0 si ese mes
 * cerró dentro de su presupuesto y también si no tenía presupuesto definido: no se puede pasar de
 * un límite que no existe. Con el modo tarjeta, "el mes anterior" es el ciclo anterior: lo
 * resuelve `getBudgetView` con el mismo rango que ese mes muestra.
 *
 * El excedente de TOPES no participa: pasarse de un tope con presupuesto global libre no debe
 * nada, porque la plata existía y solo estaba asignada a otra cosa.
 *
 * ponytail: lee el mes anterior entero con `getBudgetView` para quedarse con un solo número. Es a
 * propósito — así el monto que el plan descuenta es IDÉNTICAMENTE el que ese mes reporta como
 * excedente, sin una segunda definición de "gasto del mes" que se pueda desincronizar. El techo es
 * la latencia del dashboard (corre en paralelo con las demás lecturas); si algún día molesta, se
 * extrae de `getBudgetView` la porción "gasto del mes + límite global efectivo" y la comparten las
 * dos, en vez de escribir otra fórmula.
 */
export async function getPreviousMonthDebt(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<number> {
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const previous = await getBudgetView(deps, userId, prevYear, prevMonth)
  return previous.monthOverspend
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
  const [incomes, amounts, accounts, categories] = await Promise.all([
    deps.incomes.listByUser(userId),
    deps.incomes.listAmountsByUser(userId),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  const accById = new Map(accounts.map((a) => [a.id, a]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  // Monto vigente en ESE mes (carry-forward). Sin monto = la fuente no existía aún: no se lista,
  // igual que un límite de categoría no aparece antes de haberse definido.
  const visible = incomes
    .filter((i) => !isIncomeEndedAt(i, year, month))
    .map((i) => ({
      income: i,
      amount: effectiveIncomeAmount(amounts, i.id, year, month),
    }))
    .filter((x): x is { income: Income; amount: Money } => x.amount !== null)
  return Promise.all(
    visible.map(async ({ income: i, amount }): Promise<IncomeDTO> => {
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
        amount: amount.toMajor(),
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
  label: string // nombre visible; la clave de match (description) no se expone al cliente
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
  endDate: string | null // ISO; null = indefinida
  hasEnded: boolean // su fecha de fin ya pasó: no ejecuta más ni puede reactivarse
  isActive: boolean
  nextExecution: string // ISO del próximo cobro esperado: lo que el usuario viene a mirar
  currentPeriodPaid: boolean // el cobro del período en curso ya llegó (transacción confirmed)
  // Ese cobro lo marcó el usuario a mano, no el banco: es lo único que puede deshacerse.
  currentPeriodPaidManually: boolean
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
  return Promise.all(templates.map(async (t): Promise<RecurringDTO> => {
    const cat = catById.get(t.categoryId)
    const { min, max } = toleranceRange(t)
    // Próximo cobro: la ejecución del período en curso si aún no pasó; si ya pasó, la del siguiente.
    const thisPeriod = executionDateFor(t, periodKeyFor(t, today))
    const next =
      thisPeriod >= today
        ? thisPeriod
        : executionDateFor(t, periodKeyFor(t, nextPeriodDate(t, today)))
    // Cobrado = el período en curso ya tiene su cargo real (confirmed); el comprometido pending no.
    const periodTx = await deps.recurring.findPeriodTransaction(
      t.id,
      periodKeyFor(t, today)
    )
    return {
      id: t.id,
      label: t.label,
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
      endDate: t.endDate ? t.endDate.toISOString() : null,
      hasEnded: hasEnded(t, today),
      isActive: t.isActive,
      nextExecution: next.toISOString(),
      currentPeriodPaid: periodTx?.status === "confirmed",
      currentPeriodPaidManually:
        periodTx?.status === "confirmed" && periodTx.isManual,
    }
  }))
}

// Movimientos que el usuario puede elegir como el cobro del período en curso de la plantilla `id`
// (ver `payRecurringPeriodWith`): movimientos del banco confirmados y sin vínculo, de su misma
// dirección y moneda, de los últimos `days` días (hoy en Chile, sin tope futuro), más nuevos
// primero. Sin filtro de monto: a veces el cargo real se pasa de cualquier umbral.
// `categoryId: null` = sin categoría.
export async function listRecurringCandidates(
  deps: ReadDeps & { recurring: RecurringTemplateRepository },
  userId: string,
  id: string,
  filters: { days?: number; query?: string; categoryId?: string | null } = {},
  now = new Date()
): Promise<{ items: TransactionDTO[] }> {
  const template = await deps.recurring.findById(id)
  if (!template) throw new RecurringTemplateNotFoundError(id)
  if (template.userId !== userId) throw new NotOwnerError()
  const days = filters.days ?? 10
  if (!Number.isInteger(days) || days < 1 || days > 365)
    throw new InvalidRecurringTemplateError(
      "Los días deben ser un número entero entre 1 y 365"
    )
  // Fechas de movimiento = día civil a medianoche UTC; "hoy" es el día civil de Chile.
  const from = new Date(`${todayKey(now)}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - days)
  const items = await searchTransactions(deps, userId, {
    direction: template.direction,
    currency: template.currency,
    from,
    query: filters.query,
    categoryId: filters.categoryId,
    recurringCandidates: true,
    limit: 50,
  })
  return { items }
}

// Un día dentro del período siguiente al que contiene a `from` (basta para derivar su clave).
function nextPeriodDate(template: { periodicity: string }, from: Date): Date {
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
  const range = await rangeOf(deps, year, month)
  const txs = await deps.transactions.listByCategoryPeriod(categoryId, range)
  const accounts = await deps.accounts.listByUser(userId)
  const { clpTxs, clpAmounts } = await clpView(deps.exchangeRates, txs)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const { used, available } = computeCategoryUsage(
    categoryId,
    limit,
    clpTxs,
    range,
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
    paceEnabled: category.paceEnabled,
    limit: limit.toMajor(),
    used: used.toMajor(),
    committed: computeCategoryCommitted(
      categoryId,
      limit.currency,
      clpTxs,
      range,
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

// --- Planes de cuotas ---

export type InstallmentItemDTO = {
  id: string
  index: number
  dueDate: string // ISO
  amount: number // card: definitivo; loan: estimación (el correo manda)
  paidAmount: number | null // lo efectivamente registrado; null si aún no se registró
  status: ItemStatus
}

export type InstallmentPlanDTO = {
  id: string
  kind: string // card | loan
  description: string
  accountId: string
  accountName: string
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  categoryColor: string | null
  totalAmount: number
  currency: string
  installmentsCount: number
  startDate: string // ISO
  dayOfMonth: number
  completedAt: string | null
  settledCount: number // avance: cuotas saldadas por cualquier vía
  outstanding: number // saldo sobre lo REGISTRADO, no sobre el cronograma
  nextDueDate: string | null // ISO del próximo vencimiento pendiente
  sourceTransactionId: string | null
  items: InstallmentItemDTO[]
}

/**
 * Planes del usuario con nombres resueltos, estado por cuota y saldo real.
 *
 * El saldo se calcula sobre los montos EFECTIVAMENTE registrados, no sobre el cronograma: en un
 * plan `loan` las cuotas varían (intereses, seguros, la última difiere), así que el cronograma es
 * una estimación y mostrar su resta como deuda mentiría.
 */
export async function listInstallmentsView(
  deps: {
    installments: InstallmentPlanRepository
    accounts: AccountRepository
    categories: CategoryRepository
    transactions: TransactionRepository
  },
  userId: string,
  today = new Date()
): Promise<InstallmentPlanDTO[]> {
  const [plans, accounts, categories] = await Promise.all([
    deps.installments.listByUser(userId),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  if (plans.length === 0) return []

  const accById = new Map(accounts.map((a) => [a.id, a]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  // Montos reales de las cuotas ya registradas: una sola consulta para todos los planes.
  const txIds = plans.flatMap((p) =>
    p.items
      .map((i) => i.transactionId)
      .filter((id): id is string => id !== null)
  )
  const paidById = new Map<string, Money>()
  for (const id of txIds) {
    const tx = await deps.transactions.findById(id)
    if (tx) paidById.set(id, tx.amount)
  }

  return plans.map((plan): InstallmentPlanDTO => {
    const cat = catById.get(plan.categoryId)
    const paid = plan.items
      .map((i) => (i.transactionId ? paidById.get(i.transactionId) : null))
      .filter((m): m is Money => m != null)
    const pending = plan.items.find(
      (i) => !i.transactionId && !i.paidOutsideApp
    )
    return {
      id: plan.id,
      kind: plan.kind,
      description: plan.description,
      accountId: plan.accountId,
      accountName: accById.get(plan.accountId)?.name ?? "",
      categoryId: plan.categoryId,
      categoryName: cat?.name ?? "",
      categoryIcon: cat?.icon ?? null,
      categoryColor: cat?.color ?? null,
      totalAmount: plan.totalAmount.toMajor(),
      currency: plan.currency,
      installmentsCount: plan.installmentsCount,
      startDate: plan.startDate.toISOString(),
      dayOfMonth: plan.dayOfMonth,
      completedAt: plan.completedAt ? plan.completedAt.toISOString() : null,
      settledCount: progress(plan).settled,
      outstanding: outstanding(plan, paid).toMajor(),
      nextDueDate: pending ? pending.dueDate.toISOString() : null,
      sourceTransactionId: plan.sourceTransactionId,
      items: plan.items.map((i) => ({
        id: i.id,
        index: i.index,
        dueDate: i.dueDate.toISOString(),
        amount: i.amount.toMajor(),
        paidAmount: i.transactionId
          ? (paidById.get(i.transactionId)?.toMajor() ?? null)
          : null,
        status: itemStatus(i, today),
      })),
    }
  })
}
