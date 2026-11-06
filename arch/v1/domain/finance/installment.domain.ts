// Dominio de deudas en cuotas. Puro: sin Prisma, sin DB. Un plan reparte una deuda con el banco
// en N cuotas y las registra a medida que se pagan. El `kind` elige CÓMO se entera el sistema de
// que una cuota se pagó, y de ahí sale toda la asimetría del modelo:
//
//   card — compra en cuotas con tarjeta. La compra ya entró completa el día que ocurrió (por eso
//     se neutraliza) y el correo del pago de la tarjeta trae el total de la factura, no el de la
//     cuota. Nadie más va a crear ese movimiento: lo CREA el plan al conciliar la factura, con la
//     fecha y el monto que ella trae.
//   loan — crédito de consumo. El consumo financiado nunca entró a la app y el correo de la cuota
//     ya genera un gasto real con monto y fecha efectivos: el plan lo ADOPTA. Crearlo también aquí
//     duplicaría el gasto.

import type { AccountType } from "./finance.domain.ts"
import { type CurrencyCode, Money } from "./money.ts"
import type { PeriodRange } from "../../../shared/billing-cycle.ts"

// --- Entidad ---

export const INSTALLMENT_KINDS = ["card", "loan"] as const
export type InstallmentKind = (typeof INSTALLMENT_KINDS)[number]

export type InstallmentPlan = {
  id: string
  userId: string
  kind: InstallmentKind
  accountId: string // card: la cuenta de crédito; loan: la cuenta desde la que se paga
  categoryId: string
  sourceTransactionId: string | null // solo card: la compra neutralizada
  description: string
  totalAmount: Money // total planificado a devolver; puede incluir financiación confirmada sin cambiar la compra origen
  currency: CurrencyCode
  installmentsCount: number
  startDate: Date // vencimiento de la cuota 1
  dayOfMonth: number
  tolerancePct: number // solo desempate entre planes loan
  completedAt: Date | null
  items: InstallmentItem[]
}

export type InstallmentItem = {
  id: string
  index: number // 1..N
  dueDate: Date
  amount: Money // card: definitivo; loan: estimación (el correo manda)
  transactionId: string | null // movimiento creado o adoptado; null = sin registrar
  paidOutsideApp: boolean // cuota anterior a la conexión de correo: cuenta, pero no generó gasto
  // El movimiento lo generó la app con «Generar cuota» (`Transaction.generatedFromInstallment`):
  // es un sustituto y el correo de ese pago lo reemplaza. Uno que la persona escribió y asignó no
  // cuenta. Ausente = false.
  manualTransaction?: boolean
}

// --- Inputs de escritura ---

export type NewInstallmentPlan = {
  userId: string
  kind: InstallmentKind
  accountId: string
  categoryId: string
  sourceTransactionId: string | null
  description: string
  totalAmount: Money
  installmentsCount: number
  startDate: Date
  dayOfMonth: number
  tolerancePct: number
}

// --- Estado de una cuota ---

export type ItemStatus = "paid" | "outside_app" | "overdue" | "upcoming"

export function itemStatus(item: InstallmentItem, today: Date): ItemStatus {
  if (item.transactionId) return "paid"
  if (item.paidOutsideApp) return "outside_app"
  return isAfterDay(today, item.dueDate) ? "overdue" : "upcoming"
}

/** ¿La cuota ya quedó saldada, por movimiento o por haber ocurrido antes de la conexión? */
export function isSettled(item: InstallmentItem): boolean {
  return item.transactionId !== null || item.paidOutsideApp
}

// --- Cronograma ---

/** Último día del mes (year, month 1–12). */
export function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

// Compara solo el día calendario, leído en UTC: una fecha guardada como DATE es medianoche UTC,
// y con getters locales (Chile, UTC-4) retrocedería un día.
function isAfterDay(a: Date, b: Date): boolean {
  return (
    Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()) >
    Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  )
}

/**
 * Vencimientos de las N cuotas: el `dayOfMonth` de cada mes a partir del mes de `startDate`,
 * recortado al último día cuando el mes es más corto (31 en un mes de 30 → 30).
 *
 * `startIndex` es el número que el BANCO le da a la cuota que vence en `startDate`. En un crédito
 * dado de alta a mitad de camino ("vas en la 5 de 49") las anteriores se fechan hacia atrás, para
 * que el índice de cada ítem coincida con la numeración del banco: un correo que informa
 * "N° Cuota: 6" tiene que caer en el ítem 6, no en el sexto de los que quedaban.
 */
export function schedule(
  startDate: Date,
  dayOfMonth: number,
  count: number,
  startIndex = 1
): Date[] {
  const dates: Date[] = []
  for (let i = 1; i <= count; i++) {
    const year = startDate.getFullYear()
    const month = startDate.getMonth() + (i - startIndex) // Date normaliza el desborde
    const d = new Date(year, month, 1)
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    dates.push(new Date(y, m - 1, Math.min(dayOfMonth, lastDayOfMonth(y, m))))
  }
  return dates
}

/**
 * Reparto por defecto: `total / N` en cada cuota y el resto de la división en la ÚLTIMA, de modo
 * que la suma sea exactamente el total (nunca un peso de más o de menos por redondeo).
 */
export function splitAmount(total: Money, count: number): Money[] {
  const n = BigInt(count)
  const base = total.minor / n
  const remainder = total.minor - base * n
  return Array.from({ length: count }, (_, i) =>
    Money.fromMinor(
      i === count - 1 ? base + remainder : base,
      total.currency
    )
  )
}

// --- Selección de cuota y de plan ---

/**
 * Cuota que corresponde registrar en un pago: la pendiente MÁS ANTIGUA ya vencida a esa fecha.
 * Una sola por pago — cada factura trae una cuota de cada plan, y saldar todas las atrasadas de
 * golpe concentraría meses de gasto en el mes que el usuario está mirando.
 */
export function nextDueItem(
  plan: InstallmentPlan,
  paymentDate: Date
): InstallmentItem | null {
  return (
    [...plan.items]
      .sort((a, b) => a.index - b.index)
      .find((i) => !isSettled(i) && !isAfterDay(i.dueDate, paymentDate)) ?? null
  )
}

/** ¿La cuota la saldó un movimiento generado a mano que el correo del banco puede reemplazar? */
export function isReplaceableByEmail(item: InstallmentItem): boolean {
  return item.transactionId !== null && item.manualTransaction === true
}

// Un pago SIN N° de cuota reemplaza una generada a mano solo si cae a lo más a 10 días de su
// vencimiento: un pago atrasado o adelantado unos días es normal; más lejos ya es otro período
// (cuotas mensuales) y borrar el sustituto sería adivinar.
export const REPLACE_WINDOW_DAYS = 10
// Con N° de cuota el banco dice cuál pagó, pero un pago a más de un período de su vencimiento
// (p. ej. un año después) es otro crédito que reusa la numeración, no ese pago que llegó tarde.
export const REPLACE_WITH_NUMBER_WINDOW_DAYS = 31

/** Días calendario entre dos fechas, leídas en UTC como `isAfterDay`. */
function daysApart(a: Date, b: Date): number {
  const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  return Math.abs(dayOf(a) - dayOf(b)) / 86_400_000
}

/**
 * Cuota de un crédito que corresponde a un pago SIN N° de cuota. La cuota cuyo vencimiento está
 * más cerca de la fecha del pago: si quedó generada a mano y el pago cae dentro de
 * `REPLACE_WINDOW_DAYS`, el correo es ese mismo pago que llegó tarde y la reemplaza. Si no, como
 * siempre, la pendiente más antigua ya vencida (`nextDueItem`). Así un pago adelantado de la cuota
 * 4 no borra la generada de la 3.
 */
function loanItemFor(plan: InstallmentPlan, date: Date): InstallmentItem | null {
  const nearest = [...plan.items]
    .sort((a, b) => a.index - b.index)
    .reduce<InstallmentItem | null>(
      (best, i) =>
        best === null || daysApart(i.dueDate, date) < daysApart(best.dueDate, date) ? i : best,
      null
    )
  if (
    nearest &&
    isReplaceableByEmail(nearest) &&
    daysApart(nearest.dueDate, date) <= REPLACE_WINDOW_DAYS
  )
    return nearest
  return nextDueItem(plan, date)
}

/** Cuota generada a mano que nombra el correo, si el pago cae dentro del período de esa cuota. */
function namedReplaceable(plan: InstallmentPlan, payment: LoanPayment): InstallmentItem | null {
  const named = plan.items.find((i) => i.index === payment.installmentNumber)
  return named &&
    isReplaceableByEmail(named) &&
    daysApart(named.dueDate, payment.date) <= REPLACE_WITH_NUMBER_WINDOW_DAYS
    ? named
    : null
}

/**
 * Ítem que salda un pago de crédito. El N° de cuota del correo manda cuando viene: es el propio
 * banco diciendo cuál cuota pagó, más fiable que deducirla del orden.
 *
 * Si el banco nombra una cuota generada a mano, es esa (dentro de un período): el correo reemplaza
 * al movimiento generado. Si el banco nombra una cuota YA saldada de otra forma, no se cae a otra:
 * ese pago es un duplicado o algo que el modelo no previó, y meterlo en la cuota siguiente
 * reportaría como cuota 2 lo que el banco llamó cuota 1. Devuelve null y el movimiento queda suelto
 * para que lo resuelva el usuario. Solo cuando el correo no trae número se recurre a `loanItemFor`.
 */
export function itemForPayment(
  plan: InstallmentPlan,
  payment: LoanPayment
): InstallmentItem | null {
  if (payment.installmentNumber !== null) {
    const named = plan.items.find((i) => i.index === payment.installmentNumber)
    if (named) return isSettled(named) ? namedReplaceable(plan, payment) : named
  }
  return loanItemFor(plan, payment.date)
}

/** Rango [monto·(1−tol), monto·(1+tol)]: si un pago ya importado calza con una cuota al crear el plan. */
export function toleranceRange(expected: Money, tolerancePct: number): {
  min: Money
  max: Money
} {
  const delta =
    (expected.minor * BigInt(Math.round(tolerancePct))) / BigInt(100)
  return {
    min: Money.fromMinor(expected.minor - delta, expected.currency),
    max: Money.fromMinor(expected.minor + delta, expected.currency),
  }
}

export type LoanPayment = {
  accountId: string // cuenta de origen del pago
  amount: Money
  date: Date
  installmentNumber: number | null // "N° Cuota" del correo, cuando viene
}

/** Distancia en monto entre un pago y una cuota (misma moneda). */
export function amountDistance(payment: Money, expected: Money): bigint {
  const d = payment.minor - expected.minor
  return d < BigInt(0) ? -d : d
}

/**
 * Un plan cerrado solo toma un pago que reemplaza una cuota generada a mano, y aun así solo con
 * evidencia: el correo nombra esa cuota (la ventana de un período ya la exige `namedReplaceable`)
 * o, sin número, el monto cae en la tolerancia del plan (la ventana de días ya la exige
 * `loanItemFor`). Sin esto, siendo el único candidato ganaría sin comparar nada, y el primer correo
 * de OTRO crédito sin plan en la app borraría su última cuota.
 */
function closedPlanTakes(
  plan: InstallmentPlan,
  item: InstallmentItem,
  payment: LoanPayment
): boolean {
  if (!isReplaceableByEmail(item)) return false
  if (payment.installmentNumber !== null) return payment.installmentNumber === item.index
  const { min, max } = toleranceRange(item.amount, plan.tolerancePct)
  return payment.amount.compare(min) >= 0 && payment.amount.compare(max) <= 0
}

/**
 * Plan `loan` y cuota que salda un pago:
 *
 *   1. planes de esa cuenta de origen (activos, o cerrados según `closedPlanTakes`) — con uno solo, se acabó, y la cuota la elige
 *      `itemForPayment` (manda el N° del correo);
 *   2. con varios, el monto: gana el plan cuya cuota pendiente está más cerca del cargo, calce o no
 *      la tolerancia (la última cuota de un crédito suele desviarse del cronograma);
 *   3. solo a igual distancia desempata el N° de cuota del correo.
 *
 * Con varios candidatos la cuota es la pendiente con la que se comparó el monto, no la que nombra
 * el correo: dos créditos de la misma cuenta pueden ir en cuotas vecinas, y un cargo de $265.708
 * con «cuota 6» es la cuota 5 del crédito de $254.156, no la 6 del de $53.450.
 *
 * Ambiguo ⇒ null: el movimiento queda como gasto suelto, nunca se adivina. `item` null ⇒ el plan es
 * suyo pero no hay cuota que saldar (p. ej. el correo nombra una ya pagada).
 */
export function pickLoanItemFor(
  payment: LoanPayment,
  plans: InstallmentPlan[]
): { plan: InstallmentPlan; item: InstallmentItem | null } | null {
  const candidates = plans.flatMap((p) => {
    const item =
      p.kind === "loan" &&
      p.accountId === payment.accountId &&
      p.currency === payment.amount.currency
        ? (namedReplaceable(p, payment) ?? loanItemFor(p, payment.date))
        : null
    if (item && p.completedAt !== null && !closedPlanTakes(p, item, payment)) return []
    return item ? [{ plan: p, item, distance: amountDistance(payment.amount, item.amount) }] : []
  })
  if (candidates.length === 0) return null
  if (candidates.length === 1) {
    const { plan } = candidates[0]
    return { plan, item: itemForPayment(plan, payment) }
  }

  const best = candidates.reduce((min, c) => (c.distance < min ? c.distance : min), candidates[0].distance)
  const closest = candidates.filter((c) => c.distance === best)
  if (closest.length === 1) return closest[0]
  const byNumber = closest.filter((c) => c.item.index === payment.installmentNumber)
  return byNumber.length === 1 ? byNumber[0] : null
}

/** Plan `loan` al que pertenece un pago de cuota (ver `pickLoanItemFor`). */
export function pickLoanPlanFor(
  payment: LoanPayment,
  plans: InstallmentPlan[]
): InstallmentPlan | null {
  return pickLoanItemFor(payment, plans)?.plan ?? null
}

/** Movimiento existente que el usuario puede asignar a una cuota. */
export type LinkCandidate = {
  transactionId: string
  description: string
  amount: Money
  date: Date
  accountName: string
  categoryId: string | null // para filtrar candidatos por la categoría del plan
}

// --- Avance y saldo ---

/**
 * Saldo pendiente: el total menos lo EFECTIVAMENTE registrado. Se calcula sobre los movimientos
 * reales y no sobre el cronograma porque en un `loan` las cuotas varían (intereses, seguros, la
 * última suele diferir) y el cronograma es solo una estimación.
 */
export function outstanding(plan: InstallmentPlan, paidAmounts: Money[]): Money {
  return paidAmounts.reduce((rest, paid) => rest.subtract(paid), plan.totalAmount)
}

/** Cuotas saldadas sobre el total, para mostrar el avance ("14 de 48"). */
export function progress(plan: InstallmentPlan): {
  settled: number
  total: number
} {
  return {
    settled: plan.items.filter(isSettled).length,
    total: plan.installmentsCount,
  }
}

/**
 * Comprometido que aportan las cuotas de un plan a una categoría en un mes: las cuotas AÚN NO
 * saldadas cuyo vencimiento cae en ese mes. Es el análogo del comprometido de una recurrente —la
 * cuota se anticipa en el mes que toca cobrarla— pero DERIVADO, sin crear filas: al pagarse, la
 * cuota pasa a ser gasto real y deja de estar aquí, así que nunca cuenta dos veces. El total de la
 * compra no participa: eso lo lleva la compra origen, ya neutralizada.
 */
export function dueUnsettledItems(
  plan: InstallmentPlan,
  range: PeriodRange // el mes del presupuesto ya resuelto (calendario o ciclo de la tarjeta)
): InstallmentItem[] {
  return plan.items.filter((i) => {
    // UTC: el DATE de la BD es medianoche UTC y en local caería en el día (y a veces mes) anterior.
    const day = i.dueDate.toISOString().slice(0, 10)
    return !isSettled(i) && day >= range.start && day <= range.end
  })
}

export function committedForMonth(
  plan: InstallmentPlan,
  range: PeriodRange
): Money {
  return dueUnsettledItems(plan, range).reduce(
    (sum, i) => sum.add(i.amount),
    Money.zero(plan.currency)
  )
}

/** ¿Quedó saldada la última cuota? Entonces el plan se cierra y deja de esperar pagos. */
export function isComplete(plan: InstallmentPlan): boolean {
  return (
    plan.items.length === plan.installmentsCount && plan.items.every(isSettled)
  )
}

// --- Validación ---

/** La cuenta válida depende del disparador, no de que la deuda sea deuda. */
export function accountAllowsKind(
  kind: InstallmentKind,
  accountType: AccountType
): boolean {
  // card se dispara con el pago de UNA TARJETA: sin tarjeta de crédito no hay disparador.
  if (kind === "card") return accountType === "credit_card"
  // loan se dispara con el pago de la propia cuota, que se carga a cualquier cuenta.
  return true
}

export function isValidTolerance(pct: number): boolean {
  return Number.isInteger(pct) && pct >= 0 && pct <= 100
}

/**
 * En `card` los montos los define el usuario y deben cuadrar con el total: si no, el plan diría
 * que debes una cifra distinta de la que sumas. En `loan` el cronograma es estimación y el monto
 * real lo fija el correo, así que exigir la igualdad rechazaría planes correctos.
 */
export function requiresExactSplit(kind: InstallmentKind): boolean {
  return kind === "card"
}

export function splitMatchesTotal(total: Money, amounts: Money[]): boolean {
  const sum = amounts.reduce((a, b) => a.add(b), Money.zero(total.currency))
  return sum.compare(total) === 0
}

// --- Port (lo implementa la infraestructura) ---

export interface InstallmentPlanRepository {
  listByUser(userId: string): Promise<InstallmentPlan[]>
  /** Planes activos de un tipo y una cuenta: lo que consulta cada disparador. */
  listActiveByAccount(
    accountId: string,
    kind: InstallmentKind
  ): Promise<InstallmentPlan[]>
  /**
   * Planes `loan` de una cuenta que un correo de pago puede tocar: los activos y los cerrados con
   * alguna cuota saldada por un movimiento manual (el correo de esa cuota la reemplaza).
   */
  listLoanPlansForPayment(accountId: string): Promise<InstallmentPlan[]>
  findById(id: string): Promise<InstallmentPlan | null>
  /** Plan al que pertenece un movimiento: la cuota que lo salda o la compra origen neutralizada. */
  findByTransaction(transactionId: string): Promise<InstallmentPlan | null>
  /** Crea el plan con sus N ítems. Atómico con la neutralización de la compra origen. */
  create(
    input: NewInstallmentPlan,
    items: { index: number; dueDate: Date; amount: Money }[]
  ): Promise<InstallmentPlan>
  /**
   * Borra el plan. Si viene `restoreSourceTransactionId`, des-neutraliza esa compra origen en la
   * misma operación: sin plan que la reparta, el gasto vuelve a contar entero en su mes.
   */
  delete(id: string, restoreSourceTransactionId?: string | null): Promise<void>
  /**
   * Crea el movimiento de una cuota (`card` y marca manual) y lo vincula al ítem. Idempotente por
   * el único `Transaction.installmentItemId` de la BD: si el ítem ya tiene movimiento, devuelve
   * `false` sin crear otro.
   */
  registerItemTransaction(
    plan: InstallmentPlan,
    itemId: string,
    date: Date,
    amount: Money
  ): Promise<boolean>
  /**
   * Vincula al ítem un movimiento YA IMPORTADO (`loan`) y le aplica la categoría del plan,
   * dejándolo revisado para que la IA no lo toque. `false` si el ítem ya estaba registrado, salvo
   * que lo saldara un movimiento manual y el que llega venga del banco: entonces borra el manual y
   * adopta el del banco en la misma transacción (ver `isReplaceableByEmail`).
   */
  adoptTransaction(
    plan: InstallmentPlan,
    itemId: string,
    transactionId: string
  ): Promise<boolean>
  /** Marca cuotas como pagadas fuera de la app (anteriores a la conexión de correo). */
  markPaidOutsideApp(itemIds: string[]): Promise<void>
  /**
   * Edita varias cuotas de una vez, atómico (editar una en `card` redistribuye las pendientes).
   * Si una cuota ya tiene movimiento, lo actualiza también: el movimiento de una cuota `card` es
   * un espejo del cronograma, y editar uno sin el otro dejaría dos verdades.
   * Rechaza sin cambios si el plan ya no coincide con el leído para calcular la edición.
   * La comprobación y la escritura se serializan con las correcciones del total del plan.
   */
  updateItems(
    updates: { itemId: string; dueDate?: Date; amount: Money }[],
    expectedPlan: InstallmentPlan
  ): Promise<void>
  /**
   * Recategoriza el plan Y todos sus movimientos (cuotas registradas y compra origen), atómico.
   * La categoría es del plan: cambiarla desde cualquier punto cambia el conjunto completo.
   */
  setCategory(planId: string, categoryId: string): Promise<void>
  /** Cierra el plan cuando su última cuota queda saldada. */
  markCompleted(planId: string, at: Date): Promise<void>
  /** Reabre un plan cerrado: al soltar una cuota vuelve a tener algo pendiente. */
  reopen(planId: string): Promise<void>
  /** Marca la compra origen como interna y la vincula al plan. */
  neutralizeSourceTransaction(
    planId: string,
    transactionId: string
  ): Promise<void>
  /** Movimientos de cuota de crédito ya importados de esa cuenta, sin plan que los reclame. */
  listUnclaimedLoanPayments(
    userId: string,
    accountId: string
  ): Promise<(LoanPayment & { transactionId: string })[]>
  /**
   * Movimientos que el usuario podría asignar a una cuota: gastos suyos, no internos y todavía sin
   * plan. Se acotan a una ventana alrededor del vencimiento porque un pago se busca por cercanía,
   * no revisando el año entero.
   */
  listLinkCandidates(
    userId: string,
    around: Date,
    accountId?: string
  ): Promise<LinkCandidate[]>
  /** Suelta el movimiento de su cuota (deshacer una asignación equivocada). */
  unlinkTransaction(transactionId: string): Promise<void>
  /**
   * En una sola transacción: suelta el movimiento de la cuota `from` (lanza
   * `InvalidInstallmentPlanError` si ya no está en ella), reabre el plan origen si estaba cerrado y,
   * con destino, lo vincula a la cuota `to` con la categoría de su plan (lanza
   * `InstallmentItemAlreadySettledError` si el destino ya está saldado). Si algo falla no cambia
   * nada. El cierre del plan destino queda fuera: lo decide el caso de uso después.
   */
  moveItemTransaction(
    transactionId: string,
    to: { plan: InstallmentPlan; itemId: string } | null,
    from: { plan: InstallmentPlan; itemId: string }
  ): Promise<void>
}

// --- Errores de negocio ---

/** Input inválido: cuenta incompatible con el tipo, cuotas ≤ 0, monto ≤ 0 o tolerancia fuera de
 * 0–100 (→ 422). */
export class InvalidInstallmentPlanError extends Error {
  constructor(message = "Plan de cuotas inválido") {
    super(message)
    this.name = "InvalidInstallmentPlanError"
  }
}

/** Un plan `card` se dispara con el pago de una tarjeta: sobre otra cuenta no se ejecutaría nunca. */
export class InstallmentAccountMismatchError extends Error {
  constructor() {
    super("Las cuotas de tarjeta requieren una cuenta de crédito")
    this.name = "InstallmentAccountMismatchError"
  }
}

/** Los montos editados no suman el total del plan (solo `card`) (→ 422). */
export class InstallmentSplitMismatchError extends Error {
  constructor() {
    super("Los montos de las cuotas deben sumar el total del plan")
    this.name = "InstallmentSplitMismatchError"
  }
}

/** Una cuota ya registrada es historia: su movimiento ya vivió su mes (→ 422). */
export class InstallmentItemAlreadySettledError extends Error {
  constructor() {
    super("Esta cuota ya está registrada y no puede modificarse")
    this.name = "InstallmentItemAlreadySettledError"
  }
}

/** La categoría de una cuota la manda el plan: no puede quedar sin categoría (→ 422). */
export class InstallmentCategoryRequiredError extends Error {
  constructor() {
    super("Un movimiento de un plan de cuotas no puede quedar sin categoría")
    this.name = "InstallmentCategoryRequiredError"
  }
}

/** El monto de una cuota refleja el cronograma del plan: se edita en el plan, no aquí (→ 422). */
export class InstallmentAmountReadOnlyError extends Error {
  constructor() {
    super("El monto de una cuota se edita en su plan de cuotas")
    this.name = "InstallmentAmountReadOnlyError"
  }
}

export class InstallmentPlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Plan de cuotas no encontrado: ${id}`)
    this.name = "InstallmentPlanNotFoundError"
  }
}
