import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { todayKey } from "@/lib/finance-format"
import {
  closingOf,
  periodOfDay,
  periodRange,
} from "@/arch/shared/billing-cycle"
import {
  financeDeps,
  financePageDeps,
} from "@/arch/v1/presentation/finance/finance-http"
import {
  getMonthlySummary,
  listAccounts,
  getBudgetView,
  getPreviousMonthDebt,
  listTransactions,
  listUncategorized,
  listIncomesView,
  getAmountBounds,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { materializeUserPeriods } from "@/arch/v1/application/finance-use-cases/recurring-use-cases"
import { getPaceFrequency } from "@/arch/v1/application/finance-use-cases/pace-use-cases"
import { getBudgetPeriod } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"
import { paceDeps } from "@/arch/v1/infrastructure/database/prisma/pace.infrastructure"
import { Dashboard } from "@/components/finance/dashboard"
import { PushPrompt } from "@/components/pwa/push-prompt"
import { prDemoAccount } from "@/lib/pr-demo"

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
  // Mes por defecto: el mes del presupuesto que contiene a hoy según el modo (calendario o ciclo de
  // la tarjeta), con el "hoy" del calendario del usuario (APP_TZ), no el de UTC. Con el servidor en
  // UTC, el último día del mes saltaba al mes siguiente a media tarde en Chile.
  const today = todayKey()
  const { mode, overrides } = await getBudgetPeriod(financePageDeps)
  const current = periodOfDay(today, mode, overrides)
  const year = Number(sp.year) || current.year
  const month = Number(sp.month) || current.month
  const range = periodRange(year, month, mode, overrides)
  const cycle = {
    mode,
    range,
    closing: closingOf(year, month, overrides),
    current,
  }
  const userId = session.user.id

  // Abre los períodos de las recurrentes activas antes de leer: el comprometido del mes debe verse
  // aunque el cron no haya corrido todavía. Idempotente y solo mes actual/futuro.
  // En modo tarjeta el rango cruza dos meses calendario (23/09 → 22/10): se abren los dos, o la
  // recurrente que vence el 25/09 no aparecería como comprometido de octubre.
  // Con las deps CRUDAS a propósito: esto escribe, y lo que escribe no lee de la memoización
  // por render. Las lecturas de más abajo usan `financePageDeps` y ven lo que esto dejó.
  for (const key of new Set([range.start.slice(0, 7), range.end.slice(0, 7)]))
    await materializeUserPeriods(
      financeDeps,
      userId,
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7))
    ).catch(() => {})

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
    previousMonthDebt,
    previousCycleIncomes,
  ] = await Promise.all([
    getMonthlySummary(financePageDeps, userId, year, month),
    listAccounts(financePageDeps, userId),
    getBudgetView(financePageDeps, userId, year, month, {
      frequency: paceFrequency,
      today,
    }),
    listTransactions(financePageDeps, userId, year, month),
    listUncategorized(financePageDeps, userId, year, month),
    listIncomesView(financePageDeps, userId, year, month),
    getAmountBounds(financePageDeps, userId),
    // Lo que el mes anterior gastó por sobre su presupuesto: el plan del mes lo descuenta del
    // total que ofrece repartir. Va acá y no en `getBudgetView` porque el único que la necesita es
    // el plan; meterla al DTO se la cobraría a todos los consumidores de la vista.
    // El `.catch` no es decorativo: esto es una pista dentro de un modal, y sin él un fallo
    // leyendo el mes anterior convertiría un dato cosmético en un 500 de la pantalla principal.
    // Degradando a 0 el plan se comporta como antes de existir el descuento, que es el modo de
    // fallo correcto.
    getPreviousMonthDebt(financePageDeps, userId, year, month).catch(() => 0),
    // La cobertura del ciclo anterior es informativa: si falla la lectura histórica,
    // la Home debe seguir cargando el período actual.
    mode === "card_cycle"
      ? listIncomesView(
          financePageDeps,
          userId,
          month === 1 ? year - 1 : year,
          month === 1 ? 12 : month - 1
        ).catch((error) => {
          console.error("[dashboard] No se pudieron consultar los ingresos del ciclo anterior", error)
          return []
        })
      : Promise.resolve([]),
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
          dispositivo no los tenga. Sin claves VAPID no se ofrece nada. Tampoco en un entorno de
          PR: es una demo pública y el aviso solo estorba la prueba manual. */}
      {!prDemoAccount() && (
        <PushPrompt vapidPublicKey={process.env.VAPID_PUBLIC_KEY ?? ""} />
      )}
      <Dashboard
        period={{ year, month }}
        cycle={cycle}
        summary={summary}
        accounts={accounts}
        budget={budget}
        transactions={transactions}
        uncategorized={uncategorized}
        incomes={incomes}
        previousCycleIncomes={previousCycleIncomes}
        amountBounds={amountBounds}
        previousMonthDebt={previousMonthDebt}
        user={user}
        outlookResult={sp.outlook ?? null}
        outlookReason={sp.reason ?? null}
        openTxId={sp.tx ?? null}
      />
    </>
  )
}
