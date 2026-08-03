// Casos de uso de gastos recurrentes: CRUD de plantillas, materialización del comprometido del
// período y su confirmación cuando el cargo llega por correo. Depende solo de domain (+ ports).
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
  type MovementForMatch,
  type Periodicity,
  type RecurringTemplate,
  type RecurringTemplateRepository,
  InvalidRecurringTemplateError,
  RecurringTemplateEndedError,
  RecurringTemplateNotFoundError,
  executionDateFor,
  hasEnded,
  isValidTolerance,
  periodIsWithinValidity,
  periodKeyFor,
  pickTemplateFor,
  requiresDayOfMonth,
} from "../../domain/finance/recurring.domain.ts"
import { Money } from "../../domain/finance/money.ts"

type RecurringDeps = {
  recurring: RecurringTemplateRepository
  accounts: AccountRepository
  categories: CategoryRepository
}

export type RecurringInput = {
  accountId: string
  categoryId: string
  label: string // nombre visible; la clave de match (description) sale del movimiento de origen
  direction: "debit" | "credit"
  baseAmount: number
  tolerancePct: number
  periodicity: Periodicity
  dayOfMonth: number | null
  startDate: Date
  endDate: Date | null // null = indefinida
}

// Valida cuenta (si viene: existe, del usuario), categoría (existe, del usuario, del mismo lado que
// la dirección), tolerancia, día y monto. Devuelve el Money en la moneda de la cuenta (CLP sin cuenta).
async function validateInput(
  deps: RecurringDeps,
  userId: string,
  input: RecurringInput
): Promise<{ account: Account; category: Category; money: Money }> {
  const account = await deps.accounts.findById(input.accountId)
  if (!account) throw new AccountNotFoundError(input.accountId)
  if (account.userId !== userId) throw new NotOwnerError()

  const category = await deps.categories.findById(input.categoryId)
  if (!category) throw new CategoryNotFoundError(input.categoryId)
  if (category.userId !== userId) throw new NotOwnerError()
  // Misma regla de lado que la categorización: gasto ↔ expense, ingreso ↔ income.
  const expectedType = input.direction === "debit" ? "expense" : "income"
  if (category.type !== expectedType)
    throw new InvalidRecurringTemplateError(
      "La categoría debe ser del mismo lado que el movimiento"
    )

  if (!input.label.trim())
    throw new InvalidRecurringTemplateError("La recurrente necesita un nombre")
  if (!Number.isFinite(input.baseAmount) || input.baseAmount <= 0)
    throw new InvalidRecurringTemplateError("El monto base debe ser mayor que 0")
  if (!isValidTolerance(input.tolerancePct))
    throw new InvalidRecurringTemplateError("La tolerancia debe estar entre 0 y 100")
  if (
    requiresDayOfMonth(input.periodicity) &&
    (input.dayOfMonth === null ||
      !Number.isInteger(input.dayOfMonth) ||
      input.dayOfMonth < 1 ||
      input.dayOfMonth > 31)
  )
    throw new InvalidRecurringTemplateError("El día debe estar entre 1 y 31")
  if (input.endDate && input.endDate < input.startDate)
    throw new InvalidRecurringTemplateError(
      "La fecha de término no puede ser anterior al inicio"
    )

  return {
    account,
    category,
    money: Money.of(input.baseAmount, account.currency),
  }
}

export async function listRecurringTemplates(
  deps: { recurring: RecurringTemplateRepository },
  userId: string
): Promise<RecurringTemplate[]> {
  return deps.recurring.listByUser(userId)
}

export async function createRecurringTemplate(
  deps: RecurringDeps & { transactions: TransactionRepository },
  userId: string,
  // `sourceTransactionId` es OBLIGATORIO: una recurrente solo nace de un movimiento real. De ahí
  // sale la CLAVE de match (`description` = descripción del cargo real, inmutable) y el movimiento
  // queda vinculado como la ejecución de SU período (si no, quedaría huérfano y el período volvería
  // a materializar un comprometido por un gasto ya cobrado). `label` sí lo elige el usuario.
  input: RecurringInput & { sourceTransactionId?: string | null }
): Promise<RecurringTemplate> {
  const { money } = await validateInput(deps, userId, input)

  if (!input.sourceTransactionId)
    throw new InvalidRecurringTemplateError(
      "Una recurrente solo se crea desde un movimiento existente"
    )
  const source = await deps.transactions.findById(input.sourceTransactionId)
  if (!source || source.userId !== userId)
    throw new InvalidRecurringTemplateError(
      "El movimiento de origen no existe o no es tuyo"
    )

  const template = await deps.recurring.create({
    userId,
    accountId: input.accountId,
    categoryId: input.categoryId,
    label: input.label.trim(),
    description: source.description, // clave de match: el texto real del cargo, sin editar
    direction: input.direction,
    baseAmount: money,
    tolerancePct: input.tolerancePct,
    periodicity: input.periodicity,
    dayOfMonth: input.dayOfMonth,
    startDate: input.startDate,
    endDate: input.endDate,
  })

  await deps.recurring.attachImportedMovement(
    source.id,
    template,
    periodKeyFor(template, source.date)
  )
  return template
}

export async function updateRecurringTemplate(
  deps: RecurringDeps,
  userId: string,
  input: RecurringInput & { id: string; isActive: boolean }
): Promise<RecurringTemplate> {
  const existing = await deps.recurring.findById(input.id)
  if (!existing) throw new RecurringTemplateNotFoundError(input.id)
  if (existing.userId !== userId) throw new NotOwnerError()
  const { money } = await validateInput(deps, userId, input)
  // La clave de match (`description`) no se toca: el update ni la recibe.
  const updated = await deps.recurring.update({
    id: input.id,
    accountId: input.accountId,
    categoryId: input.categoryId,
    label: input.label.trim(),
    direction: input.direction,
    baseAmount: money,
    tolerancePct: input.tolerancePct,
    periodicity: input.periodicity,
    dayOfMonth: input.dayOfMonth,
    startDate: input.startDate,
    endDate: input.endDate,
    isActive: input.isActive,
  })
  // Acortar la vigencia deja comprometidos de períodos que ya no existen: se retiran aquí, o
  // seguirían apareciendo como "Por cobrar" y sumando al comprometido del mes.
  await deps.recurring.dropCommittedOutsideValidity(updated)
  return updated
}

// Pausar/reanudar: no toca el resto de la plantilla. Pausada NO materializa ni confirma períodos
// nuevos; lo ya confirmado se conserva.
export async function setRecurringActive(
  deps: { recurring: RecurringTemplateRepository },
  userId: string,
  input: { id: string; isActive: boolean },
  today = new Date()
): Promise<RecurringTemplate> {
  const existing = await deps.recurring.findById(input.id)
  if (!existing) throw new RecurringTemplateNotFoundError(input.id)
  if (existing.userId !== userId) throw new NotOwnerError()
  // Terminada = no se reactiva sola; hay que correr su fecha de fin primero.
  if (input.isActive && hasEnded(existing, today))
    throw new RecurringTemplateEndedError()
  return deps.recurring.update({ ...existing, isActive: input.isActive })
}

export async function deleteRecurringTemplate(
  deps: { recurring: RecurringTemplateRepository },
  userId: string,
  id: string
): Promise<{ ok: true }> {
  const existing = await deps.recurring.findById(id)
  if (!existing) throw new RecurringTemplateNotFoundError(id)
  if (existing.userId !== userId) throw new NotOwnerError()
  await deps.recurring.delete(id)
  return { ok: true }
}

// --- Ejecución ---

/** Materializa el movimiento `pending` del período que contiene a `date`. Idempotente en el repo. */
export async function materializePeriod(
  deps: { recurring: RecurringTemplateRepository },
  template: RecurringTemplate,
  date: Date
): Promise<{ transactionId: string | null; created: boolean }> {
  const periodKey = periodKeyFor(template, date)
  const executionDate = executionDateFor(template, periodKey)
  // Fuera de vigencia (antes del inicio o pasado el fin): no se abre el período.
  if (!periodIsWithinValidity(template, executionDate))
    return { transactionId: null, created: false }
  return deps.recurring.materializePeriod(template, periodKey, executionDate)
}

/**
 * ¿Este movimiento recién importado es la ejecución de alguna plantilla? Si lo es, pasa a ser la
 * ejecución del período (categoría de la plantilla, vínculo, revisado) y consume el comprometido
 * `pending`. Devuelve la plantilla que lo reclamó; null si ninguna matchea o si el período ya
 * tenía ejecución confirmada (entonces el movimiento sigue el flujo normal de IA/triage).
 */
export async function confirmFromMovement(
  deps: { recurring: RecurringTemplateRepository },
  templates: RecurringTemplate[],
  movement: MovementForMatch & { id: string; date: Date }
): Promise<RecurringTemplate | null> {
  // Una plantilla terminada ya no reclama cargos posteriores a su fin.
  const vigentes = templates.filter((t) => !hasEnded(t, movement.date))
  const template = pickTemplateFor(movement, vigentes)
  if (!template) return null
  const periodKey = periodKeyFor(template, movement.date)
  const attached = await deps.recurring.attachImportedMovement(
    movement.id,
    template,
    periodKey
  )
  return attached ? template : null
}

/**
 * Abre los períodos de las plantillas activas de UN usuario para el mes (year, month): materializa
 * el comprometido que aún no exista. Idempotente (único de BD), así que puede llamarse en cada
 * carga de la vista.
 *
 * Existe porque el comprometido no puede depender solo del cron: si el runner no está configurado,
 * falla o el usuario abre un mes que el cron aún no alcanzó, el presupuesto mentiría por omisión.
 * Meses pasados NO se tocan: no se inventa historia hacia atrás.
 */
export async function materializeUserPeriods(
  deps: { recurring: RecurringTemplateRepository },
  userId: string,
  year: number,
  month: number,
  today = new Date()
): Promise<number> {
  const isPast =
    year < today.getFullYear() ||
    (year === today.getFullYear() && month < today.getMonth() + 1)
  if (isPast) return 0

  // Día de referencia del mes pedido: hoy si es el mes en curso, el día 1 si es un mes futuro.
  const isCurrent =
    year === today.getFullYear() && month === today.getMonth() + 1
  const reference = isCurrent ? today : new Date(year, month - 1, 1)

  const templates = await deps.recurring.listActiveByUser(userId)
  let materialized = 0
  for (const template of templates) {
    const { created } = await materializePeriod(deps, template, reference)
    if (created) materialized++
  }
  return materialized
}
