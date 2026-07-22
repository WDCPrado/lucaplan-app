import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  createRecurringTemplate,
  listRecurringTemplates,
} from "@/arch/v1/application/finance-use-cases/recurring-use-cases"
import type { Periodicity } from "@/arch/v1/domain/finance/recurring.domain"

// Plantillas recurrentes del usuario.
export async function GET(req: Request) {
  return withUser(req, (userId) => listRecurringTemplates(financeDeps, userId))
}

// Crea una plantilla. La UI la precarga desde un movimiento, pero siempre manda los campos ya
// revisados por el usuario: aquí no hay creación derivada a ciegas.
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(
    req,
    (userId) =>
      createRecurringTemplate(financeDeps, userId, {
        accountId: String(body.accountId),
        categoryId: String(body.categoryId),
        description: String(body.description ?? ""),
        direction: body.direction === "credit" ? "credit" : "debit",
        baseAmount: Number(body.baseAmount),
        tolerancePct: Number(body.tolerancePct ?? 10),
        periodicity: (body.periodicity ?? "monthly") as Periodicity,
        executionMode:
          body.executionMode === "cron" ? "cron" : "email_detection",
        dayOfMonth:
          body.dayOfMonth === null || body.dayOfMonth === undefined
            ? null
            : Number(body.dayOfMonth),
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        sourceTransactionId: body.sourceTransactionId
          ? String(body.sourceTransactionId)
          : null,
      }),
    201
  )
}
