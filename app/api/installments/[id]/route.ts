import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteInstallmentPlan,
  payInstallmentManually,
  updateInstallmentItem,
} from "@/arch/v1/application/finance-use-cases/installment-use-cases"

// Dos acciones sobre una cuota del plan, según lo que traiga el cuerpo:
//  · `paid: true` → registrarla a mano (el pago no llegó por correo);
//  · resto        → editar su vencimiento y monto (solo si aún no está registrada).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()
  const itemId = String(body.itemId)

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
