// WDC-74 — el plan del mes descuenta lo que el mes ANTERIOR gastó por sobre su presupuesto. Con el
// mes anterior cerrado dentro de su límite la deuda es 0 y la feature no se ve por ninguna parte.
//
// La escena es dueña de su usuario, así que no calcula nada: le reescribe el mes anterior con los
// dos números que quiere. La deuda es siempre $150.000 corra el seed el día que corra, que es lo
// que permite escribirla en el guion de prueba.

import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "wdc-74@lucaplan.cl"
export const titulo = "WDC-74 — mes anterior sobregirado"

const LIMITE = 500000
const GASTO = 650000 // deuda del mes anterior = GASTO − LIMITE = $150.000

// Un cargo grande y creíble explica solo por qué el mes se pasó; "Compras" es la categoría que le
// corresponde y ya viene del usuario sembrado.
const CATEGORIA = "Compras"
const GLOSA = "Pago:falabella refrigerador y lavadora"

export async function seed({
  prisma,
  userId,
  checkingId,
  categoryId,
}: EscenaContext) {
  // Mes anterior en UTC, igual que el resto de la app (las fechas de movimiento son días civiles).
  const ahora = new Date()
  const prev = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1)
  )
  const year = prev.getUTCFullYear()
  const month = prev.getUTCMonth() + 1
  const desde = new Date(Date.UTC(year, month - 1, 1))
  const hasta = new Date(Date.UTC(year, month, 1))

  const catId = categoryId.get(CATEGORIA)
  if (!catId) throw new Error(`no existe la categoría "${CATEGORIA}"`)

  // Fuera el gasto que trae el usuario sembrado: el mes anterior de este usuario es de la escena.
  // Los abonos (sueldo, transferencias) se quedan — no cuentan en el presupuesto de gasto y sin
  // ellos el mes se vería sin ingresos.
  await prisma.transaction.deleteMany({
    where: {
      userId,
      direction: "debit",
      transactionDate: { gte: desde, lt: hasta },
    },
  })

  await prisma.monthlyBudget.upsert({
    where: { userId_year_month: { userId, year, month } },
    update: { globalLimit: LIMITE },
    create: { userId, year, month, globalLimit: LIMITE },
  })

  await prisma.transaction.create({
    data: {
      userId,
      accountId: checkingId,
      categoryId: catId,
      transactionDate: new Date(Date.UTC(year, month - 1, 15)),
      description: GLOSA,
      amount: GASTO,
      currency: "CLP",
      direction: "debit",
      reviewed: true,
    },
  })

  console.log(
    `[seed:pr] WDC-74: ${month}/${year} gastó $${GASTO} contra un presupuesto de $${LIMITE} — ` +
      `el plan del mes actual debe ofrecer descontar los $${GASTO - LIMITE} de deuda.`
  )
}
