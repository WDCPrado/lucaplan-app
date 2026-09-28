import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteRecurringTemplate,
  payRecurringPeriodWith,
  setRecurringActive,
  setRecurringPeriodPaid,
  updateRecurringTemplate,
} from "@/arch/v1/application/finance-use-cases/recurring-use-cases"
import type { Periodicity } from "@/arch/v1/domain/finance/recurring.domain"

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()
  // Solo `isActive` = pausar/reanudar: no exige reenviar la plantilla completa.
  if (Object.keys(body).length === 1 && typeof body.isActive === "boolean")
    return withUser(req, (userId) =>
      setRecurringActive(financeDeps, userId, { id, isActive: body.isActive })
    )
  // Solo `periodPaid` = marcar (o deshacer) a mano el cobro del período en curso.
  if (Object.keys(body).length === 1 && typeof body.periodPaid === "boolean")
    return withUser(req, (userId) =>
      setRecurringPeriodPaid(financeDeps, userId, { id, paid: body.periodPaid })
    )
  // Solo `paidWithTransactionId` = usar un movimiento existente como el cobro del período en curso.
  if (
    Object.keys(body).length === 1 &&
    typeof body.paidWithTransactionId === "string"
  )
    return withUser(req, (userId) =>
      payRecurringPeriodWith(financeDeps, userId, {
        id,
        transactionId: body.paidWithTransactionId,
      })
    )
  return withUser(req, (userId) =>
    updateRecurringTemplate(financeDeps, userId, {
      id,
      accountId: String(body.accountId),
      categoryId: String(body.categoryId),
      label: String(body.label ?? ""),
      direction: body.direction === "credit" ? "credit" : "debit",
      baseAmount: Number(body.baseAmount),
      tolerancePct: Number(body.tolerancePct ?? 10),
      periodicity: (body.periodicity ?? "monthly") as Periodicity,
      dayOfMonth:
        body.dayOfMonth === null || body.dayOfMonth === undefined
          ? null
          : Number(body.dayOfMonth),
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      endDate: body.endDate ? new Date(body.endDate) : null,
      isActive: body.isActive ?? true,
    })
  )
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, (userId) =>
    deleteRecurringTemplate(financeDeps, userId, id)
  )
}
