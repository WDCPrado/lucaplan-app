// Datos EXTRA del PR actual: lo que la feature de esta rama necesita para poder probarse y que el
// seed base (scripts/seed-pr.ts) no siembra. Lo corre el seed base al final de la primera siembra,
// con el usuario demo ya creado, y solo en entornos de PR de Railway.
//
// SE REESCRIBE COMPLETO EN CADA FEATURE, antes de abrir el PR. El contenido pertenece al PR en
// curso, no al repo: si tu cambio no necesita datos propios, déjalo como no-op.
//
// Reglas al escribirlo:
//   - Solo la data mínima de la feature y sus dependencias. Usuario, cuentas, categorías,
//     presupuesto, movimientos, recurrentes y planes de cuotas ya vienen del seed base: tómalos
//     del ctx en vez de crear otros.
//   - Nada de datos reales ni secretos: el entorno de PR es público.
//   - Si falla, el seed base lo registra y sigue (no tumba el deploy), pero la feature queda sin
//     datos. Pruébalo antes con `SEED_PR_FORCE=1 pnpm seed:pr` contra una base local.
//
// --- PR actual: actualizar saldo desde una captura del banco ---
// Para probarlo hay que poder subir una captura REAL y ver cambiar los saldos. Eso exige que los
// instrumentos del demo coincidan con los de la captura: mismos últimos 4 (si no, la app rechaza la
// imagen por ser de otra cuenta) y cupos coherentes con lo que muestra. Los saldos quedan a
// propósito DISTINTOS de los de la captura, para que al aplicarla se note el cambio.
import type { FeatureSeedContext } from "./seed-pr.ts" // solo el tipo: no ejecuta el seed base

export default async function seedFeature({
  prisma,
  userId,
  checkingId,
  creditCardId,
}: FeatureSeedContext) {
  const asOf = new Date()

  // Cuenta corriente ••••8900 con caja y línea de crédito. El seed base no le crea buckets: sin
  // ellos no hay dónde escribir el saldo leído.
  await prisma.financialAccount.update({
    where: { id: checkingId },
    data: { cardLast4: "8900", balance: 842350 },
  })
  await prisma.balanceBucket.createMany({
    data: [
      {
        userId,
        accountId: checkingId,
        kind: "cash",
        currency: "CLP",
        limitAmount: 0,
        used: 0,
        available: 842350,
        asOf,
      },
      {
        userId,
        accountId: checkingId,
        kind: "overdraft",
        currency: "CLP",
        limitAmount: 1000000,
        used: 0,
        available: 1000000,
        asOf,
      },
    ],
  })

  // Tarjeta Visa Signature ••••2120. Los cupos totales toleran los disponibles de la captura
  // ($1.334.697 y USD 2.069) — un disponible mayor que el cupo se rechaza como lectura mala.
  await prisma.financialAccount.update({
    where: { id: creditCardId },
    data: { cardLast4: "2120", name: "Visa Signature", balance: -1900000 },
  })
  await prisma.balanceBucket.updateMany({
    where: { accountId: creditCardId, kind: "credit_national" },
    data: { limitAmount: 3000000, used: 1900000, available: 1100000, asOf },
  })
  await prisma.balanceBucket.updateMany({
    where: { accountId: creditCardId, kind: "credit_international" },
    data: { limitAmount: 2500, used: 700, available: 1800, asOf },
  })

  console.log(
    "[seed:pr] saldos listos para la captura: corriente ••••8900 (caja + línea) y tarjeta ••••2120 (cupo CLP y USD)."
  )
}
