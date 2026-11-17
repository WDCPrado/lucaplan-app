import { passkey } from "@better-auth/passkey"
import { APIError, createAuthMiddleware } from "better-auth/api"

// Biometría (huella o cara): passkeys WebAuthn con las rutas del plugin, sin rutas propias.
// Registrar exige sesión; entrar no, y solo sirve con una passkey ya guardada: nunca crea cuentas,
// y una cuenta bloqueada no entra porque el admin plugin corta la creación de la sesión.

export const PASSKEY_NAME_MAX = 60

// Sin renombrar: para cambiar el nombre se quita y se agrega de nuevo.
export const PASSKEY_DISABLED_PATHS = ["/passkey/update-passkey"]

/**
 * Con URL canónica (BETTER_AUTH_URL), las passkeys son de ese host y solo valen desde ese origen.
 * Sin ella, el plugin toma el host del pedido y el origen del header `Origin`.
 * `residentKey: "required"`: la credencial queda en el aparato y se entra sin escribir el correo.
 */
export function createPasskeyPlugin(canonical?: { origin: string }) {
  const plugin = passkey({
    rpName: "Luca Plan",
    ...(canonical
      ? { rpID: new URL(canonical.origin).hostname, origin: canonical.origin }
      : {}),
    authenticatorSelection: { residentKey: "required" },
  })
  const guard = {
    matcher: (ctx: { path?: string }) =>
      ctx.path === "/passkey/generate-register-options" ||
      ctx.path === "/passkey/verify-registration",
    handler: createAuthMiddleware(async (ctx) => {
      // El cliente manda el nombre también en el query, y el plugin lo usaría como nombre de
      // usuario de la credencial: el selector del aparato mostraría "Pixel · Chrome" en vez del
      // correo. Vacío, el plugin usa el correo de la sesión.
      if (ctx.path === "/passkey/generate-register-options")
        return { context: { query: { ...ctx.query, name: "" } } }
      const name = (ctx.body as { name?: unknown } | undefined)?.name
      if (typeof name === "string" && name.trim().length > PASSKEY_NAME_MAX)
        throw new APIError("BAD_REQUEST", {
          message: `El nombre tiene más de ${PASSKEY_NAME_MAX} caracteres.`,
        })
    }),
  }
  return { ...plugin, hooks: { before: [guard] } }
}
