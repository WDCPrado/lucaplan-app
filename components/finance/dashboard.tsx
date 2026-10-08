"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Eye, EyeOff, Plus } from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { AppShell } from "./app-shell"
import { MonthPicker } from "./month-picker"
import { MonthStatus } from "./month-status"
import { OverspendBanner } from "./overspend-banner"
import { PlanSheet } from "./plan-sheet"
import { AccountCard } from "./account-card"
import { MovementRow } from "./movement-row"
import { DayStrip } from "./day-strip"
import { CategoryIcon } from "./category-icons"
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

// Inicio mobile-first: AppShell (sidebar + topbar + barra inferior) con el mes convertido en una decisión
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
  amountBounds,
  previousMonthDebt,
  user,
  outlookResult,
  outlookReason,
  openTxId,
}: Props) {
  const router = useRouter()
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
  const [infoAccount, setInfoAccount] = useState<AccountDTO | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [budgetLimitOpen, setBudgetLimitOpen] = useState(false)
  // Plan del mes (ingresos + presupuesto): decisiones ocasionales, fuera del flujo diario.
  const [planOpen, setPlanOpen] = useState(false)
  // Clasificar es una acción explícita: un refresh no interrumpe el Home.
  const [triageOpen, setTriageOpen] = useState(false)

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
  const spend = spendByDate(transactions, days)
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
  // Escritorio: los movimientos más recientes ANTES del día elegido, agrupados por fecha, para
  // que la columna del día no quede vacía. Ocho filas bastan para llenar la primera pantalla.
  const recentGroups: { key: string; header: string; txs: TransactionDTO[] }[] =
    []
  for (const t of transactions
    .filter((t) => dateOf(t) < selectedDay)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)) {
    const key = t.date.slice(0, 10)
    const last = recentGroups[recentGroups.length - 1]
    if (last?.key === key) last.txs.push(t)
    else recentGroups.push({ key, header: formatDateHeader(t.date), txs: [t] })
  }
  // Tocar el arco de un movimiento abre el detalle de SU categoría (no el movimiento).
  const openCategory = (id: string) => {
    const cat = budget.categories.find((c) => c.id === id)
    if (cat) setDetail(cat)
  }
  const dayIso = `${selectedDay}T00:00:00.000Z`
  // Neto del día como en la cabecera de cada fecha: ingresos suman, cargos restan, internos no.
  const dayNet = dayTransactions.reduce((sum, t) => {
    if (t.isInternal) return sum
    const clp = Math.abs(t.amountClp ?? t.amount)
    return sum + (t.direction === "credit" ? clp : -clp)
  }, 0)
  // El presupuesto de gastos usa las categorías de gasto (tope/uso). Las de ingreso se muestran
  // en su propio grupo con lo recibido en el mes (y su meta, si tienen límite).
  const expenseCategories = budget.categories.filter(
    (c) => c.type === "expense"
  )
  // Las con tope son las que importan en el mes; las sin tope van aparte, en su propio grupo.
  const cappedCategories = expenseCategories.filter((c) => c.limit > 0)
  const uncappedCategories = expenseCategories.filter((c) => c.limit <= 0)
  const renderExpenseCat = (c: CategoryDTO) => {
    const pct = c.limit > 0 ? Math.min(100, (c.used / c.limit) * 100) : 0
    const commPct =
      c.limit > 0 ? Math.min(100 - pct, (c.committed / c.limit) * 100) : 0
    return (
      <button
        key={c.id}
        onClick={() => setDetail(c)}
        className="home-category-row grid min-h-24 w-full grid-cols-[2.75rem_minmax(0,1fr)] gap-3 border-b border-border py-5 text-left last:border-b-0 hover:bg-secondary"
      >
        <span className="home-category-mobile grid size-11 place-items-center rounded-lg bg-secondary">
          <CategoryIcon icon={c.icon} size={21} color={c.color ?? undefined} />
        </span>
        <div className="home-category-mobile min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0 font-medium break-words">{c.name}</span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          </div>
          {c.limit > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div
                className="flex h-2 min-w-20 flex-1 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  style={{ width: `${pct}%`, background: statusVar(c.status) }}
                />
                <div
                  style={{
                    width: `${Math.max(0, commPct)}%`,
                    background:
                      "color-mix(in oklch, var(--primary) 35%, var(--card))",
                  }}
                />
              </div>
              <span
                className={cn("text-sm", c.available < 0 && "text-destructive")}
              >
                {c.available < 0 ? "Excedido " : "Quedan "}
                <span className="font-semibold tabular-nums">
                  {formatCLP(Math.abs(c.available))}
                </span>
              </span>
            </div>
          )}
          <p className="text-sm text-muted-foreground">
            Gastado <span className="tabular-nums">{formatCLP(c.used)}</span>
            {c.limit > 0 ? (
              <>
                {" "}
                de <span className="tabular-nums">{formatCLP(c.limit)}</span>
              </>
            ) : (
              " · sin tope"
            )}
          </p>
          {c.committed > 0 && (
            <p className="text-sm text-muted-foreground">
              Comprometido{" "}
              <span className="tabular-nums">{formatCLP(c.committed)}</span>
            </p>
          )}
          {c.pace && (
            <p
              className={cn(
                "text-sm",
                c.pace.status === "excedido"
                  ? "text-destructive"
                  : "text-muted-foreground"
              )}
            >
              {c.pace.budget - c.pace.spent >= 0
                ? "Libres "
                : "Sobre el ritmo "}
              {c.pace.frequency === "daily" ? "hoy: " : "esta semana: "}
              <span className="tabular-nums">
                {formatCLP(Math.abs(c.pace.budget - c.pace.spent))}
              </span>
            </p>
          )}
        </div>
        <div className="home-category-desktop home-category-columns">
          <div className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-medium">
              <CategoryIcon
                icon={c.icon}
                size={18}
                color={c.color ?? undefined}
              />
              <span className="break-words">{c.name}</span>
            </span>
            {c.pace && (
              <p
                className={cn(
                  "mt-1 text-sm",
                  c.pace.status === "excedido"
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {c.pace.budget - c.pace.spent < 0
                  ? "Sobre el ritmo "
                  : "Libres "}
                {c.pace.frequency === "daily" ? "hoy " : "esta semana "}
                <span className="tabular-nums">
                  {formatCLP(Math.abs(c.pace.budget - c.pace.spent))}
                </span>
              </p>
            )}
          </div>
          <span className="text-right text-sm tabular-nums">
            {formatCLP(c.used)}
          </span>
          <span className="text-right text-sm tabular-nums">
            {formatCLP(c.committed)}
          </span>
          <span
            className={cn(
              "text-right text-sm font-semibold tabular-nums",
              c.available < 0 && "text-destructive"
            )}
          >
            {c.limit > 0 ? formatCLP(c.available) : "—"}
          </span>
          <div className="flex items-center gap-2">
            {c.limit > 0 ? (
              <>
                <div
                  className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden="true"
                >
                  <span
                    style={{
                      width: `${pct}%`,
                      background: statusVar(c.status),
                    }}
                  />
                  <span
                    style={{
                      width: `${Math.max(0, commPct)}%`,
                      background:
                        "color-mix(in oklch, var(--primary) 35%, var(--card))",
                    }}
                  />
                </div>
                <span className="w-10 text-right text-sm text-muted-foreground tabular-nums">
                  {Math.round(((c.used + c.committed) / c.limit) * 100)}%
                </span>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">Sin tope</span>
            )}
          </div>
        </div>
      </button>
    )
  }
  const incomeCategories = budget.categories.filter((c) => c.type === "income")
  // Al crear/editar/eliminar un ingreso la suma puede dejar de calzar con el presupuesto global:
  // se ofrece actualizarlo (acción explícita, nunca automática — mismo criterio que antes).
  const activeIncomeTotal = incomes
    .filter((i) => i.isActive && i.currency === "CLP")
    .reduce((s, i) => s + i.amount, 0)

  // Uso REAL del presupuesto total: gastado del mes (categorías de gasto) vs límite global.
  const totalUsed = expenseCategories.reduce(
    (s, c) => s + Math.max(0, c.used),
    0
  )
  // Comprometido del mes: recurrentes y cuotas que aún no se cobran. Sin descontarlo, el
  // "disponible" miente justo con la plata que ya tiene dueño.
  const totalCommitted = expenseCategories.reduce(
    (s, c) => s + Math.max(0, c.committed),
    0
  )

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
      onClose={() => setTriageOpen(false)}
      onCreateCategory={() => {
        setNewCatType(null)
        setEditCat(null)
      }}
    >
      {categoryEditor}
    </UncategorizedTriage>
  )

  return (
    <AppShell
      user={user}
      active="inicio"
      onSignOut={signOut}
      quickAdd={{ accounts, categories: budget.categories }}
      onSearch={() => setSearchOpen(true)}
      title="Inicio"
      actions={
        // Móvil: selector de 44 px junto al título; «Hoy» solo aparece fuera del período actual.
        <div className="home-period-actions pointer-events-none flex flex-wrap items-center justify-end gap-2 *:pointer-events-auto md:flex-nowrap">
          {!isCurrentMonth && (
            <button
              onClick={() => {
                haptic("light")
                router.push("/dashboard")
              }}
              className="min-h-11 rounded-lg bg-secondary px-3.5 py-1.5 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Hoy
            </button>
          )}
          <div className="flex items-center rounded-lg bg-secondary md:gap-1 md:px-1.5 md:py-1">
            <button
              onClick={() => goMonth(-1)}
              className="grid size-11 place-items-center rounded-md hover:bg-background"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <MonthPicker
              period={period}
              current={cycle.current}
              withYear
              className="h-11"
              onSelect={(y, m) =>
                router.push(`/dashboard?year=${y}&month=${m}`)
              }
            />
            <button
              onClick={() => goMonth(1)}
              className="grid size-11 place-items-center rounded-md hover:bg-background"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      }
    >
      <div className="w-full px-5 py-6 md:px-6">
        <div className="flex flex-col gap-8">
          {/* Estado del mes: la respuesta a "¿cuánto puedo gastar hoy?" antes que cualquier
              detalle. Desde acá se abre el plan (ingresos y presupuesto), que es lo que lo
              determina. La actividad permite recorrer después los días de ese período. */}
          <MonthStatus
            period={period}
            cycle={cycle}
            isCurrentMonth={isCurrentMonth}
            daysLeft={daysLeft}
            globalLimit={budget.globalLimit}
            spent={totalUsed}
            committed={totalCommitted}
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

          {/* Escritorio: categorías a la izquierda; el día elegido y los días anteriores a la
              derecha; las cuentas abajo, a lo ancho. Móvil: una columna en el orden del DOM —
              categorías, día elegido, cuentas—. Todo scrollea con la página (nada fijo). */}
          <div className="home-workspace grid gap-6 gap-y-8">
            <section id="presupuestos" className="home-categories min-w-0">
              <div className="home-category-heading mb-3 flex items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <h2 className="font-heading text-lg font-bold">
                    Plan por categoría
                  </h2>
                </div>
                <button
                  onClick={() => {
                    setNewCatType("expense")
                    setEditCat(null)
                  }}
                  aria-label="Nueva categoría de gasto"
                  className="flex min-h-11 shrink-0 items-center gap-1.5 text-sm text-primary"
                >
                  <Plus className="size-4" /> Categoría
                </button>
              </div>
              <div className="home-category-list">
                {expenseCategories.length > 0 && (
                  <div className="home-category-desktop home-category-columns border-b border-border bg-secondary py-3 text-sm text-muted-foreground">
                    <span>Categoría</span>
                    <span className="text-right">Gastado</span>
                    <span className="text-right">Comprometido</span>
                    <span className="text-right">Disponible</span>
                    <span>Avance</span>
                  </div>
                )}
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
                    {/* Sin tope: separadas para que no compitan con las que sí acotan el mes. */}
                    {uncappedCategories.length > 0 && (
                      <>
                        <div className="mt-3 mb-1 px-1.5 text-xs font-medium text-muted-foreground">
                          Sin topes
                        </div>
                        {uncappedCategories.map(renderExpenseCat)}
                      </>
                    )}
                  </div>
                )}
                {uncategorized.transactions.length > 0 && (
                  <button
                    onClick={() => setTriageOpen(true)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 border-t border-border py-4 text-left text-sm text-primary"
                  >
                    <span>
                      {uncategorized.transactions.length}
                      {uncategorized.hasMore ? "+" : ""} por categorizar
                    </span>
                    <ChevronRight className="size-4" />
                  </button>
                )}
              </div>
            </section>

            {/* Los movimientos del día elegido en la tira. El mes completo se recorre día a día o
                con la búsqueda (lupa). */}
            <section
              id="movimientos"
              className="home-activity min-w-0 rounded-xl md:border md:border-border md:bg-card md:p-4"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="truncate font-heading text-lg font-bold">
                  Actividad
                </h2>
                {dayTransactions.length > 0 && (
                  <span className="tabular shrink-0 text-sm text-muted-foreground">
                    {dayNet >= 0 ? "+" : "−"}
                    {formatCLP(Math.abs(dayNet))}
                  </span>
                )}
              </div>
              <div className="mb-5">
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
              <div className="mb-3 flex items-center justify-between gap-3 text-sm text-muted-foreground">
                <span>{formatDateHeader(dayIso)}</span>
                <button
                  className="min-h-11 text-primary"
                  onClick={() => setSearchOpen(true)}
                >
                  Ver todas
                </button>
              </div>
              {dayTransactions.length === 0 ? (
                <p className="rounded-xl border border-border bg-card py-10 text-center text-sm text-muted-foreground">
                  {selectedDay === today
                    ? "Sin movimientos hoy"
                    : "Sin movimientos ese día"}
                </p>
              ) : (
                <div className="divide-y divide-border bg-card">
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
            </section>

            {/* Solo escritorio: con un día de uno o dos movimientos la columna quedaba vacía
                  frente a una lista de categorías de 900 px. Los días anteriores la completan con
                  lo más reciente, agrupado por fecha como en la búsqueda. */}
            {recentGroups.length > 0 && (
              <section className="home-recent min-w-0">
                <h3 className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Días anteriores
                </h3>
                <div className="divide-y divide-border rounded-xl border border-border bg-card p-1">
                  {recentGroups.map((g) => (
                    <div key={g.key}>
                      <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
                        {g.header}
                      </div>
                      {g.txs.map((t) => (
                        <MovementRow
                          key={t.id}
                          tx={t}
                          onOpen={setDetailTx}
                          onOpenCategory={openCategory}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Cuentas: consulta, no decisión diaria. Escritorio: bajo las dos columnas, a lo
                ancho, como filas sólidas con cada moneda por separado. Móvil: al final. */}
            <section className="home-accounts min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-heading text-lg font-bold">Cuentas</h2>
                <button
                  onClick={() => setShowBalance((v) => !v)}
                  className="flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground"
                >
                  {showBalance ? (
                    <Eye className="size-4" />
                  ) : (
                    <EyeOff className="size-4" />
                  )}
                  {showBalance ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
                {accounts.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                    <span className="text-sm text-muted-foreground">
                      Total en cuentas · CLP
                    </span>
                    <span className="tabular font-semibold">
                      {showBalance ? formatCLP(summary.activeCash) : "••••••"}
                    </span>
                  </div>
                )}
                {accounts.map((a) => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    hidden={!showBalance}
                    compact
                    onClick={() => setInfoAccount(a)}
                  />
                ))}
              </div>
              <div className="mt-4">
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
        isCurrentMonth={isCurrentMonth}
        globalLimit={budget.globalLimit}
        allocated={budget.allocated}
        expenseCategories={budget.categories.filter(
          (c) => c.type === "expense"
        )}
        incomes={incomes}
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
