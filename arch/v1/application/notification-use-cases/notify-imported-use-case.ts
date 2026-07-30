import type {
  CategoryRepository,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import type { BudgetAlertRepository } from "../../domain/notifications/budget-alert.domain.ts"
import { effectiveLimit } from "../finance-use-cases/budget-formulas.ts"
import {
  budgetAlertMessage,
  newMovementsMessage,
  type NotifiableMovement,
} from "./notification-rules.ts"
import { sendPushToUser, type PushDeps } from "./push-use-cases.ts"

export type NotifyImportedDeps = PushDeps & {
  transactions: Pick<TransactionRepository, "listByUserPeriod">
  categories: Pick<CategoryRepository, "listByUser" | "listLimitsByUser">
  budgetAlerts: Pick<BudgetAlertRepository, "list">
}

/**
 * Gasto que cuenta para el presupuesto: mismo criterio que el resumen y el medidor de la UI —
 * SOLO con categoría. Un movimiento sin clasificar no gasta nada hasta que se clasifica (por eso
 * categorizarlo puede cruzar un umbral).
 */
function countsForBudget(t: Transaction): boolean {
  return (
    t.categoryId !== null &&
    t.direction === "debit" &&
    t.status === "confirmed" &&
    !t.isInternal
  )
}

/**
 * Evalúa el cruce de umbral en el presupuesto de CADA categoría tocada y notifica las que cruzan.
 * Los umbrales configurados son los mismos para todas; lo que cambia es el límite contra el que se
 * miden. `justEntered` marca los movimientos que ACABAN de entrar a su categoría (importados, o
 * recién categorizados): el gasto de "antes" se deriva excluyéndolos, así el cruce se detecta sin
 * guardar estado de "avisos ya enviados".
 *
 * Las categorías que no tocó ese cambio no se revisan: su gasto no se movió, no hay cruce posible.
 */
export async function notifyBudgetCrossing(
  deps: NotifyImportedDeps,
  userId: string,
  year: number,
  month: number,
  justEntered: (t: Transaction) => boolean
): Promise<void> {
  // Umbrales configurables (Configuración → Alertas de presupuesto). Sin ninguno, no se alerta.
  const percents = (await deps.budgetAlerts.list()).map((a) => a.percent)
  if (percents.length === 0) return

  const txs = (
    await deps.transactions.listByUserPeriod(userId, year, month)
  ).filter(countsForBudget)
  const touched = new Set(
    txs.filter(justEntered).map((t) => t.categoryId as string)
  )
  if (touched.size === 0) return

  const [categories, limits] = await Promise.all([
    deps.categories.listByUser(userId),
    deps.categories.listLimitsByUser(userId),
  ])
  const sum = (list: Transaction[]) =>
    list.reduce((total, t) => total + t.amount.toMajor(), 0)

  for (const categoryId of touched) {
    const category = categories.find((c) => c.id === categoryId)
    if (!category || category.type !== "expense") continue
    const limit = effectiveLimit(limits, categoryId, year, month)
    if (limit.isZero) continue // sin límite no hay porcentaje que cruzar
    const own = txs.filter(
      (t) => t.categoryId === categoryId && t.amount.currency === limit.currency
    )
    const alert = budgetAlertMessage(
      category,
      sum(own.filter((t) => !justEntered(t))),
      sum(own),
      limit.toMajor(),
      percents,
      limit.currency
    )
    if (alert) await sendPushToUser(deps, userId, alert)
  }
}

/**
 * Datos del movimiento YA persistido que el aviso necesita: su id (para enlazar directo a su modal)
 * y el nombre de la categoría que le quedó. Se busca por el id del banco entre los movimientos del
 * mes; uno cuya fecha caiga fuera (una compra de fin del mes pasado que llega hoy) no aporta
 * ninguno de los dos y el aviso sale como antes.
 */
async function persisted(
  deps: NotifyImportedDeps,
  userId: string,
  year: number,
  month: number,
  movement: NotifiableMovement
): Promise<{ id?: string; category?: string }> {
  if (!movement.externalId) return {}
  const txs = await deps.transactions.listByUserPeriod(userId, year, month)
  const tx = txs.find((t) => t.externalId === movement.externalId)
  if (!tx) return {}
  if (!tx.categoryId) return { id: tx.id }
  const categories = await deps.categories.listByUser(userId)
  return {
    id: tx.id,
    category: categories.find((c) => c.id === tx.categoryId)?.name,
  }
}

/**
 * Avisa de los movimientos que ENTRARON SOLOS (correo del banco) y, si con ellos alguna categoría
 * cruza un umbral, de su presupuesto. Los movimientos manuales no notifican: el usuario acaba de
 * crearlos y ve el resultado en pantalla.
 *
 * Del lote solo pesan los que quedaron CON categoría (la IA corre antes de notificar); los que no,
 * alertarán cuando el usuario los clasifique.
 */
export async function notifyImportedMovements(
  deps: NotifyImportedDeps,
  userId: string,
  movements: NotifiableMovement[],
  now = new Date()
): Promise<void> {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  // Un solo movimiento se nombra: ahí valen la categoría que le puso la IA y el enlace directo a su
  // modal. Con varios el resumen no los lista, así que ni se consultan.
  const message = newMovementsMessage(
    movements.length === 1
      ? [
          {
            ...movements[0],
            ...(await persisted(deps, userId, year, month, movements[0])),
          },
        ]
      : movements
  )
  if (!message) return
  await sendPushToUser(deps, userId, message)

  const ids = new Set(
    movements.map((m) => m.externalId).filter((id) => id != null)
  )
  await notifyBudgetCrossing(
    deps,
    userId,
    now.getUTCFullYear(),
    now.getUTCMonth() + 1,
    (t) => t.externalId !== null && ids.has(t.externalId)
  )
}
