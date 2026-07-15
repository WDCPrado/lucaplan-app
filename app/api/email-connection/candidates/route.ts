// Escaneo del mes actual para descubrir candidatos de cuentas/tarjetas. NO persiste entidades ni
// movimientos: el resultado alimenta la revisión del usuario antes de confirmar. Refrescar la
// página simplemente reescanea (no hay modelo de borradores).
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { scanEmailCandidates } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function GET(req: Request) {
  return withUser(req, (userId) =>
    scanEmailCandidates(makeEmailConnectionDeps(), userId)
  )
}
