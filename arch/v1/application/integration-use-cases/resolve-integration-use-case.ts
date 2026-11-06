// Resolver una clave de integración en el momento de usarla: variable de entorno no vacía → lo
// guardado en Ajustes → null. El entorno se mira en cada uso; lo guardado se lee una vez por
// proceso (la caché de las deps guarda la promesa de esa lectura) y guardar la vacía, así un cambio
// rige en el siguiente uso.
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
  let loading = deps.cache.get("stored")
  if (!loading) {
    const p = loadStored(deps)
    loading = p
    deps.cache.set("stored", p)
    // Si la lectura falla no queda cacheada; solo se saca si sigue siendo la de la caché.
    p.catch(() => {
      if (deps.cache.get("stored") === p) deps.cache.delete("stored")
    })
  }
  return (await loading).get(key) ?? null
}

async function loadStored(deps: IntegrationDeps) {
  const rows = new Map((await deps.settings.list()).map((r) => [r.key, r]))
  const resolved = new Map<IntegrationKey, ResolvedSetting>()
  for (const k of Object.keys(INTEGRATION_KEYS) as IntegrationKey[]) {
    const row = rows.get(k)
    let value: ResolvedSetting = null
    if (row) {
      try {
        value = {
          value: INTEGRATION_KEYS[k].secret ? deps.cipher.decrypt(row.value) : row.value,
          updatedAt: row.updatedAt,
        }
      } catch {
        console.warn(`[integrations] ${k} guardada en Ajustes no se pudo descifrar (¿cambió BANCOCHILE_ENC_KEY?); queda sin configurar`)
      }
    }
    resolved.set(k, value)
  }
  return resolved
}

export async function resolveIntegration(
  deps: IntegrationDeps,
  key: IntegrationKey
): Promise<string | null> {
  return envValue(deps, key) ?? (await storedIntegration(deps, key))?.value ?? null
}
