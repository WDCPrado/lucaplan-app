// QA del alcance del presupuesto: totales comparables en débito y crédito.
// Solo modifica su propio usuario. No cambia el modo, que es una configuración global.
import type { EscenaContext } from "../sembrar-usuario.ts"
import { todayKey } from "../../../arch/shared/today.ts"

export const correo = "presupuesto@lucaplan.cl"
export const titulo = "Presupuesto — solo categorías con tope"

export async function seed({
  prisma,
  userId,
  checkingId,
  categoryId,
}: EscenaContext) {
  const conTope = categoryId.get("Supermercado")
  const sinTope = categoryId.get("Comida")
  if (!conTope || !sinTope)
    throw new Error("Faltan las categorías de la escena")

  const hoy = new Date(`${todayKey()}T00:00:00Z`)
  const anterior = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)
  )
  const year = anterior.getUTCFullYear()
  const month = anterior.getUTCMonth() + 1

  // Totales fijos, sin recurrentes ni cuotas del set base que puedan regenerarlos al entrar.
  await prisma.transaction.deleteMany({ where: { userId } })
  await prisma.recurringTemplate.deleteMany({ where: { userId } })
  await prisma.installmentPlan.deleteMany({ where: { userId } })
  await prisma.income.deleteMany({ where: { userId } })
  await prisma.categoryLimit.deleteMany({ where: { category: { userId } } })
  await prisma.monthlyBudget.deleteMany({ where: { userId } })

  // Heredado desde el mes anterior: funciona aunque hoy pertenezca al ciclo del mes siguiente.
  await prisma.category.update({
    where: { id: conTope, userId },
    data: { limits: { create: { year, month, limitAmount: 100000 } } },
  })
  await prisma.category.update({
    where: { id: sinTope, userId },
    data: { limits: { create: { year, month, limitAmount: 0 } } },
  })
  await prisma.monthlyBudget.create({
    data: { userId, year, month, globalLimit: 100000 },
  })

  await prisma.transaction.createMany({
    data: [
      {
        categoryId: conTope,
        amount: 10000,
        description: "QA: gasto dentro del presupuesto",
        status: "confirmed",
      },
      {
        categoryId: sinTope,
        amount: 20000,
        description: "QA: gasto sin tope",
        status: "confirmed",
      },
      {
        categoryId: null,
        amount: 30000,
        description: "QA: gasto sin categoría",
        status: "confirmed",
      },
      {
        categoryId: conTope,
        amount: 4000,
        description: "QA: pendiente dentro del presupuesto",
        status: "pending",
      },
      {
        categoryId: sinTope,
        amount: 5000,
        description: "QA: pendiente sin tope",
        status: "pending",
      },
    ].map((tx) => ({
      ...tx,
      userId,
      accountId: checkingId,
      transactionDate: hoy,
      currency: "CLP",
      direction: "debit",
      reviewed: true,
      pending: tx.status === "pending",
    })),
  })

  console.log(
    "[seed:pr] Presupuesto: gastado $10.000, comprometido $4.000, disponible $86.000. Sin tope cerrado; quitar Supermercado del gasto deja gastado $0."
  )
}
