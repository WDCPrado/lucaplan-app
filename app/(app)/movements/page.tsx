import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { auth } from "@/arch/v1/infrastructure/auth/auth"
import { todayKey } from "@/lib/finance-format"
import { periodOfDay, periodRange } from "@/arch/shared/billing-cycle"
import { financePageDeps } from "@/arch/v1/presentation/finance/finance-http"
import {
  listAccounts,
  getBudgetView,
  getAmountBounds,
  searchTransactionsPage,
} from "@/arch/v1/application/finance-use-cases/finance-read"
import { getBudgetPeriod } from "@/arch/v1/application/finance-use-cases/budget-period-use-cases"
import { MovementsView } from "@/components/finance/movements-view"

const PAGE_SIZE = 20

type Params = {
  year?: string
  month?: string
  page?: string
  q?: string
  direction?: string
  categoryId?: string
  bank?: string
  from?: string
  to?: string
  amountMin?: string
  amountMax?: string
}

const isDay = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
const num = (s?: string) => {
  if (!s) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Params>
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) redirect("/login")

  const sp = await searchParams
  const userId = session.user.id
  // Mes/ciclo como en el Inicio: por defecto el del presupuesto que contiene a hoy según el modo.
  const { mode, overrides } = await getBudgetPeriod(financePageDeps)
  const current = periodOfDay(todayKey(), mode, overrides)
  const year = Number(sp.year) || current.year
  const month = Number(sp.month) || current.month
  const range = periodRange(year, month, mode, overrides)
  // Las fechas elegidas en el panel mandan sobre el mes; sin ellas, el rango del mes/ciclo.
  const from = isDay(sp.from) ? sp.from! : range.start
  const to = isDay(sp.to) ? sp.to! : isDay(sp.from) ? sp.from! : range.end
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1)
  const direction =
    sp.direction === "debit" || sp.direction === "credit"
      ? sp.direction
      : undefined

  const [result, accounts, budget, amountBounds] = await Promise.all([
    searchTransactionsPage(
      financePageDeps,
      userId,
      {
        query: sp.q?.trim() || undefined,
        direction,
        categoryId: sp.categoryId || undefined,
        bankName: sp.bank || undefined,
        // Mismo formato que el endpoint de búsqueda: el día civil como medianoche UTC (@db.Date).
        from: new Date(from),
        to: new Date(to),
        amountMin: num(sp.amountMin),
        amountMax: num(sp.amountMax),
      },
      page,
      PAGE_SIZE
    ),
    listAccounts(financePageDeps, userId),
    // Solo por las categorías (nombre/icono/color) del filtro y del modal de editar.
    getBudgetView(financePageDeps, userId, year, month),
    getAmountBounds(financePageDeps, userId),
  ])

  return (
    <MovementsView
      period={{ year, month }}
      current={current}
      result={result}
      accounts={accounts}
      categories={budget.categories}
      amountBounds={amountBounds}
      filters={{
        q: sp.q ?? "",
        direction: direction ?? "",
        categoryId: sp.categoryId || "all",
        bank: sp.bank || "all",
        from: isDay(sp.from) ? sp.from : undefined,
        to: isDay(sp.to) ? sp.to : undefined,
        amountMin: num(sp.amountMin),
        amountMax: num(sp.amountMax),
      }}
    />
  )
}
