// WDC-107 — el presupuesto puede seguir el ciclo de facturación de la tarjeta. La feature se ve en
// los movimientos que quedan a los dos lados de un cierre: el del día del cierre es del mes que ese
// cierre factura, y el del día siguiente ya es del mes que viene.
//
// El modo NO se fija acá: vive en `app_setting`, que es GLOBAL, así que activarlo desde una escena
// cambiaría el presupuesto de todos los usuarios demo del entorno (y sus guiones). El QA lo prende
// con el switch del Inicio.
//
// Se usa el último cierre que ya pasó (estimado, sin corrección): así los dos cargos son de días
// que ya ocurrieron, corra el seed el día que corra.

import type { EscenaContext } from "../sembrar-usuario.ts"
import {
  estimateClosing,
  periodOfDay,
} from "../../../arch/shared/billing-cycle.ts"

export const correo = "wdc-107@lucaplan.cl"
export const titulo = "WDC-107 — presupuesto por ciclo de tarjeta"

const CATEGORIA = "Compras"
const EL_DIA_DEL_CIERRE = { glosa: "Pago:ticketmaster chile", monto: 40000 }
const EL_DIA_SIGUIENTE = { glosa: "Pago:ripley costanera", monto: 70000 }

export async function seed({
  prisma,
  userId,
  creditCardId,
  categoryId,
}: EscenaContext) {
  // UTC como el resto del seed: las fechas de movimiento son días civiles (@db.Date).
  const hoy = new Date().toISOString().slice(0, 10)
  // El mes en curso en modo tarjeta empieza el día siguiente al cierre del mes anterior.
  const actual = periodOfDay(hoy, "card_cycle", {})
  const anterior =
    actual.month === 1
      ? { year: actual.year - 1, month: 12 }
      : { year: actual.year, month: actual.month - 1 }
  const cierre = estimateClosing(anterior.year, anterior.month)
  const siguiente = new Date(`${cierre}T00:00:00Z`)
  siguiente.setUTCDate(siguiente.getUTCDate() + 1)

  const catId = categoryId.get(CATEGORIA)
  if (!catId) throw new Error(`no existe la categoría "${CATEGORIA}"`)

  for (const [cargo, fecha] of [
    [EL_DIA_DEL_CIERRE, new Date(`${cierre}T00:00:00Z`)],
    [EL_DIA_SIGUIENTE, siguiente],
  ] as const) {
    // Re-siembra: el cargo de la corrida anterior se reemplaza, no se acumula.
    await prisma.transaction.deleteMany({
      where: { userId, description: cargo.glosa },
    })
    await prisma.transaction.create({
      data: {
        userId,
        accountId: creditCardId,
        categoryId: catId,
        transactionDate: fecha,
        description: cargo.glosa,
        amount: cargo.monto,
        currency: "CLP",
        direction: "debit",
        reviewed: true,
      },
    })
  }

  console.log(
    `[seed:pr] WDC-107: cierre estimado ${cierre}. Con el switch en "tarjeta de crédito", ` +
      `"${EL_DIA_DEL_CIERRE.glosa}" ($${EL_DIA_DEL_CIERRE.monto}) queda en ${anterior.month}/${anterior.year} ` +
      `y "${EL_DIA_SIGUIENTE.glosa}" ($${EL_DIA_SIGUIENTE.monto}) en ${actual.month}/${actual.year}.`
  )
}
