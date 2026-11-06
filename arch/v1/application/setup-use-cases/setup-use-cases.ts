// Instalación inicial (/setup, WDC-181). Corre solo mientras la base no tiene cuentas: en cuanto
// existe una, todo responde 404. El código de instalación sale en la consola del servidor; quien lo
// verifica recibe un token aleatorio (la cookie del asistente) que habilita guardar las claves y
// crear la primera cuenta, que queda ADMIN.
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import {
  setupVerifyInput,
  type IntegrationKey,
  type IntegrationsStatus,
  type SetupStatus,
} from "../../../../lib/integration-settings-schemas.ts"
import {
  SETUP_MAX_TOTAL_FAILURES,
  SETUP_SESSION_MS,
  SetupDoneError,
  SetupRateLimitedError,
  SetupUnauthorizedError,
  type SetupDeps,
} from "../../domain/setup/setup.domain.ts"
import type { FirstAdminRepository } from "../../domain/user/user.domain.ts"
import { resolveIntegration } from "../integration-use-cases/resolve-integration-use-case.ts"
import { integrationsStatusOf } from "../integration-use-cases/get-integrations-use-case.ts"
import { applyIntegrationChanges } from "../integration-use-cases/update-integrations-use-case.ts"
import { assignFirstAdmin } from "../user-use-cases/assign-first-admin-use-case.ts"

// Sin 0/O ni 1/I: se lee de una consola y se escribe a mano.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
// Sin Resend el código de acceso no llega por correo (salvo en local, donde sale en la consola).
const REQUIRED: readonly IntegrationKey[] = ["RESEND_API_KEY", "RESEND_FROM"]

const isLocal = (env: SetupDeps["env"]) =>
  env.NODE_ENV === "development" && !env.RAILWAY_ENVIRONMENT_NAME

async function assertNotInstalled(deps: SetupDeps) {
  if (await deps.accounts.hasAccounts()) throw new SetupDoneError()
}

function newCode(deps: SetupDeps): string {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")
  deps.state.code = `${part()}-${part()}`
  deps.state.failedTotal = 0
  return deps.state.code
}

/** Genera el código de instalación (una vez por proceso) y lo imprime. null si ya hay cuentas. */
export async function ensureSetupCode(deps: SetupDeps): Promise<string | null> {
  if (await deps.accounts.hasAccounts()) return null
  if (!deps.state.code) console.log(`[setup] Código de instalación: ${newCode(deps)}`)
  return deps.state.code
}

/** ¿El token es una sesión del asistente vigente en este proceso? */
export function isSetupVerified(deps: SetupDeps, token: string | null): boolean {
  if (!token) return false
  const expires = deps.state.sessions.get(token)
  return expires !== undefined && expires > deps.now().getTime()
}

export async function getSetupStatus(deps: SetupDeps, token: string | null): Promise<SetupStatus> {
  await assertNotInstalled(deps)
  const verified = isSetupVerified(deps, token)
  const local = isLocal(deps.env)
  const missingRequired: IntegrationKey[] = []
  if (!local)
    for (const key of REQUIRED)
      if ((await resolveIntegration(deps.integrations, key)) === null) missingRequired.push(key)
  return {
    needed: true,
    verified,
    local,
    missingRequired,
    integrations: verified ? await integrationsStatusOf(deps.integrations) : null,
  }
}

/**
 * Verifica el código de instalación y devuelve el token de la cookie del asistente. Un código mal
 * formado es 422 y no cuenta; cada incorrecto cuenta para el tope por IP, que bloquea también al
 * correcto (429), y para el tope total: al 10.º incorrecto, de cualquier IP, el código se rota.
 */
export async function verifySetupCode(deps: SetupDeps, input: unknown, ip: string): Promise<string> {
  await assertNotInstalled(deps)
  const code = setupVerifyInput.parse(input).code.replace("-", "")
  const now = deps.now().getTime()
  if (deps.state.failures.full(ip, now)) throw new SetupRateLimitedError()
  const expected = Buffer.from((deps.state.code ?? "").replace("-", ""))
  const given = Buffer.from(code)
  if (!deps.state.code || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    deps.state.failures.take(ip, now)
    if (++deps.state.failedTotal >= SETUP_MAX_TOTAL_FAILURES)
      console.log(`[setup] Demasiados intentos: nuevo código de instalación: ${newCode(deps)}`)
    throw new SetupUnauthorizedError()
  }
  for (const [t, expires] of deps.state.sessions) if (expires <= now) deps.state.sessions.delete(t)
  const token = randomBytes(32).toString("base64url")
  deps.state.sessions.set(token, now + SETUP_SESSION_MS)
  return token
}

/** Guarda claves desde el asistente: mismas reglas que Ajustes; en el log, «quién» es `setup`. */
export async function updateSetupIntegrations(
  deps: SetupDeps,
  token: string | null,
  input: unknown
): Promise<IntegrationsStatus> {
  await assertNotInstalled(deps)
  if (!isSetupVerified(deps, token))
    throw new SetupUnauthorizedError("Falta verificar el código de instalación")
  return applyIntegrationChanges(deps.integrations, "setup", input)
}

/**
 * Tras crear una cuenta: queda ADMIN solo si la petición traía la cookie del asistente verificada
 * y es la única cuenta de la base (UPDATE atómico del repo).
 */
export async function promoteFirstAccount(
  deps: SetupDeps,
  users: FirstAdminRepository,
  userId: string,
  token: string | null
): Promise<boolean> {
  if (!isSetupVerified(deps, token)) return false
  return assignFirstAdmin(users, userId)
}
