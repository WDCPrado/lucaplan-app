import { prisma } from "./client.ts"

/** Batch lookup for budget and movement-link read views. */
export const reimbursementReadRepository = {
  async listForTransactions(userId: string, ids: string[]) {
    if (ids.length === 0) return []
    const rows = await prisma.expenseReimbursement.findMany({
      where: { userId, OR: [{ expenseId: { in: ids } }, { creditId: { in: ids } }] },
      select: { expenseId: true, creditId: true, amount: true },
    })
    return rows.map(row => ({ expenseId: row.expenseId, creditId: row.creditId, amount: Number(row.amount) }))
  },
}
