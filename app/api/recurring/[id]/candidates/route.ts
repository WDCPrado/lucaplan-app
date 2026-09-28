import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { listRecurringCandidates } from "@/arch/v1/application/finance-use-cases/finance-read"

// Movimientos que se pueden elegir como el cobro del período en curso de la recurrente.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, (userId) =>
    listRecurringCandidates(financeDeps, userId, id)
  )
}
