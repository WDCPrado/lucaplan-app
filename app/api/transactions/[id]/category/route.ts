import {
  withUser,
  financeDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import { categorizeTransaction } from "@/arch/v1/application/finance-use-cases/categorize-transaction-use-case"
import { notifyBudgetForCategorized } from "@/arch/v1/infrastructure/database/prisma/push-deps"

// Asignar/cambiar solo la categoría de un movimiento (permitido también en los conectados).
// Registra la corrección de aprendizaje y devuelve cuántos otros movimientos con el mismo texto
// cambiarían al propagar (para el follow-up de la UI).
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params
  const body = await req.json()
  return withUser(req, async (userId) => {
    const {
      transaction: t,
      sameTextCount,
      previousCategoryId,
      learnedCategoryId,
    } = await categorizeTransaction(
      financeDeps,
      userId,
      id,
      body.categoryId ?? null
    )
    // El gasto entra al presupuesto de su nueva categoría (venga de "sin categoría" o de otra) y
    // puede cruzar un umbral. Best-effort: un fallo del push nunca rompe la categorización.
    if (t.categoryId && t.categoryId !== previousCategoryId)
      await notifyBudgetForCategorized(userId, t).catch(() => {})
    return {
      id: t.id,
      categoryId: t.categoryId,
      sameTextCount,
      learnedCategoryId,
    }
  })
}
