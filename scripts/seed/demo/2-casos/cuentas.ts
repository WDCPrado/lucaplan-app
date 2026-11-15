// Cuentas de la cuenta demo: la corriente usa $180.000 de su sobregiro (caja $0), así «Total en
// cuentas» es la posición neta y la línea disponible no se suma como plata. La línea vive en el
// bucket `overdraft` (no en la cuenta) y el uso se ve como un giro de la línea de la cartola
// (interno `overdraft_draw`: sube caja y deuda a la vez; no es ingreso).
import type { DemoContext } from "../1-base/cuenta-demo.ts"

const LINEA = 1500000
const USADO = 180000

export async function seed({ prisma, userId, checkingId }: DemoContext) {
  const asOf = new Date()
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: { balance: -USADO },
  })
  await prisma.balanceBucket.createMany({
    data: [
      { userId, accountId: checkingId, kind: "cash", currency: "CLP", limitAmount: 0, used: 0, available: 0, asOf },
      { userId, accountId: checkingId, kind: "overdraft", currency: "CLP", limitAmount: LINEA, used: USADO, available: LINEA - USADO, asOf },
    ],
  })
  const hoy = new Date()
  await prisma.transaction.create({
    data: {
      userId,
      accountId: checkingId,
      transactionDate: new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1)),
      description: "Giro automático línea de crédito",
      amount: USADO,
      currency: "CLP",
      direction: "credit",
      status: "confirmed",
      isInternal: true,
      internalKind: "overdraft_draw",
      origin: "statement",
      reviewed: true,
    },
  })
}
