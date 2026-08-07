// Inicio del OAuth de Outlook para conectar un CORREO. El banco elegido (y su etiqueta) viajan
// firmados en el estado: al volver, el callback sabe qué vincular a ese buzón. Genera PKCE + estado
// firmado y devuelve la URL de autorización de Microsoft. El verifier PKCE viaja en una cookie
// httpOnly de corta vida (nunca al JS del cliente); ningún token se genera aquí.
import { cookies } from "next/headers"
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { bankByKey } from "@/arch/v1/application/finance-use-cases/bank-email-registry"
import {
  buildAuthorizeUrl,
  createPkcePair,
  isOutlookConfigured,
  outlookConfig,
  PKCE_COOKIE,
  signOAuthState,
} from "@/arch/v1/infrastructure/http/outlook/outlook-oauth"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    bankProvider?: string
    label?: string
  }
  return withUser(req, async (userId) => {
    if (!isOutlookConfigured()) {
      return {
        ok: false,
        error:
          "Outlook no está configurado en el servidor (falta OUTLOOK_CLIENT_ID)",
      }
    }
    // Falla acá si el banco no existe, antes de mandar al usuario a Microsoft.
    const bank = bankByKey(body.bankProvider ?? "bancochile")
    const cfg = outlookConfig()
    const { verifier, challenge } = createPkcePair()
    const state = signOAuthState(userId, {
      bankProvider: bank.key,
      label: body.label?.trim() || null,
    })
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
