import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  getMonthlySummary,
  listAccounts,
  getBudgetView,
  listTransactions,
  listUncategorized,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { Dashboard } from "@/components/finance/dashboard"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string
    month?: string
    outlook?: string
    reason?: string
  }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const sp = await searchParams
  const now = new Date()
  const year = Number(sp.year) || now.getUTCFullYear()
  const month = Number(sp.month) || now.getUTCMonth() + 1
  const userId = session.user.id

  const [summary, accounts, budget, transactions, uncategorized] =
    await Promise.all([
      getMonthlySummary(financeDeps, userId, year, month),
      listAccounts(financeDeps, userId),
      getBudgetView(financeDeps, userId, year, month),
      listTransactions(financeDeps, userId, year, month),
      listUncategorized(financeDeps, userId),
    ])

  const user = {
    name: session.user.name || session.user.email || "Usuario",
    initial: (session.user.name || session.user.email || "?")
      .charAt(0)
      .toUpperCase(),
    email: session.user.email,
  }

  return (
    <Dashboard
      period={{ year, month }}
      summary={summary}
      accounts={accounts}
      budget={budget}
      transactions={transactions}
      uncategorized={uncategorized}
      user={user}
      outlookResult={sp.outlook ?? null}
      outlookReason={sp.reason ?? null}
    />
  )
}
