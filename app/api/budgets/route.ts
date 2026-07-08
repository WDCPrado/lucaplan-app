import { withUser, financeDeps, periodOf } from "@/arch/v1/presentation/finance/finance-http";
import { getBudgetView } from "@/arch/v1/application/finance-use-cases/finance-read";
import { upsertBudget } from "@/arch/v1/application/finance-use-cases/upsert-budget-use-case";

export async function GET(req: Request) {
  const { year, month } = periodOf(req);
  return withUser(req, (userId) => getBudgetView(financeDeps, userId, year, month));
}

export async function POST(req: Request) {
  const body = await req.json();
  return withUser(
    req,
    (userId) =>
      upsertBudget(financeDeps, userId, {
        id: body.id,
        name: body.name,
        year: Number(body.year),
        month: Number(body.month),
      }),
    body.id ? 200 : 201,
  );
}
