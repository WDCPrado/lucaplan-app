// WDC-85 — el ritmo de gasto se puede apagar por categoría. Con todas encendidas la feature no se
// ve: hay que poder comparar dos tarjetas lado a lado, una con la línea de ritmo y otra sin ella.
//
// Suscripciones llega con el ritmo APAGADO (es justo el caso que lo motiva: se cobra un día del
// mes, no de a poco) y Supermercado lo conserva. Las dos reciben un cargo de HOY para que ambas
// tengan gasto del período en curso y la única diferencia visible sea la línea.

import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-85@lucaplan.cl"
export const titulo = "WDC-85 — ritmo de gasto por categoría"

// [categoría, ritmo, monto del cargo de hoy, glosa]
const CARGOS: [string, boolean, number, string][] = [
  ["Suscripciones", false, 38000, "Pago:netflix.com anual"],
  ["Supermercado", true, 95000, "Pago:jumbo costanera"],
]

export async function seed({
  prisma,
  userId,
  checkingId,
  categoryId,
}: EscenaContext) {
  // UTC como el resto del seed: las fechas de movimiento son días civiles (@db.Date).
  const ahora = new Date()
  const hoy = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())
  )

  for (const [nombre, paceEnabled, monto, glosa] of CARGOS) {
    const catId = categoryId.get(nombre)
    if (!catId) throw new Error(`no existe la categoría "${nombre}"`)

    await prisma.category.update({
      where: { id: catId },
      data: { paceEnabled },
    })

    // Re-siembra: el cargo de la corrida anterior se reemplaza, no se acumula.
    await prisma.transaction.deleteMany({
      where: { userId, categoryId: catId, description: glosa },
    })
    await prisma.transaction.create({
      data: {
        userId,
        accountId: checkingId,
        categoryId: catId,
        transactionDate: hoy,
        description: glosa,
        amount: monto,
        currency: "CLP",
        direction: "debit",
        reviewed: true,
      },
    })
  }

  console.log(
    `[seed:pr] WDC-85: en el inicio, Supermercado muestra su línea de ritmo y Suscripciones no, ` +
      `aunque las dos tienen un gasto de hoy. El interruptor está en el modal de la categoría.`
  )
}
