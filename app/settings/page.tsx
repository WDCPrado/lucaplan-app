import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { listBudgetAlerts } from "@/arch/v1/application/notification-use-cases/budget-alert-use-cases"
import { getDueDays } from "@/arch/v1/application/notification-use-cases/due-reminder-use-cases"
import { getPaceFrequency } from "@/arch/v1/application/finance-use-cases/pace-use-cases"
import {
  budgetAlertDeps,
  dueReminderDeps,
} from "@/arch/v1/infrastructure/database/prisma/push-deps"
import { paceDeps } from "@/arch/v1/infrastructure/database/prisma/pace.infrastructure"
import { currentPeriod } from "@/lib/finance-format"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  getBudgetView,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { SettingsView } from "@/components/finance/settings-view"

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const now = currentPeriod()
  // Datos iniciales en el servidor (nada de useEffect para el primer render). Cuentas y
  // categorías solo alimentan el "+" de ingreso rápido del shell, que va en toda la app.
  const [alerts, dueDays, paceFrequency, accounts, budget] = await Promise.all([
    listBudgetAlerts(budgetAlertDeps),
    getDueDays(dueReminderDeps),
    getPaceFrequency(paceDeps),
    listAccounts(financeDeps, session.user.id),
    getBudgetView(financeDeps, session.user.id, now.year, now.month),
  ])

  const label = session.user.name || session.user.email || "Usuario"
  return (
    <SettingsView
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        initial: label.charAt(0).toUpperCase(),
      }}
      alerts={alerts}
      dueDays={dueDays}
      paceFrequency={paceFrequency}
      accounts={accounts}
      categories={budget.categories}
      vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
    />
  )
}
