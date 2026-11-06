import {
  INTEGRATION_KEYS,
  integrationsStatus,
  setupStatus,
  setupVerifyInput,
  updateIntegrationsInput,
  type IntegrationKey,
  type IntegrationsStatus,
  type SetupStatus,
  type UpdateIntegrationsInput,
} from "@/lib/integration-settings-schemas"
import { ApiError } from "../finance/onboarding/http"
import { setupExample, setupIntegrationsExample } from "./example"

// Llamadas de la instalación inicial (/setup) contra el contrato (lib/integration-settings-schemas.ts).
// ponytail: mientras faltan las rutas devuelve example.ts; pasa al fetch real de GET /api/setup,
// POST /api/setup/verify y PUT /api/setup/integrations cuando queden en verde.

// ponytail: estado del ejemplo en memoria; `verified` pasa a true al validar el código y desde ahí
// trae `integrations` (null antes, como dice el contrato).
let verified = false
let integrations = integrationsStatus.parse(setupIntegrationsExample)

export async function getSetupStatus(): Promise<SetupStatus> {
  return setupStatus.parse({
    ...setupExample,
    verified,
    integrations: verified ? integrations : null,
  })
}

// Valida el código y devuelve el estado ya verificado, que trae las claves para los pasos siguientes.
export async function verifySetupCode(code: string): Promise<SetupStatus> {
  await new Promise((r) => setTimeout(r, 400))
  const input = setupVerifyInput.safeParse({ code })
  if (!input.success)
    throw new ApiError(input.error.issues[0]?.message ?? "Código inválido", 422)
  // En el ejemplo, 0000-0000 simula el código equivocado (401).
  if (input.data.code.replace("-", "") === "00000000")
    throw new ApiError("El código no coincide con el de la consola.", 401)
  verified = true
  return getSetupStatus()
}

// Al pasar al fetch real, el PUT es updateIntegrations(values, "/api/setup/integrations").
export async function saveSetupIntegrations(
  values: UpdateIntegrationsInput["values"]
): Promise<IntegrationsStatus> {
  await new Promise((r) => setTimeout(r, 400))
  const input = updateIntegrationsInput.safeParse({ values })
  if (!input.success)
    throw new ApiError(input.error.issues[0]?.message ?? "Valor inválido", 422)
  const now = new Date().toISOString()
  integrations = integrationsStatus.parse({
    entries: integrations.entries.map((entry) => {
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
  return integrations
}
