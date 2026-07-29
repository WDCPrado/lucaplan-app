import type {
  MonthlyBudgetRepository,
  Transaction,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
import type { BudgetAlertRepository } from "../../domain/notifications/budget-alert.domain.ts"
import { effectiveGlobalLimit } from "../finance-use-cases/budget-formulas.ts"
import {
  budgetAlertMessage,
  newMovementsMessage,
  type NotifiableMovement,
} from "./notification-rules.ts"
import { sendPushToUser, type PushDeps } from "./push-use-cases.ts"

export type NotifyImportedDeps = PushDeps & {
  transactions: Pick<TransactionRepository, "listByUserPeriod">
  monthlyBudgets: Pick<MonthlyBudgetRepository, "listByUser">
  budgetAlerts: Pick<BudgetAlertRepository, "list">
}

/**
 * Gasto que cuenta para el presupuesto: mismo criterio que el resumen y el medidor de la UI —
 * SOLO con categoría. Un movimiento sin clasificar no gasta nada hasta que se clasifica (por eso
 * categorizarlo puede cruzar un umbral).
 */
function countsForBudget(t: Transaction, currency: string): boolean {
  return (
    t.categoryId !== null &&
    t.direction === "debit" &&
    t.status === "confirmed" &&
    !t.isInternal &&
    t.amount.currency === currency
  )
}

/**
 * Evalúa el cruce de umbral del mes y notifica si corresponde. `justEntered` marca los movimientos
 * que ACABAN de entrar al presupuesto (importados, o recién categorizados): el gasto de "antes" se
 * deriva excluyéndolos, así el cruce se detecta sin guardar estado de "avisos ya enviados".
 */
export async function notifyBudgetCrossing(
  deps: NotifyImportedDeps,
  userId: string,
  year: number,
  month: number,
  justEntered: (t: Transaction) => boolean
): Promise<void> {
  const limit = effectiveGlobalLimit(
    await deps.monthlyBudgets.listByUser(userId),
    year,
    month
  )
  if (!limit || limit.isZero) return
  // Umbrales configurables (Configuración → Alertas de presupuesto). Sin ninguno, no se alerta.
  const percents = (await deps.budgetAlerts.list()).map((a) => a.percent)
  if (percents.length === 0) return

  const txs = (await deps.transactions.listByUserPeriod(userId, year, month))
    .filter((t) => countsForBudget(t, limit.currency))
  const sum = (list: Transaction[]) =>
    list.reduce((total, t) => total + t.amount.toMajor(), 0)
  const usedAfter = sum(txs)
  const usedBefore = sum(txs.filter((t) => !justEntered(t)))

  const alert = budgetAlertMessage(
    usedBefore,
    usedAfter,
    limit.toMajor(),
    percents,
    limit.currency
  )
  if (alert) await sendPushToUser(deps, userId, alert)
}

/**
 * Avisa de los movimientos que ENTRARON SOLOS (correo del banco) y, si con ellos el gasto del mes
 * cruza un umbral, del presupuesto. Los movimientos manuales no notifican: el usuario acaba de
 * crearlos y ve el resultado en pantalla.
 *
 * Del lote solo pesan en el presupuesto los que quedaron CON categoría (la IA corre antes de
 * notificar); los que no, alertarán cuando el usuario los clasifique.
 */
export async function notifyImportedMovements(
  deps: NotifyImportedDeps,
  userId: string,
  movements: NotifiableMovement[],
  now = new Date()
): Promise<void> {
  const message = newMovementsMessage(movements)
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
