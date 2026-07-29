// Wiring de las notificaciones push: adapters listos para inyectar en los use-cases.
import {
  monthlyBudgetRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { installmentPlanRepository } from "./installment.infrastructure.ts"
import { recurringTemplateRepository } from "./recurring.infrastructure.ts"
import { pushSubscriptionRepository } from "./push.infrastructure.ts"
import { webpushSender } from "../../http/webpush/webpush.provider.ts"
import { notifyImportedMovements } from "../../../application/notification-use-cases/notify-imported-use-case.ts"
import type { NotifiableMovement } from "../../../application/notification-use-cases/notification-rules.ts"

export const pushDeps = {
  subscriptions: pushSubscriptionRepository,
  sender: webpushSender,
}

const notifyDeps = {
  ...pushDeps,
  transactions: transactionRepository,
  monthlyBudgets: monthlyBudgetRepository,
}

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
