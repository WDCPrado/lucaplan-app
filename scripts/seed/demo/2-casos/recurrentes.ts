// Recurrentes de la cuenta demo en sus tres estados del mes: Netflix sin cobro (se puede marcar
// «Ya lo pagué»), Spotify marcado a mano (se puede deshacer) e Internet hogar cobrado por el banco
// (no ofrece nada). El arriendo por cobrar de Vivienda lo siembra presupuesto.ts.
import type { DemoContext } from "../1-base/cuenta-demo.ts"

// [label, externalId del movimiento del período]; null = lo marcó el usuario a mano.
const PERIODO: [string, string | null][] = [
  ["Spotify", null],
  ["Internet hogar", "demo-internet-hogar"],
]

export async function seed({ prisma, userId }: DemoContext) {
  const ahora = new Date()
  const year = ahora.getUTCFullYear()
  const month = ahora.getUTCMonth() + 1
  const periodKey = `${year}-${String(month).padStart(2, "0")}`
  const ultimoDia = new Date(Date.UTC(year, month, 0)).getUTCDate()
  for (const [label, externalId] of PERIODO) {
    const plantilla = await prisma.recurringTemplate.findFirstOrThrow({ where: { userId, label } })
    await prisma.transaction.create({
      data: {
        userId,
        accountId: plantilla.accountId,
        categoryId: plantilla.categoryId,
        recurringTemplateId: plantilla.id,
        periodKey,
        transactionDate: new Date(Date.UTC(year, month - 1, Math.min(plantilla.dayOfMonth ?? 1, ultimoDia))),
        description: plantilla.label,
        amount: plantilla.baseAmount,
        currency: plantilla.currency,
        direction: plantilla.direction,
        status: "confirmed",
        reviewed: true,
        externalId,
      },
    })
  }
}
