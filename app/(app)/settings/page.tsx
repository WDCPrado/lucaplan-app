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
import { SettingsView } from "@/components/finance/settings-view"

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  // Datos iniciales en el servidor (nada de useEffect para el primer render).
  const [alerts, dueDays, paceFrequency] = await Promise.all([
    listBudgetAlerts(budgetAlertDeps),
    getDueDays(dueReminderDeps),
    getPaceFrequency(paceDeps),
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
      vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
      isAdmin={session.user.role === "ADMIN"}
      // La misma que arma outlook-oauth.ts: la que hay que registrar en Microsoft Entra.
      outlookRedirectUri={
        process.env.OUTLOOK_REDIRECT_URI ||
        `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/email-connection/callback`
      }
    />
  )
}
