import { passkey } from "@better-auth/passkey"
import { APIError, createAuthMiddleware } from "better-auth/api"

// Biometría (huella o cara): passkeys WebAuthn con las rutas del plugin, sin rutas propias.
// Registrar exige sesión; entrar no, y solo sirve con una passkey ya guardada: nunca crea cuentas,
// y una cuenta bloqueada no entra porque el admin plugin corta la creación de la sesión.

export const PASSKEY_NAME_MAX = 60

// Sin renombrar: para cambiar el nombre se quita y se agrega de nuevo.
export const PASSKEY_DISABLED_PATHS = ["/passkey/update-passkey"]

// Al entrar, 401; al registrar, 400, porque un 401 ahí se lee como sesión vencida.
const userNotVerified = (status: "UNAUTHORIZED" | "BAD_REQUEST") =>
  new APIError(status, {
    message: "El aparato no confirmó tu huella, cara o PIN.",
    code: "PASSKEY_USER_NOT_VERIFIED",
  })

/**
 * `url`: el origen público de la app (la URL canónica o, en un PR de Railway, su dominio). Las
 * passkeys son de ese host y solo valen desde ese origen. Sin URL, el plugin toma el host de
 * `request.url` (detrás de un proxy, la dirección interna) y el origen del header `Origin`.
 * `residentKey: "required"`: la credencial queda en el aparato y se entra sin escribir el correo.
 * Se exige verificar a la persona (huella, cara o PIN del aparato), no solo tenerlo: al registrar se
 * pide al navegador y en ambos lados se comprueba en el servidor, porque el plugin no lo exige.
 */
export function createPasskeyPlugin(url?: string) {
  const plugin = passkey({
    rpName: "Luca Plan",
    ...(url ? { rpID: new URL(url).hostname, origin: new URL(url).origin } : {}),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    registration: {
      afterVerification: async ({ verification }) => {
        if (!verification.registrationInfo?.userVerified) throw userNotVerified("BAD_REQUEST")
      },
    },
    authentication: {
      // Corre antes de crear la sesión. Las opciones de entrar piden UV "preferred" (fijo en el
      // plugin); el lector de huella o cara del aparato la hace igual, y si no la hizo no entra.
      afterVerification: async ({ verification }) => {
        if (!verification.authenticationInfo.userVerified) throw userNotVerified("UNAUTHORIZED")
      },
    },
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
  const hooks = (plugin as { hooks?: { before?: (typeof guard)[] } }).hooks
  return { ...plugin, hooks: { ...hooks, before: [...(hooks?.before ?? []), guard] } }
}
