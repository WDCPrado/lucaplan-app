import { runDueReminders } from "@/arch/v1/infrastructure/database/prisma/push-deps"
import { cronAuthorized } from "../cron-auth"

// Recordatorio diario de pagos por vencer, para el scheduler del despliegue (en Railway, el
// servicio cron lo llama por HTTP). No hay sesión de usuario: se autentica con un secreto dedicado,
// mismo patrón que /api/email-connection/renew. Sin `CRON_SECRET` en el entorno nadie pasa.
export async function POST(req: Request) {
  if (!cronAuthorized(req))
    return Response.json({ error: "unauthorized" }, { status: 401 })
  return Response.json(await runDueReminders())
}
