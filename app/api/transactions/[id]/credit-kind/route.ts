import { changeCreditKindSchema } from "@/lib/schemas/credit-kind"
import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { changeCreditKind } from "@/arch/v1/application/finance-use-cases/credit-kind-use-cases"

// Corrige el tipo de un abono (ingreso ↔ reembolso); el tope que sigue al ingreso se alinea solo.
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => ({}))
    const input = changeCreditKindSchema.parse({ transactionId: id, creditKind: body?.creditKind })
    const { transaction, seed } = await changeCreditKind(financeDeps, userId, input)
    return { id: transaction.id, creditKind: transaction.creditKind, seed }
  })
}
