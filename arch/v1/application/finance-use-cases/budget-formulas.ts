// Fórmulas financieras puras. Sin IO: reciben datos ya cargados y devuelven derivados.
// Reglas clave: la caja activa es solo saldo positivo de cuentas corrientes (el cupo no
// es dinero); un saldo negativo es deuda de sobregiro, no caja; la posición neta combina
// ambas. El uso por categoría se calcula desde los movimientos, no se persiste.

import type {
  Account,
  CategoryLimit,
  CategoryType,
  MonthlyBudget,
  Transaction,
  CategoryStatus,
} from "../../domain/finance/finance.domain.ts"
import type { PaceFrequency } from "../../domain/finance/pace.domain.ts"
import { Money, type CurrencyCode } from "../../domain/finance/money.ts"
import { daysOf, type PeriodRange } from "../../../shared/billing-cycle.ts"

/**
 * ¿El día civil de `date` cae dentro del rango, bordes incluidos? UTC: las fechas de movimientos
 * se guardan como DATE (medianoche UTC); con getters locales un movimiento del día 1 caía en el
 * día anterior (Chile UTC-4).
 */
export function inRange(date: Date, range: PeriodRange): boolean {
  const day = date.toISOString().slice(0, 10)
  return day >= range.start && day <= range.end
}

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

/** Uso de una categoría en el mes (su rango): Σ gastos (`debit`); disponible = límite − usado. */
export function computeCategoryUsage(
  categoryId: string,
  limit: Money,
  transactions: Transaction[],
  range: PeriodRange,
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
        inRange(t.date, range)
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
  range: PeriodRange,
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
        inRange(t.date, range)
    )
    .reduce((sum, t) => sum.add(t.amount), Money.zero(currency))
}

/**
 * Período del RITMO dentro del mes del presupuesto, en días civiles: hoy (daily) o la semana
 * calendario lunes–domingo que contiene a hoy, recortada a los bordes del rango del mes (weekly).
 * La semana es LA semana: empieza el lunes aunque hoy sea jueves — lo gastado el lunes cuenta igual.
 */
export function pacePeriod(
  today: string, // "YYYY-MM-DD", dentro de `range`
  frequency: PaceFrequency,
  range: PeriodRange,
  cycleAligned = false
): PeriodRange {
  if (frequency === "daily") return { start: today, end: today }
  if (cycleAligned) {
    const elapsed = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000)
    const firstDay = new Date(`${range.start}T00:00:00Z`)
    firstDay.setUTCDate(firstDay.getUTCDate() + Math.floor(elapsed / 7) * 7)
    const lastDay = new Date(firstDay)
    lastDay.setUTCDate(lastDay.getUTCDate() + 6)
    return { start: firstDay.toISOString().slice(0, 10), end: lastDay.toISOString().slice(0, 10) < range.end ? lastDay.toISOString().slice(0, 10) : range.end }
  }
  const monday = new Date(`${today}T00:00:00Z`)
  // 0=lunes … 6=domingo (getUTCDay da 0=domingo; se rota para partir la semana en lunes).
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  return {
    start: day(monday) > range.start ? day(monday) : range.start,
    end: day(sunday) < range.end ? day(sunday) : range.end,
  }
}

/**
 * ¿Cuenta este movimiento como gasto del ritmo? Cargo confirmado no interno que no salda un
 * compromiso: lo que paga una recurrente o una cuota ya estaba descontado como comprometido.
 */
export function isPaceSpend(t: Transaction): boolean {
  return (
    t.direction === "debit" &&
    t.status === "confirmed" &&
    !t.isInternal &&
    !t.recurringTemplateId &&
    !t.installmentItemId
  )
}

/**
 * Ritmo de una categoría: lo gastado en el período (hoy / esta semana) y el presupuesto de ese
 * período. El presupuesto reparte lo libre AL INICIO del período (libre actual + gastado del
 * período) entre los días del mes que quedaban desde ese inicio, × los días del período. Así la
 * cifra es estable: registrar un gasto sube el "gastado" pero no mueve la meta, y la semana vale
 * lo mismo el lunes que el jueves. Puede ser $0 si la categoría llegó al período sin margen.
 *
 * Lo libre ya descuenta lo comprometido (recurrentes y cuotas por cobrar), así que el pago que
 * concilia una recurrente o una cuota no es gasto del ritmo: nunca suma a lo gastado del período.
 * La meta sí se mueve si el cobro real difiere de lo comprometido: al conciliar, el comprometido
 * sale y entra el monto cobrado al usado, así que lo libre cambia en esa diferencia (un arriendo
 * comprometido en $350.000 que se cobra en $352.000 baja la meta en $2.000 repartidos en los días
 * que quedan). Aceptado (WDC-171).
 */
export function computeCategoryPace(
  categoryId: string,
  available: Money, // límite − usado − comprometido del MES (puede ser negativo)
  transactions: Transaction[],
  today: string, // "YYYY-MM-DD", dentro de `range`
  frequency: PaceFrequency,
  range: PeriodRange, // el mes del presupuesto
  cycleAligned = false
): { spent: Money; budget: Money } {
  const period = pacePeriod(today, frequency, range, cycleAligned)
  const spent = transactions
    .filter(
      (t) =>
        t.categoryId === categoryId &&
        isPaceSpend(t) &&
        t.amount.currency === available.currency &&
        inRange(t.date, period)
    )
    .reduce((sum, t) => sum.add(t.amount), Money.zero(available.currency))
  const availableAtStart = available.add(spent)
  const daysFromStart = daysOf({ start: period.start, end: range.end }).length
  const periodDays = daysOf(period).length
  // Piso por día (como la línea "por día" original) y en unidad mayor: CLP no tiene centavos.
  const dailyMajor = Math.floor(availableAtStart.toMajor() / daysFromStart)
  const budget = Money.of(
    Math.max(0, dailyMajor) * periodDays,
    available.currency
  )
  return { spent, budget }
}

/** Semáforo del ritmo: silencio bajo 80%, alerta 80–100%, excedido >100% (o sin presupuesto). */
export function paceStatus(
  spent: Money,
  budget: Money
): "ok" | "alerta" | "excedido" {
  if (!budget.isPositive) return spent.isPositive ? "excedido" : "ok"
  const ratio = Number(spent.minor) / Number(budget.minor)
  if (ratio > 1) return "excedido"
  if (ratio >= 0.8) return "alerta"
  return "ok"
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
  const base = (
    latestUpTo(
      limits.filter((l) => l.categoryId === categoryId && !l.periodOnly),
      year,
      month
    )?.limit ?? Money.zero("CLP")
  )
  return limits
    .filter(l => l.categoryId === categoryId && l.periodOnly && l.year === year && l.month === month)
    .reduce((total, l) => total.add(l.limit), base)
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

/**
 * Excedente de TOPES del mes = Σ max(0, usado − tope) de las categorías de GASTO en el plan.
 * Junta en una cifra lo que hoy solo se ve categoría por categoría. Solo cuenta lo confirmado
 * (`used`), no el comprometido: son dos capas distintas. Una sin tope con gasto entra al plan con
 * tope 0 (`isInPlan`), así que todo lo usado es exceso; sin gasto no suma nada.
 *
 * Es un DESCUADRE ENTRE CATEGORÍAS, no plata que falte: puede ser positivo con presupuesto del mes
 * de sobra. La plata que de verdad no había la mide `computeMonthOverspend`.
 */
export function computeCapsOverspend(
  categories: { type: CategoryType; used: Money; limit: Money }[],
  currency: CurrencyCode
): Money {
  // Sin ningún tope definido no hay plan del que pasarse (mismo criterio que `computeSpendable`).
  if (!categories.some((c) => c.type === "expense" && c.limit.isPositive)) return Money.zero(currency)
  return categories
    .filter(
      (c) =>
        c.type === "expense" &&
        c.limit.currency === currency
    )
    .reduce((sum, c) => {
      const over = c.used.subtract(c.limit)
      return over.isPositive ? sum.add(over) : sum
    }, Money.zero(currency))
}

/**
 * Excedente del MES = max(0, gasto del mes − límite global). Esta sí es plata que no había: lo
 * gastado de más sale del mes siguiente. Sin límite global definido no hay de qué pasarse → 0.
 * Mide contra el presupuesto GLOBAL, así que vale 0 mientras quede presupuesto libre aunque haya
 * categorías reventadas (para eso está `computeCapsOverspend`).
 */
export function computeMonthOverspend(
  spent: Money,
  globalLimit: Money | null
): Money {
  if (globalLimit === null) return Money.zero(spent.currency)
  const over = spent.subtract(globalLimit)
  return over.isPositive ? over : Money.zero(spent.currency)
}

/**
 * ¿Está la categoría de gasto en el plan del período? Con tope > 0 siempre; sin tope, solo si tiene
 * gasto confirmado o comprometido en el período (entra con tope 0, todo su gasto es exceso). Se
 * deriva al leer: eliminar o recategorizar su último movimiento la devuelve sola a «sin tope».
 */
export function isInPlan(c: { limit: number; used: number; committed: number }): boolean {
  return c.limit > 0 || c.used > 0 || c.committed > 0
}

/**
 * Disponible para gastar = mín(margen, lo planificado que queda). `margin` = ingresos − gastado −
 * comprometido (el balance del medidor); `plannedLeft` = Σ (tope − usado − comprometido) de las
 * categorías en el plan. Lo no repartido no se ofrece para gastar; si se repartió de más, manda el
 * margen. Empate: "plan". Sin ningún tope > 0 no hay plan que limite: manda el margen.
 */
export function computeSpendable(input: {
  margin: number
  categories: { limit: number; used: number; committed: number }[]
}): { amount: number; margin: number; plannedLeft: number; limitedBy: "margin" | "plan" } {
  const plannedLeft = input.categories.reduce((s, c) => s + c.limit - c.used - c.committed, 0)
  const hasPlan = input.categories.some((c) => c.limit > 0)
  const limitedBy = !hasPlan || input.margin < plannedLeft ? "margin" : "plan"
  return {
    amount: hasPlan ? Math.min(input.margin, plannedLeft) : input.margin,
    margin: input.margin,
    plannedLeft,
    limitedBy,
  }
}

/**
 * Gasto del ritmo global por fecha del período, en el orden de `daysOf(range)`. Solo movimientos
 * en `currency` (la vista ya llevó los USD a CLP; sin tasa no llegan aquí).
 */
export function computeGlobalPaceDaily(
  transactions: Transaction[],
  range: PeriodRange,
  currency: CurrencyCode
): number[] {
  const days = daysOf(range)
  const index = new Map(days.map((d, i) => [d, i]))
  const out = new Array<number>(days.length).fill(0)
  for (const t of transactions) {
    if (!isPaceSpend(t) || t.amount.currency !== currency) continue
    const i = index.get(t.date.toISOString().slice(0, 10))
    if (i !== undefined) out[i] += t.amount.toMajor()
  }
  return out
}
