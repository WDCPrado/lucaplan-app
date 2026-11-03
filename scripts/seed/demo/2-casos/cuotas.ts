// Cuotas de la cuenta demo: la cuota del Notebook (plan `card`) que venció el mes pasado queda sin
// saldar, así aparece en `cuotasPendientes` al conciliar la tarjeta y se salda con pagar_cuota.
import type { DemoContext } from "../1-base/cuenta-demo.ts"

export async function seed({
  prisma,
  userId,
  creditCardId,
  categoryId,
}: DemoContext) {
  const plan = await prisma.installmentPlan.findFirstOrThrow({
    where: { userId, kind: "card", accountId: creditCardId },
    include: {
      items: {
        where: { paidOutsideApp: true },
        orderBy: { index: "desc" },
        take: 1,
      },
    },
  })
  const vencida = plan.items[0]
  if (!vencida)
    throw new Error("el plan de tarjeta no tiene cuotas vencidas que reabrir")
  await prisma.installmentItem.update({
    where: { id: vencida.id },
    data: { paidOutsideApp: false },
  })

  // Avance con diferencia entre total estimado y documento bancario. Fechas del cronograma
  // un mes después de la facturación: la corrección de importes no debe desplazarlas.
  const now = new Date()
  const due = (offset: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 22))
  const advance = await prisma.installmentPlan.create({
    data: {
      userId,
      accountId: creditCardId,
      categoryId: categoryId.get("Compras")!,
      kind: "loan",
      description: "Avance demo por corregir",
      totalAmount: 335000,
      currency: "CLP",
      installmentsCount: 3,
      startDate: due(-2),
      dayOfMonth: 22,
      items: {
        create: [-2, -1, 0].map((offset, i) => ({
          index: i + 1,
          dueDate: due(offset),
          amount: 111627,
        })),
      },
    },
    include: { items: { orderBy: { index: "asc" } } },
  })
  for (const [i, amount] of [111666, 111627].entries()) {
    await prisma.transaction.create({
      data: {
        userId,
        accountId: creditCardId,
        categoryId: categoryId.get("Compras")!,
        installmentItemId: advance.items[i].id,
        description: `Avance demo · cuota ${i + 1}/3`,
        transactionDate: due(i - 3),
        amount,
        currency: "CLP",
        direction: "debit",
        status: "confirmed",
        reviewed: true,
      },
    })
  }
}
