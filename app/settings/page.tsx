import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { listBudgetAlerts } from "@/arch/v1/application/notification-use-cases/budget-alert-use-cases"
import { budgetAlertDeps } from "@/arch/v1/infrastructure/database/prisma/push-deps"
import { SettingsView } from "@/components/finance/settings-view"

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  // Datos iniciales en el servidor (nada de useEffect para el primer render).
  const alerts = await listBudgetAlerts(budgetAlertDeps)

  const label = session.user.name || session.user.email || "Usuario"
  return (
    <SettingsView
      user={{
        name: session.user.name ?? "",
        email: session.user.email,
        initial: label.charAt(0).toUpperCase(),
      }}
      alerts={alerts}
      vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""}
    />
  )
}
