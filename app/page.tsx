import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/arch/v1/infrastructure/auth/auth";
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import {
  getMonthlySummary,
  listAccounts,
  getBudgetView,
  listTransactions,
} from "@/arch/v1/application/finance-use-cases/finance-read";
import { Dashboard } from "@/components/finance/dashboard";

// Home = dashboard financiero (primera UI). Server component: valida sesión y hace el fetch inicial
// vía los use-cases; las mutaciones (agregar/editar) van por la API + router.refresh().
export default async function Home({ searchParams }: { searchParams: Promise<{ year?: string; month?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const sp = await searchParams;
  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;
  const userId = session.user.id;

  const [summary, accounts, budget, transactions] = await Promise.all([
    getMonthlySummary(financeDeps, userId, year, month),
    listAccounts(financeDeps, userId),
    getBudgetView(financeDeps, userId, year, month),
    listTransactions(financeDeps, userId, year, month),
  ]);

  const userInitial = (session.user.name || session.user.email || "?").charAt(0).toUpperCase();

  return (
    <Dashboard
      period={{ year, month }}
      summary={summary}
      accounts={accounts}
      budget={budget}
      transactions={transactions}
      userInitial={userInitial}
    />
  );
}
