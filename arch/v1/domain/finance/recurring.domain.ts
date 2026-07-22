// Dominio de gastos recurrentes. Puro: sin Prisma, sin DB. Una plantilla ejecuta 0..N movimientos
// reales: al abrirse un período materializa su Transaction como `pending` (gasto COMPROMETIDO, que
// no cuenta como gastado) y el cobro real la confirma — por detección en el correo (texto
// normalizado + monto dentro del rango de tolerancia) o por cron el día de ejecución. La categoría
// de la plantilla manda siempre: un movimiento vinculado nunca pasa por la IA.

import type { Direction } from "./finance.domain.ts"
import { normalizeMovementText } from "./categorization-learning.domain.ts"
import { Money, type CurrencyCode } from "./money.ts"

// --- Entidad ---

export const PERIODICITIES = ["monthly", "biweekly", "yearly"] as const
export type Periodicity = (typeof PERIODICITIES)[number]

export const EXECUTION_MODES = ["email_detection", "cron"] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export type RecurringTemplate = {
  id: string
  userId: string
  accountId: string // cuenta donde se materializa el comprometido
  categoryId: string // obligatoria: toda ejecución usa ESTA categoría
  description: string // clave de match (se compara normalizada)
  direction: Direction
  baseAmount: Money
  currency: CurrencyCode
  tolerancePct: number // ± % sobre baseAmount
  periodicity: Periodicity
  executionMode: ExecutionMode
  dayOfMonth: number | null // monthly/yearly; en meses cortos cae al último día
  startDate: Date // ancla de los períodos
  isActive: boolean
}

// --- Inputs de escritura ---

export type NewRecurringTemplate = {
  userId: string
  accountId: string
  categoryId: string
  description: string
  direction: Direction
  baseAmount: Money
  tolerancePct: number
  periodicity: Periodicity
  executionMode: ExecutionMode
  dayOfMonth: number | null
  startDate: Date
}

export type UpdateRecurringTemplate = Omit<NewRecurringTemplate, "userId"> & {
  id: string
  isActive: boolean
}

// --- Reglas de período ---

const pad2 = (n: number) => String(n).padStart(2, "0")
const MS_PER_DAY = 86_400_000

/** Último día del mes (year, month 1–12). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Días transcurridos entre dos fechas contando solo el día calendario (UTC): inmune a la hora.
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.floor((b - a) / MS_PER_DAY)
}

/**
 * Clave del período que contiene a `date`: `YYYY-MM` mensual, `YYYY` anual, `YYYY-Qnn` quincenal
 * (índice de quincena desde `startDate`). Es la clave de idempotencia: un movimiento por
 * (plantilla, período).
 */
export function periodKeyFor(template: RecurringTemplate, date: Date): string {
  switch (template.periodicity) {
    case "monthly":
      return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`
    case "yearly":
      return String(date.getFullYear())
    case "biweekly": {
      const index = Math.floor(daysBetween(template.startDate, date) / 14)
      return `${template.startDate.getFullYear()}-Q${pad2(index)}`
    }
  }
}

/**
 * Fecha de ejecución del período: el `dayOfMonth` de la plantilla, recortado al último día cuando
 * el mes es más corto (31 en un mes de 30 → 30). En quincenal, `startDate + 14·índice`.
 */
export function executionDateFor(
  template: RecurringTemplate,
  periodKey: string
): Date {
  if (template.periodicity === "biweekly") {
    const index = Number(periodKey.split("Q")[1] ?? 0)
    const d = new Date(template.startDate)
    d.setDate(d.getDate() + index * 14)
    return d
  }
  const [yearPart, monthPart] = periodKey.split("-")
  const year = Number(yearPart)
  // Anual: el mes lo fija la plantilla por su fecha de inicio; mensual: el del propio período.
  const month = monthPart
    ? Number(monthPart)
    : template.startDate.getMonth() + 1
  const day = template.dayOfMonth ?? template.startDate.getDate()
  return new Date(year, month - 1, Math.min(day, lastDayOfMonth(year, month)))
}

// --- Regla de match ---

/** Rango [base·(1−tol), base·(1+tol)] en el que un cargo se considera ejecución de la plantilla. */
export function toleranceRange(template: RecurringTemplate): {
  min: Money
  max: Money
} {
  const base = template.baseAmount.minor
  const tol = BigInt(Math.round(template.tolerancePct))
  const delta = (base * tol) / BigInt(100)
  return {
    min: Money.fromMinor(base - delta, template.baseAmount.currency),
    max: Money.fromMinor(base + delta, template.baseAmount.currency),
  }
}

export type MovementForMatch = {
  description: string
  amount: Money
  direction: Direction
}

/**
 * ¿Este movimiento es la ejecución de esta plantilla? Texto normalizado igual (la MISMA
 * normalización de las correcciones) + monto dentro del rango + misma moneda y dirección.
 * Solo plantillas activas matchean.
 */
export function matchesTemplate(
  movement: MovementForMatch,
  template: RecurringTemplate
): boolean {
  if (!template.isActive) return false
  if (movement.direction !== template.direction) return false
  if (movement.amount.currency !== template.baseAmount.currency) return false
  if (
    normalizeMovementText(movement.description) !==
    normalizeMovementText(template.description)
  )
    return false
  const { min, max } = toleranceRange(template)
  return movement.amount.compare(min) >= 0 && movement.amount.compare(max) <= 0
}

/**
 * Plantilla que reclama el movimiento cuando varias matchean: gana la de rango más ESTRECHO (la
 * más específica). Empate de rango → la de monto base más cercano al del movimiento.
 */
export function pickTemplateFor(
  movement: MovementForMatch,
  templates: RecurringTemplate[]
): RecurringTemplate | null {
  const abs = (v: bigint): bigint => (v < BigInt(0) ? -v : v)
  const candidates = templates.filter((t) => matchesTemplate(movement, t))
  if (candidates.length === 0) return null
  return candidates.reduce((best, t) => {
    const width = (x: RecurringTemplate) => {
      const { min, max } = toleranceRange(x)
      return max.minor - min.minor
    }
    const gap = (x: RecurringTemplate) =>
      abs(movement.amount.minor - x.baseAmount.minor)
    const d = width(t) - width(best)
    const zero = BigInt(0)
    return d < zero || (d === zero && gap(t) < gap(best)) ? t : best
  })
}

// --- Validación ---

export function isValidTolerance(pct: number): boolean {
  return Number.isInteger(pct) && pct >= 0 && pct <= 100
}

// El día solo aplica a mensual/anual; quincenal se ancla en startDate.
export function requiresDayOfMonth(periodicity: Periodicity): boolean {
  return periodicity !== "biweekly"
}

// --- Port (lo implementa la infraestructura) ---

export interface RecurringTemplateRepository {
  listByUser(userId: string): Promise<RecurringTemplate[]>
  listActiveByUser(userId: string): Promise<RecurringTemplate[]>
  /** Todas las plantillas activas de todos los usuarios: lo que recorre el cron. */
  listAllActive(): Promise<RecurringTemplate[]>
  findById(id: string): Promise<RecurringTemplate | null>
  create(input: NewRecurringTemplate): Promise<RecurringTemplate>
  update(input: UpdateRecurringTemplate): Promise<RecurringTemplate>
  /** Borra la plantilla; conserva los movimientos confirmados (sin vínculo) y borra el pendiente. */
  delete(id: string): Promise<void>
  /**
   * Cambia la categoría de la plantilla y la propaga a sus movimientos aún NO cobrados
   * (`pending`). Lo confirmado no se toca: es historia, y cada movimiento ya vivió su mes.
   */
  setCategory(templateId: string, categoryId: string): Promise<void>
  /**
   * Materializa el movimiento `pending` del período. Idempotente por el único
   * (recurringTemplateId, periodKey) de la BD: si ya existe lo devuelve sin crear otro.
   */
  materializePeriod(
    template: RecurringTemplate,
    periodKey: string,
    date: Date
  ): Promise<{ transactionId: string; created: boolean }>
  /** Movimiento del período (pendiente o ya confirmado), si existe. */
  findPeriodTransaction(
    templateId: string,
    periodKey: string
  ): Promise<{ id: string; status: string } | null>
  /**
   * Confirma el movimiento del período (modo cron): el MISMO movimiento pasa a `confirmed`.
   * `false` si ya estaba confirmado (no pisa una ejecución previa).
   */
  confirmPeriod(
    transactionId: string,
    amount: Money,
    date: Date
  ): Promise<boolean>
  /**
   * Modo correo: el cargo real ya se importó (trae su `externalId` y ya movió los buckets), así que
   * es ÉL quien queda como ejecución del período — toma la categoría de la plantilla, el vínculo y
   * el `periodKey`, queda `confirmed` + `reviewed`, y el comprometido `pending` del período se
   * consume (se borra). Atómico. `false` si el período ya tenía una ejecución confirmada.
   */
  attachImportedMovement(
    transactionId: string,
    template: RecurringTemplate,
    periodKey: string
  ): Promise<boolean>
}

// --- Errores de negocio ---

/** Input inválido: sin categoría, tolerancia fuera de 0–100, monto ≤ 0, día inválido o moneda
 * que no coincide con la de la cuenta (→ 422). */
export class InvalidRecurringTemplateError extends Error {
  constructor(message = "Plantilla recurrente inválida") {
    super(message)
    this.name = "InvalidRecurringTemplateError"
  }
}

/**
 * Quitarle la categoría a un movimiento vinculado a una plantilla dejaría a la plantilla sin la
 * suya (es obligatoria) o con dos verdades distintas. Para dejarlo sin categoría, primero se
 * elimina la recurrencia (→ 422).
 */
export class RecurringCategoryRequiredError extends Error {
  constructor() {
    super(
      "Este movimiento es recurrente: elimina la recurrencia antes de dejarlo sin categoría"
    )
    this.name = "RecurringCategoryRequiredError"
  }
}

export class RecurringTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Plantilla recurrente no encontrada: ${id}`)
    this.name = "RecurringTemplateNotFoundError"
  }
}
