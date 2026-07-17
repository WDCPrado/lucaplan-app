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
  const { year, month } = periodOf(req)
  return withUser(req, async (userId) => {
    const income = await updateIncome(financeDeps, userId, {
      id,
      accountId: String(body.accountId),
      categoryId: String(body.categoryId),
      name: String(body.name ?? ""),
      amount: Number(body.amount),
      dayOfMonth: Number(body.dayOfMonth),
      isActive: body.isActive ?? true,
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
  return withUser(req, (userId) => deleteIncome(financeDeps, userId, id))
}
