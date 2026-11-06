// Aplica los saldos confirmados por el usuario a la cuenta y sus buckets. Recibe los montos que ve
// en su banco (saldo, disponible); lo derivado —usado, cupo faltante— lo calcula el dominio en el
// servidor, nunca llega del cliente.
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { parseReadingBody } from "@/arch/v1/presentation/finance/account-balance-body"
import { applyAccountBalance } from "@/arch/v1/application/finance-use-cases/account-balance-use-cases"

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  return withUser(req, (userId) =>
    applyAccountBalance(financeDeps, userId, id, parseReadingBody(body))
  )
}
