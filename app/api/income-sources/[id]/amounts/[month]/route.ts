import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { setIncomeSourceMonthAmount } from "@/arch/v1/application/finance-use-cases/income-source-use-cases"
import { monthAmountSchema, yearMonthSchema } from "@/lib/schemas/income-source"

type Ctx = { params: Promise<{ id: string; month: string }> }

// Monto propio de un mes calendario (YYYY-MM), que reemplaza al base del programado.
export async function PUT(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => ({}))
    const { amount } = monthAmountSchema.parse(body)
    return setIncomeSourceMonthAmount(financeDeps, userId, id, yearMonthSchema.parse(month), amount)
  })
}

// Quita el monto propio: ese mes vuelve al base.
export async function DELETE(req: Request, ctx: Ctx) {
  const { id, month } = await ctx.params
  return withUser(req, (userId) =>
    setIncomeSourceMonthAmount(financeDeps, userId, id, yearMonthSchema.parse(month), null)
  )
}
