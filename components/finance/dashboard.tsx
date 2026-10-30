"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight, Plus, TrendingUp } from "lucide-react"
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
import { MonthNav } from "./month-nav"
import { AllocationNudge, MonthStatus } from "./month-status"
import { OverspendBanner } from "./overspend-banner"
import { PlanSheet } from "./plan-sheet"
import { AccountCard } from "./account-card"
import { MovementRow } from "./movement-row"
import { DayStrip } from "./day-strip"
import { CategoryIcon } from "./category-icons"
import { unlinkedIncomeTotal } from "@/lib/unlinked-income-total"
import { CategoryModal } from "./category-modal"
import { BudgetLimitModal } from "./budget-limit-modal"
import { CategoryDetailSheet } from "./category-detail-sheet"
import { AccountInfoModal } from "./account-info-modal"
import { SyncBancoChileButton } from "./sync-bancochile-button"
import { TransactionModal } from "./transaction-modal"
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
  BudgetViewDTO,
  CategoryDTO,
  IncomeDTO,
  MonthlySummaryDTO,
  TransactionDTO,
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
  incomes: IncomeDTO[]
  previousCycleIncomes: IncomeDTO[]
  // Excedente del mes ANTERIOR: plata ya gastada que el plan descuenta del total a repartir.
  // Llega resuelta del servidor; el front no la recalcula. 0 = el mes pasado cerró en regla.
  previousMonthDebt: number
  user: { name: string; initial: string; email: string }
  outlookResult: string | null
  outlookReason: string | null
  // `?tx=<id>` de la notificación de movimiento: abre ese modal al entrar.
  openTxId: string | null
}

// Inicio: AppShell (sidebar + topbar + barra inferior) con el mes convertido en una decisión
// (cuánto queda), la tira de días, el ritmo por categoría y los movimientos del día elegido; las
// cuentas al final. La búsqueda es global y vive en el marco (AppFrame). Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({
  period,
  cycle,
  summary,
  accounts,
  budget,
  transactions,
  incomes,
  previousCycleIncomes,
  previousMonthDebt,
  user,
  outlookResult,
  outlookReason,
  openTxId,
}: Props) {
  const router = useRouter()
  // Primera conexión de correo (callback OAuth ?outlook=setup, aún sin banco): onboarding fullscreen.
  const [onboarding, setOnboarding] = useState(outlookResult === "setup")
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
    const figure =
      c.pace && paceLeft !== null ? (
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
      user={user}
      onSignOut={signOut}
      title="Inicio"
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
        {/* Móvil: título grande de iOS bajo la barra; en escritorio el título vive en el topbar. */}
        <h1 className="mb-3 text-large-title font-bold md:hidden">Inicio</h1>
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
            plan={planProps}
            onOpenPlan={() => setPlanOpen(true)}
          >
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
            categories={budget.categories}
            onOpenCategory={openCategory}
          />

          {/* Escritorio: categorías a la izquierda; el día elegido a la derecha; las cuentas abajo, a lo ancho. Móvil: una columna en el orden del DOM —
              categorías, día elegido, cuentas—. Todo scrollea con la página (nada fijo). */}
          <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2 lg:items-start">
            <section
              id="presupuestos"
              className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1"
            >
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <h2 className="text-title-3 font-bold">
                    Ritmo por categoría
                  </h2>
                  {/* Los días que faltan valen para todas las categorías: se dicen una vez acá,
                      no repetidos en cada fila. En angosto bajan a su propia línea: al lado del
                      título partían el título en dos y se truncaban. */}
                  {daysLeft > 0 && (
                    <span className="basis-full text-subheadline text-muted-foreground sm:basis-auto">
                      {daysLeft === 1
                        ? "queda 1 día"
                        : `quedan ${daysLeft} días`}
                    </span>
                  )}
                </div>
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
                {/* Los ingresos se ven y editan en el plan del mes ("Ajustar plan"): acá solo la
                    puerta, con el total activo, para no repetir las filas en dos superficies. */}
                <div>
                  <button
                    onClick={() => setPlanOpen(true)}
                    className="press flex min-h-11 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left text-body hover:bg-accent"
                  >
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-md bg-success text-success-foreground"
                    >
                      <TrendingUp className="size-4" />
                    </span>
                    Ingresos
                    <span className="tabular ml-auto text-subheadline text-muted-foreground">
                      {formatCLP(activeIncomeTotal)}
                    </span>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/60"
                    />
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
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
                <h2 className="truncate text-title-3 font-bold">
                  {formatDateHeader(dayIso)}
                </h2>
                {/* El resto del período vive en Movimientos: navegación en texto azul, como iOS. */}
                <Link
                  href="/movements"
                  className="press flex min-h-11 shrink-0 items-center gap-0.5 text-body text-primary"
                >
                  Ver todos
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
            <section className="min-w-0 lg:col-span-2 lg:row-start-3">
              <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
                <h2 className="text-title-3 font-bold">Cuentas</h2>
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
                    accounts={accounts}
                    outlookResult={onboarding ? null : outlookResult}
                    outlookReason={outlookReason}
                  />
                )}
              </div>
              {hasConnected && (
                <SyncBancoChileButton
                  variant="row"
                  accounts={accounts}
                  outlookResult={onboarding ? null : outlookResult}
                  outlookReason={outlookReason}
                />
              )}
            </section>
          </div>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil).
          La búsqueda vive en el marco (AppFrame): es la misma
          en toda la app. */}
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
