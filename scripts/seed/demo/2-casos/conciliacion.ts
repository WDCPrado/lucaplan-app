// Conciliación de la tarjeta demo: un aviso de compra internacional que el correo trajo en pesos
// (se corrige moneda e importe conservando el cargo) y una compra en dólares en su cupo, con su
// equivalente presupuestario.
import type { DemoContext } from "../1-base/cuenta-demo.ts"
import { todayKey } from "../../../../arch/shared/today.ts"

export async function seed({ prisma, userId, creditCardId, nationalBucketId, internationalBucketId, categoryId }: DemoContext) {
  const hoy = new Date(`${todayKey()}T00:00:00Z`)
  const base = { userId, accountId: creditCardId, categoryId: categoryId.get("Compras")!, transactionDate: hoy, direction: "debit", reviewed: true }
  await prisma.transaction.createMany({
    data: [
      { ...base, bucketId: nationalBucketId, description: "Aviso de compra internacional en pesos", amount: 84000, currency: "CLP", externalId: "demo-reconcile-clp-email" },
      { ...base, bucketId: internationalBucketId, description: "Compra USD — equivalente presupuestario", amount: 12.5, currency: "USD", externalId: "demo-contexto-compra-usd" },
    ],
  })
}
