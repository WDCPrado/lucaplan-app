// Inicio del OAuth de Outlook: valida que el método `email` esté disponible, genera PKCE + estado
// firmado y devuelve la URL de autorización de Microsoft. El verifier PKCE viaja en una cookie
// httpOnly de corta vida (nunca al JS del cliente); ningún token se genera aquí.
import { cookies } from "next/headers"
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { ConnectionMethodConflictError } from "@/arch/v1/domain/finance/email-connection.domain"
import { connectionMethodRepository } from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import {
  buildAuthorizeUrl,
  createPkcePair,
  isOutlookConfigured,
  outlookConfig,
  PKCE_COOKIE,
  signOAuthState,
} from "@/arch/v1/infrastructure/http/outlook/outlook-oauth"

export async function POST(req: Request) {
  return withUser(req, async (userId) => {
    if (!isOutlookConfigured()) {
      return {
        ok: false,
        error:
          "Outlook no está configurado en el servidor (falta OUTLOOK_CLIENT_ID)",
      }
    }
    // Exclusividad: con scraper activo no se inicia OAuth (reconectar la MISMA conexión email sí).
    const active = await connectionMethodRepository.activeMethod(
      userId,
      "bancochile"
    )
    if (active === "scraper") throw new ConnectionMethodConflictError("scraper")

    const cfg = outlookConfig()
    const { verifier, challenge } = createPkcePair()
    const state = signOAuthState(userId)
    const cookieStore = await cookies()
    cookieStore.set(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: cfg.redirectUri.startsWith("https"),
      sameSite: "lax",
      path: "/api/email-connection",
      maxAge: 600,
    })
    return { ok: true, url: buildAuthorizeUrl(cfg, state, challenge) }
  })
}
