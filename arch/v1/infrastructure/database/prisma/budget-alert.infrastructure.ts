// Adapter Prisma de los umbrales de alerta del presupuesto (tabla global `budget_alert`).
import type {
  BudgetAlert,
  BudgetAlertRepository,
} from "../../../domain/notifications/budget-alert.domain.ts"
import { prisma } from "./client.ts"

export const budgetAlertRepository: BudgetAlertRepository = {
  async list(): Promise<BudgetAlert[]> {
    const rows = await prisma.budgetAlert.findMany({
      orderBy: { percent: "asc" },
    })
    return rows.map((r) => ({ id: r.id, percent: r.percent }))
  },

  async save(input: { id?: string; percent: number }): Promise<BudgetAlert> {
    const row = input.id
      ? await prisma.budgetAlert.update({
          where: { id: input.id },
          data: { percent: input.percent },
        })
      : await prisma.budgetAlert.create({ data: { percent: input.percent } })
    return { id: row.id, percent: row.percent }
  },

  async delete(id: string): Promise<void> {
    await prisma.budgetAlert.deleteMany({ where: { id } })
  },
}
