// Resolver una clave de integración en el momento de usarla: variable de entorno no vacía → lo
// guardado en Ajustes → null. El entorno se mira en cada uso; lo guardado se lee una vez por
// proceso (la caché de las deps) y guardar la vacía, así un cambio rige en el siguiente uso.
import {
  INTEGRATION_KEYS,
  type IntegrationKey,
} from "../../../../lib/integration-settings-schemas.ts"
import type {
  IntegrationDeps,
  ResolvedSetting,
} from "../../domain/integrations/integrations.domain.ts"

/** Valor de la variable de entorno si no está vacía. */
export function envValue(deps: IntegrationDeps, key: IntegrationKey): string | null {
  const value = deps.env[key]?.trim()
  return value ? value : null
}

/** Lo guardado en Ajustes, descifrado. Un secreto que no se descifra queda como no configurado. */
export async function storedIntegration(
  deps: IntegrationDeps,
  key: IntegrationKey
): Promise<ResolvedSetting> {
  if (deps.cache.size === 0) {
    const rows = new Map((await deps.settings.list()).map((r) => [r.key, r]))
    for (const k of Object.keys(INTEGRATION_KEYS) as IntegrationKey[]) {
      const row = rows.get(k)
      let resolved: ResolvedSetting = null
      if (row) {
        try {
          const value = INTEGRATION_KEYS[k].secret ? deps.cipher.decrypt(row.value) : row.value
          resolved = { value, updatedAt: row.updatedAt }
        } catch {
          console.warn(`[integrations] ${k} guardada en Ajustes no se pudo descifrar (¿cambió BANCOCHILE_ENC_KEY?); queda sin configurar`)
        }
      }
      deps.cache.set(k, resolved)
    }
  }
  return deps.cache.get(key) ?? null
}

export async function resolveIntegration(
  deps: IntegrationDeps,
  key: IntegrationKey
): Promise<string | null> {
  return envValue(deps, key) ?? (await storedIntegration(deps, key))?.value ?? null
}
