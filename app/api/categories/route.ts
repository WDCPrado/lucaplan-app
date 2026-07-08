import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { upsertCategory } from "@/arch/v1/application/finance-use-cases/upsert-category-use-case";

// Crear/editar una categoría GLOBAL del usuario (nombre, icono, color). El límite va aparte.
export async function POST(req: Request) {
  const body = await req.json();
  return withUser(
    req,
    async (userId) => {
      const c = await upsertCategory(financeDeps, userId, {
        id: body.id,
        name: body.name,
        icon: body.icon ?? null,
        color: body.color ?? null,
      });
      return { id: c.id };
    },
    body.id ? 200 : 201,
  );
}
