"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  Eye,
  EyeOff,
  Plus,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { AppShell } from "./app-shell"
import { MonthPicker } from "./month-picker"
import { MonthStatus } from "./month-status"
import { PlanSheet } from "./plan-sheet"
import { AccountCard } from "./account-card"
import { MovementsList } from "./movements-list"
import { CategoryIcon } from "./category-icons"
import { AddTransactionSheet } from "./add-transaction-sheet"
import { CategoryModal } from "./category-modal"
import { BudgetLimitModal } from "./budget-limit-modal"
import { CategoryDetailSheet } from "./category-detail-sheet"
import { AccountModal } from "./account-modal"
import { AccountInfoModal } from "./account-info-modal"
import { SyncBancoChileButton } from "./sync-bancochile-button"
import { UncategorizedTriage } from "./uncategorized-triage"
import { TransactionModal } from "./transaction-modal"
import { TransactionSearch } from "./transaction-search"
import { IncomeModal } from "./income-modal"
import { OnboardingFlow } from "./onboarding/onboarding-flow"
import {
  currentPeriod,
  daysLeftInMonth,
  formatCLP,
  formatCompact,
  monthName,
  statusVar,
} from "@/lib/finance-format"
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

type Props = {
  period: { year: number; month: number }
  summary: MonthlySummaryDTO
  accounts: AccountDTO[]
  budget: BudgetViewDTO
  transactions: TransactionDTO[]
  uncategorized: UncategorizedDTO
  incomes: IncomeDTO[]
  amountBounds: AmountBoundsDTO
  user: { name: string; initial: string; email: string }
  outlookResult: string | null
  outlookReason: string | null
  // `?tx=<id>` de la notificación de movimiento: abre ese modal al entrar.
  openTxId: string | null
}

// Dashboard desktop-first: AppShell (sidebar + topbar + FAB) con el contenido en grid
// multi-columna. Las mutaciones van por la API + router.refresh() dentro de cada superficie.
export function Dashboard({
  period,
  summary,
  accounts,
  budget,
  transactions,
  uncategorized,
  incomes,
  amountBounds,
  user,
  outlookResult,
  outlookReason,
  openTxId,
}: Props) {
  const router = useRouter()
  // Primera conexión de correo (callback OAuth ?outlook=setup, aún sin banco): onboarding fullscreen.
  const [onboarding, setOnboarding] = useState(outlookResult === "setup")
  const [showBalance, setShowBalance] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
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
  // el "Agregar" del header deja el selector libre (null).
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

  // Cuentas que aceptan movimientos a mano: manuales (todo) y corrientes conectadas por correo
  // (solo abonos: el banco no notifica ingresos por correo; los cargos llegan solos).
  const addableAccounts = accounts.filter(
    (a) =>
      a.provider === "manual" ||
      (a.connectionMethod === "email" && a.accountType === "checking")
  )
  // "Mes en curso" según el calendario del usuario, no el de UTC (ver APP_TZ).
  const today = currentPeriod()
  const isCurrentMonth =
    period.year === today.year && period.month === today.month
  // Días que faltan (hoy incluido): el divisor del ritmo diario por categoría. Se anuncia una sola
  // vez en la cabecera del grupo — es un dato del mes, no de cada categoría.
  const daysLeft = isCurrentMonth ? daysLeftInMonth() : 0
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
        {/* Cuánto se puede gastar por día con lo que queda. Solo en el mes en curso y con tope: en
            un mes cerrado no hay días que repartir y sin límite no hay de qué dividir.
            El número ya lleva la señal: gastar de más lo baja solo. No se compara contra el ritmo
            que se lleva (gastado ÷ días corridos) porque un pago único al principio del mes —las
            cuentas, el arriendo— deja ese promedio disparado el resto del mes y teñiría de alarma
            una categoría que ya cumplió. Distinguirlo pide separar gasto fijo de variable, que hoy
            el DTO no permite. */}
        {isCurrentMonth && c.limit > 0 && (
          <p
            className={cn(
              "tabular text-xs",
              c.available > 0 ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {c.available > 0
              ? `${formatCLP(Math.floor(c.available / daysLeft))} por día`
              : c.available < 0
                ? `Sin margen · ${formatCLP(-c.available)} sobre el tope`
                : "Sin margen"}
          </p>
        )}
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

  return (
    <AppShell
      user={user}
      onSignOut={signOut}
      onAdd={() => setAddOpen(true)}
      onSearch={() => setSearchOpen(true)}
      title="Resumen"
      actions={
        // Móvil: columna invertida → selector arriba y "Hoy" colgando debajo; escritorio: fila.
        <div className="flex flex-col-reverse items-center gap-2 md:flex-row">
          {!isCurrentMonth && (
            <button
              onClick={() => {
                haptic("light")
                router.push("/dashboard")
              }}
              className="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-semibold transition-colors hover:bg-accent"
            >
              Hoy
            </button>
          )}
          <div className="flex items-center gap-1 rounded-full bg-secondary px-1.5 py-1">
            <button
              onClick={() => goMonth(-1)}
              className="grid size-8 place-items-center rounded-full hover:bg-background"
              aria-label="Mes anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <MonthPicker
              period={period}
              onSelect={(y, m) =>
                router.push(`/dashboard?year=${y}&month=${m}`)
              }
            />
            <button
              onClick={() => goMonth(1)}
              className="grid size-8 place-items-center rounded-full hover:bg-background"
              aria-label="Mes siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 lg:px-8">
        {/* Estado del mes: la respuesta a "¿cuánto puedo gastar?" antes que cualquier detalle.
            Desde acá se abre el plan (ingresos y presupuesto), que es lo que lo determina. */}
        <MonthStatus
          period={period}
          globalLimit={budget.globalLimit}
          spent={totalUsed}
          committed={totalCommitted}
          remainingToAllocate={budget.remainingToAllocate}
          onOpenPlan={() => setPlanOpen(true)}
        />

        {/* Cuentas */}
        <section className="mt-8">
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
            // pt-1: aire para el hover -translate-y; mask con fade dinámico en ambos bordes
            // (izquierda solo al scrollear, derecha desaparece al llegar al final).
            // snap-mandatory: las tarjetas siempre asientan en un punto de snap (no quedan a
            // medias); en móvil centradas con lock (snap-always), en escritorio al inicio.
            className="-mx-4 flex cursor-grab snap-x snap-mandatory scrollbar-none gap-4 overflow-x-auto mask-[linear-gradient(90deg,transparent,black_var(--fade-l,0rem),black_calc(100%-var(--fade-r,2.5rem)),transparent)] px-4 pt-1 pb-4 active:cursor-grabbing lg:mx-0 lg:px-0"
          >
            <div
              data-card
              className="glass flex min-h-40 w-72 shrink-0 snap-center snap-always flex-col justify-between rounded-2xl p-5 lg:snap-start"
            >
              <div className="text-sm text-muted-foreground">
                Saldo bancario
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
                <Stat label="Gastos" value={formatCompact(-summary.expense)} />
                <Stat
                  label="Presup."
                  value={formatCompact(summary.totalBudget)}
                />
              </div>
            </div>
            {accounts.map((a) => (
              <div
                key={a.id}
                data-card
                className="flex w-72 shrink-0 snap-center snap-always lg:snap-start"
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

        {/* Escritorio: Movimientos a la izquierda (2 col) y Presupuestos sticky a la derecha.
            Móvil: una columna en el orden del DOM — Presupuestos → Movimientos. */}
        <div className="mt-8 grid gap-x-6 gap-y-8 lg:grid-cols-3 lg:items-start">
          <section
            id="presupuestos"
            className="min-w-0 scroll-mt-20 lg:sticky lg:top-20 lg:order-2 lg:self-start"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <h2 className="font-heading text-lg font-bold">Presupuestos</h2>
                <span className="truncate text-sm text-muted-foreground">
                  {monthName(period.month)}
                </span>
              </div>
              <button
                onClick={() => {
                  setNewCatType(null)
                  setEditCat(null)
                }}
                className="flex shrink-0 items-center gap-1.5 text-sm text-primary"
              >
                <Plus className="size-4" /> Agregar
              </button>
            </div>
            <div className="glass rounded-2xl p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span>Categorías de gasto</span>
                {/* Los días que faltan valen para todas las categorías: se dicen una vez acá, no
                    repetidos en cada fila. */}
                {daysLeft > 0 && (
                  <span className="tabular font-normal">
                    {daysLeft === 1 ? "queda 1 día" : `quedan ${daysLeft} días`}
                  </span>
                )}
              </div>
              {expenseCategories.length === 0 ? (
                <button
                  onClick={() => {
                    setNewCatType("expense")
                    setEditCat(null)
                  }}
                  className="flex w-full flex-col items-center gap-2 py-6 text-muted-foreground"
                >
                  <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl">
                    +
                  </span>
                  <span className="text-sm">Crear categoría</span>
                </button>
              ) : (
                // Lista vertical de barras: da mejor lectura del gastado por categoría que los
                // arcos en scroll, y encaja en la columna angosta del panel en cualquier ancho.
                // El arco sigue viviendo en movimientos y en el detalle.
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
                  <button
                    onClick={() => {
                      setNewCatType("expense")
                      setEditCat(null)
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                    aria-label="Nueva categoría de gasto"
                  >
                    {/* Icono de lucide en size-4, igual que el CategoryIcon de las filas: mismo
                        tamaño, mismo trazo y el texto arranca en la misma columna. */}
                    <CirclePlus className="size-4 shrink-0" />
                    Nueva categoría
                  </button>
                </div>
              )}
            </div>
          </section>

          <section
            id="movimientos"
            className="min-w-0 scroll-mt-20 lg:order-1 lg:col-span-2"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-heading text-lg font-bold">Movimientos</h2>
              <span className="text-sm text-muted-foreground">
                {transactions.length} este mes
              </span>
            </div>
            {transactions.length === 0 ? (
              <p className="glass-strong rounded-2xl py-10 text-center text-sm text-muted-foreground">
                Sin movimientos este mes
              </p>
            ) : (
              <MovementsList
                key={`${period.year}-${period.month}`}
                transactions={transactions}
                onOpen={setDetailTx}
                // Tocar el arco del movimiento abre el detalle de SU categoría (no el movimiento).
                onOpenCategory={(id) => {
                  const cat = budget.categories.find((c) => c.id === id)
                  if (cat) setDetail(cat)
                }}
              />
            )}
          </section>
        </div>
      </div>

      {/* Superficies (adaptativas: dialog en escritorio, sheet en móvil) */}
      <AddTransactionSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        accounts={addableAccounts}
        categories={budget.categories}
        onCreateAccount={() => {
          setAddOpen(false)
          setAccountOpen(true)
        }}
      />
      <AccountModal open={accountOpen} onOpenChange={setAccountOpen} />
      <AccountInfoModal
        account={infoAccount}
        onOpenChange={(o) => !o && setInfoAccount(null)}
      />
      <CategoryDetailSheet
        // Derivada de las props frescas (no del snapshot en estado): si el modal de transacción
        // guarda encima y refresca, el usado/disponible del detalle se actualiza solo.
        category={
          detail &&
          (budget.categories.find((c) => c.id === detail.id) ?? detail)
        }
        transactions={transactions}
        // Con el modal de transacción abierto encima, su X / click fuera llega aquí como
        // "interact outside": se ignora para que solo se cierre el modal de arriba.
        onOpenChange={(o) => !o && detailTx === null && setDetail(null)}
        onEdit={(c) => {
          setDetail(null)
          setEditCat(c)
        }}
        onOpenTx={setDetailTx}
      />
      <CategoryModal
        key={editCat?.id ?? `new-${newCatType ?? "libre"}`}
        open={editCat !== undefined}
        onOpenChange={(o) => !o && setEditCat(undefined)}
        period={period}
        category={editCat}
        lockedType={editCat ? null : newCatType}
        remainingToAllocate={budget.remainingToAllocate}
      />
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
      />
      <BudgetLimitModal
        key={`${period.year}-${period.month}-${budget.globalLimit ?? "unset"}`}
        open={budgetLimitOpen}
        onOpenChange={setBudgetLimitOpen}
        period={period}
        current={budget.globalLimit}
      />
      {/* Plan del mes. Los sub-modales (límite, ingreso, categoría) reemplazan a este en vez de
          apilarse: dos superficies encima confunden el cierre, sobre todo en móvil. */}
      <PlanSheet
        open={planOpen}
        onOpenChange={setPlanOpen}
        period={period}
        isCurrentMonth={isCurrentMonth}
        globalLimit={budget.globalLimit}
        allocated={budget.allocated}
        incomes={incomes}
        incomeCategories={incomeCategories}
        activeIncomeTotal={activeIncomeTotal}
        onEditBudget={() => {
          setPlanOpen(false)
          setBudgetLimitOpen(true)
        }}
        onAddIncome={() => {
          setPlanOpen(false)
          setEditIncome(null)
        }}
        onEditIncome={(inc) => {
          setPlanOpen(false)
          setEditIncome(inc)
        }}
        onOpenIncomeCategory={(cat) => {
          setPlanOpen(false)
          setDetail(cat)
        }}
        onNewIncomeCategory={() => {
          setPlanOpen(false)
          setNewCatType("income")
          setEditCat(null)
        }}
      />
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
      <TransactionSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        categories={budget.categories}
        accounts={accounts}
        amountBounds={amountBounds}
        onOpenTransaction={(tx) => {
          setSearchOpen(false)
          setDetailTx(tx)
        }}
      />
      {triageOpen && !onboarding && (
        <UncategorizedTriage
          transactions={uncategorized.transactions}
          hasMore={uncategorized.hasMore}
          accounts={accounts}
          categories={budget.categories}
          onClose={() => setTriageDismissed(true)}
          onCreateCategory={() => {
            setTriageDismissed(true)
            setNewCatType(null)
            setEditCat(null) // abre el modal de categoría existente; el triage vuelve en la próxima carga
          }}
        />
      )}

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
