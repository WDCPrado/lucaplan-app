import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { todayKey } from "@/lib/finance-format"
import { currentBudgetPeriod } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"
import { financePageDeps } from "@/arch/v1/presentation/finance/finance-http"
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
  // Mes del presupuesto en curso según el modo (calendario o ciclo de la tarjeta).
  const now = await currentBudgetPeriod(financePageDeps, todayKey())
  // Cuentas y categorías: solo alimentan el "+" de ingreso rápido del shell, que va en toda la app.
  const [accounts, budget] = await Promise.all([
    listAccounts(financePageDeps, u.id),
    getBudgetView(financePageDeps, u.id, now.year, now.month),
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
