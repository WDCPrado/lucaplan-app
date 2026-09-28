import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { listRecurringCandidates } from "@/arch/v1/application/finance-use-cases/finance-read"

// Movimientos que se pueden elegir como el cobro del período en curso de la recurrente.
// Query params (opcionales): days (1..365, por defecto 10) y q (texto). `days` inválido → 422. La
// categoría no se elige: es siempre la de la plantilla.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const sp = new URL(req.url).searchParams
  const days = sp.get("days")
  return withUser(req, (userId) =>
    listRecurringCandidates(financeDeps, userId, id, {
      // Number("") y Number("abc") no son enteros: el use-case los rechaza con 422.
      days: days === null ? undefined : Number(days),
      query: sp.get("q")?.trim() || undefined,
    })
  )
}
