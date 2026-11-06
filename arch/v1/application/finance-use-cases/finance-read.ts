import { isDuplicateInstallmentPayment } from "./duplicate-installment-payment.ts"
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
  RECURRING_MATCH_WINDOW_DAYS,
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
  type InstallmentPlan,
  type InstallmentPlanRepository,
  type ItemStatus,
} from "../../domain/finance/installment.domain.ts"
import type { ExchangeRateProvider } from "../../domain/finance/exchange.domain.ts"
import { toClp } from "../../domain/finance/exchange.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import {
  inRange,
  computeCategoryUsage,
  computeCategoryCommitted,
  computeCategoryPace,
  categoryStatus,
  computeCapsOverspend,
  computeMonthOverspend,
  effectiveLimit,
  effectiveGlobalBudget,
  paceStatus,
  pacePeriod,
  remainingToAllocate,
  isInPlan,
  computeSpendable,
  computeGlobalPaceDaily,
} from "./budget-formulas.ts"
import { calculateFinancialHealth } from "../../../../lib/financial-health.ts"
import type { PaceFrequency } from "../../domain/finance/pace.domain.ts"
import type { BudgetPeriodRepository } from "../../domain/finance/budget-period.domain.ts"
import type { PeriodRange } from "../../../shared/billing-cycle.ts"
import { rangeOf, getBudgetPeriod, scopeBudgetPeriod, type BudgetPeriodDeps } from "./budget-period-use-cases.ts"
import { todayKey } from "../../../shared/today.ts"
import { isAdditionalIncome } from "../../../../lib/additional-income.ts"

import { currencyPositions } from "./financial-position.ts"

const CLP = "CLP" as const

import { usesGrossExpense, type ReimbursementRead } from "../../domain/finance/reimbursement.domain.ts"

type ReadDeps = {
  balanceBuckets?: BalanceBucketRepository
  reimbursements?: {
    listForTransactions(userId: string, ids: string[]): Promise<ReimbursementRead[]>
  }
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
  reimbursementCount?: number
  duplicateInstallmentPayment?: boolean // cobro sobrante desvinculado; puede eliminarse
  editable: boolean // true solo si su cuenta es manual (las conectadas son de solo lectura)
  description: string
  amount: number
  direction: string
  date: string
  status: string // confirmed | pending | reversed | duplicated (solo confirmed cuenta)
  isInternal?: boolean // ajuste de saldo; no participa en ingresos, gastos ni presupuesto
  incomeId?: string | null // permite evitar contar dos veces abonos vinculados a una fuente
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
  available: number // limit − used (para «sobre el tope»)
  free: number // limit − used − committed: lo que «quedan» de verdad
  // ¿Está en el plan del período? Gasto con tope, o sin tope pero con gasto o comprometido en el
  // período (entra con tope 0: todo es exceso). Se calcula al leer; sin movimientos vuelve a «sin tope».
  inPlan: boolean
  status: string
  // Ritmo del período en curso (hoy / esta semana): gastado vs presupuesto, con su semáforo.
  // Solo en categorías de gasto con tope, mirando el mes actual; null/ausente en el resto.
  pace?: PaceDTO | null
}

export type PaceDTO = {
  frequency: PaceFrequency
  nextResetDate: string // día civil siguiente al cierre del ritmo, incluidos períodos recortados
  spent: number // gastado en el período (hoy o desde el lunes)
  budget: number // presupuesto del período; estable durante el período
  status: "ok" | "alerta" | "excedido" // silencio <80%, alerta 80–100%, excedido >100%
}

export type BudgetViewDTO = {
  categories: CategoryDTO[]
  income: number // fuentes activas efectivas + abonos CLP no cubiertos por esas fuentes
  spent: number // todo gasto CLP confirmado no interno del período, con o sin categoría o tope
  reimbursementAdjustment?: number // compensación ya incluida en los ingresos del medidor
  committed: number // todo gasto pendiente y toda cuota por cobrar del período, con o sin tope
  // Hay movimientos en USD sin dólar observado: quedaron fuera de los totales (no se inventa tasa).
  exchangeRateUnavailable: boolean
  globalLimit: number | null // límite global efectivo del mes (carry); null = no definido
  // El tope efectivo lo puso «Igualar al ingreso» y sigue solo al total del plan (heredado con él).
  globalLimitFollowsIncome: boolean
  allocated: number // Σ límites efectivos de las categorías de GASTO
  remainingToAllocate: number | null // globalLimit − allocated; null sin límite global
  // Los dos excedentes del mes, que NO son lo mismo y pueden convivir (la UI no los suma):
  // descuadre entre categorías vs. plata que de verdad no había. 0 = nadie se pasó.
  capsOverspend: number // Σ max(0, usado − tope) de las categorías de gasto con tope
  monthOverspend: number // max(0, gasto del mes − límite global); 0 sin límite global
  // Titular del Inicio (WDC-177): mín(margen real, lo planificado que queda). Puede ser negativo.
  spendable: SpendableDTO
  // Ritmo global (WDC-177): reparte lo disponible al inicio del período y solo cuenta el gasto
  // que no salda un compromiso (recurrente o cuota). Reemplaza a `globalLimit` en la curva.
  globalPace: GlobalPaceDTO
}

export type SpendableDTO = {
  amount: number // mín(margin, plannedLeft)
  margin: number // ingresos − gastado − comprometido (− compensación de reembolsos): el balance de hoy
  plannedLeft: number // Σ free de las categorías inPlan (las sin tope aportan −(usado + comprometido))
  limitedBy: "margin" | "plan" // cuál de las dos manda; empate = "plan"
}

export type GlobalPaceDTO = {
  // Base de la curva, estable en el período: spendable.amount + gasto de ritmo ya hecho en el período.
  budget: number
  // Gasto de ritmo por fecha del período (mismo orden que los días del rango), en CLP: cargos
  // confirmados no internos SIN recurringTemplateId ni installmentItemId.
  daily: number[]
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
    incomeId: t.incomeId ?? null,
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
// (el histórico no cambia → el CLP estimado es estable entre vistas). Devuelve las tx con amount en
// CLP para las FÓRMULAS y, alineado a `txs`, el CLP estimado por tx para el DTO (null si ya venía en
// CLP o si no hay tasa). Sin dólar observado el movimiento queda FUERA de `clpTxs` (no se inventa una
// tasa) y `rateUnavailable` lo avisa. Los rates se cachean por año en el adapter.
async function clpView(
  provider: ExchangeRateProvider,
  txs: Transaction[]
): Promise<{ clpTxs: Transaction[]; clpAmounts: (number | null)[]; rateUnavailable: boolean }> {
  const rates = await Promise.all(
    txs.map((t) =>
      t.amount.currency === "CLP"
        ? Promise.resolve(null)
        : provider.clpPerUsdAt(t.date)
    )
  )
  const converted = txs.map((t, i) => {
    if (t.amount.currency === "CLP") return t
    const rate = rates[i]
    return rate === null ? null : { ...t, amount: toClp(t.amount, rate) }
  })
  return {
    clpTxs: converted.filter((t): t is Transaction => t !== null),
    clpAmounts: txs.map((t, i) =>
      t.amount.currency === "CLP" ? null : converted[i]?.amount.toMajor() ?? null
    ),
    rateUnavailable: converted.some((t) => t === null),
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
  deps: { categories: CategoryRepository } & BudgetPeriodDeps,
  userId: string,
  year: number,
  month: number
): Promise<{ category: Category; limit: Money }[]> {
  const [cats, limits] = await Promise.all([
    deps.categories.listByUser(userId),
    deps.categories.listLimitsByUser(userId, (await getBudgetPeriod(deps)).mode),
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
  deps = await scopeBudgetPeriod(deps)
  const accounts = await deps.accounts.listByUser(userId)
  const range = await rangeOf(deps, year, month)
  const txs = await deps.transactions.listByUserPeriod(userId, range)
  const withLimit = await categoriesWithLimit(deps, userId, year, month)
  // Montos en otra moneda (USD) convertidos a CLP por el dólar de su fecha, para que cuenten.
  const { clpTxs } = await clpView(deps.exchangeRates, txs)

  // Gastos: todo gasto real, con o sin categoría o tope (mismo criterio que `spent` del plan).
  // Los ingresos mantienen su total categorizado.
  const sumClp = (dir: string) =>
    clpTxs
      .filter(
        (t) =>
          t.direction === dir &&
          (dir === "debit" || t.categoryId !== null) &&
          t.amount.currency === CLP &&
          t.status === "confirmed" &&
          !t.isInternal
      )
      .reduce((s, t) => s.add(t.amount), Money.zero(CLP))

  const buckets = await deps.balanceBuckets?.listByUser(userId) ?? []
  const position = currencyPositions(accounts, buckets).find(p => p.currency === CLP)!

  return {
    activeCash: position.cash,
    netPosition: position.cash - position.overdraftUsed,
    overdraftDebt: position.overdraftUsed,
    creditCardDebts: accounts.filter(a => a.accountType === "credit_card").map(a => ({
      accountId: a.id,
      name: a.name,
      debt: currencyPositions([a], buckets).find(p => p.currency === CLP)!.cardDebt,
    })).filter(d => d.debt > 0),
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

// Metadata de enlaces, en una consulta por página. Nunca modifica montos bancarios.
async function withReimbursementCounts(deps: ReadDeps, userId: string, rows: TransactionDTO[]): Promise<TransactionDTO[]> {
  const ids = rows.filter(t => !t.installmentForecast).map(t => t.id)
  if (!ids.length) return rows
  const links = await deps.reimbursements?.listForTransactions(userId, ids) ?? []
  const counts = new Map<string, number>()
  for (const link of links) {
    counts.set(link.expenseId, (counts.get(link.expenseId) ?? 0) + 1)
    counts.set(link.creditId, (counts.get(link.creditId) ?? 0) + 1)
  }
  return rows.map(tx => ({ ...tx, reimbursementCount: counts.get(tx.id) ?? 0 }))
}

export async function listTransactions(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<TransactionDTO[]> {
  deps = await scopeBudgetPeriod(deps)
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
  const withState = await withRecurringState(deps, userId, dtos, txs)
  // Cuotas por cobrar del mes: filas DERIVADAS, no transacciones. Se anticipan como "Por cobrar"
  // igual que una recurrente y desaparecen solas al pagarse (ahí nace la transacción real). No se
  // persiste nada: por eso el disparo por correo sigue intacto y no hay doble conteo.
  const forecast = await installmentForecastRows(deps, userId, range, catById)
  // Orden por fecha desc para TODO el conjunto: la lista agrupa por día filas CONTIGUAS, así que
  // un forecast fuera de orden partiría un día en dos grupos (keys duplicadas en React) y además
  // mostraría la cuota lejos de su fecha. El sort es estable: dentro del día, forecast primero.
  return withReimbursementCounts(deps, userId, [...forecast, ...withState].sort((a, b) =>
    b.date.localeCompare(a.date)
  ))
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
    transactions: TransactionRepository
    budgetPeriod?: BudgetPeriodRepository
  },
  userId: string,
  dtos: TransactionDTO[],
  transactions: Transaction[]
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

  const transactionById = new Map(transactions.map((t) => [t.id, t]))
  return Promise.all(
    dtos.map(async (d) => {
      const template = d.recurringTemplateId
        ? byId.get(d.recurringTemplateId)
        : undefined
      return {
        ...d,
        duplicateInstallmentPayment:
          !d.editable &&
          !!transactionById.get(d.id) &&
          (await isDuplicateInstallmentPayment(
            deps,
            userId,
            transactionById.get(d.id)!,
            plans
          )),
        recurringIsActive: template ? template.isActive : null,
        recurringEndDate: template?.endDate
          ? template.endDate.toISOString()
          : null,
        installmentSourceCount: sourceCount.get(d.id) ?? null,
      }
    })
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
/** Detalle de un movimiento para navegación directa desde un reembolso relacionado. */
export async function getLinkedTransactionDTO(deps: ReadDeps, userId: string, transactionId: string): Promise<TransactionDTO | null> {
  const tx = await deps.transactions.findById(transactionId)
  if (!tx || tx.userId !== userId || tx.status !== "confirmed") return null
  const [cats, accounts] = await Promise.all([deps.categories.listByUser(userId), deps.accounts.listByUser(userId)])
  return (await searchResultDTOs(deps, userId, [tx], cats, accounts))[0] ?? null
}

export async function searchTransactions(
  deps: ReadDeps,
  userId: string,
  filters: TransactionSearchFilters
): Promise<TransactionDTO[]> {
  // El buscador mira la cartola: solo lo que ya ocurrió. Se fuerza acá (no en el endpoint) para
  // que ninguna llamada pueda pedir las recurrentes por cobrar por accidente.
  const [txs, cats, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, { ...filters, settledOnly: true }),
    deps.categories.listByUser(userId),
    deps.accounts.listByUser(userId),
  ])
  return searchResultDTOs(deps, userId, txs, cats, accounts)
}

export type TransactionPage = {
  items: TransactionDTO[]
  total: number
  page: number
  pageSize: number
}

// Búsqueda paginada (pantalla Movimientos): mismos filtros, orden y DTO que `searchTransactions`;
// `total` cuenta con el mismo where. `page` desde 1; inválido → 1. `pageSize` 1..100; inválido → 20.
// Una página pasada del final devuelve items vacíos con el total real.
export async function searchTransactionsPage(
  deps: ReadDeps,
  userId: string,
  filters: TransactionSearchFilters,
  page: number,
  pageSize: number
): Promise<TransactionPage> {
  const p = Number.isInteger(page) && page >= 1 ? page : 1
  const size =
    Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100
      ? pageSize
      : 20
  const where = { ...filters, settledOnly: true }
  const [txs, total, cats, accounts] = await Promise.all([
    deps.transactions.searchByUser(userId, {
      ...where,
      limit: size,
      offset: (p - 1) * size,
    }),
    deps.transactions.countByUser(userId, where),
    deps.categories.listByUser(userId),
    deps.accounts.listByUser(userId),
  ])
  const items = await searchResultDTOs(deps, userId, txs, cats, accounts)
  return { items, total, page: p, pageSize: size }
}

// Mapeo común del buscador: categoría, editable según el origen de la cuenta, monto en CLP y
// estado de recurrencia.
async function searchResultDTOs(
  deps: ReadDeps,
  userId: string,
  txs: Transaction[],
  cats: Category[],
  accounts: Account[]
): Promise<TransactionDTO[]> {
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
  return withReimbursementCounts(deps, userId, await withRecurringState(deps, userId, dtos, txs))
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

/**
 * Lo que el presupuesto mide de los movimientos del período, compartido por la vista del mes y el
 * detalle de una categoría para que sus cifras cuadren: los movimientos en CLP con el neteo de
 * reembolso legado y el comprometido de cuotas por categoría (la cuota que vence en el rango y aún
 * no se paga se anticipa como comprometida, igual que una recurrente; derivado, no filas: al pagarse
 * pasa a `used` y desaparece de aquí, sin doble conteo).
 */
async function budgetInputs(
  deps: ReadDeps,
  userId: string,
  clpTxs: Transaction[],
  plans: InstallmentPlan[],
  range: PeriodRange
) {
  const reimbursementRows = await deps.reimbursements?.listForTransactions(
    userId, clpTxs.filter(t => t.direction === "debit").map(t => t.id)
  ) ?? []
  const reimbursed = new Map<string, number>()
  const { mode } = await getBudgetPeriod(deps)
  const legacyRows = reimbursementRows.filter(row => !usesGrossExpense(row, mode))
  for (const row of legacyRows)
    reimbursed.set(row.expenseId, (reimbursed.get(row.expenseId) ?? 0) + Number(row.amount))
  const netBudgetTxs = clpTxs.map(t => {
    const deducted = reimbursed.get(t.id) ?? 0
    if (!deducted || t.direction !== "debit") return t
    return { ...t, amount: Money.of(Math.max(0, t.amount.toMajor() - deducted), "CLP") }
  })
  const installmentCommitted = new Map<string, Money>()
  for (const plan of plans) {
    const amount = committedForMonth(plan, range)
    if (amount.isZero) continue
    const prev = installmentCommitted.get(plan.categoryId)
    installmentCommitted.set(plan.categoryId, prev ? prev.add(amount) : amount)
  }
  return { legacyRows, netBudgetTxs, installmentCommitted }
}

// Comprometido de una categoría: recurrentes por cobrar + cuotas de sus planes. Las cuotas solo si
// coinciden la moneda de la categoría y la del plan (el comprometido es por moneda).
function categoryCommitted(
  categoryId: string,
  currency: CurrencyCode,
  netBudgetTxs: Transaction[],
  installmentCommitted: Map<string, Money>,
  range: PeriodRange,
  direction: "debit" | "credit"
): Money {
  const fromInstallments = installmentCommitted.get(categoryId)
  return computeCategoryCommitted(categoryId, currency, netBudgetTxs, range, direction).add(
    fromInstallments && fromInstallments.currency === currency
      ? fromInstallments
      : Money.zero(currency)
  )
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
  deps = await scopeBudgetPeriod(deps)
  const range = await rangeOf(deps, year, month)
  const cycleAligned = (await getBudgetPeriod(deps)).mode === "card_cycle"
  const [withLimit, txs, budgets, plans, incomesList, incomeAmounts] =
    await Promise.all([
      categoriesWithLimit(deps, userId, year, month),
      deps.transactions.listByUserPeriod(userId, range),
      deps.monthlyBudgets.listByUser(userId, (await getBudgetPeriod(deps)).mode),
      deps.installments?.listByUser(userId) ?? Promise.resolve([]),
      deps.incomes?.listByUser(userId, (await getBudgetPeriod(deps)).mode) ?? Promise.resolve([]),
      deps.incomes?.listAmountsByUser(userId, (await getBudgetPeriod(deps)).mode) ?? Promise.resolve([]),
    ])
  // USD → CLP por fecha para que el uso por categoría cuente esos movimientos.
  const { clpTxs, rateUnavailable } = await clpView(deps.exchangeRates, txs)
  const { legacyRows, netBudgetTxs, installmentCommitted } = await budgetInputs(
    deps, userId, clpTxs, plans, range
  )
  // Meta de cada categoría de ingreso = suma de sus ingresos vigentes del mes. Derivada, no
  // persistida: agregar/editar/eliminar un ingreso la actualiza sola.
  // ponytail: suma solo CLP; una fuente en otra moneda no entra a la meta.
  const incomeGoal = new Map<string, Money>()
  const plannedIncomeIds = new Set<string>()
  const incomeRemaining = new Map<string, number>()
  let income = Money.zero(CLP)
  for (const inc of incomesList) {
    if (!inc.isActive || isIncomeEndedAt(inc, year, month)) continue
    const amount = effectiveIncomeAmount(incomeAmounts, inc.id, year, month)
    if (!amount || amount.currency !== CLP) continue
    plannedIncomeIds.add(inc.id)
    incomeRemaining.set(inc.id, amount.toMajor())
    income = income.add(amount)
    const prev = incomeGoal.get(inc.categoryId)
    incomeGoal.set(inc.categoryId, prev ? prev.add(amount) : amount)
  }
  // Abonos en USD convertidos igual que los gastos (sin tasa quedan fuera, con aviso).
  for (const tx of clpTxs) {
    if (tx.amount.currency === CLP && inRange(tx.date, range) && isAdditionalIncome(tx, plannedIncomeIds))
      income = income.add(tx.amount)
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
      netBudgetTxs,
      range,
      direction
    )
    const committed = categoryCommitted(
      category.id, limit.currency, netBudgetTxs, installmentCommitted, range, direction
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
              available.subtract(committed),
              netBudgetTxs,
              pace.today,
              pace.frequency,
              range,
              cycleAligned
            )
            const period = pacePeriod(pace.today, pace.frequency, range, cycleAligned)
            const nextReset = new Date(`${period.end}T00:00:00Z`)
            nextReset.setUTCDate(nextReset.getUTCDate() + 1)
            return {
              frequency: pace.frequency,
              nextResetDate: nextReset.toISOString().slice(0, 10),
              spent: p.spent.toMajor(),
              budget: p.budget.toMajor(),
              status: paceStatus(p.spent, p.budget),
            }
          })()
        : null
    return { category, limit, used, available, committed, paceDTO }
  })
  // Sin ningún tope de gasto no hay plan: ninguna categoría entra (mismo criterio que
  // `computeSpendable` y `computeCapsOverspend`).
  const hasPlan = computed.some((x) => x.category.type === "expense" && x.limit.isPositive)
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
      free: available.subtract(committed).toMajor(),
      inPlan:
        hasPlan &&
        category.type === "expense" &&
        isInPlan({ limit: limit.toMajor(), used: used.toMajor(), committed: committed.toMajor() }),
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
  const globalBudget = effectiveGlobalBudget(budgets, year, month)
  const globalLimit = globalBudget?.globalLimit ?? null
  const remaining = remainingToAllocate(globalLimit, allocated)
  // Gastado y comprometido del plan: todo gasto real del período, con o sin categoría o tope
  // (WDC-171). Los topes solo miden categorías y ritmo; no deciden qué plata salió.
  const isPlanDebit = (t: Transaction) =>
    t.direction === "debit" && !t.isInternal && t.amount.currency === CLP && inRange(t.date, range)
  const spent = netBudgetTxs
    .filter((t) => isPlanDebit(t) && t.status === "confirmed")
    .reduce((s, t) => s.add(t.amount), Money.zero(CLP))
  const committed = plans
    .filter((plan) => plan.currency === CLP)
    .reduce(
      (s, plan) => s.add(committedForMonth(plan, range)),
      netBudgetTxs
        .filter((t) => isPlanDebit(t) && t.status === "pending")
        .reduce((s, t) => s.add(t.amount), Money.zero(CLP))
    )
  // Solo el legado netea gasto y necesita compensar el ingreso. Los reembolsos con
  // suplemento (o ya ajustados manualmente) mantienen gasto bruto e ingreso una vez.
  const byId = new Map(txs.map(t => [t.id, t]))
  const expenseRemaining = new Map<string, number>()
  const creditRemaining = new Map<string, number>()
  let reimbursementAdjustment = 0
  for (const row of legacyRows) {
    const expense = byId.get(row.expenseId)
    const credit = byId.get(row.creditId)
    if (!expense || !credit || expense.direction !== "debit" || credit.direction !== "credit" ||
        expense.status !== "confirmed" || credit.status !== "confirmed" ||
        expense.isInternal || credit.isInternal ||
        expense.amount.currency !== CLP || credit.amount.currency !== CLP ||
        !inRange(expense.date, range) || !inRange(credit.date, range)) continue
    const expenseLeft = expenseRemaining.get(expense.id) ?? expense.amount.toMajor()
    const creditLeft = creditRemaining.get(credit.id) ?? credit.amount.toMajor()
    const plannedId = credit.incomeId && plannedIncomeIds.has(credit.incomeId) ? credit.incomeId : null
    const incomeLeft = plannedId
      ? incomeRemaining.get(plannedId) ?? 0
      : isAdditionalIncome(credit, plannedIncomeIds) ? credit.amount.toMajor() : 0
    const adjustment = Math.max(0, Math.min(Number(row.amount), expenseLeft, creditLeft, incomeLeft))
    reimbursementAdjustment += adjustment
    expenseRemaining.set(expense.id, expenseLeft - adjustment)
    creditRemaining.set(credit.id, creditLeft - adjustment)
    if (plannedId) incomeRemaining.set(plannedId, incomeLeft - adjustment)
  }
  // Disponible para gastar (WDC-177): solo categorías CLP en el plan; el margen es el balance del medidor.
  const spendable = computeSpendable({
    margin: calculateFinancialHealth({
      income: income.toMajor(), spent: spent.toMajor(), committed: committed.toMajor(), reimbursementAdjustment,
    }).balance,
    categories: computed
      .filter(({ category, limit }) => category.type === "expense" && limit.currency === CLP)
      .map(({ limit, used, committed }) => ({ limit: limit.toMajor(), used: used.toMajor(), committed: committed.toMajor() }))
      .filter(isInPlan),
  })
  const daily = computeGlobalPaceDaily(netBudgetTxs, range, CLP)
  return {
    categories,
    spendable,
    globalPace: { budget: spendable.amount + daily.reduce((a, b) => a + b, 0), daily },
    income: income.toMajor(),
    reimbursementAdjustment,
    spent: spent.toMajor(),
    committed: committed.toMajor(),
    globalLimit: globalLimit === null ? null : globalLimit.toMajor(),
    globalLimitFollowsIncome: globalBudget?.followsIncome === true,
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
    exchangeRateUnavailable: rateUnavailable,
  }
}

/**
 * Déficit del período anterior: gastos realizados contra sus ingresos, sin topes ni pendientes.
 * `getBudgetView` resuelve el mes o ciclo y la compensación de reembolsos para no contarlos dos veces.
 */
export async function getPreviousMonthDebt(
  deps: ReadDeps,
  userId: string,
  year: number,
  month: number
): Promise<number> {
  deps = await scopeBudgetPeriod(deps)
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const previous = await getBudgetView(deps, userId, prevYear, prevMonth)
  return Math.max(0, previous.spent + (previous.reimbursementAdjustment ?? 0) - previous.income)
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
    budgetPeriod?: BudgetPeriodRepository
  },
  userId: string,
  year: number,
  month: number
): Promise<IncomeDTO[]> {
  deps = await scopeBudgetPeriod(deps)
  const [incomes, amounts, accounts, categories] = await Promise.all([
    deps.incomes.listByUser(userId, (await getBudgetPeriod(deps)).mode),
    deps.incomes.listAmountsByUser(userId, (await getBudgetPeriod(deps)).mode),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  const incomeRange = await rangeOf(deps, year, month)
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
        generated: await deps.incomes.hasGeneratedFor(i.id, year, month, incomeRange),
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
  url: string | null // portal de pago opcional (solo http/https)
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
  now = new Date()
): Promise<RecurringDTO[]> {
  // «Hoy» es el día civil de Chile a medianoche UTC, como las fechas de período de las plantillas:
  // a las 22:00 en Chile ya es mañana en UTC y el período en curso no puede adelantarse.
  const today = new Date(`${todayKey(now)}T00:00:00.000Z`)
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
    // Pagado = el período en curso ya tiene su cargo real (confirmed); el comprometido pending no.
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
      url: t.url,
    }
  }))
}

// Movimientos que el usuario puede elegir como el cobro del período en curso de la plantilla `id`
// (ver `payRecurringPeriodWith`): movimientos del banco confirmados y sin vínculo, de su misma
// dirección, moneda y categoría, de los últimos `days` días (hoy en Chile, sin tope futuro), más
// nuevos primero. Sin filtro de monto: a veces el cargo real se pasa de cualquier umbral.
export async function listRecurringCandidates(
  deps: ReadDeps & { recurring: RecurringTemplateRepository },
  userId: string,
  id: string,
  filters: { days?: number; query?: string } = {},
  now = new Date()
): Promise<{ items: TransactionDTO[] }> {
  const template = await deps.recurring.findById(id)
  if (!template) throw new RecurringTemplateNotFoundError(id)
  if (template.userId !== userId) throw new NotOwnerError()
  const days = filters.days ?? RECURRING_MATCH_WINDOW_DAYS
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
    categoryId: template.categoryId,
    recurringCandidates: true,
    limit: 50,
  })
  return { items }
}

// Un día dentro del período siguiente al que contiene a `from` (basta para derivar su clave).
function nextPeriodDate(template: { periodicity: string }, from: Date): Date {
  const d = new Date(from)
  if (template.periodicity === "biweekly") d.setUTCDate(d.getUTCDate() + 14)
  else if (template.periodicity === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1)
  else d.setUTCMonth(d.getUTCMonth() + 1, 1)
  return d
}

export async function getCategoryDetail(
  deps: ReadDeps,
  userId: string,
  categoryId: string,
  year: number,
  month: number
): Promise<CategoryDTO & { transactions: TransactionDTO[] }> {
  deps = await scopeBudgetPeriod(deps)
  const category = await deps.categories.findById(categoryId)
  if (!category) throw new CategoryNotFoundError(categoryId)
  if (category.userId !== userId) throw new NotOwnerError()

  const limits = await deps.categories.listLimitsByUser(userId, (await getBudgetPeriod(deps)).mode)
  const limit = effectiveLimit(limits, categoryId, year, month)
  // Igual que en `getBudgetView`: sin ningún tope de gasto no hay plan.
  const hasPlan = (await deps.categories.listByUser(userId)).some(
    (c) => c.type === "expense" && effectiveLimit(limits, c.id, year, month).isPositive
  )
  const range = await rangeOf(deps, year, month)
  const txs = await deps.transactions.listByCategoryPeriod(categoryId, range)
  const accounts = await deps.accounts.listByUser(userId)
  const { clpTxs, clpAmounts } = await clpView(deps.exchangeRates, txs)
  const manual = new Set(
    accounts.filter((a) => a.provider === "manual").map((a) => a.id)
  )
  const direction = category.type === "income" ? "credit" : "debit"
  // Mismas cifras que la vista del mes (`getBudgetView`): neteo de reembolso legado y cuotas por
  // cobrar de los planes de la categoría.
  const plans = (await deps.installments?.listByUser(userId)) ?? []
  const { netBudgetTxs, installmentCommitted } = await budgetInputs(
    deps, userId, clpTxs, plans.filter((p) => p.categoryId === categoryId), range
  )
  const { used, available } = computeCategoryUsage(categoryId, limit, netBudgetTxs, range, direction)
  const remaining = historicalRemaining(clpTxs, () => limit)
  const committed = categoryCommitted(
    categoryId, limit.currency, netBudgetTxs, installmentCommitted, range, direction
  )
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
    committed: committed.toMajor(),
    available: available.toMajor(),
    free: available.subtract(committed).toMajor(),
    inPlan:
      hasPlan &&
      category.type === "expense" &&
      isInPlan({ limit: limit.toMajor(), used: used.toMajor(), committed: committed.toMajor() }),
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
  // Movimiento que pagó la cuota; null si está pendiente o se pagó fuera de la app.
  transaction: { id: string; description: string; amount: number; date: string } | null
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
  // «Hoy» es el día civil de Chile, como en las recurrentes: a las 21:00 ya es mañana en UTC y una
  // cuota que vence hoy saldría «vencida».
  today = new Date(`${todayKey()}T00:00:00.000Z`)
): Promise<InstallmentPlanDTO[]> {
  const [plans, accounts, categories] = await Promise.all([
    deps.installments.listByUser(userId),
    deps.accounts.listByUser(userId),
    deps.categories.listByUser(userId),
  ])
  if (plans.length === 0) return []

  const accById = new Map(accounts.map((a) => [a.id, a]))
  const catById = new Map(categories.map((c) => [c.id, c]))
  // Movimientos de las cuotas ya registradas: su monto real da el saldo y la cuota los muestra.
  // ponytail: una lectura por cuota pagada; si los planes crecen, un `findByIds` en el port.
  const txIds = plans.flatMap((p) =>
    p.items
      .map((i) => i.transactionId)
      .filter((id): id is string => id !== null)
  )
  const txById = new Map<string, Transaction>()
  for (const id of txIds) {
    const tx = await deps.transactions.findById(id)
    if (tx) txById.set(id, tx)
  }

  return plans.map((plan): InstallmentPlanDTO => {
    const cat = catById.get(plan.categoryId)
    const paid = plan.items
      .map((i) => (i.transactionId ? txById.get(i.transactionId)?.amount : null))
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
      items: plan.items.map((i) => {
        const tx = i.transactionId ? txById.get(i.transactionId) : undefined
        return {
          id: i.id,
          index: i.index,
          dueDate: i.dueDate.toISOString(),
          amount: i.amount.toMajor(),
          paidAmount: tx ? tx.amount.toMajor() : null,
          status: itemStatus(i, today),
          transaction: tx
            ? {
                id: tx.id,
                description: tx.description,
                amount: tx.amount.toMajor(),
                date: tx.date.toISOString(),
              }
            : null,
        }
      }),
    }
  })
}

