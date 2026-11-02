"use client"

import type { IncomeSource } from "@/arch/v1/domain/finance/income.domain"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { isBudgetedExpenseCategory } from "@/arch/v1/domain/finance/budget-scope.domain"
import { haptic } from "@/lib/haptics"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { AppShell } from "./app-shell"
import { MonthNav } from "./month-nav"
import { AllocationNudge, MonthStatus } from "./month-status"
import { OverspendBanner } from "./overspend-banner"
import { PlanSheet } from "./plan-sheet"
import { AccountCard } from "./account-card"
import { MovementRow } from "./movement-row"
import { SpendPaceChart } from "./spend-pace-chart"
import { CategoryIcon } from "./category-icons"
import { CategoryModal } from "./category-modal"
import { BudgetLimitModal } from "./budget-limit-modal"
import { CategoryDetailSheet } from "./category-detail-sheet"
import { AccountInfoModal } from "./account-info-modal"
import { LiquidityDetailModal } from "./liquidity-detail-modal"
import { SyncBancoChileButton } from "./sync-bancochile-button"
import { TransactionModal } from "./transaction-modal"
import { IncomeModal } from "./income-modal"
import { OnboardingFlow } from "./onboarding/onboarding-flow"
import {
  formatCLP,
  formatDateHeader,
  formatLongDate,
  formatShortDateHeader,
  fromYmd,
  ymd,
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
  BudgetViewDTO,
  CategoryDTO,
  IncomeDTO,
  MonthlySummaryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const resetDayFormat = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  timeZone: "UTC",
})

export type CycleProps = {
  mode: PeriodMode
  range: PeriodRange // del mes en pantalla
  closing: { date: string; estimated: boolean } // cierre del mes en pantalla
  current: { year: number; month: number } // mes en curso según el modo
}

type Props = {
  period: { year: number; month: number; mode: "calendar" | "card_cycle" }
  // Modo del período y rango del mes en pantalla: calendario (1 → fin de mes) o ciclo de la tarjeta.
  cycle: CycleProps
  summary: MonthlySummaryDTO
  accounts: AccountDTO[]
  budget: BudgetViewDTO
  transactions: TransactionDTO[]
  incomes: IncomeDTO[]
  availableIncomeSources: IncomeSource[]
  previousCycleIncomes: IncomeDTO[]
  // Déficit de gastos frente a ingresos del período ANTERIOR, descontado del total a repartir.
  // Llega resuelta del servidor; el front no la recalcula. 0 = el mes pasado cerró en regla.
  previousMonthDebt: number
  outlookResult: string | null
  outlookReason: string | null
  // `?tx=<id>` de la notificación de movimiento: abre ese modal al entrar.
  openTxId: string | null
}

// Inicio: AppShell (sidebar + topbar + barra inferior) con el mes convertido en una decisión
// (cuánto queda), la curva de gasto contra el ritmo, el ritmo por categoría y los movimientos del
// día elegido (con su selector de día); las
// cuentas al final. La búsqueda es global y vive en el marco (AppFrame). Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({
  period,
  cycle,
  summary,
  accounts,
  budget,
  transactions,
  incomes,
  availableIncomeSources,
  previousCycleIncomes,
  previousMonthDebt,
  outlookResult,
  outlookReason,
  openTxId,
}: Props) {
  const router = useRouter()
  // Primera conexión de correo (callback OAuth ?outlook=setup, aún sin banco): onboarding fullscreen.
  const [onboarding, setOnboarding] = useState(outlookResult === "setup")
  const [liquidityOpen, setLiquidityOpen] = useState(false)
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
  // Tipo fijo al crear categoría: el "+ Categoría" del header fija gasto; el plan, ingreso.
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
  const [budgetLimitOpen, setBudgetLimitOpen] = useState(false)
  // Plan del mes (ingresos + presupuesto): decisiones ocasionales, fuera del flujo diario.
  const [planOpen, setPlanOpen] = useState(false)

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
  // Selector de día de los movimientos: dentro del período y, en el mes en curso, nunca después de hoy.
  const lastSelectable = todayInRange ? today : lastDay
  const dayIndex = days.indexOf(selectedDay)
  const selectDay = (day: string) => {
    haptic("light")
    setDayState({ key: periodKey, day })
  }
  const [calendarOpen, setCalendarOpen] = useState(false)
  const showToday = todayInRange && selectedDay !== today
  // Curva del mes: hasta hoy en el mes en curso, todo el período en uno pasado, nada en uno futuro.
  const chartLastIndex = todayInRange
    ? days.indexOf(today)
    : days[0] > today
      ? -1
      : days.length - 1
  const civilDate = (d: string) => fromYmd(d)!
  const prevDisabled = dayIndex <= 0
  const nextDisabled = dayIndex < 0 || selectedDay >= lastSelectable
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
    // UNA cifra por fila. Con ritmo (mes en curso y con tope), lo libre del período (hoy / esta
    // semana), que el backend deja estable; sin ritmo, lo que queda del mes. «X de Y» vive en el
    // detalle que abre la fila. Semáforo silencioso: gris, alerta, excedido.
    const paceLeft = c.pace && c.pace.budget > 0 ? c.pace.budget - c.pace.spent : null
    // Con ritmo pero sin presupuesto del período, ya no queda nada que repartir.
    const noMargin = !!c.pace && c.pace.budget <= 0
    const figure = noMargin ? (
      "Sin margen"
    ) : c.pace && paceLeft !== null ? (
        paceLeft >= 0 ? (
          <>
            <span className="tabular">{formatCLP(paceLeft)}</span> libres{" "}
            {c.pace.frequency === "daily" ? "hoy" : "esta semana"}
          </>
        ) : (
          <>
            <span className="tabular">{formatCLP(-paceLeft)}</span> sobre el
            ritmo {c.pace.frequency === "daily" ? "de hoy" : "semanal"}
          </>
        )
      ) : c.limit > 0 ? (
        c.available < 0 ? (
          <>
            <span className="tabular">{formatCLP(-c.available)}</span> sobre el
            tope
          </>
        ) : (
          <>
            quedan <span className="tabular">{formatCLP(c.available)}</span>
          </>
        )
      ) : (
        <>
          sin tope · <span className="tabular">{formatCLP(c.used)}</span>
        </>
      )
    const figureTone =
      noMargin ||
      (paceLeft !== null && c.pace?.status === "excedido") ||
      (paceLeft === null && c.available < 0 && c.limit > 0)
        ? "text-destructive"
        : paceLeft !== null && c.pace?.status === "alerta"
          ? "text-warning"
          : "text-muted-foreground"
    return (
      // Fila de lista agrupada estilo Ajustes: icono en cuadrado de color, nombre, su cifra y el
      // chevron de que abre el detalle; debajo, la barra fina alineada con el nombre.
      <button
        key={c.id}
        onClick={() => setDetail(c)}
        className="press flex min-h-11 w-full items-start gap-3 py-3 pr-3 pl-4 text-left hover:bg-accent"
      >
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-md text-white"
          style={{ background: c.color ?? "var(--muted-foreground)" }}
        >
          <CategoryIcon icon={c.icon} size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-h-7 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-body">{c.name}</span>
            <span className={cn("shrink-0 text-subheadline", figureTone)}>
              {figure}
            </span>
            <ChevronRight
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground/60"
            />
          </div>
          {/* Mismo semáforo que el arco (statusVar): gastado sólido + comprometido tenue detrás. */}
          {c.limit > 0 && (
            <div className="mr-6 flex h-1.5 overflow-hidden rounded-full bg-muted">
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
          )}
          {c.pace?.frequency === "weekly" && (
            <span className="text-footnote text-muted-foreground">
              Se reinicia el {resetDayFormat.format(new Date(`${c.pace.nextResetDate}T00:00:00Z`))}
            </span>
          )}
        </div>
      </button>
    )
  }
  const incomeCategories = budget.categories.filter((c) => c.type === "income")
  // Al crear/editar/eliminar un ingreso la suma puede dejar de calzar con el presupuesto global:
  // se ofrece actualizarlo (acción explícita, nunca automática — mismo criterio que antes).
  const activeIncomeTotal = budget.income

  // El servidor resuelve ambos totales con el mismo alcance que el resumen y los excedentes.
  const { spent: totalUsed, committed: totalCommitted } = budget

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
      availableSources={availableIncomeSources}
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
      {detail && transactionEditor}
    </CategoryDetailSheet>
  )
  // Resumen del plan; la liquidez es la CLP registrada.
  const planProps = {
    cash: summary.activeCash,
    overdraftDebt: summary.overdraftDebt,
    income: activeIncomeTotal,
    spent: totalUsed,
    committed: totalCommitted,
    reimbursementAdjustment: budget.reimbursementAdjustment,
  }

  const hasConnected = accounts.some((a) => a.provider !== "manual")
  const newExpenseCategory = () => {
    setNewCatType("expense")
    setEditCat(null)
  }

  return (
    <AppShell
      actions={
        <MonthNav
          period={period}
          current={cycle.current}
          cycleRange={cycle.mode === "card_cycle" ? cycle.range : undefined}
          onNavigate={(y, m) => router.push(`/dashboard?year=${y}&month=${m}`)}
        />
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 pt-1 pb-6 md:pt-6 lg:px-8">
        <div className="flex flex-col gap-5">
          {/* Estado del mes: la respuesta a "¿cuánto puedo gastar hoy?" antes que cualquier
              detalle. Desde acá se abre el plan (ingresos y presupuesto), que es lo que lo
              determina. Adentro, la curva del gasto contra el ritmo ideal: cómo vas en el mes.
              Móvil: con presupuesto, este bloque (tarjeta + avisos) llena la primera pantalla
              menos un asomo de los movimientos (--home-peek); el gráfico es lo que estira. */}
          <div className="flex flex-col gap-4">
            <MonthStatus
              period={period}
              cycle={cycle}
              isCurrentMonth={isCurrentMonth}
              daysLeft={daysLeft}
              globalLimit={budget.globalLimit}
              spent={totalUsed}
              committed={totalCommitted}
              plan={planProps}
              onOpenPlan={() => setPlanOpen(true)}
              onOpenLiquidity={() => setLiquidityOpen(true)}
            >
              {budget.globalLimit !== null && (
                <SpendPaceChart
                  days={days}
                  spend={spend}
                  limit={budget.globalLimit}
                  income={budget.income}
                  lastIndex={chartLastIndex}
                  current={todayInRange}
                />
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
              capsOverspend={budget.capsOverspend}
              monthOverspend={budget.monthOverspend}
              globalLimit={budget.globalLimit}
              categories={budget.categories}
              onOpenCategory={openCategory}
            />
          </div>

          {/* Escritorio: categorías a la izquierda y movimientos a la derecha. En móvil los movimientos van primero,
              luego ritmo por categoría y finalmente cuentas, sin duplicar componentes. */}
          <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2 lg:items-start">
            <section
              id="presupuestos"
              className="order-2 min-w-0 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1"
            >
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
                {/* Los días que faltan ya los dice la tarjeta principal («N días para cerrar»). */}
                <h2 className="min-w-0 text-title-3 font-bold">
                  Ritmo por categoría
                </h2>
                {expenseCategories.length > 0 && (
                  <button
                    onClick={newExpenseCategory}
                    aria-label="Nueva categoría de gasto"
                    className="press flex min-h-11 shrink-0 items-center gap-1 text-body text-primary"
                  >
                    <Plus className="size-4" /> Categoría
                  </button>
                )}
              </div>
              {/* Lista agrupada: las filas se separan con líneas finas que arrancan en el texto
                  (--inset = margen + icono + espacio), no con bordes de tarjeta. */}
              <div className="glass inset-list overflow-hidden rounded-xl [--inset:3.5rem]">
                {expenseCategories.length === 0 ? (
                  // Vacío: un solo CTA (el "+ Categoría" de la cabecera se esconde mientras tanto).
                  <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                    <p className="text-subheadline text-muted-foreground">
                      Reparte tu presupuesto en categorías para ver su ritmo.
                    </p>
                    <button
                      onClick={newExpenseCategory}
                      className="press flex min-h-11 items-center gap-1 text-body text-primary"
                    >
                      <Plus className="size-4" /> Crear categoría
                    </button>
                  </div>
                ) : (
                  // Lista vertical de barras: gastado + comprometido sobre el tope, con el ritmo
                  // del período y lo que queda del mes debajo. El arco sigue viviendo en el detalle.
                  <div className="inset-list flex flex-col [--inset:3.5rem]">
                    {cappedCategories.map(renderExpenseCat)}
                    {/* Fuera del plan: consultables, cerradas al entrar o cambiar de período. */}
                    {uncappedCategories.length > 0 && (
                      <Collapsible
                        key={periodKey}
                        defaultOpen={false}
                      >
                        <CollapsibleTrigger asChild>
                          <button
                            type="button"
                            className="press group flex min-h-11 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left text-subheadline text-muted-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="grid size-7 shrink-0 place-items-center">
                              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
                            </span>
                            <span className="flex-1">
                              Sin tope · fuera del presupuesto
                            </span>
                            <span className="tabular">
                              {uncappedCategories.length}
                            </span>
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="pr-3 pb-2 pl-14 text-footnote text-muted-foreground">
                            No afectan lo gastado ni lo disponible del plan.
                          </p>
                          <div className="inset-list flex flex-col [--inset:3.5rem]">
                            {uncappedCategories.map(renderExpenseCat)}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                )}
              </div>
            </section>

            {/* Los movimientos del día elegido: flechas al día anterior/siguiente y, tocando la
                fecha, un calendario del período. El mes completo, en Movimientos o la búsqueda. */}
            <section
              id="movimientos"
              className="order-1 min-w-0 max-lg:pb-6 lg:order-none lg:col-start-2 lg:row-start-1"
            >
              <div className="mb-2 flex min-h-11 items-center justify-between gap-0.5">
                <div className="-ml-3 flex min-w-0 items-center">
                  <button
                    type="button"
                    aria-label="Día anterior"
                    // aria-disabled y no disabled: al llegar al extremo el foco se queda en la flecha.
                    aria-disabled={prevDisabled || undefined}
                    onClick={() => !prevDisabled && selectDay(days[dayIndex - 1])}
                    className="press grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-accent aria-disabled:cursor-default aria-disabled:text-muted-foreground/40 aria-disabled:hover:bg-transparent"
                  >
                    <ChevronLeft className="size-5" />
                  </button>
                  {/* «Hoy», dentro del selector junto a la flecha izquierda: su columna crece de 0 y funde al aparecer. Solo en
                      el mes en curso y con otro día elegido. */}
                  <div
                    inert={!showToday}
                    className={cn(
                      "grid transition-[grid-template-columns,opacity] duration-(--nav-duration) ease-(--nav-ease) motion-reduce:transition-none",
                      showToday ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"
                    )}
                  >
                    {/* Entra desde la izquierda, como el título de la fila móvil (.top-title). */}
                    <div
                      className={cn(
                        "min-w-0 transition-transform duration-(--nav-duration) ease-(--nav-ease) motion-reduce:transition-none",
                        showToday ? "translate-x-0" : "-translate-x-3 overflow-hidden"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => selectDay(today)}
                        // Mismo material y clases que «Hoy» de MonthNav: hereda los cinco niveles de Apariencia; no crear efectos locales.
                        className="press ml-2 min-h-11 rounded-full px-4 text-subheadline font-semibold whitespace-nowrap max-md:liquid-glass md:min-h-10 md:rounded-(--radius-bar-inner) md:bg-(--glass-control) md:hover:bg-accent"
                      >
                        Hoy
                      </button>
                    </div>
                  </div>
                  <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                    <h2 className="flex min-w-0 text-title-3 font-bold">
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-describedby="day-picker-hint"
                          className="press min-h-11 min-w-0 truncate rounded-lg px-1 text-left whitespace-nowrap hover:bg-accent"
                        >
                          {/* El nombre es el texto visible. El largo («Sábado, 31 de octubre») solo
                              cabe en una columna ancha (sm–lg); en móvil y en la columna de
                              escritorio va «Sáb 31 oct», con la fecha completa para el lector. El
                              día nuevo se anuncia al cambiarlo con las flechas. */}
                          <span aria-live="polite">
                            <span className="sm:hidden lg:inline">
                              {formatShortDateHeader(dayIso)}
                              <span className="sr-only">, {formatLongDate(dayIso)}</span>
                            </span>
                            <span className="hidden sm:inline lg:hidden">
                              {formatDateHeader(dayIso)}
                              {["Hoy", "Ayer"].includes(formatDateHeader(dayIso)) && (
                                <span className="sr-only">, {formatLongDate(dayIso)}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </PopoverTrigger>
                    </h2>
                    <span id="day-picker-hint" className="sr-only">
                      Elegir otro día
                    </span>
                    <PopoverContent align="start" className="w-auto p-3">
                      <Calendar
                        mode="single"
                        locale={es}
                        required
                        selected={civilDate(selectedDay)}
                        defaultMonth={civilDate(selectedDay)}
                        startMonth={civilDate(days[0])}
                        endMonth={civilDate(lastSelectable)}
                        disabled={[
                          { before: civilDate(days[0]) },
                          { after: civilDate(lastSelectable) },
                        ]}
                        onSelect={(d) => {
                          const key = ymd(d)
                          setCalendarOpen(false)
                          if (key !== selectedDay) selectDay(key)
                        }}
                        // Celdas de 44 px: el mínimo táctil.
                        className="p-0 [--cell-size:--spacing(11)]"
                      />
                    </PopoverContent>
                  </Popover>
                  <button
                    type="button"
                    aria-label="Día siguiente"
                    aria-disabled={nextDisabled || undefined}
                    onClick={() => !nextDisabled && selectDay(days[dayIndex + 1])}
                    className="press grid size-11 shrink-0 place-items-center rounded-full text-primary hover:bg-accent aria-disabled:cursor-default aria-disabled:text-muted-foreground/40 aria-disabled:hover:bg-transparent"
                  >
                    <ChevronRight className="size-5" />
                  </button>
                </div>
                {/* El resto del período vive en Movimientos: navegación en texto azul, como iOS. */}
                <Link
                  href="/movements"
                  // Entrar: la pantalla llega desde la derecha (no como un cambio de pestaña).
                  data-nav="forward"
                  aria-label="Ver todos"
                  className="press flex min-h-11 shrink-0 items-center gap-0.5 text-body text-primary"
                >
                  {/* Angosto (≤400 px), «Todos»: así la fecha y «Hoy» no se cortan. */}
                  <span className="max-[401px]:hidden">Ver todos</span>
                  <span className="min-[401px]:hidden">Todos</span>
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              </div>
              {dayTransactions.length === 0 ? (
                <p className="glass-strong rounded-xl py-10 text-center text-subheadline text-muted-foreground">
                  {selectedDay === today
                    ? "Sin movimientos hoy"
                    : "Sin movimientos ese día"}
                </p>
              ) : (
                <div className="glass inset-list flex flex-col overflow-hidden rounded-xl [--inset:4.5rem]">
                  {dayTransactions.map((t) => (
                    <MovementRow
                      key={t.id}
                      tx={t}
                      onOpen={setDetailTx}
                      // Tocar el arco del movimiento abre el detalle de SU categoría (no el movimiento).
                      onOpenCategory={openCategory}
                      className="press min-h-11 rounded-none px-4 hover:bg-accent"
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Cuentas: consulta, no decisión diaria. Escritorio: bajo las dos columnas, a lo
                ancho, como grilla de tarjetas. Móvil: al final, como carrusel. */}
            <section className="order-3 min-w-0 lg:order-none lg:col-span-2 lg:row-start-3">
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
                <h2 className="text-title-3 font-bold">Cuentas</h2>
                {hasConnected && (
                  <SyncBancoChileButton
                    variant="row"
                    outlookResult={onboarding ? null : outlookResult}
                    outlookReason={outlookReason}
                  />
                )}
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
                    <div className="text-subheadline text-muted-foreground">
                      Total en cuentas
                    </div>
                    <div className="tabular text-title-1 font-bold">
                      {formatCLP(summary.activeCash)}
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
                      onClick={() => setInfoAccount(a)}
                    />
                  </div>
                ))}
                {/* Sin bancos conectados, conectar es un tile del tamaño de una cuenta; con alguno ya
                    conectado, baja a una fila de texto al pie de la sección. */}
                {!hasConnected && (
                  <SyncBancoChileButton
                    outlookResult={onboarding ? null : outlookResult}
                    outlookReason={outlookReason}
                  />
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil).
          La búsqueda vive en el marco (AppFrame): es la misma
          en toda la app. */}
      <LiquidityDetailModal
        open={liquidityOpen}
        onOpenChange={setLiquidityOpen}
        accounts={accounts}
        cash={summary.activeCash}
        overdraftDebt={summary.overdraftDebt}
      />
      <AccountInfoModal
        account={infoAccount}
        onOpenChange={(o) => !o && setInfoAccount(null)}
      />
      {!planOpen && categoryDetail}
      {!planOpen && editIncome === undefined && !detail && categoryEditor}
      {!planOpen && incomeEditor}
      {!planOpen && budgetEditor}
      <PlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        period={period}
        cycleRange={cycle.mode === "card_cycle" ? cycle.range : undefined}
        mode={cycle.mode}
        closing={cycle.mode === "card_cycle" ? cycle.closing : undefined}
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
      {!detail && transactionEditor}

      {onboarding && (
        <OnboardingFlow
          accounts={accounts}
          categories={budget.categories}
          incomes={incomes}
          availableIncomeSources={availableIncomeSources}
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
