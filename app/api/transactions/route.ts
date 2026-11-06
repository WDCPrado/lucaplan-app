import { transactionSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
  periodOf,
} from "@/arch/v1/presentation/finance/finance-http"
import { listTransactions } from "@/arch/v1/application/finance-use-cases/finance-read"
import { createTransaction } from "@/arch/v1/application/finance-use-cases/create-transaction-use-case"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"
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
        date: body.date || new Date().toISOString(),
      })
      const create = () =>
        createTransaction(financeDeps, userId, { ...parsed, date: new Date(parsed.date) })
      // Un abono mueve el ingreso del plan: el tope igualado lo sigue.
      // ponytail: un gasto con fecha del período anterior también mueve el total (vía déficit) y
      // no se sigue, para no leer el plan en cada gasto; «Igualar al ingreso» lo vuelve a alinear.
      const t = parsed.direction === "credit"
        ? (await followIncome(financeDeps, userId, create, { allModes: true })).result
        : await create()
      return { id: t.id }
    },
    201
  )
}
