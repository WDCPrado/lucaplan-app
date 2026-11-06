import {
  setupStatus,
  setupVerifyInput,
  type IntegrationsStatus,
  type SetupStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { ApiError } from "../finance/onboarding/http"
import {
  getIntegrations,
  updateIntegrations,
} from "../finance/integrations/http"
import { setupExample } from "./example"

// Llamadas de la instalación inicial (/setup) contra el contrato (lib/integration-settings-schemas.ts).
// ponytail: mientras faltan las rutas devuelve example.ts; pasa al fetch real de GET /api/setup,
// POST /api/setup/verify y PUT /api/setup/integrations cuando queden en verde.

export async function getSetupStatus(): Promise<SetupStatus> {
  return setupStatus.parse(setupExample)
}

export async function verifySetupCode(code: string): Promise<void> {
  await new Promise((r) => setTimeout(r, 400))
  const input = setupVerifyInput.safeParse({ code })
  if (!input.success)
    throw new ApiError(input.error.issues[0]?.message ?? "Código inválido", 422)
  // En el ejemplo, 0000-0000 simula el código equivocado (401).
  if (input.data.code.replace("-", "") === "00000000")
    throw new ApiError("El código no coincide con el de la consola.", 401)
}

// ponytail: GET /api/setup no trae el estado de cada clave; mientras, se parte del ejemplo de
// Integraciones (ver duda de contrato).
export const getSetupIntegrations = getIntegrations

export function saveSetupIntegrations(
  values: UpdateIntegrationsInput["values"]
): Promise<IntegrationsStatus> {
  return updateIntegrations(values, "/api/setup/integrations")
}
