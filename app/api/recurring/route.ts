import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  createRecurringTemplate,
  listRecurringTemplates,
} from "@/arch/v1/application/finance-use-cases/recurring-use-cases"
import { recurringUrlSchema } from "@/lib/schemas/recurring-url"
import {
  InvalidRecurringUrlError,
  type Periodicity,
} from "@/arch/v1/domain/finance/recurring.domain"

// Plantillas recurrentes del usuario.
export async function GET(req: Request) {
  return withUser(req, (userId) => listRecurringTemplates(financeDeps, userId))
}

// Crea una plantilla. Solo nace desde un movimiento (`sourceTransactionId` obligatorio): de ahí
// sale la clave de match; el `label` lo elige el usuario. Los campos van ya revisados por él.
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(
    req,
    (userId) => {
      // Dentro de withUser: sin sesión es 401 antes de tocar el texto.
      const url = recurringUrlSchema.safeParse(body.url)
      if (!url.success) throw new InvalidRecurringUrlError(url.error.issues[0]?.message ?? "")
      return createRecurringTemplate(financeDeps, userId, {
        accountId: String(body.accountId),
        categoryId: String(body.categoryId),
        label: String(body.label ?? ""),
        direction: body.direction === "credit" ? "credit" : "debit",
        baseAmount: Number(body.baseAmount),
        tolerancePct: Number(body.tolerancePct ?? 10),
        periodicity: (body.periodicity ?? "monthly") as Periodicity,
        dayOfMonth:
          body.dayOfMonth === null || body.dayOfMonth === undefined
            ? null
            : Number(body.dayOfMonth),
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        endDate: body.endDate ? new Date(body.endDate) : null,
        sourceTransactionId: body.sourceTransactionId
          ? String(body.sourceTransactionId)
          : null,
        url: url.data,
      })
    },
    201
  )
}
