import type { IntegrationsStatus } from "@/lib/integration-settings-schemas"

// Datos de ejemplo mientras no existe GET /api/integrations: un estado de cada tipo (Ajustes,
// entorno y vacío) para ver las tres filas. Deja de usarse cuando http.ts pasa al fetch real.
export const integrationsExample: IntegrationsStatus = {
  entries: [
    {
      key: "OPENAI_API_KEY",
      source: "app",
      display: "••••x9Qa",
      updatedAt: "2026-11-04T14:20:00.000Z",
    },
    { key: "OPENAI_MODEL", source: "none", display: null, updatedAt: null },
    {
      key: "OUTLOOK_CLIENT_ID",
      source: "env",
      display: "3f2b9c1e-7a4d-4e1b-9c2a-5d8e6f1a2b3c",
      updatedAt: null,
    },
    {
      key: "OUTLOOK_CLIENT_SECRET",
      source: "env",
      display: "••••Kd7w",
      updatedAt: null,
    },
    {
      key: "OUTLOOK_TENANT",
      source: "app",
      display: "consumers",
      updatedAt: "2026-10-28T09:05:00.000Z",
    },
    { key: "RESEND_API_KEY", source: "none", display: null, updatedAt: null },
    { key: "RESEND_FROM", source: "none", display: null, updatedAt: null },
  ],
}
