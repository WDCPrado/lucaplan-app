// Inicio del OAuth para conectar un CORREO. El proveedor elegido, el banco y su etiqueta viajan
// firmados en el estado: al volver, el callback sabe con quién habló y qué vincular a ese buzón.
// El verifier PKCE viaja en una cookie httpOnly de corta vida (nunca al JS del cliente); ningún
// token se genera aquí.
import { cookies } from "next/headers"
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import { bankByKey } from "@/arch/v1/application/finance-use-cases/bank-email-registry"
import {
  PKCE_COOKIE,
  signOAuthState,
} from "@/arch/v1/infrastructure/http/email/oauth-state"
import {
  DEFAULT_EMAIL_PROVIDER,
  EMAIL_PROVIDER_REGISTRY,
} from "@/arch/v1/infrastructure/http/email/provider-registry"

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string
    bankProvider?: string
    label?: string
  }
  return withUser(req, async (userId) => {
    // Proveedor desconocido o sin credenciales en el servidor: se responde igual que antes, sin
    // mandar al usuario a una pantalla de consentimiento que va a fallar. El mensaje NO repite la
    // clave que mandó el cliente: es entrada de usuario y no hay nada que ganar devolviéndola.
    const provider = EMAIL_PROVIDER_REGISTRY.find(
      (p) => p.key === (body.provider ?? DEFAULT_EMAIL_PROVIDER)
    )
    if (!provider)
      return { ok: false, error: "Proveedor de correo no soportado" }
    if (!(await provider.oauth.isConfigured()))
      return { ok: false, error: provider.notConfiguredError }
    // Falla acá si el banco no existe, antes de mandar al usuario al proveedor.
    const bank = bankByKey(body.bankProvider ?? "bancochile")
    const state = signOAuthState(userId, {
      provider: provider.key,
      bankProvider: bank.key,
      label: body.label?.trim() || null,
    })
    const { url, pkceVerifier, secureCookie } =
      await provider.oauth.authorization(state)
    const cookieStore = await cookies()
    cookieStore.set(PKCE_COOKIE, pkceVerifier, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax",
      path: "/api/email-connection",
      maxAge: 600,
    })
    return { ok: true, url }
  })
}
