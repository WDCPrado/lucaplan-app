import { requireInternal } from "@/arch/v1/presentation/finance/require-internal"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import { runRecurringCron } from "@/arch/v1/application/finance-use-cases/recurring-use-cases"

// Corrida diaria de las plantillas recurrentes de TODOS los usuarios: abre el período (materializa
// el comprometido) y confirma las plantillas `cron` cuyo día llegó. Sin sesión de usuario: el
// acceso lo restringe `requireInternal` (red privada del proyecto + CRON_KEY).
// Idempotente: reejecutar el mismo día no duplica nada. Body opcional `{ date: "YYYY-MM-DD" }`
// para reprocesar un día concreto.
export async function POST(req: Request) {
  const denied = requireInternal(req)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const date = body?.date ? new Date(String(body.date)) : new Date()
  if (Number.isNaN(date.getTime()))
    return Response.json({ error: "fecha inválida" }, { status: 422 })

  const result = await runRecurringCron(financeDeps, date)
  return Response.json(result)
}
