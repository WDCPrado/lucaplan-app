import {
  setupStatus,
  type IntegrationsStatus,
  type SetupStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { financeResponseError } from "../finance/finance-form-field"
import { ApiError } from "../finance/onboarding/http"
import { updateIntegrations } from "../finance/integrations/http"

// Llamadas de la instalación inicial (/setup) contra el contrato (lib/integration-settings-schemas.ts).
// Un error lanza con el mensaje de la API ({ error }) y su status.

// Ya hay cuentas: GET /api/setup da 404 y la pantalla muestra «Esta instalación ya está lista».
const INSTALLED: SetupStatus = {
  needed: false,
  verified: false,
  local: false,
  missingRequired: [],
  integrations: null,
}

async function fail(res: Response, fallback: string): Promise<never> {
  throw new ApiError(await financeResponseError(res, fallback), res.status)
}

export async function getSetupStatus(): Promise<SetupStatus> {
  const res = await fetch("/api/setup", { cache: "no-store" })
  if (res.status === 404) return INSTALLED
  if (!res.ok)
    await fail(res, "No se pudo cargar la instalación. Recarga la página.")
  return setupStatus.parse(await res.json())
}

// Valida el código (204 + cookie httpOnly) y vuelve a pedir el estado, que ya trae las claves.
export async function verifySetupCode(code: string): Promise<SetupStatus> {
  const res = await fetch("/api/setup/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  })
  if (!res.ok)
    await fail(res, "No se pudo validar el código. Vuelve a intentarlo.")
  return getSetupStatus()
}

export function saveSetupIntegrations(
  values: UpdateIntegrationsInput["values"]
): Promise<IntegrationsStatus> {
  return updateIntegrations(values, "/api/setup/integrations")
}
