import { timingSafeEqual } from "node:crypto"
import { makeEmailConnectionDeps } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import { renewMailboxSubscriptions } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"

function authorized(req: Request): boolean {
  const secret = process.env.OUTLOOK_RENEW_SECRET
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  if (!secret || supplied.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
}

// Llamar cada 12 horas desde el scheduler del despliegue. No requiere sesión de usuario, pero sí
// un secreto dedicado; solo renueva suscripciones próximas a vencer y nunca devuelve tokens.
// La suscripción es del BUZÓN: se renueva una vez por correo, no una por banco. Va por el router,
// así que cada buzón se renueva con su proveedor y los que no tengan suscripción que renovar
// devuelven null sin romper la pasada.
export async function POST(req: Request) {
  if (!authorized(req))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  return Response.json(await renewMailboxSubscriptions(makeEmailConnectionDeps()))
}
