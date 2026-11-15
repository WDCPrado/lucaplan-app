import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { linkCreditToIncomeSource } from "@/arch/v1/application/finance-use-cases/income-source-use-cases"
import { linkIncomeSourceSchema } from "@/lib/schemas/income-source"

// Vincula un abono de ingreso a un ingreso programado (misma moneda), o lo desvincula con null.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => ({}))
    const { incomeSourceId } = linkIncomeSourceSchema.parse(body)
    return linkCreditToIncomeSource(financeDeps, userId, id, incomeSourceId)
  })
}
