import { withUser, financeDeps, periodOf } from "@/arch/v1/presentation/finance/finance-http";
import { listTransactions } from "@/arch/v1/application/finance-use-cases/finance-read";
import { createTransaction } from "@/arch/v1/application/finance-use-cases/create-transaction-use-case";

export async function GET(req: Request) {
  const { year, month } = periodOf(req);
  return withUser(req, (userId) => listTransactions(financeDeps, userId, year, month));
}

export async function POST(req: Request) {
  const body = await req.json();
  return withUser(
    req,
    async (userId) => {
      const t = await createTransaction(financeDeps, userId, {
        accountId: body.accountId,
        categoryId: body.categoryId ?? null,
        amount: Number(body.amount),
        currency: body.currency,
        direction: body.direction,
        description: body.description ?? "",
        date: body.date ? new Date(body.date) : new Date(),
      });
      return { id: t.id };
    },
    201,
  );
}
