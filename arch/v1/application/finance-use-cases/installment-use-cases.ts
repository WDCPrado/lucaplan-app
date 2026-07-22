// Casos de uso de deudas en cuotas: alta del plan, y los dos disparadores que registran cada
// cuota. La asimetría entre ellos es deliberada y vive aquí:
//
//   card → `executeCardInstallments` CREA el movimiento de la cuota. La compra ya entró completa
//     el día que ocurrió (se neutraliza) y el correo del pago trae el total de la factura.
//   loan → `adoptLoanInstallment` ENGANCHA el movimiento que el correo ya creó. Crearlo también
//     aquí duplicaría el gasto.
//
// Depende solo de domain (+ ports).
import {
  type Account,
  type AccountRepository,
  type Category,
  type CategoryRepository,
  type TransactionRepository,
  AccountNotFoundError,
  CategoryNotFoundError,
  NotOwnerError,
} from "../../domain/finance/finance.domain.ts"
import {
  type InstallmentItem,
  type InstallmentKind,
  type InstallmentPlan,
  type InstallmentPlanRepository,
  type LinkCandidate,
  type LoanPayment,
  InstallmentAccountMismatchError,
  InstallmentItemAlreadySettledError,
  InstallmentPlanNotFoundError,
  InstallmentSplitMismatchError,
  InvalidInstallmentPlanError,
  accountAllowsKind,
  isComplete,
  isSettled,
  isValidTolerance,
  itemForPayment,
  nextDueItem,
  pickLoanPlanFor,
  requiresExactSplit,
  schedule,
  splitAmount,
  splitMatchesTotal,
} from "../../domain/finance/installment.domain.ts"
import { Money } from "../../domain/finance/money.ts"

type InstallmentDeps = {
  installments: InstallmentPlanRepository
  accounts: AccountRepository
  categories: CategoryRepository
}

export type InstallmentPlanInput = {
  kind: InstallmentKind
  accountId: string
  categoryId: string
  description: string
  totalAmount: number
  installmentsCount: number
  startDate: Date
  dayOfMonth: number
  tolerancePct: number
  /** Montos por cuota ya editados por el usuario; vacío ⇒ reparto por defecto. */
  amounts?: number[]
  /** Índices (1..N) que el usuario dejó marcados como ya pagados al crear. */
  paidIndexes?: number[]
  /** Solo `card`: la compra que se transforma y queda neutralizada. */
  sourceTransactionId?: string | null
}

async function validateInput(
  deps: InstallmentDeps,
  userId: string,
  input: InstallmentPlanInput
): Promise<{ account: Account; category: Category; total: Money }> {
  const account = await deps.accounts.findById(input.accountId)
  if (!account) throw new AccountNotFoundError(input.accountId)
  if (account.userId !== userId) throw new NotOwnerError()
  // La cuenta válida depende del disparador: `card` se dispara con el pago de UNA TARJETA, así que
  // sobre otra cuenta el plan no se ejecutaría nunca.
  if (!accountAllowsKind(input.kind, account.accountType))
    throw new InstallmentAccountMismatchError()

  const category = await deps.categories.findById(input.categoryId)
  if (!category) throw new CategoryNotFoundError(input.categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  if (category.type !== "expense")
    throw new InvalidInstallmentPlanError("Una deuda en cuotas es un gasto")

  if (!input.description.trim())
    throw new InvalidInstallmentPlanError("El plan necesita descripción")
  if (!Number.isFinite(input.totalAmount) || input.totalAmount <= 0)
    throw new InvalidInstallmentPlanError("El total debe ser mayor que 0")
  if (!Number.isInteger(input.installmentsCount) || input.installmentsCount < 1)
    throw new InvalidInstallmentPlanError("El plan necesita al menos una cuota")
  if (
    !Number.isInteger(input.dayOfMonth) ||
    input.dayOfMonth < 1 ||
    input.dayOfMonth > 31
  )
    throw new InvalidInstallmentPlanError("El día debe estar entre 1 y 31")
  if (!isValidTolerance(input.tolerancePct))
    throw new InvalidInstallmentPlanError("La tolerancia debe estar entre 0 y 100")

  return { account, category, total: Money.of(input.totalAmount, account.currency) }
}

export async function listInstallmentPlans(
  deps: { installments: InstallmentPlanRepository },
  userId: string
): Promise<InstallmentPlan[]> {
  return deps.installments.listByUser(userId)
}

/**
 * Crea el plan con su cronograma y salda las cuotas que el usuario marcó como ya pagadas. Cómo se
 * saldan depende del tipo, por la misma razón de siempre:
 *
 *   card — crea el movimiento con la FECHA DE VENCIMIENTO de cada cuota, no la de hoy: si usara
 *     hoy, el mes de creación acumularía todas las cuotas viejas y los meses que les tocaban
 *     quedarían vacíos, justo después de que la compra origen dejó de contar.
 *   loan — engancha los pagos ya importados de esa cuenta. Las cuotas anteriores a la conexión de
 *     correo no tienen movimiento que adoptar: quedan como pagadas fuera de la app. Inventarlas
 *     metería gasto en meses que el usuario nunca vio en la aplicación.
 */
export async function createInstallmentPlan(
  deps: InstallmentDeps & { transactions?: TransactionRepository },
  userId: string,
  input: InstallmentPlanInput
): Promise<InstallmentPlan> {
  const { total } = await validateInput(deps, userId, input)

  const dates = schedule(input.startDate, input.dayOfMonth, input.installmentsCount)
  const amounts =
    input.amounts && input.amounts.length === input.installmentsCount
      ? input.amounts.map((a) => Money.of(a, total.currency))
      : splitAmount(total, input.installmentsCount)
  if (requiresExactSplit(input.kind) && !splitMatchesTotal(total, amounts))
    throw new InstallmentSplitMismatchError()

  const plan = await deps.installments.create(
    {
      userId,
      kind: input.kind,
      accountId: input.accountId,
      categoryId: input.categoryId,
      sourceTransactionId: null,
      description: input.description.trim(),
      totalAmount: total,
      installmentsCount: input.installmentsCount,
      startDate: input.startDate,
      dayOfMonth: input.dayOfMonth,
      tolerancePct: input.tolerancePct,
    },
    dates.map((dueDate, i) => ({ index: i + 1, dueDate, amount: amounts[i] }))
  )

  // La compra origen deja de contar como gasto: si no, el total y las cuotas se sumarían los dos.
  if (input.kind === "card" && input.sourceTransactionId) {
    await deps.installments.neutralizeSourceTransaction(
      plan.id,
      input.sourceTransactionId
    )
  }

  const paid = new Set(input.paidIndexes ?? [])
  if (paid.size > 0) {
    const marked = plan.items.filter((i) => paid.has(i.index))
    if (input.kind === "card") {
      for (const item of marked)
        await deps.installments.registerItemTransaction(
          plan,
          item.id,
          item.dueDate,
          item.amount
        )
    } else {
      await adoptOrMarkOutside(deps, userId, plan, marked)
    }
  }

  return (await deps.installments.findById(plan.id)) ?? plan
}

// Para cada cuota marcada busca el pago ya importado de ESE mes y lo adopta; sin pago que adoptar,
// la cuota queda registrada como pagada fuera de la app (cuenta para el avance, no genera gasto).
async function adoptOrMarkOutside(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  plan: InstallmentPlan,
  items: InstallmentItem[]
): Promise<void> {
  const payments = await deps.installments.listUnclaimedLoanPayments(
    userId,
    plan.accountId
  )
  const used = new Set<string>()
  const outside: string[] = []
  for (const item of items) {
    const match = payments.find(
      (p) =>
        !used.has(p.transactionId) &&
        p.date.getFullYear() === item.dueDate.getFullYear() &&
        p.date.getMonth() === item.dueDate.getMonth()
    )
    if (match) {
      used.add(match.transactionId)
      await deps.installments.adoptTransaction(plan, item.id, match.transactionId)
    } else {
      outside.push(item.id)
    }
  }
  if (outside.length > 0) await deps.installments.markPaidOutsideApp(outside)
}

// --- Disparador de tarjeta: crea el movimiento de la cuota ---

/**
 * Al detectarse el pago de una tarjeta, registra UNA cuota por cada plan `card` de esa cuenta: la
 * pendiente más antigua ya vencida. Una sola por plan — cada factura trae una cuota de cada uno, y
 * saldar todas las atrasadas de golpe concentraría meses de gasto en el mes que el usuario mira.
 *
 * El monto del pago no condiciona nada: el correo informa el total de la factura, no el de la
 * cuota, así que un pago mínimo cierra igual el ciclo.
 */
export async function executeCardInstallments(
  deps: { installments: InstallmentPlanRepository },
  accountId: string,
  paymentDate: Date
): Promise<number> {
  const plans = await deps.installments.listActiveByAccount(accountId, "card")
  let registered = 0
  for (const plan of plans) {
    const item = nextDueItem(plan, paymentDate)
    if (!item) continue
    const created = await deps.installments.registerItemTransaction(
      plan,
      item.id,
      paymentDate,
      item.amount
    )
    if (!created) continue
    registered++
    await closeIfComplete(deps, plan, item, paymentDate)
  }
  return registered
}

// --- Disparador de crédito: adopta el movimiento que ya llegó ---

/**
 * Engancha a su plan el movimiento ya importado de un pago de cuota de crédito. Devuelve el plan
 * que lo reclamó, o null si ninguno lo hace de forma inequívoca — en cuyo caso el movimiento sigue
 * su curso como gasto normal, que es exactamente lo que era antes de existir los planes.
 */
export async function adoptLoanInstallment(
  deps: { installments: InstallmentPlanRepository },
  payment: LoanPayment & { transactionId: string }
): Promise<InstallmentPlan | null> {
  const plans = await deps.installments.listActiveByAccount(
    payment.accountId,
    "loan"
  )
  const plan = pickLoanPlanFor(payment, plans)
  if (!plan) return null
  const item = itemForPayment(plan, payment)
  if (!item) return null
  const adopted = await deps.installments.adoptTransaction(
    plan,
    item.id,
    payment.transactionId
  )
  if (!adopted) return null
  await closeIfComplete(deps, plan, item, payment.date)
  return plan
}

// --- Asignación manual de un movimiento existente ---

/**
 * Asigna a una cuota un movimiento que YA existe. Es la contraparte manual de `adoptLoanInstallment`
 * para cuando el enganche automático no ocurrió: el pago quedó ambiguo entre dos planes, el plan se
 * creó después de que llegara el cargo, o la descripción del banco no encajó.
 *
 * Nunca crea un movimiento: por eso es la acción correcta en un plan `loan`, donde el gasto real ya
 * está registrado y fabricar otro lo contaría dos veces.
 *
 * No se exige que el movimiento sea de la misma cuenta del plan: una cuota puede pagarse desde otra
 * cuenta, y aquí el usuario está afirmando la relación explícitamente.
 */
export async function linkTransactionToItem(
  deps: { installments: InstallmentPlanRepository; transactions: TransactionRepository },
  userId: string,
  input: { planId: string; itemId: string; transactionId: string }
): Promise<InstallmentPlan> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const item = plan.items.find((i) => i.id === input.itemId)
  if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
  if (isSettled(item)) throw new InstallmentItemAlreadySettledError()

  const tx = await deps.transactions.findById(input.transactionId)
  if (!tx) throw new InstallmentPlanNotFoundError(input.transactionId)
  if (tx.userId !== userId) throw new NotOwnerError()
  if (tx.installmentItemId)
    throw new InvalidInstallmentPlanError(
      "Ese movimiento ya está asignado a otra cuota"
    )
  if (tx.direction !== "debit")
    throw new InvalidInstallmentPlanError("Una cuota es un gasto, no un ingreso")

  await deps.installments.adoptTransaction(plan, item.id, tx.id)
  await closeIfComplete(deps, plan, item, tx.date)
  return (await deps.installments.findById(plan.id)) ?? plan
}

/**
 * Suelta el movimiento de una cuota: vuelve a ser un gasto normal y la cuota, pendiente. Sin esta
 * vuelta atrás una asignación equivocada sería definitiva, y la única salida borrar el plan entero.
 */
export async function unlinkTransactionFromItem(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  input: { planId: string; itemId: string }
): Promise<InstallmentPlan> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const item = plan.items.find((i) => i.id === input.itemId)
  if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
  if (item.transactionId)
    await deps.installments.unlinkTransaction(item.transactionId)
  // Reabrir una cuota reabre el plan: si estaba cerrado, vuelve a esperar pagos.
  if (plan.completedAt) await deps.installments.reopen(plan.id)
  return (await deps.installments.findById(plan.id)) ?? plan
}

/** Movimientos que el usuario puede asignar a una cuota, ordenados por cercanía al vencimiento. */
export async function listLinkCandidates(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  around: Date,
  accountId?: string
): Promise<LinkCandidate[]> {
  return deps.installments.listLinkCandidates(userId, around, accountId)
}

// --- Marca manual ---

/**
 * CREA el movimiento de una cuota cuyo pago no dejó rastro en la app: pagaste desde otro banco o el
 * aviso nunca llegó. Sin esta salida un único pago no notificado bloquearía el plan para siempre.
 *
 * Ojo: si el movimiento SÍ existe, lo correcto es `linkTransactionToItem`. Crear uno aquí sumaría
 * un gasto que ya estaba contado.
 */
export async function payInstallmentManually(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  input: { planId: string; itemId: string; date: Date; amount: number }
): Promise<InstallmentPlan> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const item = plan.items.find((i) => i.id === input.itemId)
  if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
  if (isSettled(item)) throw new InstallmentItemAlreadySettledError()

  await deps.installments.registerItemTransaction(
    plan,
    item.id,
    input.date,
    Money.of(input.amount, plan.currency)
  )
  await closeIfComplete(deps, plan, item, input.date)
  return (await deps.installments.findById(plan.id)) ?? plan
}

// --- Edición y borrado ---

export async function updateInstallmentItem(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  input: { planId: string; itemId: string; dueDate: Date; amount: number }
): Promise<InstallmentPlan> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const item = plan.items.find((i) => i.id === input.itemId)
  if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
  // Una cuota registrada es historia: su movimiento ya vivió su mes.
  if (isSettled(item)) throw new InstallmentItemAlreadySettledError()

  const amount = Money.of(input.amount, plan.currency)
  if (requiresExactSplit(plan.kind)) {
    const next = plan.items.map((i) => (i.id === item.id ? amount : i.amount))
    if (!splitMatchesTotal(plan.totalAmount, next))
      throw new InstallmentSplitMismatchError()
  }
  await deps.installments.updateItem(item.id, input.dueDate, amount)
  return (await deps.installments.findById(plan.id)) ?? plan
}

export async function deleteInstallmentPlan(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  id: string
): Promise<{ ok: true }> {
  const plan = await deps.installments.findById(id)
  if (!plan) throw new InstallmentPlanNotFoundError(id)
  if (plan.userId !== userId) throw new NotOwnerError()
  await deps.installments.delete(id)
  return { ok: true }
}

// El plan que acaba de saldar su última cuota se cierra y deja de esperar pagos. Se evalúa sobre
// una copia con el ítem ya saldado: el `plan` en memoria es anterior a la escritura.
async function closeIfComplete(
  deps: { installments: InstallmentPlanRepository },
  plan: InstallmentPlan,
  settled: InstallmentItem,
  at: Date
): Promise<void> {
  const after = {
    ...plan,
    items: plan.items.map((i) =>
      i.id === settled.id ? { ...i, transactionId: "settled" } : i
    ),
  }
  if (isComplete(after)) await deps.installments.markCompleted(plan.id, at)
}
