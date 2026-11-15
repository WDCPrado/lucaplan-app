import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"
import { unlinkReimbursement } from "@/arch/v1/infrastructure/database/prisma/reimbursement.infrastructure"

// Deshace un vínculo abono→gasto (WDC-184). [id] es cualquiera de los dos movimientos; el vínculo
// tiene que ser del usuario y tocar ese movimiento (si no, 404). El tope que sigue al ingreso se alinea.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; linkId: string }> }) {
  const { id, linkId } = await ctx.params
  return withUser(req, async (userId) => {
    const { result } = await followIncome(financeDeps, userId,
      () => unlinkReimbursement(userId, linkId, id), { allModes: true })
    return result
  })
}
