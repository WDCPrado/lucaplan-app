// Dominio de deudas en cuotas. Puro: sin Prisma, sin DB. Un plan reparte una deuda con el banco
// en N cuotas y las registra a medida que se pagan. El `kind` elige CÓMO se entera el sistema de
// que una cuota se pagó, y de ahí sale toda la asimetría del modelo:
//
//   card — compra en cuotas con tarjeta. La compra ya entró completa el día que ocurrió (por eso
//     se neutraliza) y el correo del pago de la tarjeta trae el total de la factura, no el de la
//     cuota. Nadie más va a crear ese movimiento: lo CREA el plan, con el monto del cronograma.
//   loan — crédito de consumo. El consumo financiado nunca entró a la app y el correo de la cuota
//     ya genera un gasto real con monto y fecha efectivos: el plan lo ADOPTA. Crearlo también aquí
//     duplicaría el gasto.

import type { AccountType } from "./finance.domain.ts"
import { type CurrencyCode, Money } from "./money.ts"

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
  totalAmount: Money // capital, sin intereses del banco
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

// Compara solo el día calendario: la hora de una fecha guardada como DATE (medianoche UTC) no
// debe cambiar el resultado.
function isAfterDay(a: Date, b: Date): boolean {
  return (
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) >
    Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
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

/**
 * Ítem que salda un pago de crédito. El N° de cuota del correo manda cuando viene: es el propio
 * banco diciendo cuál cuota pagó, más fiable que deducirla del orden.
 *
 * Si el banco nombra una cuota YA saldada, no se cae a otra: ese pago es un duplicado o algo que
 * el modelo no previó, y meterlo en la cuota siguiente reportaría como cuota 2 lo que el banco
 * llamó cuota 1. Devuelve null y el movimiento queda suelto para que lo resuelva el usuario.
 * Solo cuando el correo no trae número se recurre a la pendiente más antigua vencida.
 */
export function itemForPayment(
  plan: InstallmentPlan,
  payment: LoanPayment
): InstallmentItem | null {
  if (payment.installmentNumber !== null) {
    const named = plan.items.find((i) => i.index === payment.installmentNumber)
    if (named) return isSettled(named) ? null : named
  }
  return nextDueItem(plan, payment.date)
}

/** Rango [monto·(1−tol), monto·(1+tol)] usado SOLO para desempatar entre planes candidatos. */
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

/**
 * Plan `loan` al que pertenece un pago de cuota. Se resuelve por especificidad decreciente:
 *
 *   1. planes activos de esa cuenta de origen — con uno solo, se acabó;
 *   2. el N° de cuota del correo, que fija el ítem sin ambigüedad;
 *   3. la tolerancia sobre el monto esperado de esa cuota.
 *
 * Ambiguo ⇒ null: el movimiento queda como gasto suelto, nunca se adivina.
 *
 * La tolerancia SOLO desempata. Si decidiera *si el correo es la cuota*, la última cuota —la que
 * más se desvía del cronograma— caería fuera del rango y el plan no se cerraría nunca. Con un
 * único candidato ni siquiera se evalúa.
 */
export function pickLoanPlanFor(
  payment: LoanPayment,
  plans: InstallmentPlan[]
): InstallmentPlan | null {
  const byAccount = plans.filter(
    (p) =>
      p.kind === "loan" &&
      p.completedAt === null &&
      p.accountId === payment.accountId &&
      p.currency === payment.amount.currency &&
      nextDueItem(p, payment.date) !== null
  )
  if (byAccount.length <= 1) return byAccount[0] ?? null

  const byNumber =
    payment.installmentNumber === null
      ? byAccount
      : byAccount.filter(
          (p) => nextDueItem(p, payment.date)?.index === payment.installmentNumber
        )
  if (byNumber.length === 1) return byNumber[0]

  const candidates = byNumber.length > 0 ? byNumber : byAccount
  const withinTolerance = candidates.filter((p) => {
    const item = nextDueItem(p, payment.date)
    if (!item) return false
    const { min, max } = toleranceRange(item.amount, p.tolerancePct)
    return (
      payment.amount.compare(min) >= 0 && payment.amount.compare(max) <= 0
    )
  })
  return withinTolerance.length === 1 ? withinTolerance[0] : null
}

/** Movimiento existente que el usuario puede asignar a una cuota. */
export type LinkCandidate = {
  transactionId: string
  description: string
  amount: Money
  date: Date
  accountName: string
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
  findById(id: string): Promise<InstallmentPlan | null>
  /** Crea el plan con sus N ítems. Atómico con la neutralización de la compra origen. */
  create(
    input: NewInstallmentPlan,
    items: { index: number; dueDate: Date; amount: Money }[]
  ): Promise<InstallmentPlan>
  delete(id: string): Promise<void>
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
   * dejándolo revisado para que la IA no lo toque. `false` si el ítem ya estaba registrado.
   */
  adoptTransaction(
    plan: InstallmentPlan,
    itemId: string,
    transactionId: string
  ): Promise<boolean>
  /** Marca cuotas como pagadas fuera de la app (anteriores a la conexión de correo). */
  markPaidOutsideApp(itemIds: string[]): Promise<void>
  /** Edita monto y vencimiento de una cuota aún sin registrar. */
  updateItem(itemId: string, dueDate: Date, amount: Money): Promise<void>
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

export class InstallmentPlanNotFoundError extends Error {
  constructor(id: string) {
    super(`Plan de cuotas no encontrado: ${id}`)
    this.name = "InstallmentPlanNotFoundError"
  }
}
