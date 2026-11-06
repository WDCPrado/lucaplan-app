import type { SetupStatus } from "@/lib/integration-settings-schemas"

// Datos de ejemplo mientras no existe GET /api/setup: una instalación de producción recién
// levantada (falta Resend). Con `local: true` se ve el paso del correo como opcional.
export const setupExample: SetupStatus = {
  needed: true,
  verified: false,
  local: false,
  missingRequired: ["RESEND_API_KEY", "RESEND_FROM"],
}
