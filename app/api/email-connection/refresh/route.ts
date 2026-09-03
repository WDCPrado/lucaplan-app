// Refresco manual: ejecuta el delta guardado de cada buzón (recupera notificaciones perdidas),
// reparte los mensajes entre los bancos vinculados, importa idempotente, proyecta buckets solo con
// movimientos nuevos posteriores al snapshot y renueva la suscripción si está por expirar.
// Serializado por usuario.
//
// Con `since` en el cuerpo relee el buzón desde esa fecha en vez de avanzar el delta: recupera
// correos que ya pasaron por el cursor sin dejar movimiento, como los que llegaron con una
// plantilla que el parser todavía no reconocía. Releer no duplica —la importación es idempotente
// por externalId— pero sí es caro, así que la fecha acota cuánto se relee y nunca es todo el buzón.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { withLock } from "@/arch/shared/mutex"
import { syncUserMailboxes } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { BankConnectionError } from "@/arch/v1/domain/finance/finance.domain"

// Techo del reproceso: más atrás que esto se relee medio buzón para recuperar, en el mejor caso,
// un correo. Quien necesite ir más lejos reconecta el banco, que es el camino pensado para eso.
const MAX_REPROCESO_DIAS = 90

export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    const body = await req.json().catch(() => null)
    const raw = (body as { since?: unknown } | null)?.since
    let reprocessSince: Date | undefined
    if (raw !== undefined && raw !== null) {
      if (typeof raw !== "string")
        throw new BankConnectionError("La fecha de reproceso debe ser texto ISO")
      const date = new Date(raw)
      if (Number.isNaN(date.getTime()))
        throw new BankConnectionError("Fecha de reproceso inválida")
      const now = Date.now()
      if (date.getTime() > now)
        throw new BankConnectionError(
          "La fecha de reproceso no puede estar en el futuro"
        )
      if (now - date.getTime() > MAX_REPROCESO_DIAS * 86_400_000)
        throw new BankConnectionError(
          `El reproceso no puede ir más de ${MAX_REPROCESO_DIAS} días atrás`
        )
      reprocessSince = date
    }
    return withLock(`email:${userId}`, () =>
      syncUserMailboxes(makeEmailConnectionDeps(), userId, { reprocessSince })
    )
  })
}
