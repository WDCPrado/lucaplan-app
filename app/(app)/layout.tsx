import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { todayKey } from "@/lib/finance-format"
import { currentBudgetPeriod } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  getBudgetView,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { AppFrame } from "@/components/finance/app-shell"

// Marco de las pantallas con sesión: la barra inferior móvil y el "+" de nuevo movimiento se
// montan una vez aquí y no se desmontan al cambiar de ruta (un layout no se vuelve a renderizar en
// la navegación; sí con router.refresh(), que es lo que hacen el sheet y el modal de cuenta al
// guardar, así las cuentas y categorías del "+" se ponen al día).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  // Deps CRUDAS a propósito: el layout se renderiza en paralelo con la página, y el dashboard
  // abre los períodos de las recurrentes (escribe) antes de leer con `financePageDeps`. Si el
  // layout llenara esa memoización primero, el dashboard leería el mes sin su comprometido.
  // ponytail: getBudgetView completo solo por sus categorías; en /dashboard cada router.refresh()
  // lo calcula dos veces (aquí y en la página). Una lectura liviana de categorías si pesa.
  const userId = session.user.id
  const now = await currentBudgetPeriod(financeDeps, todayKey())
  const [accounts, budget] = await Promise.all([
    listAccounts(financeDeps, userId),
    getBudgetView(financeDeps, userId, now.year, now.month),
  ])

  return (
    <AppFrame quickAdd={{ accounts, categories: budget.categories }}>
      {children}
    </AppFrame>
  )
}
