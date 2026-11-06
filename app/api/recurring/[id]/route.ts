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
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"
import { recurringUrlSchema } from "@/lib/schemas/recurring-url"
import {
  InvalidRecurringUrlError,
  type Periodicity,
} from "@/arch/v1/domain/finance/recurring.domain"

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
    // Un abono que pasa a ser el cobro de una recurrente deja de ser ingreso adicional.
    return withUser(req, async (userId) =>
      (await followIncome(financeDeps, userId, () =>
        payRecurringPeriodWith(financeDeps, userId, { id, transactionId: body.paidWithTransactionId }),
        { allModes: true }
      )).result
    )
  return withUser(req, (userId) => {
    // Dentro de withUser: sin sesión es 401 antes de tocar el texto. `url` ausente no toca el
    // enlace guardado; null o "" lo borra.
    const url = recurringUrlSchema.safeParse(body.url)
    if (!url.success) throw new InvalidRecurringUrlError(url.error.issues[0]?.message ?? "")
    return updateRecurringTemplate(financeDeps, userId, {
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
      url: body.url === undefined ? undefined : url.data,
    })
  })
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
