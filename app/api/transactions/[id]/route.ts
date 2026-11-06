import { transactionUpdateSchema } from "@/lib/finance-form-schemas"
import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  updateTransaction,
  deleteTransaction,
} from "@/arch/v1/application/finance-use-cases/update-transaction-use-case"
import { followIncome } from "@/arch/v1/application/finance-use-cases/follow-income"

// Editar un movimiento manual (los de cuentas conectadas son de solo lectura → 422).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()

  return withUser(req, async (userId) => {
    // Sin fecha se conserva la del movimiento: un PATCH sin `date` no lo mueve a hoy.
    const parsed = transactionUpdateSchema.partial({ date: true }).parse({
      description: String(body.description ?? "").trim() || "Movimiento",
      amount: Number(body.amount) || 0,
      direction: body.direction === "credit" ? "credit" : "debit",
      categoryId: body.categoryId ?? null,
      date: body.date || undefined,
    })
    const { result: t } = await followIncome(financeDeps, userId, () =>
      updateTransaction(financeDeps, userId, { transactionId: id, ...parsed, date: parsed.date ? new Date(parsed.date) : undefined }),
      { allModes: true }
    )
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
    await followIncome(financeDeps, userId, () => deleteTransaction(financeDeps, userId, id), { allModes: true })
    return { ok: true }
  })
}
