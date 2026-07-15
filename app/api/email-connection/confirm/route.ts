// Confirmación del setup: instrumentos validados + snapshot con fecha → crea banco, cuentas,
// tarjetas y buckets, e importa los movimientos del mes en UNA operación atómica. Luego guarda el
// estado delta y categoriza los no internos (best-effort). Serializado por usuario.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { parseSnapshotBody } from "@/arch/v1/presentation/finance/email-snapshot-body"
import { withLock } from "@/arch/shared/mutex"
import { confirmEmailSetup } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  return withUser(req, (userId) =>
    withLock(`email:${userId}`, () =>
      confirmEmailSetup(
        makeEmailConnectionDeps(),
        userId,
        parseSnapshotBody(body)
      )
    )
  )
}
