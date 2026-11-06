import { incomeUpdateSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeForRequest,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  updateIncome,
  deleteIncome,
} from "@/arch/v1/application/finance-use-cases/income-use-cases"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"

// Edita una fuente de ingreso; el tope del período en curso la sigue si estaba igualado al ingreso.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()

  return withUser(req, async (userId) => {
      const scopedDeps = await financeForRequest(req)
    const parsed = incomeUpdateSchema.parse({
      accountId: String(body.accountId),
      categoryId: String(body.categoryId),
      name: String(body.name ?? ""),
      amount: Number(body.amount),
      dayOfMonth: Number(body.dayOfMonth),
      isActive: body.isActive ?? true,
    })
    const { year, month } = await periodOf(req, scopedDeps)
    const { result: income, seed } = await followIncome(scopedDeps, userId, () =>
      updateIncome(scopedDeps, userId, { id, ...parsed, year, month })
    )
    return { income, seed }
  })
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
      const scopedDeps = await financeForRequest(req)
    const { year, month } = await periodOf(req, scopedDeps)
    const { result, seed } = await followIncome(scopedDeps, userId, () =>
      deleteIncome(scopedDeps, userId, id, { year, month })
    )
    return { ...result, seed }
  })
}
