import {
  INTEGRATION_KEYS,
  integrationsStatus,
  updateIntegrationsInput,
  type IntegrationKey,
  type IntegrationsStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { ApiError } from "../onboarding/http"
import { integrationsExample } from "./example"

export { ApiError }

// Llamadas de Ajustes → Integraciones contra el contrato (lib/integration-settings-schemas.ts).
// ponytail: mientras falta la API devuelve example.ts y simula el PUT en memoria; pasa al fetch
// real de GET/PUT /api/integrations cuando el endpoint quede en verde.
export const USING_EXAMPLE = true

let example: IntegrationsStatus = integrationsStatus.parse(integrationsExample)

export async function getIntegrations(): Promise<IntegrationsStatus> {
  return example
}

// `url`: Ajustes usa la de siempre; la instalación inicial, /api/setup/integrations (mismas reglas).
export async function updateIntegrations(
  values: UpdateIntegrationsInput["values"],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- la usa el fetch real
  url = "/api/integrations"
): Promise<IntegrationsStatus> {
  await new Promise((r) => setTimeout(r, 400))
  const input = updateIntegrationsInput.safeParse({ values })
  if (!input.success)
    throw new ApiError(input.error.issues[0]?.message ?? "Valor inválido", 422)
  const now = new Date().toISOString()
  example = integrationsStatus.parse({
    entries: example.entries.map((entry) => {
      if (!(entry.key in values)) return entry
      if (entry.source === "env")
        throw new ApiError(
          "Esta clave viene del servidor y no se puede cambiar aquí.",
          409
        )
      const value = values[entry.key as IntegrationKey]
      if (value == null)
        return { ...entry, source: "none", display: null, updatedAt: null }
      const display = INTEGRATION_KEYS[entry.key].secret
        ? `••••${value.slice(-4)}`
        : value
      return { ...entry, source: "app", display, updatedAt: now }
    }),
  })
  return example
}
