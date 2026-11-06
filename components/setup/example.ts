import type {
  IntegrationsStatus,
  SetupStatus,
} from "@/lib/integration-settings-schemas"

// Datos de ejemplo mientras no existe GET /api/setup: una instalación de producción recién
// levantada (falta Resend). Con `local: true` se ve el paso del correo como opcional.
export const setupExample: SetupStatus = {
  needed: true,
  verified: false,
  local: false,
  missingRequired: ["RESEND_API_KEY", "RESEND_FROM"],
  integrations: null,
}

// Una instalación recién levantada: nada guardado en Ajustes y el client id de Outlook en el entorno,
// para ver la fila bloqueada.
export const setupIntegrationsExample: IntegrationsStatus = {
  entries: [
    { key: "OPENAI_API_KEY", source: "none", display: null, updatedAt: null },
    { key: "OPENAI_MODEL", source: "none", display: null, updatedAt: null },
    {
      key: "OUTLOOK_CLIENT_ID",
      source: "env",
      display: "3f2b9c1e-7a4d-4e1b-9c2a-5d8e6f1a2b3c",
      updatedAt: null,
    },
    {
      key: "OUTLOOK_CLIENT_SECRET",
      source: "none",
      display: null,
      updatedAt: null,
    },
    { key: "OUTLOOK_TENANT", source: "none", display: null, updatedAt: null },
    { key: "RESEND_API_KEY", source: "none", display: null, updatedAt: null },
    { key: "RESEND_FROM", source: "none", display: null, updatedAt: null },
  ],
}
