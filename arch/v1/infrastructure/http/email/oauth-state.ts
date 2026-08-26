// Estado OAuth firmado, común a TODOS los proveedores de correo. Es lo único que sobrevive el viaje
// al proveedor, así que lleva dentro lo que el callback necesita para retomar: el proveedor elegido,
// el banco a vincular y su etiqueta. Va firmado con HMAC derivado del secreto maestro: nada que
// guardar server-side y nada que el navegador pueda alterar sin romper la firma.
//
// Vive acá y no dentro de `outlook/` porque una sola ruta de callback atiende a todos los
// proveedores: el módulo OAuth concreto lo elige el callback leyendo `provider` de este estado.
import { randomBytes, timingSafeEqual } from "node:crypto"
import { OAuthStateError } from "../../../domain/finance/email-connection.domain.ts"
import { deriveVerifier, EMAIL_PURPOSE } from "../../crypto/secret-crypto.ts"

const STATE_TTL_MS = 10 * 60 * 1000 // el callback debe volver dentro de 10 minutos

// Cookie httpOnly de corta vida que transporta el verifier PKCE entre /connect y /callback. Una
// sola para todos los proveedores: solo hay un flujo OAuth en vuelo por navegador.
export const PKCE_COOKIE = "email_pkce"

// El nombre anterior, cuando la conexión era solo de Outlook. El callback la sigue LEYENDO para no
// romper a quien apretó "Conectar" justo antes del deploy: su cookie se llama así y sin esto
// volvería del OAuth a un error de estado. Vive 10 minutos, así que se puede borrar de acá un
// release después de este.
export const LEGACY_PKCE_COOKIE = "outlook_pkce"

// Ámbito de la cookie. El borrado tiene que repetirlo: sin `path`, `delete` apunta a "/" y no
// alcanza a la que se fijó bajo /api/email-connection, que sobreviviría sus 600 segundos.
export const PKCE_COOKIE_PATH = "/api/email-connection"

const STATE_PURPOSE = `${EMAIL_PURPOSE}:oauth-state`

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

// Lo que viaja firmado hasta el callback. `provider` es la clave del proveedor de correo
// (`outlook`, …); `bankProvider` y `label`, el banco que se vincula al volver.
export type OAuthIntent = {
  provider?: string
  bankProvider?: string
  label?: string | null
}

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
        p: intent.provider,
        b: intent.bankProvider,
        l: intent.label ?? undefined,
      })
    )
  )
  return `${payload}.${deriveVerifier(STATE_PURPOSE, payload)}`
}

// Verifica firma, expiración y que el estado pertenezca al usuario de la sesión; devuelve la
// intención (proveedor + banco a vincular) que viajó dentro.
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
  let decoded: { u?: string; e?: number; p?: string; b?: string; l?: string }
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
  return {
    provider: decoded.p,
    bankProvider: decoded.b,
    label: decoded.l ?? null,
  }
}
