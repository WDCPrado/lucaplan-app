import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { listBudgetAlerts } from "@/arch/v1/application/notification-use-cases/budget-alert-use-cases"
import { getDueDays } from "@/arch/v1/application/notification-use-cases/due-reminder-use-cases"
import {
  budgetAlertDeps,
  dueReminderDeps,
} from "@/arch/v1/infrastructure/database/prisma/push-deps"
import { SettingsView } from "@/components/finance/settings-view"

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  // Datos iniciales en el servidor (nada de useEffect para el primer render).
  const [alerts, dueDays] = await Promise.all([
    listBudgetAlerts(budgetAlertDeps),
    getDueDays(dueReminderDeps),
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
      vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
    />
  )
}
