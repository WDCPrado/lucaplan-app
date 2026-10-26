import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "qa-conciliacion-conflictos@lucaplan.cl"
export const titulo = "QA — cargos similares y liquidación recurrente"

export async function seed({
  prisma,
  userId,
  creditCardId,
  categoryId,
}: EscenaContext) {
  const category = categoryId.get("Compras")!
  const template = await prisma.recurringTemplate.create({
    data: {
      userId,
      accountId: creditCardId,
      categoryId: category,
      label: "Suscripción demo",
      description: "SUSCRIPCION DEMO",
      direction: "debit",
      baseAmount: 4500,
      currency: "CLP",
      periodicity: "monthly",
      dayOfMonth: 4,
      startDate: new Date("2025-01-04T00:00:00Z"),
    },
  })
  await prisma.transaction.create({
    data: {
      userId,
      accountId: creditCardId,
      categoryId: category,
      recurringTemplateId: template.id,
      periodKey: "2025-01",
      transactionDate: new Date("2025-01-04T00:00:00Z"),
      description: "SUSCRIPCION DEMO",
      amount: 4500,
      currency: "CLP",
      direction: "debit",
      status: "confirmed",
      reviewed: true,
    },
  })
  await prisma.transaction.create({
    data: {
      userId,
      accountId: creditCardId,
      categoryId: category,
      transactionDate: new Date("2025-01-05T00:00:00Z"),
      description: "TIENDA DEMO",
      amount: 1800,
      currency: "CLP",
      direction: "debit",
      status: "confirmed",
      reviewed: true,
    },
  })
}
