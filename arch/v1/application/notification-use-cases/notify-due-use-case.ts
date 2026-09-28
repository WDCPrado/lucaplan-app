import type { TransactionRepository } from "../../domain/finance/finance.domain.ts"
import type { InstallmentPlanRepository } from "../../domain/finance/installment.domain.ts"
import { isSettled } from "../../domain/finance/installment.domain.ts"
import type { RecurringTemplateRepository } from "../../domain/finance/recurring.domain.ts"
import {
  executionDateFor,
  hasEnded,
  periodKeyFor,
} from "../../domain/finance/recurring.domain.ts"
import { dueSoonMessage, type DueItem } from "./notification-rules.ts"
import { periodRange } from "../../../shared/billing-cycle.ts"
import { sendPushToUser, type PushDeps } from "./push-use-cases.ts"

export type NotifyDueDeps = PushDeps & {
  recurring: Pick<RecurringTemplateRepository, "listActiveByUser">
  installments: Pick<InstallmentPlanRepository, "listByUser">
  transactions: Pick<TransactionRepository, "listByUserPeriod">
}

const DAY_MS = 86_400_000
const monthOf = (d: Date) => ({
  year: d.getUTCFullYear(),
  month: d.getUTCMonth() + 1,
})

/**
 * Pagos que vencen dentro de la ventana: cuotas de planes sin saldar y ejecuciones de plantillas
 * recurrentes vigentes que aún no se cobraron.
 *
 * La ventana puede cruzar de mes (lo típico: arriendo o suscripción que vence el día 1), así que
 * se miran los períodos de hoy y del último día de la ventana.
 */
export async function collectDueItems(
  deps: NotifyDueDeps,
  userId: string,
  now: Date,
  windowDays: number
): Promise<DueItem[]> {
  const end = new Date(now.getTime() + windowDays * DAY_MS)
  const inWindow = (d: Date) =>
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) >=
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) &&
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) <=
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())

  const items: DueItem[] = []

  // Cuotas: `dueUnsettledItems` filtra por mes calendario; aquí la ventana manda, así que se
  // filtra por fecha directamente sobre los ítems no saldados.
  const plans = await deps.installments.listByUser(userId)
  for (const plan of plans) {
    for (const item of plan.items) {
      if (isSettled(item) || !inWindow(item.dueDate)) continue
      items.push({
        description: `${plan.description} (cuota ${item.index}/${plan.installmentsCount})`,
        amount: item.amount.toMajor(),
        currency: item.amount.currency,
        dueDate: item.dueDate,
        kind: "installment",
      })
    }
  }

  // Recurrentes ya cobradas: se detectan por movimiento confirmado de la plantilla en el mes del
  // vencimiento. ponytail: en quincenales eso silencia el segundo aviso del mes; si molesta, hay
  // que exponer `periodKey` en el dominio de Transaction y comparar por período exacto.
  const templates = await deps.recurring.listActiveByUser(userId)
  if (templates.length === 0) return items

  const periods = [monthOf(now), monthOf(end)].filter(
    (p, i, all) =>
      i === all.findIndex((o) => o.year === p.year && o.month === p.month)
  )
  const movements = (
    await Promise.all(
      periods.map((p) =>
        // Mes CALENDARIO a propósito: el recordatorio mira días corridos, no el ciclo de la tarjeta.
        deps.transactions.listByUserPeriod(
          userId,
          periodRange(p.year, p.month, "calendar", {})
        )
      )
    )
  ).flat()
  const charged = new Set(
    movements
      .filter((t) => t.status === "confirmed" && t.recurringTemplateId)
      .map(
        (t) =>
          `${t.recurringTemplateId}:${t.date.getUTCFullYear()}-${t.date.getUTCMonth()}`
      )
  )

  for (const t of templates) {
    // Períodos que la ventana toca: el de hoy y el de su último día (pueden ser el mismo).
    const keys = [periodKeyFor(t, now), periodKeyFor(t, end)]
    for (const key of [...new Set(keys)]) {
      const dueDate = executionDateFor(t, key)
      if (!inWindow(dueDate) || hasEnded(t, dueDate)) continue
      const monthKey = `${t.id}:${dueDate.getUTCFullYear()}-${dueDate.getUTCMonth()}`
      if (charged.has(monthKey)) continue
      items.push({
        description: t.description,
        amount: t.baseAmount.toMajor(),
        currency: t.baseAmount.currency,
        dueDate,
        kind: "recurring",
      })
    }
  }
  return items
}

/** Recordatorio diario de vencimientos. Devuelve a cuántos dispositivos llegó (0 = nada que avisar). */
export async function notifyDueSoon(
  deps: NotifyDueDeps,
  userId: string,
  now = new Date(),
  windowDays = 2
): Promise<number> {
  const items = await collectDueItems(deps, userId, now, windowDays)
  const message = dueSoonMessage(items, now, windowDays)
  if (!message) return 0
  return sendPushToUser(deps, userId, message)
}
