// Lee una captura de la app del banco y propone los saldos. NO persiste: el usuario confirma en
// PUT /api/accounts/[id]/balances. La imagen se procesa y se descarta (no se guarda ni se registra).
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { parseImageBody } from "@/arch/v1/presentation/finance/balance-scan-body"
import { scanAccountBalance } from "@/arch/v1/application/finance-use-cases/balance-scan-use-cases"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const image = parseImageBody(body)
  return withUser(req, async (userId) => {
    const proposal = await scanAccountBalance(financeDeps, userId, id, image)
    // null = la IA no está configurada o no reconoció nada; la UI cae al ingreso manual.
    return proposal ?? { reading: null }
  })
}
