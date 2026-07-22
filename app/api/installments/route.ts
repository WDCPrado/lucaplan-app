import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  createInstallmentPlan,
  listInstallmentPlans,
} from "@/arch/v1/application/finance-use-cases/installment-use-cases"
import type { InstallmentKind } from "@/arch/v1/domain/finance/installment.domain"

// Planes de cuotas del usuario (compras con tarjeta y créditos de consumo).
export async function GET(req: Request) {
  return withUser(req, (userId) => listInstallmentPlans(financeDeps, userId))
}

// Crea un plan. `card` viene de transformar una compra (manda `sourceTransactionId`); `loan` se da
// de alta directo, sin movimiento origen.
export async function POST(req: Request) {
  const body = await req.json()
  return withUser(
    req,
    (userId) =>
      createInstallmentPlan(financeDeps, userId, {
        kind: (body.kind === "loan" ? "loan" : "card") as InstallmentKind,
        accountId: String(body.accountId),
        categoryId: String(body.categoryId),
        description: String(body.description ?? ""),
        totalAmount: Number(body.totalAmount),
        installmentsCount: Number(body.installmentsCount),
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        dayOfMonth: Number(body.dayOfMonth),
        tolerancePct: Number(body.tolerancePct ?? 10),
        amounts: Array.isArray(body.amounts)
          ? body.amounts.map(Number)
          : undefined,
        paidIndexes: Array.isArray(body.paidIndexes)
          ? body.paidIndexes.map(Number)
          : undefined,
        sourceTransactionId: body.sourceTransactionId
          ? String(body.sourceTransactionId)
          : null,
      }),
    201
  )
}
