// "Actualizar saldos" de un banco: reemplaza los valores estimados por los reales ingresados por el
// usuario y mueve la fecha del snapshot; la proyección continúa solo con eventos posteriores.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { parseSnapshotBody } from "@/arch/v1/presentation/finance/email-snapshot-body"
import { withLock } from "@/arch/shared/mutex"
import { reconcileEmailBalances } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  return withUser(req, (userId) =>
    withLock(`email:${userId}`, () =>
      reconcileEmailBalances(
        makeEmailConnectionDeps(),
        userId,
        String(body?.linkId ?? ""),
        parseSnapshotBody(body)
      )
    )
  )
}
