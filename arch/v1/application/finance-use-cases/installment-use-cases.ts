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
  type Transaction,
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
  amountDistance,
  isComplete,
  isSettled,
  isValidTolerance,
  nextDueItem,
  pickLoanItemFor,
  requiresExactSplit,
  schedule,
  splitAmount,
  splitMatchesTotal,
  toleranceRange,
} from "../../domain/finance/installment.domain.ts"
import { Money } from "../../domain/finance/money.ts"
import { todayKey } from "../../../shared/today.ts"

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
  /**
   * Número que el BANCO le da a la primera cuota que este plan va a seguir. 1 = desde el principio.
   * En un crédito dado de alta a mitad ("vas en la 5 de 49") es 5: las cuotas 1–4 se crean ya
   * saldadas fuera de la app, y `totalAmount` es el SALDO —lo que falta pagar—, no el crédito
   * original.
   */
  startIndex?: number
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

  const startIndex = input.startIndex ?? 1
  if (
    !Number.isInteger(startIndex) ||
    startIndex < 1 ||
    startIndex > input.installmentsCount
  )
    throw new InvalidInstallmentPlanError(
      "La cuota inicial debe estar dentro del plan"
    )

  const dates = schedule(
    input.startDate,
    input.dayOfMonth,
    input.installmentsCount,
    startIndex
  )
  // El total es el SALDO: cubre solo las cuotas que este plan va a seguir. Las anteriores ya se
  // pagaron fuera de la app y no participan del reparto ni del saldo pendiente.
  const pendingCount = input.installmentsCount - startIndex + 1
  const pendingAmounts =
    input.amounts && input.amounts.length === pendingCount
      ? input.amounts.map((a) => Money.of(a, total.currency))
      : splitAmount(total, pendingCount)
  if (requiresExactSplit(input.kind) && !splitMatchesTotal(total, pendingAmounts))
    throw new InstallmentSplitMismatchError()

  const zero = Money.zero(total.currency)
  const amounts = dates.map((_, i) =>
    i + 1 < startIndex ? zero : pendingAmounts[i + 1 - startIndex]
  )

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

  // Las cuotas anteriores al desfase ocurrieron antes de que el plan existiera: cuentan para el
  // avance ("vas en la 5 de 49") pero no generan gasto en meses que el usuario nunca vio.
  const before = plan.items.filter((i) => i.index < startIndex).map((i) => i.id)
  if (before.length > 0) await deps.installments.markPaidOutsideApp(before)

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

// Para cada cuota marcada busca un pago ya importado de ESE mes que calce con ella: dentro de su
// tolerancia y no más cerca de la cuota pendiente de otro crédito activo de la cuenta (a igual
// distancia sí se toma). Sin pago que calce, la cuota queda pagada fuera de la app (cuenta para el
// avance, no genera gasto): adoptar el pago de otro crédito lo dejaría huérfano.
async function adoptOrMarkOutside(
  deps: { installments: InstallmentPlanRepository },
  userId: string,
  plan: InstallmentPlan,
  items: InstallmentItem[]
): Promise<void> {
  const [payments, active] = await Promise.all([
    deps.installments.listUnclaimedLoanPayments(userId, plan.accountId),
    deps.installments.listActiveByAccount(plan.accountId, "loan"),
  ])
  const others = active.filter((p) => p.id !== plan.id)
  const used = new Set<string>()
  const outside: string[] = []
  for (const item of items) {
    const { min, max } = toleranceRange(item.amount, plan.tolerancePct)
    const match = payments.find((p) => {
      if (
        used.has(p.transactionId) ||
        p.date.getFullYear() !== item.dueDate.getFullYear() ||
        p.date.getMonth() !== item.dueDate.getMonth() ||
        p.amount.currency !== plan.currency ||
        p.amount.compare(min) < 0 ||
        p.amount.compare(max) > 0
      )
        return false
      const own = amountDistance(p.amount, item.amount)
      return !others.some((o) => {
        const pending = nextDueItem(o, p.date)
        return (
          pending !== null &&
          o.currency === p.amount.currency &&
          amountDistance(p.amount, pending.amount) < own
        )
      })
    })
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
  const picked = pickLoanItemFor(payment, plans)
  if (!picked?.item) return null
  const { plan, item } = picked
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
 * cuenta, y aquí el usuario está afirmando la relación explícitamente. Sí se exige que sea un gasto
 * real en la moneda del plan (ver `assertCanPayItem`).
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
  assertCanPayItem(tx, plan)

  await deps.installments.adoptTransaction(plan, item.id, tx.id)
  await closeIfComplete(deps, plan, item, tx.date)
  return (await deps.installments.findById(plan.id)) ?? plan
}

// Un movimiento paga una cuota solo si es un gasto real en la moneda del plan: un ingreso, una
// transferencia entre cuentas propias o un cargo en otra moneda descuadrarían el saldo del plan.
function assertCanPayItem(tx: Transaction, plan: InstallmentPlan): void {
  if (tx.direction !== "debit")
    throw new InvalidInstallmentPlanError("Una cuota es un gasto, no un ingreso")
  if (tx.isInternal)
    throw new InvalidInstallmentPlanError(
      "Un movimiento interno (transferencia entre tus cuentas) no paga una cuota"
    )
  if (tx.amount.currency !== plan.currency)
    throw new InvalidInstallmentPlanError(
      `El movimiento está en otra moneda (${tx.amount.currency}) que el plan (${plan.currency})`
    )
}

/**
 * Mueve el pago de una cuota a otra —de este u otro plan— o, sin destino, lo suelta como gasto
 * normal. Es la corrección de un cargo que quedó en la cuota equivocada: el mismo movimiento cambia
 * de cuota y toma la categoría del plan destino; nunca se crea ni se borra un movimiento.
 *
 * Solo para planes `loan`: en `card` el movimiento de la cuota lo creó la app desde el cronograma,
 * no es un cargo del banco que haya quedado mal enganchado.
 *
 * Todo se valida antes de escribir. Soltar, reabrir el plan origen y vincular al destino ocurren en
 * una sola transacción del repo (`moveItemTransaction`): a medio camino el cargo no queda en ninguna
 * cuota. El cierre del plan destino, si con esto queda completo, es una escritura aparte.
 */
export async function moveInstallmentPayment(
  deps: { installments: InstallmentPlanRepository; transactions: TransactionRepository },
  userId: string,
  input: { planId: string; itemId: string; toPlanId?: string; toItemId?: string }
): Promise<InstallmentPlan> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const item = plan.items.find((i) => i.id === input.itemId)
  if (!item) throw new InstallmentPlanNotFoundError(input.itemId)
  if (plan.kind === "card")
    throw new InvalidInstallmentPlanError(
      "El pago de una cuota de tarjeta lo genera la app: no se mueve ni se suelta"
    )
  if (!item.transactionId)
    throw new InvalidInstallmentPlanError("Esa cuota no tiene un movimiento que mover")
  if (Boolean(input.toPlanId) !== Boolean(input.toItemId))
    throw new InvalidInstallmentPlanError(
      "El destino necesita el plan y la cuota, o ninguno de los dos"
    )

  let to: { plan: InstallmentPlan; item: InstallmentItem; paidAt: Date } | null = null
  if (input.toPlanId && input.toItemId) {
    const toPlan = await deps.installments.findById(input.toPlanId)
    if (!toPlan) throw new InstallmentPlanNotFoundError(input.toPlanId)
    if (toPlan.userId !== userId) throw new NotOwnerError()
    const toItem = toPlan.items.find((i) => i.id === input.toItemId)
    if (!toItem) throw new InstallmentPlanNotFoundError(input.toItemId)
    if (isSettled(toItem)) throw new InstallmentItemAlreadySettledError()
    const tx = await deps.transactions.findById(item.transactionId)
    if (!tx) throw new InstallmentPlanNotFoundError(item.transactionId)
    if (tx.userId !== userId) throw new NotOwnerError()
    assertCanPayItem(tx, toPlan)
    to = { plan: toPlan, item: toItem, paidAt: tx.date }
  }

  await deps.installments.moveItemTransaction(
    item.transactionId,
    to && { plan: to.plan, itemId: to.item.id },
    { plan, itemId: item.id }
  )
  // El repo ya reabrió el plan dentro de la transacción; esto es idempotente y deja el contrato
  // explícito para cualquier implementación del puerto.
  if (plan.completedAt) await deps.installments.reopen(plan.id)
  if (to) {
    // Si el destino es el mismo plan, la cuota origen ya quedó pendiente: el cierre debe verlo.
    const dest = {
      ...to.plan,
      items: to.plan.items.map((i) => (i.id === item.id ? { ...i, transactionId: null } : i)),
    }
    await closeIfComplete(deps, dest, to.item, to.paidAt)
  }
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
  // Una cuota futura es un compromiso, nunca un pago manual confirmado.
  // Comparar días civiles en Chile evita falsos positivos cerca de medianoche UTC.
  if (item.dueDate.toISOString().slice(0, 10) > todayKey())
    throw new InvalidInstallmentPlanError("No puedes generar una cuota que todavía no vence")
  if (input.date.toISOString().slice(0, 10) > todayKey())
    throw new InvalidInstallmentPlanError("No puedes registrar un pago con fecha futura")

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
  // En `loan` una cuota registrada es historia: su monto y fecha reales los fijó el correo. En
  // `card` el movimiento es un espejo del cronograma: editarla vale, y el repo lo sincroniza.
  if (plan.kind === "loan" && isSettled(item))
    throw new InstallmentItemAlreadySettledError()

  const amount = Money.of(input.amount, plan.currency)
  const updates: { itemId: string; dueDate?: Date; amount: Money }[] = [
    { itemId: item.id, dueDate: input.dueDate, amount },
  ]

  // En `card` el total es el capital de la compra y no se negocia: cambiar el monto de una cuota
  // redistribuye la diferencia entre las PENDIENTES restantes (partes iguales, resto en la
  // última, como al crear). Las ya saldadas no se tocan: su movimiento ya vivió su mes.
  // ponytail: el reparto uniforme pisa montos personalizados de las pendientes; si alguien
  // configura cuota a cuota y le molesta, el paso siguiente es repartir proporcional.
  if (requiresExactSplit(plan.kind) && amount.compare(item.amount) !== 0) {
    const pool = plan.items.filter((i) => i.id !== item.id && !isSettled(i))
    const fixed = plan.items
      .filter((i) => i.id !== item.id && isSettled(i))
      .reduce((sum, i) => sum.add(i.amount), Money.zero(plan.currency))
    const rest = plan.totalAmount.subtract(fixed).subtract(amount)

    if (pool.length === 0) {
      // No queda quién absorba la diferencia: el monto tiene que cuadrar solo.
      if (rest.minor !== BigInt(0)) throw new InstallmentSplitMismatchError()
    } else {
      // Cada pendiente debe quedar con al menos una unidad: una cuota de $0 no es una cuota.
      if (rest.minor < BigInt(pool.length))
        throw new InvalidInstallmentPlanError(
          "El monto no deja saldo suficiente para las cuotas pendientes"
        )
      const amounts = splitAmount(rest, pool.length)
      pool.forEach((i, idx) =>
        updates.push({ itemId: i.id, amount: amounts[idx] })
      )
    }
  }

  await deps.installments.updateItems(updates)
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
  // Sin cuotas registradas, borrar el plan deshace la transformación completa: la compra origen
  // se des-neutraliza y vuelve a contar como gasto en su mes. Con cuotas ya registradas no: parte
  // del gasto ya vive repartido y des-neutralizar lo contaría dos veces.
  // ponytail: en ese segundo caso el gasto aún no repartido se pierde con el plan; si molesta,
  // la salida es borrar también las cuotas creadas por el plan antes de des-neutralizar.
  const hasRegistered = plan.items.some((i) => i.transactionId !== null)
  await deps.installments.delete(
    id,
    plan.kind === "card" && !hasRegistered ? plan.sourceTransactionId : null
  )
  return { ok: true }
}

/**
 * Recategoriza el plan completo: el plan y todos sus movimientos (cuotas registradas y compra
 * origen). La categoría es UNA por plan; cambiarla desde cualquier punto cambia el conjunto.
 */
export async function setInstallmentPlanCategory(
  deps: {
    installments: InstallmentPlanRepository
    categories: CategoryRepository
  },
  userId: string,
  input: { planId: string; categoryId: string }
): Promise<{ ok: true }> {
  const plan = await deps.installments.findById(input.planId)
  if (!plan) throw new InstallmentPlanNotFoundError(input.planId)
  if (plan.userId !== userId) throw new NotOwnerError()
  const category = await deps.categories.findById(input.categoryId)
  if (!category) throw new CategoryNotFoundError(input.categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  if (category.type !== "expense")
    throw new InvalidInstallmentPlanError("Una deuda en cuotas es un gasto")
  await deps.installments.setCategory(plan.id, input.categoryId)
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
