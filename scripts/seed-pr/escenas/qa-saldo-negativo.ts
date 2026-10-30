import type { EscenaContext } from "../sembrar-usuario.ts";

export const correo = "qa-saldo-negativo@lucaplan.cl";
export const titulo = "QA — saldo negativo con línea sin uso";

export async function seed({ prisma, userId, checkingId }: EscenaContext) {
  const asOf = new Date();
  await prisma.financialAccount.update({
    where: { id: checkingId, userId },
    data: { balance: -110517, overdraftLimit: 1000000 },
  });
  await prisma.balanceBucket.updateMany({
    where: { userId, accountId: checkingId, kind: "cash" },
    data: { limitAmount: 0, used: 0, available: -110517, asOf },
  });
  await prisma.balanceBucket.updateMany({
    where: { userId, accountId: checkingId, kind: "overdraft" },
    data: { limitAmount: 1000000, used: 0, available: 1000000, asOf },
  });
}
