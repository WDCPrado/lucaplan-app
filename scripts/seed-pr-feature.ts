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

// WDC-73 — la banda de excedente necesita un mes con VARIAS categorías por sobre su tope y el
// presupuesto global todavía sin agotar: ese es el caso que hoy no se puede leer en el dashboard
// (te pasaste $68.120 de los topes, pero no debes $68.120). El seed base deja como mucho una
// categoría rozando el tope, y cuál depende del día en que corra.
//
// Los TOPES no se tocan: quedan los que siembra `seed-pr.ts`. Lo que se fija es el EXCESO, por
// diferencia: se lee lo que la categoría lleva gastado y se carga un movimiento que la deja
// exactamente en `tope + exceso`. Así los montos de la banda son los mismos corra el seed el día 1
// o el 28 —que es lo que permite escribir el guion de prueba— sin duplicar acá los topes del seed
// base, que se leen de la propia base.
//
// "Compras" entra a la lista aunque no haga falta para el caso: el seed base la deja sobre su tope
// o no según el día, y como quinta culpable con exceso fijo deja de ensuciar la suma.
const EXCESOS: [categoria: string, exceso: number, glosa: string][] = [
  ["Compras", 35000, "Pago:paris parque arauco"],
  ["Supermercado", 12480, "Pago:tottus la reina"],
  ["Cuentas", 8900, "Pago:gastos comunes edificio"],
  ["Suscripciones", 6500, "NETFLIX.COM"],
  ["Salud", 5240, "Pago:clinica alemana consulta"],
]

export default async function seedFeature({
  prisma,
  userId,
  checkingId,
  categoryId,
}: FeatureSeedContext) {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  // Mes en UTC, igual que el resto de la app (las fechas de movimiento son días civiles).
  const desde = new Date(Date.UTC(year, month - 1, 1))
  const hasta = new Date(Date.UTC(year, month, 1))

  for (const [nombre, exceso, glosa] of EXCESOS) {
    const catId = categoryId.get(nombre)
    if (!catId) continue
    const cap = await prisma.categoryLimit.findUnique({
      where: { categoryId_year_month: { categoryId: catId, year, month } },
    })
    if (!cap) continue // sin tope no hay de qué pasarse: esa categoría no participa
    const tope = Number(cap.limitAmount)
    // Mismo criterio que el uso por categoría del presupuesto: gasto confirmado, no interno.
    const { _sum } = await prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        categoryId: catId,
        direction: "debit",
        status: "confirmed",
        isInternal: false,
        currency: "CLP",
        transactionDate: { gte: desde, lt: hasta },
      },
    })
    const falta = tope + exceso - Number(_sum.amount ?? 0)
    if (falta <= 0) continue // ya venía más pasada que el exceso buscado: no se toca
    await prisma.transaction.create({
      data: {
        userId,
        accountId: checkingId,
        categoryId: catId,
        transactionDate: desde,
        description: glosa,
        amount: falta,
        currency: "CLP",
        direction: "debit",
        reviewed: true,
      },
    })
  }

  const total = EXCESOS.reduce((s, [, exceso]) => s + exceso, 0)
  console.log(
    `[seed:pr] WDC-73: ${EXCESOS.length} categorías sobre su tope (excedente de topes $${total}), ` +
      `con el presupuesto global del mes todavía sin agotar (usuario ${userId}).`
  )
}
