// Anticipación del recordatorio de vencimientos (Configuración → Pagos por vencer).
// Preferencia GLOBAL de la app, igual que los umbrales: se exige sesión, pero el valor es el mismo
// para cualquier usuario autenticado.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  getDueDays,
  setDueDays,
} from "@/arch/v1/application/notification-use-cases/due-reminder-use-cases"
import { dueReminderDeps } from "@/arch/v1/infrastructure/database/prisma/push-deps"

export async function GET(req: Request) {
  return withUser(req, async () => ({ days: await getDueDays(dueReminderDeps) }))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const days = Number(body?.days)
  // Validación de entrada en el boundary; el rango permitido lo decide el dominio.
  if (!Number.isFinite(days))
    return Response.json({ error: "days debe ser un número" }, { status: 400 })
  return withUser(req, async () => ({
    days: await setDueDays(dueReminderDeps, days),
  }))
}
