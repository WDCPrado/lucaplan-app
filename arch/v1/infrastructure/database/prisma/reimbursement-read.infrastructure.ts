import { prisma } from "./client.ts"
import type { ReimbursementRead } from "../../../domain/finance/reimbursement.domain.ts"

/** Batch lookup for budget and movement-link read views. */
export const reimbursementReadRepository = {
  async listForTransactions(userId: string, ids: string[]): Promise<ReimbursementRead[]> {
    if (ids.length === 0) return []
    const rows = await prisma.expenseReimbursement.findMany({
      where: { userId, OR: [{ expenseId: { in: ids } }, { creditId: { in: ids } }] },
      select: { expenseId: true, creditId: true, amount: true, budgetEffects: true },
    })
    return rows.map(row => ({ expenseId: row.expenseId, creditId: row.creditId, amount: Number(row.amount),
      effects: row.budgetEffects as ReimbursementRead["effects"] }))
  },
}
