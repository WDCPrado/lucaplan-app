import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteIncomeSource,
  updateIncomeSource,
} from "@/arch/v1/application/finance-use-cases/income-source-use-cases"
import { updateIncomeSourceSchema } from "@/lib/schemas/income-source"

// Solo lo que cambia.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => ({}))
    return updateIncomeSource(financeDeps, userId, id, updateIncomeSourceSchema.parse(body))
  })
}

// Con abonos vinculados termina su vigencia hoy ({ ended: true }); sin ellos se borra ({ deleted: true }).
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, (userId) => deleteIncomeSource(financeDeps, userId, id))
}
