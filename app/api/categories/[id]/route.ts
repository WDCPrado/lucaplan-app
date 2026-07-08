import { withUser, financeDeps, periodOf } from "@/arch/v1/presentation/finance/finance-http";
import { getCategoryDetail } from "@/arch/v1/application/finance-use-cases/finance-read";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { year, month } = periodOf(req);
  return withUser(req, (userId) => getCategoryDetail(financeDeps, userId, id, year, month));
}
