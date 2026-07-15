import { timingSafeEqual } from "node:crypto"
import { prisma } from "@/arch/v1/infrastructure/database/prisma/client"
import { msgraphMailProvider } from "@/arch/v1/infrastructure/http/outlook/msgraph.provider"

function authorized(req: Request): boolean {
  const secret = process.env.OUTLOOK_RENEW_SECRET
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? ""
  if (!secret || supplied.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
}

// Llamar cada 12 horas desde el scheduler del despliegue. No requiere sesión de usuario, pero sí
// un secreto dedicado; solo renueva suscripciones próximas a vencer y nunca devuelve tokens.
export async function POST(req: Request) {
  if (!authorized(req))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  const renewBefore = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const rows = await prisma.emailConnection.findMany({
    where: {
      status: "active",
      OR: [
        { subscriptionExpiresAt: null },
        { subscriptionExpiresAt: { lt: renewBefore } },
      ],
    },
    select: { id: true },
  })
  let renewed = 0
  let failed = 0
  for (const row of rows) {
    try {
      const subscription = await msgraphMailProvider.ensureSubscription(row.id)
      if (subscription) {
        await prisma.emailConnection.update({
          where: { id: row.id },
          data: {
            subscriptionId: subscription.subscriptionId,
            subscriptionExpiresAt: subscription.expiresAt,
            lastError: null,
          },
        })
        renewed++
      }
    } catch (error) {
      failed++
      await prisma.emailConnection
        .update({
          where: { id: row.id },
          data: {
            status:
              (error as Error).name === "EmailReauthRequiredError"
                ? "reauth_required"
                : "error",
            lastError: (error as Error).message,
          },
        })
        .catch(() => {})
    }
  }
  return Response.json({ checked: rows.length, renewed, failed })
}
