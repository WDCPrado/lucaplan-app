// Wiring de las notificaciones push: adapters listos para inyectar en los use-cases.
import {
  monthlyBudgetRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { budgetAlertRepository } from "./budget-alert.infrastructure.ts"
import { installmentPlanRepository } from "./installment.infrastructure.ts"
import { recurringTemplateRepository } from "./recurring.infrastructure.ts"
import { pushSubscriptionRepository } from "./push.infrastructure.ts"
import { webpushSender } from "../../http/webpush/webpush.provider.ts"
import {
  notifyBudgetCrossing,
  notifyImportedMovements,
} from "../../../application/notification-use-cases/notify-imported-use-case.ts"
import type { NotifiableMovement } from "../../../application/notification-use-cases/notification-rules.ts"
import type { Transaction } from "../../../domain/finance/finance.domain.ts"

export const pushDeps = {
  subscriptions: pushSubscriptionRepository,
  sender: webpushSender,
}

const notifyDeps = {
  ...pushDeps,
  transactions: transactionRepository,
  monthlyBudgets: monthlyBudgetRepository,
  budgetAlerts: budgetAlertRepository,
}

/** Deps del CRUD de umbrales (Configuración → Alertas de presupuesto). */
export const budgetAlertDeps = { budgetAlerts: budgetAlertRepository }

/** Deps del recordatorio de vencimientos (lo usa el cron `pnpm notify:due`). */
export const notifyDueDeps = {
  ...pushDeps,
  transactions: transactionRepository,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
}

/** Hook que el sync de correo invoca con los movimientos recién importados (best-effort). */
export function notifyImportedForSync(
  userId: string,
  movements: NotifiableMovement[]
): Promise<void> {
  return notifyImportedMovements(notifyDeps, userId, movements)
}

/**
 * Un movimiento recién categorizado entra al presupuesto de SU mes: puede cruzar un umbral, así que
 * se evalúa igual que lo importado.
 */
export function notifyBudgetForCategorized(
  userId: string,
  tx: Transaction
): Promise<void> {
  return notifyBudgetCrossing(
    notifyDeps,
    userId,
    tx.date.getUTCFullYear(),
    tx.date.getUTCMonth() + 1,
    (t) => t.id === tx.id
  )
}
