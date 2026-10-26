import type { EscenaContext } from "../sembrar-usuario.ts"
export const correo = "qa-conciliacion@lucaplan.cl"
export const titulo = "QA — corregir moneda bancaria conservando el cargo"
export async function seed({
  prisma,
  userId,
  creditCardId,
  categoryId,
}: EscenaContext) {
  const date = new Date()
  date.setUTCDate(5)
  const bucket = await prisma.balanceBucket.findFirstOrThrow({
    where: { userId, accountId: creditCardId, kind: "credit_national" },
  })
  await prisma.transaction.create({
    data: {
      userId,
      accountId: creditCardId,
      categoryId: categoryId.get("Compras"),
      bucketId: bucket.id,
      transactionDate: date,
      description: "QA aviso de compra internacional en pesos",
      amount: 84000,
      currency: "CLP",
      direction: "debit",
      externalId: "qa-reconcile-clp-email",
      reviewed: true,
    },
  })
}
