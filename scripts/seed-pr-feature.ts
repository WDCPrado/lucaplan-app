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

// WDC-57 — "Actualizar saldo" por captura: el cupo total ya no se edita ni se lee de la foto.
export default async function seedFeature({
  userId,
  prisma,
  checkingId,
}: FeatureSeedContext) {
  // La tarjeta ya trae del seed base sus dos cupos con total guardado (CLP 3.000.000 y USD 1.500),
  // que es justo lo que el panel usa de referencia. Lo que falta es la otra variante: la cuenta
  // corriente con caja y una línea de crédito con cupo total, para probar ahí lo mismo (escribir el
  // disponible y ver salir el utilizado, o al revés) sin que el total se mueva.
  const asOf = new Date()
  await prisma.balanceBucket.createMany({
    data: [
      {
        userId,
        accountId: checkingId,
        kind: "cash",
        currency: "CLP",
        limitAmount: 0,
        used: 0,
        available: 842350, // el mismo saldo con que el seed base crea la cuenta
        asOf,
      },
      {
        userId,
        accountId: checkingId,
        kind: "overdraft",
        currency: "CLP",
        limitAmount: 1500000,
        used: 300000,
        available: 1200000,
        asOf,
      },
    ],
  })

  console.log(
    "[seed:pr] WDC-57: caja y línea de crédito (cupo total $1.500.000) en la cuenta corriente."
  )
}
