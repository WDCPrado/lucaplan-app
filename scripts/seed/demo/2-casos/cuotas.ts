// Cuotas de la cuenta demo: la cuota del Notebook (plan `card`) que venció el mes pasado queda sin
// saldar, así aparece en `cuotasPendientes` al conciliar la tarjeta y se salda con pagar_cuota.
import type { DemoContext } from "../1-base/cuenta-demo.ts"

export async function seed({ prisma, userId, creditCardId }: DemoContext) {
  const plan = await prisma.installmentPlan.findFirstOrThrow({
    where: { userId, kind: "card", accountId: creditCardId },
    include: { items: { where: { paidOutsideApp: true }, orderBy: { index: "desc" }, take: 1 } },
  })
  const vencida = plan.items[0]
  if (!vencida) throw new Error("el plan de tarjeta no tiene cuotas vencidas que reabrir")
  await prisma.installmentItem.update({ where: { id: vencida.id }, data: { paidOutsideApp: false } })
}
