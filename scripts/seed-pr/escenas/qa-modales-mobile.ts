// Nombres largos en ingresos y un movimiento de cada editor para revisar los pies en móvil.
import type { EscenaContext } from "../sembrar-usuario.ts"
import { todayKey } from "../../../arch/shared/today.ts"

export const correo = "modales-mobile@lucaplan.cl"
export const titulo = "Modales móvil — ingresos y conversiones"

export async function seed({
  prisma,
  userId,
  checkingId,
  creditCardId,
  categoryId,
}: EscenaContext) {
  const comida = categoryId.get("Comida")
  const compras = categoryId.get("Compras")
  if (!comida || !compras)
    throw new Error("Faltan categorías de la escena móvil")
  // El mapa del contexto contiene las categorías de gasto; la de ingreso sale de su fuente.
  const income = await prisma.income.findFirstOrThrow({ where: { userId } })

  await prisma.income.update({
    where: { id: income.id, userId },
    data: { name: "Sueldo mensual y servicios profesionales de largo plazo" },
  })
  await prisma.category.update({
    where: { id: income.categoryId, userId },
    data: { name: "Ingresos por remuneraciones y servicios profesionales" },
  })
  // Solo cambia el proveedor de la cuenta demo para recorrer el editor de movimientos del banco.
  // No se crea conexión bancaria ni de correo.
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: {
      name: "Cuenta corriente principal para remuneraciones y gastos personales",
      provider: "bancochile",
    },
  })

  const descriptions = [
    "QA móvil: movimiento del banco",
    "QA móvil: compra manual en tarjeta",
  ]
  await prisma.transaction.deleteMany({
    where: { userId, description: { in: descriptions } },
  })
  await prisma.transaction.createMany({
    data: [
      {
        accountId: checkingId,
        categoryId: comida,
        amount: 12000,
        description: descriptions[0],
      },
      {
        accountId: creditCardId,
        categoryId: compras,
        amount: 14000,
        description: descriptions[1],
      },
    ].map((tx) => ({
      ...tx,
      userId,
      transactionDate: new Date(`${todayKey()}T00:00:00Z`),
      currency: "CLP",
      direction: "debit",
      status: "confirmed",
      reviewed: true,
    })),
  })
  console.log(
    "[seed:pr] Modales móvil: ingreso con nombres largos; movimientos QA de hoy para Hacer recurrente, Es una cuota y Pasar a cuotas."
  )
}
