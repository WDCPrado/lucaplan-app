// Callback del OAuth de Outlook. Verifica el estado firmado contra la sesión, canjea el código con
// el verifier PKCE (cookie httpOnly) y persiste la conexión con el refresh token cifrado. Nunca
// expone tokens al navegador: termina con un redirect al dashboard con un flag de resultado.
import { cookies } from "next/headers"
import { sessionGateway } from "@/arch/v1/infrastructure/auth/session.gateway"
import { OAuthStateError } from "@/arch/v1/domain/finance/email-connection.domain"
import { completeEmailConnection } from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import {
  connectionMethodRepository,
  emailConnectionRepository,
} from "@/arch/v1/infrastructure/database/prisma/email-connection.infrastructure"
import {
  emailFromIdToken,
  exchangeCodeForTokens,
  outlookConfig,
  PKCE_COOKIE,
  verifyOAuthState,
} from "@/arch/v1/infrastructure/http/outlook/outlook-oauth"

function redirectTo(req: Request, params: Record<string, string>): Response {
  // La base es la URL PÚBLICA de la app (BETTER_AUTH_URL), no `req.url`: detrás del reverse proxy
  // `req.url` trae la dirección interna del contenedor (localhost:3005) y el 302 terminaría ahí.
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin
  const url = new URL("/dashboard", base)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return Response.redirect(url, 302)
}

export async function GET(req: Request) {
  const actor = await sessionGateway.getActor(req.headers)
  if (!actor) return redirectTo(req, { outlook: "error", reason: "session" })
  const userId = actor.userId

  const sp = new URL(req.url).searchParams
  const code = sp.get("code")
  const state = sp.get("state")
  if (sp.get("error") || !code || !state)
    return redirectTo(req, { outlook: "error", reason: "denied" })

  const cookieStore = await cookies()
  const verifier = cookieStore.get(PKCE_COOKIE)?.value
  cookieStore.delete(PKCE_COOKIE)
  if (!verifier) return redirectTo(req, { outlook: "error", reason: "state" })

  try {
    verifyOAuthState(state, userId)
    const tokens = await exchangeCodeForTokens(outlookConfig(), code, verifier)
    if (!tokens.refreshToken)
      return redirectTo(req, { outlook: "error", reason: "no_refresh_token" })
    const emailAddress = emailFromIdToken(tokens.idToken) ?? "cuenta Outlook"
    const { connection, reconnected } = await completeEmailConnection(
      {
        emailConnections: emailConnectionRepository,
        methods: connectionMethodRepository,
      },
      userId,
      { emailAddress, refreshToken: tokens.refreshToken }
    )
    // Conexión nueva → asistente de configuración; reconexión con banco → sigue operando.
    const step = !reconnected || !connection.bankId ? "setup" : "reconnected"
    return redirectTo(req, { outlook: step })
  } catch (e) {
    if (e instanceof OAuthStateError)
      return redirectTo(req, { outlook: "error", reason: "state" })
    if ((e as Error).name === "ConnectionMethodConflictError")
      return redirectTo(req, { outlook: "error", reason: "method" })
    console.error("[email-connection] callback OAuth falló:", (e as Error).name) // sin tokens ni PII
    return redirectTo(req, { outlook: "error", reason: "exchange" })
  }
}
