import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { categorizeTransaction } from "@/arch/v1/application/finance-use-cases/categorize-transaction-use-case";

// Asignar/cambiar solo la categoría de un movimiento (permitido también en los de Fintoc).
// Registra la corrección de aprendizaje y devuelve cuántos otros movimientos con el mismo texto
// cambiarían al propagar (para el follow-up de la UI).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  return withUser(req, async (userId) => {
    const { transaction: t, sameTextCount } = await categorizeTransaction(financeDeps, userId, id, body.categoryId ?? null);
    return { id: t.id, categoryId: t.categoryId, sameTextCount };
  });
}
