import { runFollowIncome } from "@/arch/v1/infrastructure/database/prisma/follow-income.infrastructure"
import { cronAuthorized } from "../cron-auth"

// Tope que sigue al ingreso al empezar un período (mes o ciclo de tarjeta) sin movimientos: sin
// esto queda con el del período anterior hasta la primera escritura. Diario, con `CRON_SECRET`.
export async function POST(req: Request) {
  if (!cronAuthorized(req))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  return Response.json(await runFollowIncome())
}
