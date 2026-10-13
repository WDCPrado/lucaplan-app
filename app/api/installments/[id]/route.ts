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

import { listInstallmentsView } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { InstallmentPlan } from "@/arch/v1/domain/finance/installment.domain"

// Cada escritura devuelve la misma vista que consume el detalle, con estados y saldos reales.
// Así el modal puede aplicar el resultado sin esperar la recarga de la página.
function withUpdatedPlan(
  req: Request,
  mutate: (userId: string) => Promise<InstallmentPlan>
) {
  return withUser(req, async (userId) => {
    const updated = await mutate(userId)
    const plans = await listInstallmentsView(financeDeps, userId)
    const plan = plans.find((p) => p.id === updated.id)
    if (!plan) throw new Error("No se pudo leer el plan actualizado")
    return plan
  })
}

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
    return withUpdatedPlan(req, (userId) =>
      unlinkTransactionFromItem(financeDeps, userId, { planId: id, itemId })
    )

  if (body.transactionId)
    return withUpdatedPlan(req, (userId) =>
      linkTransactionToItem(financeDeps, userId, {
        planId: id,
        itemId,
        transactionId: String(body.transactionId),
      })
    )

  if (body.paid === true)
    return withUpdatedPlan(req, (userId) =>
      payInstallmentManually(financeDeps, userId, {
        planId: id,
        itemId,
        date: body.date ? new Date(body.date) : new Date(),
        amount: Number(body.amount),
      })
    )

  return withUpdatedPlan(req, (userId) =>
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
