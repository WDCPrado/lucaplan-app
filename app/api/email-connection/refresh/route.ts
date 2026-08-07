// Refresco manual: ejecuta el delta guardado de cada buzón (recupera notificaciones perdidas),
// reparte los mensajes entre los bancos vinculados, importa idempotente, proyecta buckets solo con
// movimientos nuevos posteriores al snapshot y renueva la suscripción si está por expirar.
// Serializado por usuario.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { withLock } from "@/arch/shared/mutex"
import { syncUserMailboxes } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  return withUser(req, (userId) =>
    withLock(`email:${userId}`, () =>
      syncUserMailboxes(makeEmailConnectionDeps(), userId)
    )
  )
}
