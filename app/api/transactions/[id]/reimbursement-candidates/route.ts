import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { listReimbursementCandidates } from "@/arch/v1/infrastructure/database/prisma/reimbursement.infrastructure"

// Gastos que este abono ([id]) puede devolver (WDC-184): 404 si no es del usuario, 422 si no es un
// abono de ingreso o reembolso confirmado en CLP.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  return withUser(req, (userId) => listReimbursementCandidates(userId, id))
}
