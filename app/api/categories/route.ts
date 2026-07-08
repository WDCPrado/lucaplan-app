import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { upsertCategory } from "@/arch/v1/application/finance-use-cases/upsert-budget-use-case";

export async function POST(req: Request) {
  const body = await req.json();
  return withUser(
    req,
    async (userId) => {
      const c = await upsertCategory(financeDeps, userId, {
        id: body.id,
        budgetId: body.budgetId,
        name: body.name,
        limit: Number(body.limit),
        icon: body.icon ?? null,
        color: body.color ?? null,
      });
      return { id: c.id };
    },
    body.id ? 200 : 201,
  );
}
