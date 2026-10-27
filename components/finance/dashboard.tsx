"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Eye,
  EyeOff,
  Plus,
  TrendingUp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { isBudgetedExpenseCategory } from "@/arch/v1/domain/finance/budget-scope.domain"
import { haptic } from "@/lib/haptics"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { AppShell } from "./app-shell"
import { MonthPicker } from "./month-picker"
import { AllocationNudge, MonthStatus } from "./month-status"
import { OverspendBanner } from "./overspend-banner"
import { PlanSheet } from "./plan-sheet"
import { AccountCard } from "./account-card"
import { MovementRow } from "./movement-row"
import { DayStrip } from "./day-strip"
import { FinancialHealthMeter, PlanSummary } from "./financial-health-meter"
import { getDashboardChartPreference, type DashboardChart } from "@/lib/dashboard-chart-preference"
import { CategoryIcon } from "./category-icons"
import { unlinkedIncomeTotal } from "@/lib/unlinked-income-total"
import { CategoryModal } from "./category-modal"
import { BudgetLimitModal } from "./budget-limit-modal"
import { CategoryDetailSheet } from "./category-detail-sheet"
import { AccountInfoModal } from "./account-info-modal"
import { SyncBancoChileButton } from "./sync-bancochile-button"
import { UncategorizedTriage } from "./uncategorized-triage"
import { TransactionModal } from "./transaction-modal"
import { TransactionSearch } from "./transaction-search"
import { IncomeModal } from "./income-modal"
import { OnboardingFlow } from "./onboarding/onboarding-flow"
import {
  formatCLP,
  formatCompact,
  formatDateHeader,
  statusVar,
  todayKey,
} from "@/lib/finance-format"
import { dateOf, daysLeftIn, spendByDate } from "@/lib/day-spend"
import {
  daysOf,
  type PeriodMode,
  type PeriodRange,
} from "@/arch/shared/billing-cycle"
import type {
  AccountDTO,
  AmountBoundsDTO,
  BudgetViewDTO,
  CategoryDTO,
  IncomeDTO,
  MonthlySummaryDTO,
  TransactionDTO,
  UncategorizedDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

export type CycleProps = {
  mode: PeriodMode
  range: PeriodRange // del mes en pantalla
  closing: { date: string; estimated: boolean } // cierre del mes en pantalla
  current: { year: number; month: number } // mes en curso según el modo
}

type Props = {
  period: { year: number; month: number }
  // Modo del período y rango del mes en pantalla: calendario (1 → fin de mes) o ciclo de la tarjeta.
  cycle: CycleProps
  summary: MonthlySummaryDTO
  accounts: AccountDTO[]
  budget: BudgetViewDTO
  transactions: TransactionDTO[]
  uncategorized: UncategorizedDTO
  incomes: IncomeDTO[]
  previousCycleIncomes: IncomeDTO[]
  amountBounds: AmountBoundsDTO
  // Excedente del mes ANTERIOR: plata ya gastada que el plan descuenta del total a repartir.
  // Llega resuelta del servidor; el front no la recalcula. 0 = el mes pasado cerró en regla.
  previousMonthDebt: number
  user: { name: string; initial: string; email: string }
  outlookResult: string | null
  outlookReason: string | null
  // `?tx=<id>` de la notificación de movimiento: abre ese modal al entrar.
  openTxId: string | null
}

// Inicio desktop-first: AppShell (sidebar + topbar + barra inferior) con el mes convertido en una decisión
// (cuánto puedo gastar hoy), la tira de días, el ritmo por categoría y los movimientos del día
// elegido; las cuentas al final. Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({
  period,
  cycle,
  summary,
  accounts,
  budget,
  transactions,
  uncategorized,
  incomes,
  previousCycleIncomes,
  amountBounds,
  previousMonthDebt,
  user,
  outlookResult,
  outlookReason,
  openTxId,
}: Props) {
  const router = useRouter()
  const [dashboardChart, setDashboardChart] = useState<DashboardChart>("health")
  useEffect(() => {
    const sync = () => setDashboardChart(getDashboardChartPreference())
    sync()
    window.addEventListener("storage", sync)
    window.addEventListener("lucaplan:dashboard-chart-changed", sync)
    return () => {
      window.removeEventListener("storage", sync)
      window.removeEventListener("lucaplan:dashboard-chart-changed", sync)
    }
  }, [])
  // Primera conexión de correo (callback OAuth ?outlook=setup, aún sin banco): onboarding fullscreen.
  const [onboarding, setOnboarding] = useState(outlookResult === "setup")
  const [showBalance, setShowBalance] = useState(true)
  const [detail, setDetail] = useState<CategoryDTO | null>(null)
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(
    () => transactions.find((t) => t.id === openTxId) ?? null
  )
  // Tocar otra notificación con la app ya abierta navega a `?tx=<otro>` sin remontar: se ajusta el
  // estado en render (patrón de React para props que cambian) en vez de un useEffect.
  const [linkedTxId, setLinkedTxId] = useState(openTxId)
  if (openTxId !== linkedTxId) {
    setLinkedTxId(openTxId)
    setDetailTx(transactions.find((t) => t.id === openTxId) ?? null)
  }
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(
    undefined
  ) // undefined=cerrado, null=crear
  // Tipo fijo al crear categoría: "Nueva" dentro de un grupo abre el modal ya fijado en ese tipo;
  // solo el triage deja el selector libre (null); el "+ Categoría" del header fija gasto.
  const [newCatType, setNewCatType] = useState<"income" | "expense" | null>(
    null
  )
  // Ingreso (fuente) en edición: modal SEPARADO del de categoría (una categoría tiene N ingresos).
  const [editIncome, setEditIncome] = useState<IncomeDTO | null | undefined>(
    undefined
  ) // undefined=cerrado, null=crear
  const {
    ref: cardsRef,
    handlers: cardsHandlers,
    onScroll: cardsScroll,
  } = useCardCarousel()
  const [infoAccount, setInfoAccount] = useState<AccountDTO | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [budgetLimitOpen, setBudgetLimitOpen] = useState(false)
  // Plan del mes (ingresos + presupuesto): decisiones ocasionales, fuera del flujo diario.
  const [planOpen, setPlanOpen] = useState(false)
  // Triage de sin categoría: descartado no reaparece hasta la PRÓXIMA carga (el estado vive en
  // el cliente; recargar la app lo resetea). Se monta solo mientras está abierto.
  const [triageDismissed, setTriageDismissed] = useState(false)
  const triageOpen = uncategorized.transactions.length > 0 && !triageDismissed

  // "Mes en curso" según el modo (en modo tarjeta, el 28/09 ya es octubre) y el calendario del
  // usuario, no el de UTC (ver APP_TZ). Lo resuelve el servidor en `cycle.current`.
  const today = todayKey()
  const isCurrentMonth =
    period.year === cycle.current.year && period.month === cycle.current.month
  // Días que faltan del rango (hoy incluido): el divisor del ritmo diario por categoría. Se
  // anuncia una sola vez en la cabecera del grupo — es un dato del mes, no de cada categoría.
  const daysLeft = isCurrentMonth ? daysLeftIn(cycle.range, today) : 0
  // Un día por fecha del rango: en modo tarjeta cruza dos meses (23 sep – 22 oct).
  const days = daysOf(cycle.range)
  const spend = spendByDate(transactions, days, budget.categories)
  const lastDay = days[days.length - 1]
  // Día que se lista: hoy en el mes en curso; en otro mes, el último con movimientos. Al cambiar
  // de mes (o de rango) se vuelve al default ajustando el estado en render (mismo patrón que
  // `openTxId`).
  const periodKey = `${cycle.range.start}_${cycle.range.end}`
  const todayInRange = isCurrentMonth && days.includes(today)
  const defaultDay = todayInRange
    ? today
    : (transactions.map(dateOf).sort().at(-1) ?? lastDay)
  const [dayState, setDayState] = useState({ key: periodKey, day: defaultDay })
  if (dayState.key !== periodKey)
    setDayState({ key: periodKey, day: defaultDay })
  const selectedDay = dayState.day
  const dayTransactions = transactions.filter((t) => dateOf(t) === selectedDay)
  // Tocar el arco de un movimiento abre el detalle de SU categoría (no el movimiento).
  const openCategory = (id: string) => {
    const cat = budget.categories.find((c) => c.id === id)
    if (cat) setDetail(cat)
  }
  const dayIso = `${selectedDay}T00:00:00.000Z`
  // Misma cifra que la barra del día: solo el gasto que consume presupuesto.
  const daySpent = spend[days.indexOf(selectedDay)] ?? 0
  // El presupuesto de gastos usa las categorías de gasto (tope/uso). Las de ingreso se muestran
  // en su propio grupo con lo recibido en el mes (y su meta, si tienen límite).
  const expenseCategories = budget.categories.filter(
    (c) => c.type === "expense"
  )
  // Las con tope son las que importan en el mes; las sin tope van aparte, en su propio grupo.
  const cappedCategories = expenseCategories.filter(isBudgetedExpenseCategory)
  const uncappedCategories = expenseCategories.filter(
    (c) => !isBudgetedExpenseCategory(c)
  )
  const renderExpenseCat = (c: CategoryDTO) => {
    const pct = c.limit > 0 ? Math.min(100, (c.used / c.limit) * 100) : 0
    // El comprometido continúa al gastado en lo que queda de barra (no se suma).
    const commPct =
      c.limit > 0 ? Math.min(100 - pct, (c.committed / c.limit) * 100) : 0
    return (
      <button
        key={c.id}
        onClick={() => setDetail(c)}
        className="flex flex-col gap-1.5 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <div className="flex items-center gap-2">
          <CategoryIcon icon={c.icon} size={16} color={c.color ?? undefined} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {c.name}
          </span>
          <span className="tabular shrink-0 text-xs text-muted-foreground">
            {c.limit > 0
              ? `${formatCLP(c.used)} de ${formatCLP(c.limit)}`
              : `sin tope · ${formatCLP(c.used)}`}
          </span>
        </div>
        {/* Mismo semáforo que el arco (statusVar): gastado sólido + comprometido tenue detrás. */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%`, background: statusVar(c.status) }}
          />
          <div
            className="h-full transition-[width] duration-500 ease-out"
            style={{
              width: `${Math.max(0, commPct)}%`,
              background: statusVar(c.status),
              opacity: 0.35,
            }}
          />
        </div>
        {/* Izquierda: ritmo del período (hoy / esta semana, según Configuración): lo gastado del período
            contra su presupuesto, que el backend deja ESTABLE — registrar un gasto sube el
            gastado, no mueve la meta, y la semana vale lo mismo el lunes que el jueves.
            Semáforo silencioso: gris bajo 80%, alerta 80–100%, excedido >100%. `pace` solo viene
            en el mes en curso y con tope; sin margen de período se mantiene el aviso de siempre. */}
        <div className="flex items-baseline justify-between gap-2">
          {c.pace ? (
            c.pace.budget > 0 ? (
              <p
                className={cn(
                  "text-xs",
                  c.pace.status === "excedido"
                    ? "text-destructive"
                    : c.pace.status === "alerta"
                      ? "text-warning"
                      : "text-muted-foreground"
                )}
              >
                {/* ponytail: se muestra lo que QUEDA (más accionable que lo gastado) y en una sola
                  línea, sin el "de $X": en móvil partía la fila en cuatro líneas. Pasado el
                  ritmo se dice cuánto de más, que "$0 libres" esconde. */}
                {c.pace.budget - c.pace.spent >= 0 ? (
                  <>
                    <span className="tabular">
                      {formatCLP(c.pace.budget - c.pace.spent)}
                    </span>{" "}
                    libres{" "}
                    {c.pace.frequency === "daily" ? "hoy" : "esta semana"}
                  </>
                ) : (
                  <>
                    <span className="tabular">
                      {formatCLP(c.pace.spent - c.pace.budget)}
                    </span>{" "}
                    sobre el ritmo{" "}
                    {c.pace.frequency === "daily" ? "de hoy" : "semanal"}
                  </>
                )}
              </p>
            ) : (
              <p className="text-xs text-destructive">
                Sin margen
                {c.available < 0 && (
                  <>
                    {" "}
                    · <span className="tabular">
                      {formatCLP(-c.available)}
                    </span>{" "}
                    sobre el tope
                  </>
                )}
              </p>
            )
          ) : (
            <span />
          )}
          {/* Derecha: lo que queda del mes (tope − gastado − comprometido). Sin tope no hay resto. */}
          {c.limit > 0 && (
            <p
              className={cn(
                "shrink-0 text-xs",
                c.available < 0 ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {c.available < 0 ? (
                <>
                  <span className="tabular">{formatCLP(-c.available)}</span>{" "}
                  sobre el tope
                </>
              ) : (
                <>
                  quedan{" "}
                  <span className="tabular">{formatCLP(c.available)}</span>
                </>
              )}
            </p>
          )}
        </div>
      </button>
    )
  }
  const incomeCategories = budget.categories.filter((c) => c.type === "income")
  // Al crear/editar/eliminar un ingreso la suma puede dejar de calzar con el presupuesto global:
  // se ofrece actualizarlo (acción explícita, nunca automática — mismo criterio que antes).
  const activeIncomeTotal = incomes
    .filter((i) => i.isActive && i.currency === "CLP")
    .reduce((s, i) => s + i.amount, 0) + unlinkedIncomeTotal(transactions)

  // El servidor resuelve ambos totales con el mismo alcance que el resumen y los excedentes.
  const { spent: totalUsed, committed: totalCommitted } = budget

  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1))
    router.push(
      `/dashboard?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`
    )
  }

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  const transactionEditor = (
    <TransactionModal
      tx={detailTx}
      categories={budget.categories}
      accounts={accounts}
      onOpenChange={(o) => {
        if (o) return
        setDetailTx(null)
        // Saca el `?tx=` de la barra: recargar o volver no debe reabrir el modal.
        if (openTxId)
          window.history.replaceState(null, "", window.location.pathname)
      }}
    />
  )
  const categoryEditor = (
    <CategoryModal
      key={editCat?.id ?? `new-${newCatType ?? "libre"}`}
      open={editCat !== undefined}
      onOpenChange={(o) => !o && setEditCat(undefined)}
      onDeleted={(id) => {
        if (detail?.id === id) setDetail(null)
      }}
      period={period}
      category={editCat}
      lockedType={editCat ? null : newCatType}
      remainingToAllocate={budget.remainingToAllocate}
    />
  )
  const incomeEditor = (
    <IncomeModal
      key={editIncome?.id ?? "new-income"}
      open={editIncome !== undefined}
      onOpenChange={(o) => !o && setEditIncome(undefined)}
      accounts={accounts}
      categories={budget.categories}
      income={editIncome}
      period={period}
      onCreateCategory={() => {
        setNewCatType("income")
        setEditCat(null)
      }}
    >
      {editIncome !== undefined && categoryEditor}
    </IncomeModal>
  )
  const budgetEditor = (
    <BudgetLimitModal
      key={`${period.year}-${period.month}-${budget.globalLimit ?? "unset"}`}
      open={budgetLimitOpen}
      onOpenChange={setBudgetLimitOpen}
      period={period}
      current={budget.globalLimit}
    />
  )
  const categoryDetail = (
    <CategoryDetailSheet
      // Derivada de las props frescas (no del snapshot en estado): si el modal de transacción
      // guarda encima y refresca, el usado/disponible del detalle se actualiza solo.
      category={
        detail && (budget.categories.find((c) => c.id === detail.id) ?? detail)
      }
      transactions={transactions}
      onOpenChange={(o) => !o && setDetail(null)}
      onEdit={(c) => {
        setEditCat(c)
      }}
      onOpenTx={setDetailTx}
    >
      {detail && categoryEditor}
      {detail && !searchOpen && transactionEditor}
    </CategoryDetailSheet>
  )
  const triage = triageOpen && !onboarding && (
    <UncategorizedTriage
      transactions={uncategorized.transactions}
      hasMore={uncategorized.hasMore}
      accounts={accounts}
      categories={budget.categories}
      onClose={() => setTriageDismissed(true)}
      onCreateCategory={() => {
        setNewCatType(null)
        setEditCat(null)
      }}
    >
      {categoryEditor}
    </UncategorizedTriage>
  )

  // Medidor y diario muestran el mismo resumen del plan; la liquidez es la CLP registrada.
  const planProps = {
    cash: summary.activeCash,
    overdraftDebt: summary.overdraftDebt,
    income: activeIncomeTotal,
    spent: totalUsed,
    committed: totalCommitted,
    reimbursementAdjustment: budget.reimbursementAdjustment,
  }

  return (
    <AppShell
      user={user}
      onSignOut={signOut}
      onSearch={() => setSearchOpen(true)}
      title="Inicio"
      actions={
        // Móvil: columna invertida → selector arriba y "Hoy" colgando debajo; escritorio: fila.
        <div className="pointer-events-none flex flex-col-reverse items-center gap-2 *:pointer-events-auto md:flex-row">
          {!isCurrentMonth && (
            <button
              onClick={() => {
                haptic("light")
                router.push("/dashboard")
              }}
              className="rounded-lg bg-secondary px-3.5 py-1.5 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Hoy
            </button>
          )}
          <div className="flex items-center gap-1 rounded-lg bg-secondary px-1.5 py-1">
            <button
              onClick={() => goMonth(-1)}
              className="grid size-8 place-items-center rounded-md hover:bg-background"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <MonthPicker
              period={period}
              current={cycle.current}
              cycleRange={cycle.mode === "card_cycle" ? cycle.range : undefined}
              onSelect={(y, m) =>
                router.push(`/dashboard?year=${y}&month=${m}`)
              }
            />
            <button
              onClick={() => goMonth(1)}
              className="grid size-8 place-items-center rounded-md hover:bg-background"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
        <div className="flex flex-col gap-5">
          {/* Estado del mes: la respuesta a "¿cuánto puedo gastar hoy?" antes que cualquier
              detalle. Desde acá se abre el plan (ingresos y presupuesto), que es lo que lo
              determina. La tira de días vive adentro: es el mes que ese número reparte. */}
          <MonthStatus
            period={period}
            cycle={cycle}
            isCurrentMonth={isCurrentMonth}
            daysLeft={daysLeft}
            globalLimit={budget.globalLimit}
            spent={totalUsed}
            committed={totalCommitted}
            onOpenPlan={() => setPlanOpen(true)}
          >
            {dashboardChart === "health" ? (
              <FinancialHealthMeter {...planProps} />
            ) : (
              <div className="flex flex-col gap-4">
                <PlanSummary {...planProps} />
                <DayStrip
                  days={days}
                  spend={spend}
                  selectedDay={selectedDay}
                  today={todayInRange ? today : null}
                  onSelect={(day) => {
                    haptic("light")
                    setDayState({ key: periodKey, day })
                  }}
                />
              </div>
            )}
          </MonthStatus>
          <AllocationNudge
            remainingToAllocate={budget.remainingToAllocate}
            onOpenPlan={() => setPlanOpen(true)}
          />

          {/* Cuánto te pasaste, junto: el excedente del mes (contra el presupuesto global) y el de
              los topes por categoría, que no son la misma cifra. Con ambos en $0 no se renderiza. */}
          <OverspendBanner
            period={period}
            globalLimit={budget.globalLimit}
            capsOverspend={budget.capsOverspend}
            monthOverspend={budget.monthOverspend}
            categories={budget.categories}
          />

          {/* Escritorio: categorías a la izquierda; el día elegido a la derecha; las cuentas abajo, a lo ancho. Móvil: una columna en el orden del DOM —
              categorías, día elegido, cuentas—. Todo scrollea con la página (nada fijo). */}
          <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2 lg:items-start">
            <section
              id="presupuestos"
              className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1"
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <h2 className="font-heading text-lg font-bold">
                    Ritmo por categoría
                  </h2>
                  {/* Los días que faltan valen para todas las categorías: se dicen una vez acá,
                      no repetidos en cada fila. En angosto bajan a su propia línea: al lado del
                      título partían el título en dos y se truncaban. */}
                  {daysLeft > 0 && (
                    <span className="basis-full text-sm text-muted-foreground sm:basis-auto">
                      {daysLeft === 1
                        ? "queda 1 día"
                        : `quedan ${daysLeft} días`}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    setNewCatType("expense")
                    setEditCat(null)
                  }}
                  aria-label="Nueva categoría de gasto"
                  className="flex shrink-0 items-center gap-1.5 text-sm text-primary"
                >
                  <Plus className="size-4" /> Categoría
                </button>
              </div>
              <div className="glass rounded-xl p-4">
                {expenseCategories.length === 0 ? (
                  <button
                    onClick={() => {
                      setNewCatType("expense")
                      setEditCat(null)
                    }}
                    className="flex w-full flex-col items-center gap-2 py-6 text-muted-foreground"
                  >
                    <span className="grid size-18 place-items-center rounded-xl border-2 border-dashed border-border text-2xl">
                      +
                    </span>
                    <span className="text-sm">Crear categoría</span>
                  </button>
                ) : (
                  // Lista vertical de barras: gastado + comprometido sobre el tope, con el ritmo
                  // del período y lo que queda del mes debajo. El arco sigue viviendo en el detalle.
                  <div className="flex flex-col">
                    {cappedCategories.map(renderExpenseCat)}
                    {/* Fuera del plan: consultables, cerradas al entrar o cambiar de período. */}
                    {uncappedCategories.length > 0 && (
                      <Collapsible
                        key={periodKey}
                        defaultOpen={false}
                        className="mt-3"
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="group flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm text-muted-foreground hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <ChevronRight className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                            <span className="flex-1">
                              Sin tope · fuera del presupuesto
                            </span>
                            <span className="tabular">
                              {uncappedCategories.length}
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="px-1.5 pb-2 text-xs text-muted-foreground">
                            No afectan lo gastado ni lo disponible del plan.
                          </p>
                          <div className="flex flex-col">
                            {uncappedCategories.map(renderExpenseCat)}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    <button
                      onClick={() => {
                        setNewCatType("expense")
                        setEditCat(null)
                      }}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                      aria-label="Nueva categoría de gasto"
                    >
                      <CirclePlus className="size-4 shrink-0" />
                      Nueva categoría
                    </button>
                  </div>
                )}
                {/* Los ingresos se ven y editan en el plan del mes ("Ajustar plan"): acá solo la
                    puerta, con el total activo, para no repetir las filas en dos superficies. */}
                <div className="mt-2 border-t border-border/40 pt-2">
                  <button
                    onClick={() => setPlanOpen(true)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                  >
                    <TrendingUp className="size-4 shrink-0" />
                    Ingresos
                    <span className="tabular ml-auto text-foreground">
                      {formatCLP(activeIncomeTotal)}
                    </span>
                    <ChevronRight className="size-4 shrink-0" />
                  </button>
                </div>
              </div>
            </section>

            {/* Los movimientos del día elegido en la tira. El mes completo se recorre día a día o
                con la búsqueda (lupa). */}
            <section
              id="movimientos"
              className="min-w-0 max-lg:pb-6 lg:col-start-2 lg:row-start-1"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="truncate font-heading text-lg font-bold">
                  {formatDateHeader(dayIso)}
                </h2>
                {dayTransactions.length > 0 && (
                  <span className="tabular shrink-0 text-right text-sm text-muted-foreground">
                    <span className="block text-xs">Gastado del plan</span>
                    {formatCLP(daySpent)}
                  </span>
                )}
              </div>
              {dayTransactions.length === 0 ? (
                <p className="glass-strong rounded-xl py-10 text-center text-sm text-muted-foreground">
                  {selectedDay === today
                    ? "Sin movimientos hoy"
                    : "Sin movimientos ese día"}
                </p>
              ) : (
                <div className="glass flex flex-col gap-0.5 rounded-xl p-2">
                  {dayTransactions.map((t) => (
                    <MovementRow
                      key={t.id}
                      tx={t}
                      onOpen={setDetailTx}
                      // Tocar el arco del movimiento abre el detalle de SU categoría (no el movimiento).
                      onOpenCategory={openCategory}
                    />
                  ))}
                </div>
              )}
              {/* El resto del período (y la búsqueda) vive en Movimientos. */}
              <Button asChild variant="outline" className="mt-3 h-11 w-full">
                <Link href="/movements">Ver todos los movimientos</Link>
              </Button>
            </section>

            {/* Cuentas: consulta, no decisión diaria. Escritorio: bajo las dos columnas, a lo
                ancho, como grilla de tarjetas. Móvil: al final, como carrusel. */}
            <section className="min-w-0 lg:col-span-2 lg:row-start-3">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold">Cuentas</h2>
                <button
                  onClick={() => setShowBalance((v) => !v)}
                  className="flex items-center gap-1.5 text-sm text-muted-foreground"
                >
                  {showBalance ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                  {showBalance ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div
                ref={cardsRef}
                {...cardsHandlers}
                onScroll={cardsScroll}
                // Móvil: carrusel con snap y fade en los bordes (pt-1: aire para el hover
                // -translate-y). Escritorio: grilla sin scroll que llena el ancho —tres o cuatro
                // tarjetas por fila según quepan; con más, envuelve—.
                className="-mx-4 flex cursor-grab snap-x snap-mandatory scrollbar-none gap-4 overflow-x-auto mask-[linear-gradient(90deg,transparent,black_var(--fade-l,0rem),black_calc(100%-var(--fade-r,2.5rem)),transparent)] px-4 pt-1 pb-4 active:cursor-grabbing lg:mx-0 lg:grid lg:cursor-default lg:grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] lg:overflow-visible lg:mask-none lg:px-0"
              >
                {/* Sin cuentas no hay nada que sumar: la tarjeta en $0 solo tapaba «Conectar banco». */}
                {accounts.length > 0 && (
                  <div
                    data-card
                    className="glass flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col justify-between rounded-xl p-5 lg:w-auto lg:snap-start"
                  >
                    <div className="text-sm text-muted-foreground">
                      Total en cuentas
                    </div>
                    <div className="tabular my-3 text-3xl font-bold">
                      {showBalance ? formatCLP(summary.activeCash) : "••••••"}
                    </div>
                    <div className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-center">
                      <Stat
                        label="Ingresos"
                        value={formatCompact(summary.income, true)}
                        className="text-success"
                      />
                      <Stat
                        label="Gastos"
                        value={formatCompact(-summary.expense)}
                      />
                      <Stat
                        label="Asignado"
                        value={formatCompact(summary.totalBudget)}
                      />
                    </div>
                  </div>
                )}
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    data-card
                    className="flex w-72 shrink-0 snap-center snap-always lg:w-auto lg:snap-start"
                  >
                    <AccountCard
                      account={a}
                      hidden={!showBalance}
                      onClick={() => setInfoAccount(a)}
                    />
                  </div>
                ))}
                <SyncBancoChileButton
                  accounts={accounts}
                  outlookResult={onboarding ? null : outlookResult}
                  outlookReason={outlookReason}
                />
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil).
          El de "nuevo movimiento" (el +) y el de crear tarjeta viven en el AppShell: son los mismos
          en toda la app. */}
      <AccountInfoModal
        account={infoAccount}
        onOpenChange={(o) => !o && setInfoAccount(null)}
      />
      {!planOpen && categoryDetail}
      {!planOpen &&
        editIncome === undefined &&
        !detail &&
        !triageOpen &&
        categoryEditor}
      {!planOpen && incomeEditor}
      {!planOpen && budgetEditor}
      <PlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        period={period}
        cycleRange={cycle.mode === "card_cycle" ? cycle.range : undefined}
        isCurrentMonth={isCurrentMonth}
        globalLimit={budget.globalLimit}
        allocated={budget.allocated}
        expenseCategories={budget.categories.filter(
          (c) => c.type === "expense"
        )}
        incomes={incomes}
        previousCycleIncomes={cycle.mode === "card_cycle" ? previousCycleIncomes : []}
        incomeCategories={incomeCategories}
        activeIncomeTotal={activeIncomeTotal}
        previousMonthDebt={previousMonthDebt}
        onEditBudget={() => {
          setBudgetLimitOpen(true)
        }}
        onAddIncome={() => {
          setEditIncome(null)
        }}
        onEditIncome={(inc) => {
          setEditIncome(inc)
        }}
        onOpenIncomeCategory={(cat) => {
          setDetail(cat)
        }}
        onNewIncomeCategory={() => {
          setNewCatType("income")
          setEditCat(null)
        }}
      >
        {budgetEditor}
        {incomeEditor}
        {categoryDetail}
        {editIncome === undefined && !detail && categoryEditor}
      </PlanSheet>
      {!searchOpen && !detail && transactionEditor}
      <TransactionSearch
        open={searchOpen}
        detailOpen={detailTx !== null}
        onOpenChange={setSearchOpen}
        categories={budget.categories}
        accounts={accounts}
        amountBounds={amountBounds}
        onOpenTransaction={(tx) => {
          setDetailTx(tx)
        }}
      >
        {searchOpen && transactionEditor}
      </TransactionSearch>
      {triage}

      {onboarding && (
        <OnboardingFlow
          accounts={accounts}
          categories={budget.categories}
          uncategorized={uncategorized}
          incomes={incomes}
          period={period}
          globalLimit={budget.globalLimit}
          totalSpent={totalUsed}
          remainingToAllocate={budget.remainingToAllocate}
          onFinish={() => {
            setOnboarding(false)
            router.replace("/dashboard", { scroll: false })
          }}
        />
      )}
    </AppShell>
  )
}

function Stat({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className={cn("tabular text-sm font-semibold", className)}>
        {value}
      </div>
    </div>
  )
}

