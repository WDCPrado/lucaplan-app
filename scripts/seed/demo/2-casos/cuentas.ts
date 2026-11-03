// Cuentas de la cuenta demo: la corriente usa $180.000 de su sobregiro (caja $0), así «Total en
// cuentas» es la posición neta y la línea disponible no se suma como plata.
import type { DemoContext } from "../1-base/cuenta-demo.ts"

const LINEA = 1500000
const USADO = 180000

export async function seed({ prisma, userId, checkingId }: DemoContext) {
  const asOf = new Date()
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: { balance: -USADO, overdraftLimit: LINEA },
  })
  await prisma.balanceBucket.createMany({
    data: [
      { userId, accountId: checkingId, kind: "cash", currency: "CLP", limitAmount: 0, used: 0, available: 0, asOf },
      { userId, accountId: checkingId, kind: "overdraft", currency: "CLP", limitAmount: LINEA, used: USADO, available: LINEA - USADO, asOf },
    ],
  })
}
