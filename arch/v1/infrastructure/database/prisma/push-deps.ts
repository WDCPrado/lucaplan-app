// Wiring de las notificaciones push: adapters listos para inyectar en los use-cases.
import {
  categoryRepository,
  transactionRepository,
} from "./finance.infrastructure.ts"
import { budgetAlertRepository } from "./budget-alert.infrastructure.ts"
import { dueReminderRepository } from "./due-reminder.infrastructure.ts"
import { installmentPlanRepository } from "./installment.infrastructure.ts"
import { recurringTemplateRepository } from "./recurring.infrastructure.ts"
import { pushSubscriptionRepository } from "./push.infrastructure.ts"
import { webpushSender } from "../../http/webpush/webpush.provider.ts"
import { prisma } from "./client.ts"
import { budgetPeriodRepository } from "./budget-period.infrastructure.ts"
import { currentBudgetPeriod } from "../../../application/finance-use-cases/budget-period-use-cases.ts"
import { inRange } from "../../../application/finance-use-cases/budget-formulas.ts"
import { todayKey } from "../../../../shared/today.ts"
import {
  notifyBudgetCrossing,
  notifyImportedMovements,
} from "../../../application/notification-use-cases/notify-imported-use-case.ts"
import { notifyDueSoon } from "../../../application/notification-use-cases/notify-due-use-case.ts"
import { getDueDays } from "../../../application/notification-use-cases/due-reminder-use-cases.ts"
import type { NotifiableMovement } from "../../../application/notification-use-cases/notification-rules.ts"
import type { Transaction } from "../../../domain/finance/finance.domain.ts"

export const pushDeps = {
  subscriptions: pushSubscriptionRepository,
  sender: webpushSender,
}

const notifyDeps = {
  ...pushDeps,
  transactions: transactionRepository,
  categories: categoryRepository,
  budgetAlerts: budgetAlertRepository,
  budgetPeriod: budgetPeriodRepository,
}

/** Deps del CRUD de umbrales (Configuración → Alertas de presupuesto). */
export const budgetAlertDeps = { budgetAlerts: budgetAlertRepository }

/** Deps de la anticipación del recordatorio de vencimientos (Configuración → Pagos por vencer). */
export const dueReminderDeps = { dueReminder: dueReminderRepository }

/** Deps del recordatorio de vencimientos (lo usa el cron `pnpm notify:due`). */
export const notifyDueDeps = {
  ...pushDeps,
  recurring: recurringTemplateRepository,
  installments: installmentPlanRepository,
}

/**
 * Una pasada del recordatorio de vencimientos sobre TODOS los usuarios con algún dispositivo
 * suscrito. La comparten el script `pnpm notify:due` y el endpoint `/api/cron/notify-due`: el
 * scheduler del despliegue elige cuál usar, la lógica es una sola.
 *
 * `windowDays` solo se pasa para pruebas puntuales; por defecto manda lo configurado en la app.
 */
export async function runDueReminders(
  windowDays?: number
): Promise<{ users: number; sent: number; windowDays: number }> {
  const days = windowDays ?? (await getDueDays(dueReminderDeps))
  const subscribed = await prisma.pushSubscription.findMany({
    distinct: ["userId"],
    select: { userId: true },
  })
  const now = new Date()
  let sent = 0
  for (const { userId } of subscribed)
    sent += await notifyDueSoon(notifyDueDeps, userId, now, days)
  return { users: subscribed.length, sent, windowDays: days }
}

/** Hook que el sync de correo invoca con los movimientos recién importados (best-effort). */
export function notifyImportedForSync(
  userId: string,
  movements: NotifiableMovement[]
): Promise<void> {
  return notifyImportedMovements(notifyDeps, userId, movements)
}

/**
 * Un movimiento recién categorizado entra al presupuesto de su mes: puede cruzar un umbral, así que
 * se evalúa igual que lo importado.
 *
 * SOLO el mes en curso: clasificar historial (el triage del onboarding importa 3 meses) no es un
 * gasto nuevo, es ordenar el pasado — avisar "superaste el presupuesto de mayo" sería ruido.
 */
export async function notifyBudgetForCategorized(
  userId: string,
  tx: Transaction
): Promise<void> {
  const current = await currentBudgetPeriod(notifyDeps, todayKey())
  if (!inRange(tx.date, current.range)) return
  return notifyBudgetCrossing(notifyDeps, userId, current, (t) => t.id === tx.id)
}
