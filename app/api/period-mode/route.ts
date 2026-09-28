// Modo del período del presupuesto (switch del Inicio): mes calendario o ciclo de la tarjeta.
// Preferencia GLOBAL de la app, igual que el ritmo: se exige sesión, pero el valor es el mismo para
// cualquier usuario autenticado. Un modo inválido responde 422 con su `error`.
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { setBudgetPeriodMode } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"

export async function PUT(req: Request) {
  const body = await req.json().catch(() => null)
  const mode = String(body?.mode ?? "")
  return withUser(req, async () => ({
    mode: await setBudgetPeriodMode(financeDeps, mode),
  }))
}
