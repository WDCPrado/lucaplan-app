import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteInstallmentPlan,
  linkTransactionToItem,
  payInstallmentManually,
  setInstallmentPlanCategory,
  unlinkTransactionFromItem,
  updateInstallmentItem,
} from "@/arch/v1/application/finance-use-cases/installment-use-cases"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"

// Acciones sobre el plan o una de sus cuotas, según lo que traiga el cuerpo:
//  · `categoryId` (sin itemId) → recategorizar el plan COMPLETO (plan + todos sus movimientos);
//  · `transactionId` → asignarle a la cuota un movimiento que YA existe (no crea nada);
//  · `unlink: true`  → soltar el movimiento asignado y dejar la cuota pendiente;
//  · `paid: true`    → crear su movimiento, para cuando el pago no dejó rastro en la app;
//  · resto           → editar vencimiento y monto de la cuota (en card sincroniza su movimiento).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()

  if (body.categoryId !== undefined && body.itemId === undefined)
    return withUser(req, (userId) =>
      setInstallmentPlanCategory(financeDeps, userId, {
        planId: id,
        categoryId: String(body.categoryId),
      })
    )

  const itemId = String(body.itemId)

  if (body.unlink === true)
    return withUser(req, async (userId) =>
      (await followIncome(financeDeps, userId, () =>
        unlinkTransactionFromItem(financeDeps, userId, { planId: id, itemId }),
        { allModes: true }
      )).result
    )

  if (body.transactionId)
    return withUser(req, async (userId) =>
      (await followIncome(financeDeps, userId, () =>
        linkTransactionToItem(financeDeps, userId, { planId: id, itemId, transactionId: String(body.transactionId) }),
        { allModes: true }
      )).result
    )

  if (body.paid === true)
    return withUser(req, (userId) =>
      payInstallmentManually(financeDeps, userId, {
        planId: id,
        itemId,
        date: body.date ? new Date(body.date) : new Date(),
        amount: Number(body.amount),
      })
    )

  return withUser(req, (userId) =>
    updateInstallmentItem(financeDeps, userId, {
      planId: id,
      itemId,
      dueDate: new Date(body.dueDate),
      amount: Number(body.amount),
    })
  )
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, (userId) =>
    deleteInstallmentPlan(financeDeps, userId, id)
  )
}
