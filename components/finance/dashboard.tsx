"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, Plus } from "lucide-react"
import { es } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
import { Chevron, IconTile, ProgressBar, SectionAction, SectionCard } from "./blocks"
import { CategoryModal } from "./category-modal"
import { BudgetLimitModal } from "./budget-limit-modal"
import { CategoryDetailSheet } from "./category-detail-sheet"
import { AccountInfoModal } from "./account-info-modal"
import { LiquidityDetailModal } from "./liquidity-detail-modal"
import { SyncBancoChileButton } from "./sync-bancochile-button"
import { TransactionModal } from "./transaction-modal"
import { OnboardingFlow } from "./onboarding/onboarding-flow"
import type { OnboardingStatus } from "@/lib/onboarding-schemas"
import {
  formatCLP,
  formatDateHeader,
  formatLongDate,
  formatShortDateHeader,
  fromYmd,
  ymd,
  todayKey,
} from "@/lib/finance-format"
import { dateOf, daysLeftIn } from "@/lib/day-spend"
import {
  daysOf,
  type PeriodMode,
  type PeriodRange,
} from "@/arch/shared/billing-cycle"
import type {
  AccountDTO,
  BudgetViewDTO,
  CategoryDTO,
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
  // Abonos de ingreso del período (lo que llegó al banco): la sección Ingresos del plan.
  // Déficit de gastos frente a ingresos del período ANTERIOR, descontado del total a repartir.
  // Llega resuelta del servidor; el front no la recalcula. 0 = el mes pasado cerró en regla.
  previousMonthDebt: number
  outlookResult: string | null
  outlookReason: string | null
  // Estado del onboarding (GET /api/onboarding, resuelto en el servidor): sin terminar ⇒ pantalla completa.
  onboardingStatus: OnboardingStatus
  // `?tx=<id>` de la notificación de movimiento, ya resuelto en el servidor (aunque sea de otro
  // período): abre ese modal al entrar.
  openTx: TransactionDTO | null
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
  previousMonthDebt,
  outlookResult,
  outlookReason,
  openTx,
  onboardingStatus,
}: Props) {
  const router = useRouter()
  // Cuenta sin onboarding terminado: pantalla completa. El retorno de Microsoft (?outlook=setup)
  // lo retoma en el paso del banco; con el onboarding ya terminado, ese retorno va al modal del banco.
  const [onboarding, setOnboarding] = useState(!onboardingStatus.completed)
  const [liquidityOpen, setLiquidityOpen] = useState(false)
  const [detail, setDetail] = useState<CategoryDTO | null>(null)
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(openTx)
  // Tocar otra notificación con la app ya abierta navega a `?tx=<otro>` sin remontar: se ajusta el
  // estado en render (patrón de React para props que cambian) en vez de un useEffect.
  const openTxId = openTx?.id ?? null
  const [linkedTxId, setLinkedTxId] = useState(openTxId)
  if (openTxId !== linkedTxId) {
    setLinkedTxId(openTxId)
    setDetailTx(openTx)
  }
  const [editCat, setEditCat] = useState<CategoryDTO | null | undefined>(
    undefined
  ) // undefined=cerrado, null=crear
  // Tipo fijo al crear categoría: el "+ Categoría" del header fija gasto; el plan, ingreso.
  const [newCatType, setNewCatType] = useState<"income" | "expense" | null>(
    null
  )
  const {
    ref: cardsRef,
    handlers: cardsHandlers,
    onScroll: cardsScroll,
  } = useCardCarousel()
  // Solo el id: la cuenta se deriva de `accounts` para que «Conciliada hasta» se refresque.
  const [infoAccountId, setInfoAccountId] = useState<string | null>(null)
  const infoAccount = accounts.find((a) => a.id === infoAccountId) ?? null
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
  // En el plan: con tope, o sin tope pero con gasto en el período (tope $0: todo es exceso). Las
  // demás van aparte, en su propio grupo cerrado.
  const planCategories = expenseCategories.filter((c) => c.inPlan)
  const outOfPlanCategories = expenseCategories.filter((c) => !c.inPlan)
  const renderExpenseCat = (c: CategoryDTO, nested = false) => {
    // Una sin tope pero en el plan tiene tope $0: lo usado llena la barra, lo comprometido el resto.
    const capped = c.inPlan
    // UNA cifra por fila. Con ritmo (mes en curso y con tope), lo libre del período (hoy / esta
    // semana), que el backend deja estable; sin ritmo, lo que queda del mes. «X de Y» vive en el
    // detalle que abre la fila. La cifra va en su columna y lo que significa, debajo a la derecha.
    const paceLeft = c.pace && c.pace.budget > 0 ? c.pace.budget - c.pace.spent : null
    // Con ritmo pero sin presupuesto del período, ya no queda nada que repartir.
    const noMargin = !!c.pace && c.pace.budget <= 0
    // «quedan» descuenta lo comprometido (tope − usado − comprometido); «sobre el tope» sale de `available`.
    const quedan = Math.max(0, c.free)
    const [figure, figureLabel]: [ReactNode, string] = noMargin
      ? ["Sin margen", ""]
      : c.pace && paceLeft !== null
        ? paceLeft >= 0
          ? [formatCLP(paceLeft), c.pace.frequency === "daily" ? "libres hoy" : "libres esta semana"]
          : [
              formatCLP(-paceLeft),
              c.pace.frequency === "daily" ? "sobre el ritmo de hoy" : "sobre el ritmo semanal",
            ]
        : capped
          ? c.available < 0
            ? [formatCLP(-c.available), "sobre el tope"]
            : [
                // «quedan» descuenta lo comprometido: tope − usado − comprometido.
                <>
                  quedan <span className="tabular">{formatCLP(quedan)}</span>
                </>,
                "",
              ]
          : [formatCLP(c.used), "sin tope"]
    const tone: "alert" | "warn" | "default" =
      noMargin ||
      (paceLeft !== null && c.pace?.status === "excedido") ||
      (paceLeft === null && c.available < 0 && capped)
        ? "alert"
        : (paceLeft !== null && c.pace?.status === "alerta") ||
            // Sin pasarse del tope, pero lo comprometido ya se come lo que queda: «quedan $0».
            (paceLeft === null && capped && c.free < 0)
          ? "warn"
          : "default"
    // Frecuencia del ritmo y tope, a la izquierda bajo el nombre.
    const meta = [
      c.pace ? (c.pace.frequency === "weekly" ? "Semanal" : "Diario") : null,
      capped ? `tope ${formatCLP(c.limit)}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    const weekly = c.pace?.frequency === "weekly"
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => setDetail(c)}
        className={cn(
          "press -mx-3 grid min-h-16 w-[calc(100%+1.5rem)] grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-left",
          nested ? "hover:bg-surface-3" : "hover:bg-secondary"
        )}
      >
        <IconTile
          color={c.color ?? undefined}
          className={cn(
            "self-center",
            ["row-span-2", "row-span-3", "row-span-4"][Number(capped) + Number(weekly)]
          )}
        >
          <CategoryIcon icon={c.icon} size={18} />
        </IconTile>
        <span className="min-w-0 truncate font-semibold">{c.name}</span>
        <span
          className={cn(
            "text-right font-semibold whitespace-nowrap",
            tone === "alert" && "text-destructive",
            tone === "warn" && "text-warning"
          )}
        >
          {figure}
        </span>
        <span className="col-span-2 col-start-2 flex items-baseline justify-between gap-2 text-caption">
          <span className="min-w-0 truncate text-ink-2">{meta}</span>
          {figureLabel && (
            <span className="shrink-0 text-right whitespace-nowrap text-ink-3">{figureLabel}</span>
          )}
        </span>
        {/* Gastado sólido y comprometido tenue detrás (solo con tope); se tiñe con el estado. */}
        {capped && (
          <ProgressBar
            value={c.used}
            committed={c.committed}
            max={c.limit}
            tone={tone}
            label={`Gastado de ${c.name}`}
            className="col-span-2 col-start-2 mt-1"
          />
        )}
        {weekly && c.pace && (
          <span className="col-span-2 col-start-2 text-caption text-ink-3">
            Se reinicia el {resetDayFormat.format(new Date(`${c.pace.nextResetDate}T00:00:00Z`))}
          </span>
        )}
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
  // Resumen del plan: el titular llega resuelto del servidor; la liquidez es la CLP registrada.
  const planProps = {
    cash: summary.activeCash,
    overdraftDebt: summary.overdraftDebt,
    income: activeIncomeTotal,
    spent: totalUsed,
    committed: totalCommitted,
    reimbursementAdjustment: budget.reimbursementAdjustment,
    exchangeRateUnavailable: budget.exchangeRateUnavailable,
    spendable: budget.spendable,
  }

  const hasConnected = accounts.some((a) => a.provider !== "manual")
  const newExpenseCategory = () => {
    setNewCatType("expense")
    setEditCat(null)
  }

  const hasBand = budget.monthOverspend > 0 || budget.capsOverspend > 0
  // Acción de texto en verde con forma de enlace (la de SectionAction, sobre un Link).
  const linkAction =
    "press -mr-2 inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-callout font-semibold whitespace-nowrap text-primary hover:bg-primary-soft md:min-h-8 [&_svg]:size-4"
  const dayArrow =
    "press grid size-(--ctl) shrink-0 place-items-center rounded-md text-ink-2 hover:bg-secondary hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-35 aria-disabled:hover:bg-transparent"

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
      {/* Orden = urgencia de decisión: cuánto queda → voy bien → dónde se va → qué pasó → con qué
          cuento. Móvil: una columna en ese orden. Desde 1200 px, dos columnas parejas: plan y ritmo
          arriba, la banda de excedente a lo ancho, y categorías junto a movimientos y cuentas. */}
      <div className="page-container max-md:pb-2">
        <div
          className={cn(
            "grid grid-cols-1 gap-4 min-[75rem]:grid-cols-2 min-[75rem]:gap-6",
            hasBand
              ? "min-[75rem]:[grid-template-areas:'hero_pace'_'band_band'_'cats_side']"
              : "min-[75rem]:[grid-template-areas:'hero_pace'_'cats_side']"
          )}
        >
          {/* Estado del mes: la respuesta a "¿cuánto puedo gastar?" antes que cualquier detalle. */}
          <MonthStatus
            period={period}
            cycle={cycle}
            isCurrentMonth={isCurrentMonth}
            daysLeft={daysLeft}
            globalLimit={budget.globalLimit}
            spent={totalUsed}
            plan={planProps}
            onOpenPlan={() => setPlanOpen(true)}
            onOpenLiquidity={() => setLiquidityOpen(true)}
            className="min-[75rem]:[grid-area:hero]"
          />

          {/* Cuánto te pasaste, junto: el excedente del mes (contra el presupuesto global) y el de
              los topes por categoría, que no son la misma cifra. Con ambos en $0 no se renderiza. */}
          {hasBand && (
            <div className="min-w-0 min-[75rem]:[grid-area:band]">
              <OverspendBanner
                period={period}
                capsOverspend={budget.capsOverspend}
                monthOverspend={budget.monthOverspend}
                globalLimit={budget.globalLimit}
                categories={budget.categories}
                onOpenCategory={openCategory}
              />
            </div>
          )}

          {/* Ritmo global: reparte lo disponible al inicio del período y solo cuenta el gasto que no
              salda un compromiso. Desde acá se abre el plan, que es lo que lo determina. */}
          <SectionCard
            title="Ritmo del mes"
            action={
              <SectionAction onClick={() => setPlanOpen(true)}>
                Ajustar plan
                <ChevronRight aria-hidden />
              </SectionAction>
            }
            className="min-[75rem]:[grid-area:pace]"
          >
            {budget.globalPace.budget > 0 ? (
              <SpendPaceChart
                days={days}
                spend={budget.globalPace.daily}
                limit={budget.globalPace.budget}
                income={budget.income}
                lastIndex={chartLastIndex}
                current={todayInRange}
              />
            ) : (
              <p className="flex-1 py-2 text-callout text-ink-2">
                Este período no tiene nada que repartir: no hay ritmo que seguir.
              </p>
            )}
            <AllocationNudge
              remainingToAllocate={budget.remainingToAllocate}
              onOpenPlan={() => setPlanOpen(true)}
              className="mt-3"
            />
          </SectionCard>

          <SectionCard
            id="presupuestos"
            title="Categorías"
            action={
              expenseCategories.length > 0 && (
                <SectionAction onClick={newExpenseCategory} aria-label="Nueva categoría de gasto">
                  <Plus aria-hidden /> Nueva
                </SectionAction>
              )
            }
            className="min-[75rem]:[grid-area:cats]"
          >
            {expenseCategories.length === 0 ? (
              // Vacío: un solo CTA (el "+ Nueva" de la cabecera se esconde mientras tanto).
              <div className="flex flex-col items-start gap-3 py-2">
                <p className="text-callout text-ink-2">
                  Reparte tu tope de gasto en categorías para ver su ritmo.
                </p>
                <Button variant="secondary" onClick={newExpenseCategory}>
                  <Plus aria-hidden /> Crear categoría
                </Button>
              </div>
            ) : (
              <>
                {planCategories.length > 0 && (
                  <div className="flex flex-col gap-2">{planCategories.map((c) => renderExpenseCat(c))}</div>
                )}
                {/* Fuera del plan: consultables, cerradas al entrar o cambiar de período. */}
                {outOfPlanCategories.length > 0 && (
                  <Collapsible
                    key={periodKey}
                    defaultOpen={false}
                    className={cn("rounded-lg bg-secondary px-3", planCategories.length > 0 && "mt-3")}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="group flex min-h-12 w-full items-center gap-2 rounded-lg text-left"
                      >
                        <span className="font-semibold">Sin tope</span>
                        <span className="text-caption text-ink-3">{outOfPlanCategories.length}</span>
                        <Chevron className="ml-auto" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="pb-1 text-caption text-ink-3">
                        Fuera del tope de gasto: no afectan lo gastado ni lo disponible del plan.
                      </p>
                      <div className="flex flex-col gap-2 pb-3">
                        {outOfPlanCategories.map((c) => renderExpenseCat(c, true))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </>
            )}
          </SectionCard>

          {/* Columna derecha (≥1200): movimientos del día y cuentas. En móvil se disuelve en la columna. */}
          <div className="contents min-[75rem]:flex min-[75rem]:min-w-0 min-[75rem]:flex-col min-[75rem]:gap-6 min-[75rem]:[grid-area:side]">
            {/* Los movimientos del día elegido: flechas al día anterior/siguiente y, tocando la
                fecha, un calendario del período. El mes completo, en Movimientos o la búsqueda. */}
            <SectionCard
              id="movimientos"
              title="Movimientos"
              action={
                // El resto del período vive en Movimientos.
                <Link
                  href="/movements"
                  // Entrar: la pantalla llega desde la derecha (no como un cambio de pestaña).
                  data-nav="forward"
                  className={linkAction}
                >
                  Ver todos
                  <ChevronRight aria-hidden />
                </Link>
              }
              className="min-[75rem]:flex-1"
            >
              <div className="-ml-3 mb-2 flex min-w-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="Día anterior"
                  // aria-disabled y no disabled: al llegar al extremo el foco se queda en la flecha.
                  aria-disabled={prevDisabled || undefined}
                  onClick={() => !prevDisabled && selectDay(days[dayIndex - 1])}
                  className={dayArrow}
                >
                  <ChevronLeft className="size-5" />
                </button>
                <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-describedby="day-picker-hint"
                      className="press group flex min-h-(--ctl) min-w-0 items-center gap-1 rounded-md px-2 text-left font-semibold whitespace-nowrap hover:bg-secondary"
                    >
                      {/* El nombre es el texto visible. El largo («Sábado, 31 de octubre») solo
                          cabe en una columna ancha (640–1199 px); en móvil y en la columna de
                          escritorio va «Sáb 31 oct», con la fecha completa para el lector. El
                          día nuevo se anuncia al cambiarlo con las flechas. */}
                      <span aria-live="polite" className="min-w-0 truncate">
                        <span className="sm:hidden min-[75rem]:inline">
                          {formatShortDateHeader(dayIso)}
                          <span className="sr-only">, {formatLongDate(dayIso)}</span>
                        </span>
                        <span className="hidden sm:inline min-[75rem]:hidden">
                          {formatDateHeader(dayIso)}
                          {["Hoy", "Ayer"].includes(formatDateHeader(dayIso)) && (
                            <span className="sr-only">, {formatLongDate(dayIso)}</span>
                          )}
                        </span>
                      </span>
                      <Chevron />
                    </button>
                  </PopoverTrigger>
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
                  className={dayArrow}
                >
                  <ChevronRight className="size-5" />
                </button>
                {/* «Hoy», tras la flecha derecha: su columna crece de 0 y funde al aparecer. Solo en
                    el mes en curso y con otro día elegido. */}
                <div
                  inert={!showToday}
                  className={cn(
                    "grid transition-[grid-template-columns,opacity] duration-(--nav-duration) ease-(--nav-ease) motion-reduce:transition-none",
                    showToday ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0"
                  )}
                >
                  <div className="min-w-0 overflow-hidden">
                    <Button variant="outline" onClick={() => selectDay(today)} className="ml-1">
                      Hoy
                    </Button>
                  </div>
                </div>
              </div>
              {dayTransactions.length === 0 ? (
                <p className="py-2 text-callout text-ink-2">
                  {selectedDay === today
                    ? "Sin movimientos hoy"
                    : "Sin movimientos ese día"}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dayTransactions.map((t) => (
                    <MovementRow
                      key={t.id}
                      tx={t}
                      onOpen={setDetailTx}
                      // Tocar el cuadro del movimiento abre el detalle de SU categoría (no el movimiento).
                      onOpenCategory={openCategory}
                      className="-mx-3 w-[calc(100%+1.5rem)]"
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Cuentas: consulta, no decisión diaria. Arriba, lo disponible en cuentas. Móvil: carrusel que sale al borde de la tarjeta, con la
                siguiente asomando. Escritorio: grilla. */}
            <SectionCard
              title="Cuentas"
              action={
                hasConnected && (
                  <SyncBancoChileButton
                    variant="row"
                    outlookResult={onboarding ? null : outlookResult}
                    outlookReason={outlookReason}
                  />
                )
              }
            >
              {/* Caja menos sobregiro usado (no solo la caja); abre el detalle de liquidez. */}
              {accounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLiquidityOpen(true)}
                  className="press -mx-2 mb-3 flex min-h-(--ctl) items-center gap-2 self-start rounded-md px-2 text-left hover:bg-secondary"
                >
                  <span className="flex flex-col">
                    <span
                      className={cn(
                        "text-caption",
                        summary.netPosition < 0 ? "text-destructive" : "text-ink-3"
                      )}
                    >
                      {summary.netPosition < 0 ? "Cuentas en negativo" : "Disponible en cuentas"}
                    </span>
                    <span
                      className={cn(
                        "text-title font-semibold whitespace-nowrap",
                        summary.netPosition < 0 && "text-destructive"
                      )}
                    >
                      {formatCLP(summary.netPosition)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-4 text-ink-3" />
                </button>
              )}
              <div
                ref={cardsRef}
                {...cardsHandlers}
                onScroll={cardsScroll}
                className="-mx-(--pad-card) flex cursor-grab snap-x snap-mandatory scroll-px-(--pad-card) scrollbar-none gap-3 overflow-x-auto overscroll-x-contain px-(--pad-card) py-1 active:cursor-grabbing lg:mx-0 lg:grid lg:cursor-default lg:grid-cols-[repeat(auto-fill,minmax(17.5rem,1fr))] lg:overflow-visible lg:px-0 lg:py-0"
              >
                {accounts.map((a) => (
                  <div
                    key={a.id}
                    data-card
                    className="flex w-[calc(100%-2.25rem+var(--pad-card))] shrink-0 snap-start last:snap-end lg:w-auto"
                  >
                    <AccountCard
                      account={a}
                      variant="tone"
                      onClick={() => setInfoAccountId(a.id)}
                    />
                  </div>
                ))}
                {/* Sin bancos conectados, conectar es un tile del tamaño de una cuenta; con alguno ya
                    conectado, es la acción de la tarjeta. El tile toma el tono de las cuentas. */}
                {!hasConnected && (
                  <div className="contents [&>[data-card]]:w-[calc(100%-2.25rem+var(--pad-card))] [&>[data-card]]:rounded-lg [&>[data-card]]:bg-secondary [&>[data-card]]:hover:bg-surface-3 lg:[&>[data-card]]:w-auto">
                    <SyncBancoChileButton
                      outlookResult={onboarding ? null : outlookResult}
                      outlookReason={outlookReason}
                    />
                  </div>
                )}
              </div>
            </SectionCard>
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
        onOpenChange={(o) => !o && setInfoAccountId(null)}
      />
      {!planOpen && categoryDetail}
      {!planOpen && !detail && categoryEditor}
      {!planOpen && budgetEditor}
      <PlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        period={period}
        cycleRange={cycle.mode === "card_cycle" ? cycle.range : undefined}
        mode={cycle.mode}
        closing={cycle.closing}
        globalLimit={budget.globalLimit}
        globalLimitFollowsIncome={budget.globalLimitFollowsIncome}
        allocated={budget.allocated}
        expenseCategories={budget.categories.filter(
          (c) => c.type === "expense"
        )}
        incomeCategories={incomeCategories}
        activeIncomeTotal={activeIncomeTotal}
        transactions={transactions}
        previousMonthDebt={previousMonthDebt}
        onEditBudget={() => {
          setBudgetLimitOpen(true)
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
        {categoryDetail}
        {!detail && categoryEditor}
      </PlanSheet>
      {!detail && transactionEditor}

      {onboarding && (
        <OnboardingFlow
          status={onboardingStatus}
          globalLimit={budget.globalLimit}
          totalSpent={totalUsed}
          transactions={transactions}
          outlookResult={outlookResult}
          outlookReason={outlookReason}
          onFinish={() => {
            setOnboarding(false)
            router.replace("/dashboard", { scroll: false })
          }}
        />
      )}
    </AppShell>
  )
}
