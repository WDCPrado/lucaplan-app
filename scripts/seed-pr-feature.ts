// Datos EXTRA del PR actual: lo que la feature de esta rama necesita para poder probarse y que el
// seed base (scripts/seed-pr.ts) no siembra. Lo corre el seed base al final de la primera siembra,
// con el usuario demo ya creado, y solo en entornos de PR de Railway.
//
// SE REESCRIBE COMPLETO EN CADA FEATURE, antes de abrir el PR. El contenido pertenece al PR en
// curso, no al repo: si tu cambio no necesita datos propios, déjalo como está (no-op).
//
// Reglas al escribirlo:
//   - Solo la data mínima de la feature y sus dependencias. Usuario, cuentas, categorías,
//     presupuesto, movimientos, recurrentes y planes de cuotas ya vienen del seed base: tómalos
//     del ctx en vez de crear otros.
//   - Nada de datos reales ni secretos: el entorno de PR es público.
//   - Si falla, el seed base lo registra y sigue (no tumba el deploy), pero la feature queda sin
//     datos. Pruébalo antes con `SEED_PR_FORCE=1 pnpm seed:pr` contra una base local.

import type { FeatureSeedContext } from "./seed-pr.ts" // solo el tipo: no ejecuta el seed base

// WDC-74 — el plan del mes descuenta lo que el mes ANTERIOR gastó por sobre su presupuesto. El
// seed base deja ese mes muy por debajo del suyo (límite $950.000 contra ~$265.000 gastados), así
// que sin esto la deuda es 0 y la feature no se ve por ninguna parte.
//
// Se fija la DEUDA, no el gasto: se lee lo que el mes anterior lleva gastado con el mismo criterio
// del presupuesto (Σ usado de las categorías de GASTO —confirmado, no interno, en CLP—) y se carga
// un movimiento por la diferencia que falta para dejarlo exactamente en `límite global + DEUDA`.
// Así el monto es el mismo corra el seed el día que corra, que es lo que permite escribirlo en el
// guion de prueba. El límite se lee de la base en vez de duplicar acá el del seed base.
const DEUDA = 150000

// Un cargo grande y creíble explica solo por qué el mes se pasó; "Compras" es la categoría que le
// corresponde y ya viene del seed base.
const CATEGORIA = "Compras"
const GLOSA = "Pago:falabella refrigerador y lavadora"

export default async function seedFeature({
  prisma,
  userId,
  checkingId,
  categoryId,
}: FeatureSeedContext) {
  // Mes anterior en UTC, igual que el resto de la app (las fechas de movimiento son días civiles).
  const now = new Date()
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const year = prev.getUTCFullYear()
  const month = prev.getUTCMonth() + 1
  const desde = new Date(Date.UTC(year, month - 1, 1))
  const hasta = new Date(Date.UTC(year, month, 1))

  const presupuesto = await prisma.monthlyBudget.findUnique({
    where: { userId_year_month: { userId, year, month } },
  })
  // Sin límite global no hay de qué pasarse: la deuda sería 0 y el movimiento no probaría nada.
  if (!presupuesto) {
    console.log(
      `[seed:pr] WDC-74: el mes ${month}/${year} no tiene presupuesto — sin límite no hay deuda que mostrar.`
    )
    return
  }
  const limite = Number(presupuesto.globalLimit)

  const catId = categoryId.get(CATEGORIA)
  if (!catId) {
    console.log(`[seed:pr] WDC-74: no existe la categoría "${CATEGORIA}".`)
    return
  }

  // Gasto del mes con el mismo criterio que el presupuesto: débitos confirmados, no internos, en
  // CLP y de categorías de GASTO (un ingreso o un movimiento sin categoría no gastan).
  const gasto = await prisma.category.findMany({
    where: { userId, type: "expense" },
    select: { id: true },
  })
  const { _sum } = await prisma.transaction.aggregate({
    _sum: { amount: true },
    where: {
      userId,
      categoryId: { in: gasto.map((c) => c.id) },
      direction: "debit",
      status: "confirmed",
      isInternal: false,
      currency: "CLP",
      transactionDate: { gte: desde, lt: hasta },
    },
  })
  const falta = limite + DEUDA - Number(_sum.amount ?? 0)
  if (falta <= 0) {
    console.log(
      `[seed:pr] WDC-74: el mes ${month}/${year} ya venía más pasado que $${DEUDA} — no se toca.`
    )
    return
  }

  await prisma.transaction.create({
    data: {
      userId,
      accountId: checkingId,
      categoryId: catId,
      transactionDate: new Date(Date.UTC(year, month - 1, 15)),
      description: GLOSA,
      amount: falta,
      currency: "CLP",
      direction: "debit",
      reviewed: true,
    },
  })

  console.log(
    `[seed:pr] WDC-74: ${month}/${year} cerró $${DEUDA} sobre su presupuesto de $${limite} ` +
      `(cargo de $${falta} en "${CATEGORIA}"). El plan del mes actual debe ofrecer ese descuento (usuario ${userId}).`
  )
}
