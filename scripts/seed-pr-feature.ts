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

// WDC-54 — "Del banco": registrar por foto los movimientos que el banco no avisó.
export default async function seedFeature({
  prisma,
  userId,
  checkingId,
  creditCardId,
}: FeatureSeedContext) {
  // La feature solo tiene sentido en cuentas CONECTADAS: en una manual el alta normal ya acepta
  // cargos. El seed base las crea manuales, así que acá se marcan como conectadas por correo — que
  // es justo el caso donde el toggle − aparece bloqueado y el tab "Del banco" es la única vía.
  await prisma.financialAccount.updateMany({
    where: { id: { in: [checkingId, creditCardId] } },
    data: { provider: "bancochile" },
  })

  // La corriente conectada proyecta su caja al registrar un movimiento (cargo consume caja, el
  // exceso usa el sobregiro). Sin bucket de caja esa proyección es no-op y el reviewer no vería el
  // efecto en el saldo; la tarjeta ya trae sus cupos del seed base.
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
        used: 0,
        available: 1500000,
        asOf,
      },
    ],
  })

  console.log(
    "[seed:pr] WDC-54: cuentas marcadas como conectadas + caja y sobregiro de la corriente."
  )
}
