import { withUser, financeDeps, periodOf } from "@/arch/v1/presentation/finance/finance-http";
import { getBudgetView } from "@/arch/v1/application/finance-use-cases/finance-read";

// Vista del mes: categorías (globales) con su límite efectivo, uso, disponible y estado.
export async function GET(req: Request) {
  const { year, month } = periodOf(req);
  return withUser(req, (userId) => getBudgetView(financeDeps, userId, year, month));
}
