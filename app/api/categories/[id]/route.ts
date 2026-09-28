import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { getCategoryDetail } from "@/arch/v1/application/finance-use-cases/finance-read"
import { deleteCategory } from "@/arch/v1/application/finance-use-cases/upsert-category-use-case"

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return getCategoryDetail(financeDeps, userId, id, year, month)
  })
}

// Elimina la categoría: movimientos quedan sin categoría; ingresos asignados se eliminan.
// 422 si recurrentes o planes de cuotas la usan (exigen categoría).
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    await deleteCategory(financeDeps, userId, id)
    return { ok: true }
  })
}
