// Cambiar claves de integración (solo ADMIN). Solo las que vienen en la entrada; null borra. Una
// clave que viene del entorno no se toca (409) y en ese caso no se escribe nada del envío. Tampoco
// se guarda un secreto fuera de local sin BANCOCHILE_ENC_KEY en el entorno (409, nada del envío).
// El log dice cuál y quién, nunca el valor.
import {
  INTEGRATION_KEYS,
  updateIntegrationsInput,
  type IntegrationKey,
  type IntegrationsStatus,
} from "../../../../lib/integration-settings-schemas.ts"
import type { Actor } from "../../domain/authorization/authorization.domain.ts"
import {
  IntegrationEncKeyMissingError,
  IntegrationFromEnvError,
  type IntegrationDeps,
} from "../../domain/integrations/integrations.domain.ts"
import { authorize } from "../auth-use-cases/authorize-use-case.ts"
import { envValue } from "./resolve-integration-use-case.ts"
import { integrationsStatusOf } from "./get-integrations-use-case.ts"

export async function updateIntegrations(
  deps: IntegrationDeps,
  actor: Actor | null,
  input: unknown
): Promise<IntegrationsStatus> {
  const { userId } = authorize(actor, "integrations", "update")
  return applyIntegrationChanges(deps, userId, input)
}

/** El cambio sin el permiso, para quien ya autorizó (el asistente de /setup). `who` va al log. */
export async function applyIntegrationChanges(
  deps: IntegrationDeps,
  who: string,
  input: unknown
): Promise<IntegrationsStatus> {
  const changes = Object.entries(updateIntegrationsInput.parse(input).values) as [
    IntegrationKey,
    string | null,
  ][]
  for (const [key] of changes) if (envValue(deps, key)) throw new IntegrationFromEnvError(key)
  const local = deps.env.NODE_ENV === "development" && !deps.env.RAILWAY_ENVIRONMENT_NAME
  if (
    !local &&
    (deps.env.BANCOCHILE_ENC_KEY?.length ?? 0) < 32 &&
    changes.some(([key, value]) => value !== null && INTEGRATION_KEYS[key].secret)
  )
    throw new IntegrationEncKeyMissingError()
  try {
    // ponytail: una escritura por clave, sin transacción; si la base cae a la mitad quedan las
    // primeras guardadas y reintentar el envío completa el resto.
    for (const [key, value] of changes) {
      if (value === null) await deps.settings.remove(key)
      else await deps.settings.save(key, INTEGRATION_KEYS[key].secret ? deps.cipher.encrypt(value) : value)
      console.info(`[integrations] ${key} ${value === null ? "borrada" : "actualizada"} por ${who}`)
    }
  } finally {
    deps.cache.clear()
  }
  return integrationsStatusOf(deps)
}
