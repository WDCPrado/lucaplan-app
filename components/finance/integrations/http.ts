import {
  integrationsStatus,
  type IntegrationsStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { financeResponseError } from "../finance-form-field"
import { ApiError } from "../onboarding/http"

export { ApiError }

// Llamadas de Ajustes → Integraciones contra el contrato (lib/integration-settings-schemas.ts). Un
// error lanza con el mensaje de la API ({ error }) y su status; la respuesta pasa por su esquema.
async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, { cache: "no-store", ...init })
  if (!res.ok)
    throw new ApiError(
      await financeResponseError(
        res,
        "No se pudo completar. Vuelve a intentarlo."
      ),
      res.status
    )
  return integrationsStatus.parse(await res.json())
}

export function getIntegrations(): Promise<IntegrationsStatus> {
  return call("/api/integrations")
}

// `url`: Ajustes usa la de siempre; la instalación inicial, /api/setup/integrations (mismas reglas).
export function updateIntegrations(
  values: UpdateIntegrationsInput["values"],
  url = "/api/integrations"
): Promise<IntegrationsStatus> {
  return call(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ values }),
  })
}
