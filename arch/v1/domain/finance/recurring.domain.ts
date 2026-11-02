// Dominio de gastos recurrentes. Puro: sin Prisma, sin DB. Una plantilla ejecuta 0..N movimientos
// reales: al abrirse un período materializa su Transaction como `pending` (gasto COMPROMETIDO, que
// no cuenta como gastado) y el cargo real del banco la confirma, reconocido por texto normalizado +
// monto dentro del rango de tolerancia. La categoría de la plantilla manda siempre: un movimiento
// vinculado nunca pasa por la IA.
//
// `label` vs `description`: son campos SEPARADOS. `label` es el nombre visible/editable (solo
// presentación, no afecta el match). `description` es la CLAVE de match contra el correo: sale del
// movimiento real de origen y es inmutable desde el front. Renombrar (editar `label`) nunca rompe
// el reconocimiento del cargo.

import type { Direction, Transaction } from "./finance.domain.ts"
import { normalizeMovementText } from "./categorization-learning.domain.ts"
import { type CurrencyCode } from "./money.ts"
import { Money } from "./money.ts"

// --- Entidad ---

export const PERIODICITIES = ["monthly", "biweekly", "yearly"] as const
export type Periodicity = (typeof PERIODICITIES)[number]

export type RecurringTemplate = {
  id: string
  userId: string
  accountId: string // cuenta donde se materializa el comprometido
  categoryId: string // obligatoria: toda ejecución usa ESTA categoría
  label: string // nombre visible/editable; no afecta el match
  description: string // clave de match (se compara normalizada); del movimiento real, inmutable. Vacía = planificada sin cobro real aún
  direction: Direction
  baseAmount: Money
  currency: CurrencyCode
  tolerancePct: number // ± % sobre baseAmount
  periodicity: Periodicity
  dayOfMonth: number | null // monthly/yearly; en meses cortos cae al último día
  startDate: Date // ancla de los períodos
  endDate: Date | null // null = indefinida; el último cobro es el que cae en esta fecha o antes
  isActive: boolean
}

// --- Inputs de escritura ---

export type NewRecurringTemplate = {
  userId: string
  accountId: string
  categoryId: string
  label: string
  description: string
  direction: Direction
  baseAmount: Money
  tolerancePct: number
  periodicity: Periodicity
  dayOfMonth: number | null
  startDate: Date
  endDate: Date | null
}

// `description` (clave de match) NO se edita: se omite del update para que ni siquiera pueda
// reescribirse por accidente.
export type UpdateRecurringTemplate = Omit<
  NewRecurringTemplate,
  "userId" | "description"
> & {
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

// Todas las fechas de este módulo son días CIVILES (`@db.Date`, medianoche UTC) y se leen con
// getters UTC: con getters locales el resultado dependería de la TZ del proceso (en Chile, UTC−3/−4,
// la medianoche UTC del 1-nov es el 31-oct). Quien tenga un instante ("ahora") lo pasa antes a su
// día civil en Chile (`todayKey`).

// Días transcurridos entre dos días civiles.
function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.floor((b - a) / MS_PER_DAY)
}

/**
 * Días alrededor del vencimiento de un período en los que un cargo con otro texto todavía puede
 * ser su cobro (bordes incluidos). Es también la ventana por defecto del buscador de candidatos.
 */
export const RECURRING_MATCH_WINDOW_DAYS = 10

/**
 * Clave del período que contiene a `date`: `YYYY-MM` mensual, `YYYY` anual, `YYYY-Qnn` quincenal
 * (índice de quincena desde `startDate`). Es la clave de idempotencia: un movimiento por
 * (plantilla, período).
 */
export function periodKeyFor(template: RecurringTemplate, date: Date): string {
  switch (template.periodicity) {
    case "monthly":
      return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`
    case "yearly":
      return String(date.getUTCFullYear())
    case "biweekly": {
      const index = Math.floor(daysBetween(template.startDate, date) / 14)
      return `${template.startDate.getUTCFullYear()}-Q${pad2(index)}`
    }
  }
}

/**
 * Fecha de ejecución del período: el `dayOfMonth` de la plantilla, recortado al último día cuando
 * el mes es más corto (31 en un mes de 30 → 30). En quincenal, `startDate + 14·índice`. Siempre
 * un día civil a medianoche UTC.
 */
export function executionDateFor(
  template: RecurringTemplate,
  periodKey: string
): Date {
  const start = template.startDate
  if (template.periodicity === "biweekly") {
    const index = Number(periodKey.split("Q")[1] ?? 0)
    // Sumar días en UTC: en hora local el cambio de hora corría el vencimiento un día.
    return new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index * 14)
    )
  }
  const [yearPart, monthPart] = periodKey.split("-")
  const year = Number(yearPart)
  // Anual: el mes lo fija la plantilla por su fecha de inicio; mensual: el del propio período.
  const month = monthPart ? Number(monthPart) : start.getUTCMonth() + 1
  const day = template.dayOfMonth ?? start.getUTCDate()
  return new Date(Date.UTC(year, month - 1, Math.min(day, lastDayOfMonth(year, month))))
}

// --- Vigencia ---

// Compara solo el día civil.
function isAfterDay(a: Date, b: Date): boolean {
  return daysBetween(b, a) > 0
}

/**
 * ¿La plantilla ya terminó a la fecha dada? Con `endDate` null nunca termina. El día de fin
 * SIGUE siendo vigente: su período es el del último cobro, no el primero que se omite.
 */
export function hasEnded(
  template: Pick<RecurringTemplate, "endDate">,
  date: Date
): boolean {
  return template.endDate !== null && isAfterDay(date, template.endDate)
}

/**
 * ¿Corresponde ejecutar este período? Se mira la FECHA DE EJECUCIÓN del período, no el día en que
 * se pregunta: un período cuyo cobro cae después del fin no se abre, aunque el mes ya empezó.
 */
export function periodIsWithinValidity(
  template: RecurringTemplate,
  executionDate: Date
): boolean {
  return (
    !isAfterDay(template.startDate, executionDate) &&
    !hasEnded(template, executionDate)
  )
}

/** Una plantilla terminada no vuelve sola: reactivarla exige correr antes su fecha de fin. */
export function canReactivate(
  template: Pick<RecurringTemplate, "endDate">,
  today: Date
): boolean {
  return !hasEnded(template, today)
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
  // Planificada sin cobro real todavía: no tiene clave de match y no reclama nada por texto (un
  // texto vacío calzaría con cualquier descripción que normalice a vacío).
  if (!normalizeMovementText(template.description)) return false
  if (
    normalizeMovementText(movement.description) !==
    normalizeMovementText(template.description)
  )
    return false
  return matchesAmount(movement, template)
}

/** Lo que pide el match sin mirar el texto: activa, misma dirección y moneda, monto en tolerancia. */
export function matchesAmount(
  movement: MovementForMatch,
  template: RecurringTemplate
): boolean {
  if (!template.isActive) return false
  if (movement.direction !== template.direction) return false
  if (movement.amount.currency !== template.baseAmount.currency) return false
  const { min, max } = toleranceRange(template)
  return movement.amount.compare(min) >= 0 && movement.amount.compare(max) <= 0
}

/**
 * Períodos vigentes cuyo vencimiento cae a ±`RECURRING_MATCH_WINDOW_DAYS` días de `date` (bordes
 * incluidos), del más antiguo al más nuevo. Un cargo en el borde de mes puede saldar el período
 * anterior (vence el 31, se cobra el 1) o el siguiente (se paga adelantado).
 */
export function periodsAround(
  template: RecurringTemplate,
  date: Date
): { periodKey: string; executionDate: Date }[] {
  const keys = new Set<string>()
  for (let i = -RECURRING_MATCH_WINDOW_DAYS; i <= RECURRING_MATCH_WINDOW_DAYS; i++)
    keys.add(periodKeyFor(template, new Date(date.getTime() + i * MS_PER_DAY)))
  return [...keys]
    .map((periodKey) => ({ periodKey, executionDate: executionDateFor(template, periodKey) }))
    .filter(
      ({ executionDate }) =>
        Math.abs(daysBetween(executionDate, date)) <= RECURRING_MATCH_WINDOW_DAYS &&
        periodIsWithinValidity(template, executionDate)
    )
    .sort((a, b) => a.executionDate.getTime() - b.executionDate.getTime())
}

/**
 * Plantillas que matchean el movimiento, ORDENADAS por prioridad de reclamo: primero la de rango
 * más ESTRECHO (la más específica); a igualdad de rango, la de monto base más cercano al del
 * movimiento. Con esto quien confirma puede recorrerlas e imputar el cargo a la primera cuyo
 * período aún esté libre (varias plantillas equivalentes reparten un cargo a cada una).
 */
export function rankTemplatesFor(
  movement: MovementForMatch,
  templates: RecurringTemplate[]
): RecurringTemplate[] {
  const abs = (v: bigint): bigint => (v < BigInt(0) ? -v : v)
  const width = (x: RecurringTemplate) => {
    const { min, max } = toleranceRange(x)
    return max.minor - min.minor
  }
  const gap = (x: RecurringTemplate) =>
    abs(movement.amount.minor - x.baseAmount.minor)
  return templates
    .filter((t) => matchesTemplate(movement, t))
    .sort((a, b) => {
      const d = width(a) - width(b)
      if (d !== BigInt(0)) return d < BigInt(0) ? -1 : 1
      const g = gap(a) - gap(b)
      return g < BigInt(0) ? -1 : g > BigInt(0) ? 1 : 0
    })
}

/** La plantilla de mayor prioridad que matchea (o null). */
export function pickTemplateFor(
  movement: MovementForMatch,
  templates: RecurringTemplate[]
): RecurringTemplate | null {
  return rankTemplatesFor(movement, templates)[0] ?? null
}

// --- Validación ---

export function isValidTolerance(pct: number): boolean {
  return Number.isInteger(pct) && pct >= 0 && pct <= 100
}

// El día solo aplica a mensual/anual; quincenal se ancla en startDate.
export function requiresDayOfMonth(periodicity: Periodicity): boolean {
  return periodicity !== "biweekly"
}

// --- Cobro con un movimiento elegido ---

/**
 * ¿Puede `tx` usarse como el cobro del período de `template`? null si sí; si no, el motivo en
 * palabras del usuario (→ 422). La fecha no importa: justamente se usa cuando el cargo cayó fuera
 * del período. El mismo criterio lo aplica el filtro `recurringCandidates` del buscador.
 */
export function paymentCandidateRejection(
  tx: Transaction,
  template: Pick<RecurringTemplate, "currency" | "direction">
): string | null {
  if (tx.direction !== template.direction)
    return template.direction === "debit"
      ? "Un ingreso no puede ser el cobro de una recurrente de gasto"
      : "Un gasto no puede ser el cobro de una recurrente de ingreso"
  // Solo lo que vino del banco: un movimiento manual vinculado se confundiría con la marca de «Ya
  // lo pagué», y el próximo correo del período lo borraría (`attachImportedMovement`).
  if (tx.externalId === null)
    return "Solo se pueden elegir movimientos que vinieron del banco"
  if (tx.status !== "confirmed")
    return "El movimiento todavía no está confirmado"
  if (tx.isInternal)
    return "Un movimiento interno no puede ser el cobro de una recurrente"
  if (tx.recurringTemplateId)
    return "El movimiento ya es el cobro de una recurrente"
  if (tx.installmentItemId) return "El movimiento ya es la cuota de un plan"
  if (tx.amount.currency !== template.currency)
    return "El movimiento está en otra moneda que la recurrente"
  return null
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
   * Borra los comprometidos (`pending`) que quedaron FUERA de la vigencia de la plantilla, tras
   * cambiar su inicio o su fin. Lo confirmado no se toca: ya ocurrió. Devuelve cuántos borró.
   */
  dropCommittedOutsideValidity(template: RecurringTemplate): Promise<number>
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
  /**
   * Movimiento del período (pendiente o ya confirmado), si existe. `isManual` = no tiene
   * `externalId`: lo confirmó el usuario, no el banco. Es lo que distingue una marca de un cobro.
   */
  findPeriodTransaction(
    templateId: string,
    periodKey: string
  ): Promise<{ id: string; status: string; isManual: boolean } | null>
  /**
   * Marca manual del cobro del período: confirma el comprometido (`paid`) o lo devuelve a
   * comprometido. Conserva monto y fecha — el monto y la fecha reales los fija el correo.
   *
   * Al deshacer solo toca lo confirmado A MANO (sin `externalId`): un cargo del banco es un hecho
   * y revertirlo lo borraría. El use-case lo comprueba antes para dar el error; la condición vive
   * además en la escritura para que una carrera no se lo salte.
   */
  setPeriodPaid(
    templateId: string,
    periodKey: string,
    paid: boolean
  ): Promise<boolean>
  /**
   * El cargo real ya se importó (trae su `externalId` y ya movió los buckets), así que
   * es ÉL quien queda como ejecución del período — toma la categoría de la plantilla, el vínculo y
   * el `periodKey`, queda `confirmed` + `reviewed`, y el comprometido `pending` del período se
   * consume (se borra). Atómico. `false` si el período ya tenía una ejecución confirmada del banco,
   * o si el movimiento no existe o ya es de otra plantilla (entonces no se toca nada).
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

/** Reactivar una plantilla cuya fecha de fin ya pasó (→ 422): primero hay que correr esa fecha. */
export class RecurringTemplateEndedError extends Error {
  constructor() {
    super(
      "La recurrente terminó: corre su fecha de fin antes de volver a activarla"
    )
    this.name = "RecurringTemplateEndedError"
  }
}

export class RecurringTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`Plantilla recurrente no encontrada: ${id}`)
    this.name = "RecurringTemplateNotFoundError"
  }
}

/**
 * Deshacer el cobro de un período que confirmó el BANCO (→ 422): no es una marca del usuario sino
 * un cargo real, y revertirlo borraría un hecho de su mes.
 */
export class RecurringPeriodNotManualError extends Error {
  constructor() {
    super("Ese cobro lo confirmó el banco: no se puede deshacer a mano")
    this.name = "RecurringPeriodNotManualError"
  }
}

/** El período en curso ya tiene su cargo real del banco (→ 409): dos cargos reales no se pisan. */
export class RecurringPeriodBankPaidError extends Error {
  constructor() {
    super("Este período ya tiene un cargo del banco")
    this.name = "RecurringPeriodBankPaidError"
  }
}
