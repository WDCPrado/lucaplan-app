import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { listTransactions } from "@/arch/v1/application/finance-use-cases/finance-read"
import { createTransaction } from "@/arch/v1/application/finance-use-cases/create-transaction-use-case"
import {
  DIRECTIONS,
  type Direction,
} from "@/arch/v1/domain/finance/finance.domain"

export async function GET(req: Request) {
  const { year, month } = periodOf(req)
  return withUser(req, (userId) =>
    listTransactions(financeDeps, userId, year, month)
  )
}

export async function POST(req: Request) {
  const body = await req.json()
  // Validación de entrada en el boundary: direction inválido o monto no positivo → 400
  // (nunca adivinar la dirección de un movimiento de dinero).
  if (!(DIRECTIONS as readonly string[]).includes(body.direction)) {
    return Response.json(
      { error: "direction debe ser 'debit' o 'credit'" },
      { status: 400 }
    )
  }
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json(
      { error: "amount debe ser un número positivo" },
      { status: 400 }
    )
  }
  return withUser(
    req,
    async (userId) => {
      const t = await createTransaction(financeDeps, userId, {
        accountId: body.accountId,
        categoryId: body.categoryId ?? null,
        amount,
        currency: body.currency,
        direction: body.direction as Direction,
        description: body.description ?? "",
        date: body.date ? new Date(body.date) : new Date(),
      })
      return { id: t.id }
    },
    201
  )
}
