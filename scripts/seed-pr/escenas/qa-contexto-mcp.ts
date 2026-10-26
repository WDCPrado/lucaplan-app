import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "qa-contexto-mcp@lucaplan.cl"
export const titulo = "QA — contexto MCP: aviso CLP y compra USD"

export async function seed({
  prisma,
  userId,
  creditCardId,
  categoryId,
}: EscenaContext) {
  const category = categoryId.get("Compras")!
  const date = new Date()
  date.setUTCDate(10)
  await prisma.financialAccount.update({
    where: { id: creditCardId, userId },
    data: { provider: "bancochile" },
  })
  const bucket = await prisma.balanceBucket.findFirstOrThrow({
    where: { userId, accountId: creditCardId, kind: "credit_international" },
  })
  await prisma.transaction.createMany({
    data: [
      {
        userId,
        accountId: creditCardId,
        categoryId: category,
        transactionDate: date,
        description: "QA aviso en pesos — cupo definitivo sin verificar",
        amount: 10000,
        currency: "CLP",
        direction: "debit",
        externalId: "qa-contexto-aviso-clp",
        reviewed: true,
      },
      {
        userId,
        accountId: creditCardId,
        categoryId: category,
        transactionDate: date,
        description: "QA compra USD — equivalente presupuestario",
        amount: 12.5,
        currency: "USD",
        direction: "debit",
        bucketId: bucket.id,
        externalId: "qa-contexto-compra-usd",
        reviewed: true,
      },
    ],
  })
}
