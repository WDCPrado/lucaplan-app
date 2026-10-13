import type { EscenaContext } from "../sembrar-usuario.ts"
import { todayKey } from "../../../arch/shared/today.ts"

export const correo = "cuotas-sin-correo@lucaplan.cl"
export const titulo = "Cuotas — generación sin correo"

export async function seed({ prisma, userId }: EscenaContext) {
  const today = new Date(`${todayKey()}T00:00:00Z`)
  const plans = await prisma.installmentPlan.findMany({ where: { userId } })
  for (const plan of plans) {
    const amount = plan.kind === "loan" ? 254156 : 50000
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 5))
    await prisma.installmentItem.deleteMany({ where: { planId: plan.id, plan: { userId } } })
    await prisma.installmentPlan.update({
      where: { id: plan.id, userId },
      data: {
        description: plan.kind === "loan" ? "QA Crédito consumo sin correo" : "QA Tarjeta sin cargo individual",
        totalAmount: amount * 3,
        installmentsCount: 3,
        startDate: start,
        completedAt: null,
        items: {
          create: Array.from({ length: 3 }, (_, i) => ({
            index: i + 1,
            amount,
            dueDate: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 5)),
            paidOutsideApp: false,
          })),
        },
      },
    })
  }
  console.log("[seed:pr] Cuotas sin correo: tarjeta $50.000 y consumo $254.156; tres cuotas pendientes por plan.")
}
