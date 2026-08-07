// OAuth 2.0 de Microsoft (cuentas personales Outlook) con Authorization Code + PKCE y estado
// firmado. Permiso delegado mínimo: Mail.Read (+ openid/email para conocer la dirección). Ningún
// token se expone al cliente ni se registra en logs; el refresh token se persiste cifrado en la
// capa de datos. Todo con `fetch` nativo, sin SDK.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import {
  OAuthStateError,
  EmailReauthRequiredError,
} from "../../../domain/finance/email-connection.domain.ts"
import { deriveVerifier, EMAIL_PURPOSE } from "../../crypto/secret-crypto.ts"

const STATE_TTL_MS = 10 * 60 * 1000 // el callback debe volver dentro de 10 minutos

// Cookie httpOnly de corta vida que transporta el verifier PKCE entre /connect y /callback.
export const PKCE_COOKIE = "outlook_pkce"

// Scopes: lectura de correo + identidad mínima para conocer la dirección + offline (refresh token).
const SCOPES =
  "openid profile email offline_access https://graph.microsoft.com/Mail.Read"

export type OutlookConfig = {
  clientId: string
  clientSecret: string | null // apps "Web" lo exigen; apps públicas SPA/native solo PKCE
  tenant: string // "consumers" (personal) | "common"
  redirectUri: string
  webhookUrl: string | null // URL HTTPS pública para Graph; null = sin webhook (solo manual/delta)
}

// Configuración desde el entorno. Lanza si falta lo esencial (client id / redirect).
export function outlookConfig(): OutlookConfig {
  const clientId = process.env.OUTLOOK_CLIENT_ID
  if (!clientId)
    throw new Error(
      "Falta OUTLOOK_CLIENT_ID (registro de app en Microsoft Entra)"
    )
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  return {
    clientId,
    clientSecret: process.env.OUTLOOK_CLIENT_SECRET || null,
    tenant: process.env.OUTLOOK_TENANT || "consumers",
    redirectUri:
      process.env.OUTLOOK_REDIRECT_URI ||
      `${base}/api/email-connection/callback`,
    webhookUrl: process.env.OUTLOOK_WEBHOOK_URL || null,
  }
}

export function isOutlookConfigured(): boolean {
  return Boolean(process.env.OUTLOOK_CLIENT_ID)
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

// --- Estado firmado (HMAC derivado del secreto maestro; nada que guardar server-side) ---

const STATE_PURPOSE = `${EMAIL_PURPOSE}:oauth-state`

// El banco elegido y su etiqueta viajan FIRMADOS en el estado: al volver del OAuth hay que saber
// qué vincular a este buzón, y el estado es lo único que sobrevive el viaje a Microsoft.
export type OAuthIntent = { bankProvider?: string; label?: string | null }

export function signOAuthState(
  userId: string,
  intent: OAuthIntent = {},
  now = new Date()
): string {
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        u: userId,
        e: now.getTime() + STATE_TTL_MS,
        n: b64url(randomBytes(8)),
        b: intent.bankProvider,
        l: intent.label ?? undefined,
      })
    )
  )
  return `${payload}.${deriveVerifier(STATE_PURPOSE, payload)}`
}

// Verifica firma, expiración y que el estado pertenezca al usuario de la sesión; devuelve la
// intención (banco a vincular) que viajó dentro.
export function verifyOAuthState(
  state: string,
  userId: string,
  now = new Date()
): OAuthIntent {
  const [payload, sig] = state.split(".")
  const expected = payload ? deriveVerifier(STATE_PURPOSE, payload) : ""
  if (
    !payload ||
    !sig ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    throw new OAuthStateError()
  }
  let decoded: { u?: string; e?: number; b?: string; l?: string }
  try {
    decoded = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    )
  } catch {
    throw new OAuthStateError()
  }
  if (
    decoded.u !== userId ||
    typeof decoded.e !== "number" ||
    decoded.e < now.getTime()
  )
    throw new OAuthStateError()
  return { bankProvider: decoded.b, label: decoded.l ?? null }
}

// --- PKCE ---

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(48)) // 64 chars, dentro de [43,128]
  const challenge = b64url(createHash("sha256").update(verifier).digest())
  return { verifier, challenge }
}

// URL de autorización de Microsoft para redirigir al usuario.
export function buildAuthorizeUrl(
  cfg: OutlookConfig,
  state: string,
  challenge: string
): string {
  const url = new URL(
    `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/authorize`
  )
  url.searchParams.set("client_id", cfg.clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", cfg.redirectUri)
  url.searchParams.set("response_mode", "query")
  url.searchParams.set("scope", SCOPES)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("prompt", "select_account")
  return url.toString()
}

// --- Token endpoint ---

export type TokenSet = {
  accessToken: string
  refreshToken: string | null // Microsoft puede rotarlo en cada refresh
  expiresAt: Date
  idToken: string | null
}

async function tokenRequest(
  cfg: OutlookConfig,
  params: Record<string, string>
): Promise<TokenSet> {
  const body = new URLSearchParams({ client_id: cfg.clientId, ...params })
  if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret)
  const res = await fetch(
    `https://login.microsoftonline.com/${cfg.tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }
  )
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    id_token?: string
    error?: string
    error_description?: string
  }
  if (!res.ok || !data.access_token) {
    // Autorización revocada/expirada → reconexión (los datos se conservan). Sin tokens en el mensaje.
    if (data.error === "invalid_grant" || data.error === "interaction_required")
      throw new EmailReauthRequiredError()
    throw new Error(
      `Token de Microsoft rechazado (${res.status}): ${data.error ?? "error desconocido"}`
    )
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    idToken: data.id_token ?? null,
  }
}

export function exchangeCodeForTokens(
  cfg: OutlookConfig,
  code: string,
  pkceVerifier: string
): Promise<TokenSet> {
  return tokenRequest(cfg, {
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: pkceVerifier,
  })
}

export function refreshTokens(
  cfg: OutlookConfig,
  refreshToken: string
): Promise<TokenSet> {
  return tokenRequest(cfg, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: SCOPES,
  })
}

// Dirección de correo desde el id_token (viene directo del endpoint de tokens por TLS; no requiere
// verificación de firma para este uso informativo).
export function emailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null
  const parts = idToken.split(".")
  if (parts.length < 2) return null
  try {
    const payload = JSON.parse(
      Buffer.from(
        parts[1].replace(/-/g, "+").replace(/_/g, "/"),
        "base64"
      ).toString("utf8")
    )
    return payload.email ?? payload.preferred_username ?? null
  } catch {
    return null
  }
}
