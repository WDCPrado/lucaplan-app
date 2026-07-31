import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { currentPeriod } from "@/lib/finance-format"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  listRecurringView,
  getBudgetView,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { RecurringView } from "@/components/finance/recurring-view"

export default async function RecurringPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const userId = session.user.id
  const now = currentPeriod()
  const [templates, accounts, budget] = await Promise.all([
    listRecurringView(financeDeps, userId),
    listAccounts(financeDeps, userId),
    // Solo por las categorías (nombre/icono/color) para el selector del modal.
    getBudgetView(financeDeps, userId, now.year, now.month),
  ])

  const label = session.user.name || session.user.email || "Usuario"
  return (
    <RecurringView
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        initial: label.charAt(0).toUpperCase(),
      }}
      templates={templates}
      accounts={accounts}
      categories={budget.categories}
    />
  )
}
