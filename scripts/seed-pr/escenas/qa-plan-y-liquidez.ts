import type { EscenaContext } from "../sembrar-usuario.ts"

export const correo = "qa-plan-liquidez@lucaplan.cl"
export const titulo = "QA — plan cubierto y corriente negativa"

export async function seed({ prisma, userId, checkingId }: EscenaContext) {
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: { balance: 80000, overdraftLimit: 1000000 },
  })
  await prisma.balanceBucket.createMany({
    data: [
      { userId, accountId: checkingId, kind: "cash", currency: "CLP", limitAmount: 0, used: 0, available: 80000, asOf: new Date() },
      { userId, accountId: checkingId, kind: "overdraft", currency: "CLP", limitAmount: 1000000, used: 200000, available: 800000, asOf: new Date() },
    ],
  })
}
