import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteInstallmentPlan,
  linkTransactionToItem,
  payInstallmentManually,
  unlinkTransactionFromItem,
  updateInstallmentItem,
} from "@/arch/v1/application/finance-use-cases/installment-use-cases"

// Cuatro acciones sobre una cuota del plan, según lo que traiga el cuerpo:
//  · `transactionId` → asignarle un movimiento que YA existe (no crea nada);
//  · `unlink: true`  → soltar el movimiento asignado y dejar la cuota pendiente;
//  · `paid: true`    → crear su movimiento, para cuando el pago no dejó rastro en la app;
//  · resto           → editar su vencimiento y monto (solo si aún no está registrada).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()
  const itemId = String(body.itemId)

  if (body.unlink === true)
    return withUser(req, (userId) =>
      unlinkTransactionFromItem(financeDeps, userId, { planId: id, itemId })
    )

  if (body.transactionId)
    return withUser(req, (userId) =>
      linkTransactionToItem(financeDeps, userId, {
        planId: id,
        itemId,
        transactionId: String(body.transactionId),
      })
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
