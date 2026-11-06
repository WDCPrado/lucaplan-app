// Ver las claves de integración (solo ADMIN): de dónde sale cada una y cómo se ve. Un secreto
// nunca sale completo: «••••» con sus últimos 4 caracteres, o solo «••••» si es tan corto que eso
// lo revelaría.
import {
  INTEGRATION_KEYS,
  type IntegrationKey,
  type IntegrationsStatus,
} from "../../../../lib/integration-settings-schemas.ts"
import type { Actor } from "../../domain/authorization/authorization.domain.ts"
import type { IntegrationDeps } from "../../domain/integrations/integrations.domain.ts"
import { authorize } from "../auth-use-cases/authorize-use-case.ts"
import { envValue, storedIntegration } from "./resolve-integration-use-case.ts"

const display = (key: IntegrationKey, value: string) =>
  !INTEGRATION_KEYS[key].secret ? value : value.length <= 4 ? "••••" : `••••${value.slice(-4)}`

/** Lo mismo que getIntegrations, sin el permiso: para quien ya lo revisó. */
export async function integrationsStatusOf(deps: IntegrationDeps): Promise<IntegrationsStatus> {
  const entries = []
  for (const key of Object.keys(INTEGRATION_KEYS) as IntegrationKey[]) {
    const env = envValue(deps, key)
    const stored = env ? null : await storedIntegration(deps, key)
    entries.push(
      env
        ? { key, source: "env" as const, display: display(key, env), updatedAt: null }
        : stored
          ? { key, source: "app" as const, display: display(key, stored.value), updatedAt: stored.updatedAt.toISOString() }
          : { key, source: "none" as const, display: null, updatedAt: null }
    )
  }
  return { entries }
}

export async function getIntegrations(
  deps: IntegrationDeps,
  actor: Actor | null
): Promise<IntegrationsStatus> {
  authorize(actor, "integrations", "read")
  return integrationsStatusOf(deps)
}
