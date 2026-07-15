// Desconexión del método correo: elimina la suscripción de Microsoft (best-effort), descarta los
// tokens, borra la conexión y el banco con sus cuentas/movimientos (cascade), y libera el método
// para poder conectar el scraper después. No toca bancos manuales ni otros bancos.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { disconnectEmailConnection } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    await disconnectEmailConnection(makeEmailConnectionDeps(), userId)
    return { ok: true }
  })
}
