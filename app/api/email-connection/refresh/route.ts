// Refresco manual: ejecuta el delta guardado (recupera notificaciones perdidas), importa
// idempotente, proyecta buckets solo con movimientos nuevos posteriores al snapshot y renueva la
// suscripción si está por expirar. Serializado por usuario.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { withLock } from "@/arch/shared/mutex"
import { syncEmailConnection } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"

export async function POST(req: Request) {
  return withUser(req, (userId) =>
    withLock(`email:${userId}`, () =>
      syncEmailConnection(makeEmailConnectionDeps(), userId)
    )
  )
}
