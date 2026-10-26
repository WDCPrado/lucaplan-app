import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "qa-conciliacion@lucaplan.cl"
export const titulo = "QA — caja, línea y reembolso sin doble beneficio"

export async function seed({
  prisma,
  userId,
  checkingId,
  categoryId,
}: EscenaContext) {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  // Día 10 pertenece al mes visible tanto en calendario como en ciclo de tarjeta.
  const date = new Date(Date.UTC(year, month - 1, 10))
  const expenseCategory = categoryId.get("Compras")!
  await prisma.installmentPlan.deleteMany({ where: { userId } })
  await prisma.recurringTemplate.deleteMany({ where: { userId } })
  await prisma.transaction.deleteMany({ where: { userId } })
  await prisma.income.deleteMany({ where: { userId } })
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: { balance: 80000, overdraftLimit: 1000000 },
  })
  await prisma.balanceBucket.deleteMany({
    where: { userId, accountId: checkingId },
  })
  await prisma.balanceBucket.createMany({
    data: [
      {
        userId,
        accountId: checkingId,
        kind: "cash",
        currency: "CLP",
        available: 80000,
        asOf: now,
      },
      {
        userId,
        accountId: checkingId,
        kind: "overdraft",
        currency: "CLP",
        limitAmount: 1000000,
        used: 200000,
        available: 800000,
        asOf: now,
      },
    ],
  })
  const incomeCategory = await prisma.category.findFirstOrThrow({
    where: { userId, type: "income" },
  })
  for (const [name, amount] of [
    ["Sueldo demo", 1000000],
    ["Reembolso demo", 40000],
  ] as const) {
    const income = await prisma.income.create({
      data: {
        userId,
        accountId: checkingId,
        categoryId: incomeCategory.id,
        name,
        currency: "CLP",
        dayOfMonth: 10,
        amounts: { create: { year, month, amount } },
      },
    })
    const credit = await prisma.transaction.create({
      data: {
        userId,
        accountId: checkingId,
        categoryId: incomeCategory.id,
        incomeId: income.id,
        transactionDate: date,
        description: name,
        amount,
        currency: "CLP",
        direction: "credit",
        reviewed: true,
      },
    })
    if (name === "Reembolso demo") {
      const expense = await prisma.transaction.create({
        data: {
          userId,
          accountId: checkingId,
          categoryId: expenseCategory,
          transactionDate: date,
          description: "Compra compartida demo",
          amount: 60000,
          currency: "CLP",
          direction: "debit",
          reviewed: true,
        },
      })
      await prisma.expenseReimbursement.create({
        data: {
          userId,
          expenseId: expense.id,
          creditId: credit.id,
          amount: 40000,
        },
      })
    }
  }
  console.log(
    `[seed:pr] Conciliación ${month}/${year}: caja 80.000, línea usada 200.000, gasto neto 20.000, margen 980.000.`
  )
}
