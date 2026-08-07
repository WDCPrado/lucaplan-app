import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { currentPeriod } from "@/lib/finance-format"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  getBudgetView,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { ProfileView } from "@/components/finance/profile-view"

export default async function ProfilePage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const u = session.user
  const label = u.name || u.email || "Usuario"
  const now = currentPeriod()
  // Cuentas y categorías: solo alimentan el "+" de ingreso rápido del shell, que va en toda la app.
  const [accounts, budget] = await Promise.all([
    listAccounts(financeDeps, u.id),
    getBudgetView(financeDeps, u.id, now.year, now.month),
  ])

  return (
    <ProfileView
      user={{
        name: u.name ?? "",
        email: u.email,
        role: (u.role ?? "USER") as string,
        initial: label.charAt(0).toUpperCase(),
      }}
      accounts={accounts}
      categories={budget.categories}
    />
  )
}
