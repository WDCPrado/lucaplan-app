import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { currentPeriod } from "@/lib/finance-format"
import { financeDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  getMonthlySummary,
  listAccounts,
  getBudgetView,
  listTransactions,
  listUncategorized,
  listIncomesView,
  getAmountBounds,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { materializeUserPeriods } from "@/arch/v1/application/finance-use-cases/recurring-use-cases"
import { getPaceFrequency } from "@/arch/v1/application/finance-use-cases/pace-use-cases"
import { paceDeps } from "@/arch/v1/infrastructure/database/prisma/pace.infrastructure"
import { Dashboard } from "@/components/finance/dashboard"
import { PushPrompt } from "@/components/pwa/push-prompt"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    year?: string
    month?: string
    outlook?: string
    reason?: string
    tx?: string // deep link de la notificación de movimiento: abre su modal al entrar
  }>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const sp = await searchParams
  // Mes por defecto: el del calendario del usuario (APP_TZ), no el de UTC. Con el servidor en UTC,
  // el último día del mes saltaba al mes siguiente a media tarde en Chile.
  const now = currentPeriod()
  const year = Number(sp.year) || now.year
  const month = Number(sp.month) || now.month
  const userId = session.user.id

  // Abre los períodos de las recurrentes activas antes de leer: el comprometido del mes debe verse
  // aunque el cron no haya corrido todavía. Idempotente y solo mes actual/futuro.
  await materializeUserPeriods(financeDeps, userId, year, month).catch(() => {})

  // La frecuencia primero: getBudgetView la necesita para calcular el ritmo del período.
  const paceFrequency = await getPaceFrequency(paceDeps)
  const [
    summary,
    accounts,
    budget,
    transactions,
    uncategorized,
    incomes,
    amountBounds,
  ] = await Promise.all([
    getMonthlySummary(financeDeps, userId, year, month),
    listAccounts(financeDeps, userId),
    getBudgetView(financeDeps, userId, year, month, {
      frequency: paceFrequency,
      today: now,
    }),
    listTransactions(financeDeps, userId, year, month),
    listUncategorized(financeDeps, userId, year, month),
    listIncomesView(financeDeps, userId, year, month),
    getAmountBounds(financeDeps, userId),
  ])

  const user = {
    name: session.user.name || session.user.email || "Usuario",
    initial: (session.user.name || session.user.email || "?")
      .charAt(0)
      .toUpperCase(),
    email: session.user.email,
  }

  return (
    <>
      {/* Entrada de la app (start_url de la PWA): aquí se ofrece activar los avisos mientras el
          dispositivo no los tenga. Sin claves VAPID no se ofrece nada. */}
      <PushPrompt vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""} />
      <Dashboard
        period={{ year, month }}
        summary={summary}
        accounts={accounts}
        budget={budget}
        transactions={transactions}
        uncategorized={uncategorized}
        incomes={incomes}
        amountBounds={amountBounds}
        user={user}
        outlookResult={sp.outlook ?? null}
        outlookReason={sp.reason ?? null}
        openTxId={sp.tx ?? null}
      />
    </>
  )
}
