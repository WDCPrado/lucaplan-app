import { timingSafeEqual } from "node:crypto"
import { emailMailboxRepository } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
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
// La suscripción es del BUZÓN: se renueva una vez por correo, no una por banco.
export async function POST(req: Request) {
  if (!authorized(req))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  const renewBefore = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const mailboxes =
    await emailMailboxRepository.listForSubscriptionRenewal(renewBefore)
  let renewed = 0
  let failed = 0
  for (const mailbox of mailboxes) {
    try {
      const subscription = await msgraphMailProvider.ensureSubscription(
        mailbox.id
      )
      if (subscription) {
        await emailMailboxRepository.update(mailbox.id, {
          subscriptionId: subscription.subscriptionId,
          subscriptionExpiresAt: subscription.expiresAt,
          lastError: null,
        })
        renewed++
      }
    } catch (error) {
      failed++
      await emailMailboxRepository
        .update(mailbox.id, {
          status:
            (error as Error).name === "EmailReauthRequiredError"
              ? "reauth_required"
              : "error",
          lastError: (error as Error).message,
        })
        .catch(() => {})
    }
  }
  return Response.json({ checked: mailboxes.length, renewed, failed })
}
