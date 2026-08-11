// Movimientos que el banco no avisó, leídos de una foto de la cartola.
//   POST → lee las fotos y propone candidatos (NO persiste; las imágenes se descartan).
//   PUT  → crea los movimientos que el usuario confirmó.
// Van juntos porque son el mismo paso partido en dos: sin la revisión del usuario en medio, una
// lectura equivocada entraría como movimiento real.
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { parseImagesBody } from "@/arch/v1/presentation/finance/balance-scan-body"
import { parseMovementsBody } from "@/arch/v1/presentation/finance/movement-scan-body"
import {
  confirmScannedMovements,
  scanAccountMovements,
} from "@/arch/v1/application/finance-use-cases/movement-scan-use-cases"

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  // El parseo va DENTRO de withUser para que un body inválido salga como 422 y no como 500.
  return withUser(req, (userId) =>
    scanAccountMovements(financeDeps, userId, id, parseImagesBody(body))
  )
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => ({}))
  return withUser(req, (userId) =>
    confirmScannedMovements(financeDeps, userId, id, parseMovementsBody(body))
  )
}
