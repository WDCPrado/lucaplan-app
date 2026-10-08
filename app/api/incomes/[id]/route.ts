import { incomeUpdateSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  updateIncome,
  deleteIncome,
  seedGlobalLimitFromIncomes,
} from "@/arch/v1/application/finance-use-cases/income-use-cases"

// Edita una fuente de ingreso. Re-siembra el límite global del mes solo si aún no está definido.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()

  return withUser(req, async (userId) => {
    const parsed = incomeUpdateSchema.parse({
      accountId: String(body.accountId),
      categoryId: String(body.categoryId),
      name: String(body.name ?? ""),
      amount: Number(body.amount),
      dayOfMonth: Number(body.dayOfMonth),
      isActive: body.isActive ?? true,
    })
    const { year, month } = await periodOf(req)
    const income = await updateIncome(financeDeps, userId, {
      id,
      ...parsed,
      year,
      month,
    })
    const seed = await seedGlobalLimitFromIncomes(financeDeps, userId, {
      year,
      month,
    })
    return { income, seed }
  })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return deleteIncome(financeDeps, userId, id, { year, month })
  })
}
