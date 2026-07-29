import type {
  MonthlyBudgetRepository,
  TransactionRepository,
} from "../../domain/finance/finance.domain.ts"
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
}

/**
 * Avisa de los movimientos que ENTRARON SOLOS (correo del banco) y, si con ellos el gasto del mes
 * cruza un umbral, del presupuesto. Los movimientos manuales no notifican: el usuario acaba de
 * crearlos y ve el resultado en pantalla.
 *
 * `usedBefore` se deriva restando el lote al gasto del mes ya persistido — así el cruce de umbral
 * se detecta sin guardar estado de "avisos ya enviados".
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

  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const limit = effectiveGlobalLimit(
    await deps.monthlyBudgets.listByUser(userId),
    year,
    month
  )
  if (!limit || limit.isZero) return

  // Gasto del mes en la moneda del límite global (CLP): confirmado, no interno, dirección débito.
  const txs = await deps.transactions.listByUserPeriod(userId, year, month)
  const usedAfter = txs
    .filter(
      (t) =>
        t.direction === "debit" &&
        t.status === "confirmed" &&
        !t.isInternal &&
        t.amount.currency === limit.currency
    )
    .reduce((sum, t) => sum + t.amount.toMajor(), 0)
  const batch = movements
    .filter((m) => m.direction === "debit" && m.currency === limit.currency)
    .reduce((sum, m) => sum + m.amount, 0)

  const alert = budgetAlertMessage(
    usedAfter - batch,
    usedAfter,
    limit.toMajor(),
    limit.currency
  )
  if (alert) await sendPushToUser(deps, userId, alert)
}
