import { transactionSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { listTransactions } from "@/arch/v1/application/finance-use-cases/finance-read"
import { createTransaction } from "@/arch/v1/application/finance-use-cases/create-transaction-use-case"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"
import { todayKey } from "@/arch/shared/today"
import {
  DIRECTIONS,
  type Direction,
} from "@/arch/v1/domain/finance/finance.domain"

export async function GET(req: Request) {
  return withUser(req, async (userId) => {
    const { year, month } = await periodOf(req)
    return listTransactions(financeDeps, userId, year, month)
  })
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
      const parsed = transactionSchema.parse({
        accountId: body.accountId,
        categoryId: body.categoryId ?? null,
        amount,
        currency: body.currency,
        direction: body.direction as Direction,
        description: body.description ?? "",
        // Sin fecha, hoy en Chile: el instante UTC de las 22:00 ya es mañana y el @db.Date lo guardaba así.
        date: body.date || todayKey(),
      })
      // Un abono mueve el ingreso; un gasto del período anterior, el déficit: el tope que sigue
      // al ingreso se alinea en los dos casos.
      const { result: t } = await followIncome(financeDeps, userId, () =>
        createTransaction(financeDeps, userId, { ...parsed, date: new Date(parsed.date) }),
        { allModes: true }
      )
      return { id: t.id }
    },
    201
  )
}
