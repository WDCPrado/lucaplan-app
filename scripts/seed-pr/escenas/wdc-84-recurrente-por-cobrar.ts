// WDC-84 — marcar a mano el cobro de una recurrente que el banco todavía no avisa. Los tres
// estados de la fila se ven de una sola pasada, y son distintos entre sí a propósito: uno se puede
// marcar, otro se puede deshacer y el tercero no ofrece nada porque el cargo lo confirmó el banco.
//
// El usuario base ya trae las tres recurrentes; la escena solo les escribe el movimiento del
// período en curso. Netflix se queda sin él justamente para que aparezca el botón.

import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-84@lucaplan.cl"
export const titulo = "WDC-84 — cobro recurrente por marcar"

// [label de la recurrente, externalId del movimiento del período]
// `null` = lo confirmó el usuario a mano (sin id del banco): es lo único que se puede deshacer.
const PERIODO: [string, string | null][] = [
  ["Spotify", null],
  ["Internet hogar", "wdc-84-internet-hogar"],
]

export async function seed({ prisma, userId }: EscenaContext) {
  // UTC como el resto del seed: las fechas de movimiento son días civiles (@db.Date).
  const ahora = new Date()
  const year = ahora.getUTCFullYear()
  const month = ahora.getUTCMonth() + 1
  const periodKey = `${year}-${String(month).padStart(2, "0")}`

  for (const [label, externalId] of PERIODO) {
    const plantilla = await prisma.recurringTemplate.findFirst({
      where: { userId, label },
    })
    if (!plantilla) throw new Error(`no existe la recurrente "${label}"`)

    // Re-siembra: el único (plantilla, período) rebotaría el create de la corrida anterior.
    await prisma.transaction.deleteMany({
      where: { userId, recurringTemplateId: plantilla.id, periodKey },
    })

    const ultimoDia = new Date(Date.UTC(year, month, 0)).getUTCDate()
    await prisma.transaction.create({
      data: {
        userId,
        accountId: plantilla.accountId,
        categoryId: plantilla.categoryId,
        recurringTemplateId: plantilla.id,
        periodKey,
        transactionDate: new Date(
          Date.UTC(year, month - 1, Math.min(plantilla.dayOfMonth ?? 1, ultimoDia))
        ),
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

  console.log(
    `[seed:pr] WDC-84: en /recurring, Netflix se puede marcar como pagado, Spotify se puede ` +
      `deshacer (lo marcó el usuario) e Internet hogar no ofrece nada (lo cobró el banco).`
  )
}
