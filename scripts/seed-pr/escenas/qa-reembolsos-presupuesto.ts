import type { EscenaContext } from "../sembrar-usuario.ts"
import { todayKey } from "../../../arch/shared/today.ts"
import { periodOfDay } from "../../../arch/shared/billing-cycle.ts"
import { budgetPeriodSettings } from "../../../arch/v1/infrastructure/database/prisma/budget-period.infrastructure.ts"

export const correo = "reembolsos@lucaplan.cl"
export const titulo = "Reembolsos — suplemento del período"

export async function seed({ prisma, userId, checkingId, categoryId }: EscenaContext) {
  const category = categoryId.get("Compras")!
  await prisma.transaction.deleteMany({ where: { userId } })
  await prisma.recurringTemplate.deleteMany({ where: { userId } })
  await prisma.installmentPlan.deleteMany({ where: { userId } })
  await prisma.income.deleteMany({ where: { userId } })
  await prisma.categoryLimit.deleteMany({ where: { category: { userId } } })
  await prisma.monthlyBudget.deleteMany({ where: { userId } })
  const income = await prisma.category.upsert({
    where: { userId_name: { userId, name: "Abono de terceros" } },
    create: { userId, name: "Abono de terceros", type: "income" }, update: {},
  })
  const day = todayKey()
  const { overrides } = await budgetPeriodSettings(prisma)
  const expense = await prisma.transaction.create({ data: {
    userId, accountId: checkingId, categoryId: category, transactionDate: new Date(day),
    description: "Cena demo compartida", amount: 60000, currency: "CLP", direction: "debit",
  } })
  const credit = await prisma.transaction.create({ data: {
    userId, accountId: checkingId, categoryId: income.id, transactionDate: new Date(day),
    description: "Transferencia demo recibida", amount: 20000, currency: "CLP", direction: "credit",
  } })
  const effects = []
  for (const mode of ["calendar", "card_cycle"] as const) {
    const { year, month } = periodOfDay(day, mode, overrides)
    await prisma.categoryLimit.create({ data: { categoryId: category, mode, year, month, limitAmount: 100000 } })
    await prisma.monthlyBudget.create({ data: { userId, mode, year, month, globalLimit: 120000 } })
    effects.push({ categoryId: category, mode, year, month, treatment: "automatic" })
  }
  await prisma.expenseReimbursement.create({ data: {
    userId, expenseId: expense.id, creditId: credit.id, amount: 20000, budgetEffects: { create: effects },
  } })
  console.log("[seed:pr] Reembolsos: Compras $120.000, gasto bruto $60.000, disponible $60.000; próximo período $100.000.")
}
