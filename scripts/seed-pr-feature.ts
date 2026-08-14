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

// WDC-62 — MACHBANK, solo débito. Conectar Outlook de verdad no se puede en el entorno del PR, así
// que se siembra el RESULTADO de sus tres plantillas: una cuenta principal con su Visa Débito y un
// movimiento por caso (transferencia, compra internacional cobrada en pesos y pago directo). Sirve
// para mirar que ninguno crea crédito, cupos ni sobregiro: el único bucket es `cash`.
export default async function seedFeature({
  prisma,
  userId,
  categoryId,
}: FeatureSeedContext) {
  const now = new Date()
  const day = (d: number) =>
    new Date(now.getFullYear(), now.getMonth(), Math.min(d, 28))

  const bank = await prisma.bank.create({
    data: { userId, name: "MACHBANK" },
  })

  const cuenta = await prisma.financialAccount.create({
    data: {
      userId,
      bankId: bank.id,
      name: "Cuenta Corriente",
      accountType: "checking",
      currency: "CLP",
      balance: 128500,
      cardLast4: "4321", // los últimos 4 de la Visa Débito, no de una tarjeta de crédito
      color: "#5b21b6",
    },
  })

  const cash = await prisma.balanceBucket.create({
    data: {
      userId,
      accountId: cuenta.id,
      kind: "cash",
      currency: "CLP",
      limitAmount: 0,
      used: 0,
      available: 128500,
      asOf: now,
    },
  })

  // Los tres gastos que producen las plantillas de MACHBANK. Ninguno es interno: los tres cuentan
  // en el presupuesto, como cualquier cargo en cuenta corriente.
  await prisma.transaction.createMany({
    data: [
      {
        description: "Transferencia a Ana Pérez",
        amount: 25000,
        transactionDate: day(4),
        externalId: "email:txn:112233445566",
        categoryId: null, // como llega del correo: sin categoría, va al triage
      },
      {
        description: "RAILWAY",
        amount: 943, // compra de US$1: MACHBANK la cobra en pesos, sin cupo internacional
        transactionDate: day(9),
        externalId: "email:txn:346162814174956",
        categoryId: categoryId.get("Suscripciones") ?? null,
      },
      {
        description: "Pago a Ana Pérez",
        amount: 15750,
        transactionDate: day(14),
        externalId: "email:mid:<demo-machbank@example.test>",
        categoryId: null, // como llega del correo: sin categoría, va al triage
      },
    ].map((m) => ({
      userId,
      accountId: cuenta.id,
      bucketId: cash.id,
      currency: "CLP",
      direction: "debit",
      status: "confirmed",
      ...m,
    })),
  })

  console.log(`[seed:pr] MACHBANK sembrado para el usuario ${userId}.`)
}
