// Callback del OAuth de Outlook. Verifica el estado firmado contra la sesión, canjea el código con
// el verifier PKCE (cookie httpOnly) y persiste el BUZÓN con el refresh token cifrado; después
// vincula a ese buzón el banco que venía firmado en el estado. Nunca expone tokens al navegador:
// termina con un redirect al dashboard con un flag de resultado.
import { cookies } from "next/headers"
import { sessionGateway } from "@/arch/v1/infrastructure/auth/session.gateway"
import { OAuthStateError } from "@/arch/v1/domain/finance/email-connection.domain"
import {
  addBankLink,
  connectMailbox,
} from "@/arch/v1/application/finance-use-cases/email-connection-use-cases"
import {
  connectionMethodRepository,
  emailBankLinkRepository,
  emailMailboxRepository,
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
    const intent = verifyOAuthState(state, userId)
    const tokens = await exchangeCodeForTokens(outlookConfig(), code, verifier)
    if (!tokens.refreshToken)
      return redirectTo(req, { outlook: "error", reason: "no_refresh_token" })
    const emailAddress = emailFromIdToken(tokens.idToken) ?? "cuenta Outlook"
    const deps = {
      mailboxes: emailMailboxRepository,
      links: emailBankLinkRepository,
      methods: connectionMethodRepository,
    }
    const { mailbox } = await connectMailbox(deps, userId, {
      emailAddress,
      refreshToken: tokens.refreshToken,
    })

    // Reconexión pura (sin banco en el estado): el buzón recupera su autorización y todos sus
    // bancos vuelven a sincronizar sin tocar nada más.
    if (!intent.bankProvider) return redirectTo(req, { outlook: "reconnected" })

    const existing = await emailBankLinkRepository.listByMailbox(mailbox.id)
    const already = existing.find(
      (l) => l.bankProvider === intent.bankProvider
    )
    // Volver a autorizar un correo que ya alimenta ese banco no crea un vínculo nuevo: si su setup
    // quedó a medias, se retoma; si estaba andando, se sigue.
    if (already)
      return redirectTo(req, {
        outlook: already.bankId ? "reconnected" : "setup",
        link: already.id,
      })

    const link = await addBankLink(deps, userId, {
      mailboxId: mailbox.id,
      bankProvider: intent.bankProvider,
      label: intent.label,
    })
    return redirectTo(req, { outlook: "setup", link: link.id })
  } catch (e) {
    if (e instanceof OAuthStateError)
      return redirectTo(req, { outlook: "error", reason: "state" })
    const name = (e as Error).name
    if (name === "ConnectionMethodConflictError")
      return redirectTo(req, { outlook: "error", reason: "method" })
    if (name === "BankLabelRequiredError")
      return redirectTo(req, { outlook: "error", reason: "label" })
    if (name === "BankAlreadyLinkedError")
      return redirectTo(req, { outlook: "error", reason: "duplicate" })
    console.error("[email-connection] callback OAuth falló:", name) // sin tokens ni PII
    return redirectTo(req, { outlook: "error", reason: "exchange" })
  }
}
