// Umbrales de alerta del presupuesto (Configuración → Alertas de presupuesto).
// Preferencia GLOBAL de la app: no cuelga del usuario. La sesión se exige igual — la configuración
// no es pública —, pero cualquier usuario autenticado ve y edita los mismos umbrales.
import { withUser } from "@/arch/v1/presentation/finance/finance-http"
import {
  deleteBudgetAlert,
  listBudgetAlerts,
  saveBudgetAlert,
} from "@/arch/v1/application/notification-use-cases/budget-alert-use-cases"
import { budgetAlertDeps } from "@/arch/v1/infrastructure/database/prisma/push-deps"

export async function GET(req: Request) {
  return withUser(req, () => listBudgetAlerts(budgetAlertDeps))
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const percent = Number(body?.percent)
  // Validación de entrada en el boundary; el rango permitido lo decide el dominio.
  if (!Number.isFinite(percent)) {
    return Response.json(
      { error: "percent debe ser un número" },
      { status: 400 }
    )
  }
  const id = typeof body?.id === "string" ? body.id : undefined
  return withUser(
    req,
    () => saveBudgetAlert(budgetAlertDeps, { id, percent }),
    id ? 200 : 201
  )
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return Response.json({ error: "id requerido" }, { status: 400 })
  return withUser(req, async () => {
    await deleteBudgetAlert(budgetAlertDeps, id)
    return { ok: true }
  })
}
