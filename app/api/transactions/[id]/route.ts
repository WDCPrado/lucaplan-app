import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  updateTransaction,
  deleteTransaction,
} from "@/arch/v1/application/finance-use-cases/update-transaction-use-case"

// Editar un movimiento manual (los de cuentas fintoc son de solo lectura → 422).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()
  return withUser(req, async (userId) => {
    const t = await updateTransaction(financeDeps, userId, {
      transactionId: id,
      description: String(body.description ?? "").trim() || "Movimiento",
      amount: Number(body.amount) || 0,
      direction: body.direction === "credit" ? "credit" : "debit",
      categoryId: body.categoryId ?? null,
      date: body.date ? new Date(body.date) : new Date(),
    })
    return { id: t.id }
  })
}

// Borrar un movimiento manual (revierte su efecto en el saldo).
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  return withUser(req, async (userId) => {
    await deleteTransaction(financeDeps, userId, id)
    return { ok: true }
  })
}
