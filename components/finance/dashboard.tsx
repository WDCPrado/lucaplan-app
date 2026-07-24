"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Plus,
} from "lucide-react"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { useCardCarousel } from "@/hooks/use-card-carousel"
import { AppShell } from "./app-shell"
import { MonthPicker } from "./month-picker"
import { AccountCard } from "./account-card"
import { MovementsList } from "./movements-list"
import { ProgressRing } from "./progress-ring"
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
  formatCLP,
  formatCompact,
  formatMoney,
  monthName,
  quartileVar,
} from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
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
}: Props) {
  const router = useRouter()
  // Primera conexión de correo (callback OAuth ?outlook=setup, aún sin banco): onboarding fullscreen.
  const [onboarding, setOnboarding] = useState(outlookResult === "setup")
  const [showBalance, setShowBalance] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [detail, setDetail] = useState<CategoryDTO | null>(null)
  const [detailTx, setDetailTx] = useState<TransactionDTO | null>(null)
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
  const [applyingBudget, setApplyingBudget] = useState(false)
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
  // El presupuesto de gastos usa las categorías de gasto (tope/uso). Las de ingreso se muestran
  // en su propio grupo con lo recibido en el mes (y su meta, si tienen límite).
  const expenseCategories = budget.categories.filter(
    (c) => c.type === "expense"
  )
  const incomeCategories = budget.categories.filter((c) => c.type === "income")
  // Categorías de ingreso sin fuente fija (solo agrupan abonos sueltos): fila informativa.
  const looseIncomeCategories = incomeCategories.filter(
    (c) => !incomes.some((i) => i.categoryId === c.id)
  )
  const hasIncomeRows = incomes.length > 0 || looseIncomeCategories.length > 0
  // Al crear/editar/eliminar un ingreso la suma puede dejar de calzar con el presupuesto global:
  // se ofrece actualizarlo (acción explícita, nunca automática — mismo criterio que antes).
  const activeIncomeTotal = incomes
    .filter((i) => i.isActive && i.currency === "CLP")
    .reduce((s, i) => s + i.amount, 0)
  const suggestBudget =
    budget.globalLimit !== null &&
    activeIncomeTotal > 0 &&
    activeIncomeTotal !== budget.globalLimit
  // Sobre-asignado: los límites de categoría superan el límite global del mes (alerta, no bloquea).
  const overAllocated =
    budget.remainingToAllocate !== null && budget.remainingToAllocate < 0

  // Uso REAL del presupuesto total: gastado del mes (categorías de gasto) vs límite global.
  const totalUsed = expenseCategories.reduce(
    (s, c) => s + Math.max(0, c.used),
    0
  )
  const usedPct = budget.globalLimit
    ? (totalUsed / budget.globalLimit) * 100
    : 0

  function goMonth(delta: number) {
    const d = new Date(Date.UTC(period.year, period.month - 1 + delta, 1))
    router.push(
      `/dashboard?year=${d.getUTCFullYear()}&month=${d.getUTCMonth() + 1}`
    )
  }

  const now = new Date()
  const isCurrentMonth =
    period.year === now.getUTCFullYear() &&
    period.month === now.getUTCMonth() + 1

  async function signOut() {
    await authClient.signOut()
    router.push("/login")
  }

  async function applyIncomeTotal() {
    setApplyingBudget(true)
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: period.year,
        month: period.month,
        globalLimit: activeIncomeTotal,
      }),
    })
    setApplyingBudget(false)
    if (!res.ok) {
      haptic("error")
      return toast.error("No se pudo actualizar el presupuesto")
    }
    haptic("success")
    toast.success("Presupuesto actualizado")
    router.refresh()
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
        {/* Cuentas */}
        <section>
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
              {/* Ingresos primero: lo que entra define cuánto se puede presupuestar abajo.
                  Una fila por fuente (día en que llega, estado, generar) + categorías de ingreso
                  sin fuente (agrupan abonos sueltos) + fila para agregar. */}
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Ingresos
              </div>
              <div className="divide-y divide-border/40">
                {incomes.map((inc) => (
                  <IncomeRow
                    key={inc.id}
                    income={inc}
                    period={period}
                    isCurrentMonth={isCurrentMonth}
                    onEdit={() => setEditIncome(inc)}
                    onOpenCategory={() => {
                      const cat = budget.categories.find(
                        (c) => c.id === inc.categoryId
                      )
                      if (cat) setEditCat(cat)
                    }}
                  />
                ))}
                {looseIncomeCategories.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 py-2.5">
                    {/* Aro = la categoría (editar); el resto de la fila abre su detalle. */}
                    <button
                      onClick={() => setEditCat(c)}
                      aria-label={`Editar categoría ${c.name}`}
                      className="shrink-0"
                    >
                      <ProgressRing
                        percent={c.used > 0 ? 100 : 0}
                        status="bueno"
                        size={44}
                      >
                        <CategoryIcon
                          icon={c.icon}
                          size={16}
                          color={c.color ?? undefined}
                        />
                      </ProgressRing>
                    </button>
                    <button
                      onClick={() => setDetail(c)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {c.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          Sin ingreso fijo
                        </div>
                      </div>
                    </button>
                    <span className="tabular shrink-0 text-sm font-semibold text-success">
                      +{formatCLP(c.used)}
                    </span>
                  </div>
                ))}
                <button
                  onClick={() => setEditIncome(null)}
                  className="flex w-full items-center gap-3 py-2.5 text-left text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-full border-2 border-dashed border-border text-lg">
                    +
                  </span>
                  {hasIncomeRows ? (
                    <span className="text-sm">Agregar ingreso</span>
                  ) : (
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        Registra tus ingresos
                      </span>
                      <span className="block text-xs">
                        Sueldo, arriendo u otros · definen tu presupuesto
                      </span>
                    </span>
                  )}
                </button>
              </div>

              <div className="mt-5 mb-3 text-xs font-medium text-muted-foreground">
                Gastos
              </div>
              {/* Ingresos ≠ presupuesto definido → ofrecer actualizar el límite global */}
              {suggestBudget && (
                <div className="mb-4 flex flex-col gap-2 rounded-xl bg-secondary/50 p-3">
                  <p className="text-sm">
                    Tus ingresos suman{" "}
                    <span className="tabular font-semibold">
                      {formatMoney(activeIncomeTotal, "CLP")}
                    </span>{" "}
                    · presupuesto en{" "}
                    {formatMoney(budget.globalLimit ?? 0, "CLP")}
                  </p>
                  <button
                    onClick={applyIncomeTotal}
                    disabled={applyingBudget}
                    className="self-start rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {applyingBudget
                      ? "Actualizando…"
                      : "Actualizar presupuesto"}
                  </button>
                </div>
              )}
              {/* Cabecera del límite global: restante por presupuestar (o CTA para definirlo) */}
              {budget.globalLimit === null ? (
                <button
                  onClick={() => setBudgetLimitOpen(true)}
                  className="mb-4 flex w-full items-center justify-between gap-3 rounded-xl border-2 border-dashed border-border px-4 py-3 text-left text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      Definir presupuesto del mes
                    </div>
                    <div className="text-xs">
                      Fija un límite global para repartir entre categorías
                    </div>
                  </div>
                  <span className="shrink-0 text-xl">＋</span>
                </button>
              ) : (
                <button
                  onClick={() => setBudgetLimitOpen(true)}
                  className="group mb-4 w-full rounded-xl bg-secondary/50 px-4 py-3 text-left transition-colors hover:bg-accent"
                  aria-label="Editar presupuesto del mes"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground uppercase">
                      {overAllocated ? "Sobre-asignado" : "Por presupuestar"}
                    </span>
                    <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div
                    className={cn(
                      "tabular text-2xl font-bold",
                      overAllocated && "text-destructive"
                    )}
                  >
                    {formatCLP(budget.remainingToAllocate ?? 0)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Asignado {formatCLP(budget.allocated)} de{" "}
                    {formatCLP(budget.globalLimit)}
                  </div>
                  {/* Uso REAL del mes vs presupuesto total: línea con color por cuartil */}
                  <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, usedPct)}%`,
                        background: quartileVar(usedPct),
                      }}
                    />
                  </div>
                  <div className="tabular mt-1.5 flex items-center justify-between gap-2 text-xs">
                    <span
                      className="font-medium"
                      style={{ color: quartileVar(usedPct) }}
                    >
                      Usado {formatCLP(totalUsed)} · {Math.round(usedPct)}%
                    </span>
                    <span className="text-muted-foreground">
                      {budget.globalLimit - totalUsed >= 0
                        ? `Queda ${formatCLP(budget.globalLimit - totalUsed)}`
                        : `Excedido ${formatCLP(totalUsed - budget.globalLimit)}`}
                    </span>
                  </div>
                </button>
              )}
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
                // Móvil: scroll-x sin wrap (más limpio que la grilla); escritorio: grid 2 col.
                <div className="-mx-4 flex scrollbar-none gap-4 overflow-x-auto px-4 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
                  {expenseCategories.map((c) => {
                    const pct = c.limit > 0 ? (c.used / c.limit) * 100 : 0
                    return (
                      <button
                        key={c.id}
                        onClick={() => setDetail(c)}
                        className="flex w-20 shrink-0 flex-col items-center gap-1.5 lg:w-auto"
                      >
                        <ProgressRing
                          percent={pct}
                          committedPercent={
                            c.limit > 0 ? (c.committed / c.limit) * 100 : 0
                          }
                          status={c.status}
                          size={72}
                        >
                          <CategoryIcon
                            icon={c.icon}
                            size={22}
                            color={c.color ?? undefined}
                          />
                        </ProgressRing>
                        <div className="w-full text-center">
                          <div className="truncate text-xs font-medium">
                            {c.name}
                          </div>
                          <div className="tabular text-xs text-muted-foreground">
                            {formatCLP(c.available)}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                  <button
                    onClick={() => {
                      setNewCatType("expense")
                      setEditCat(null)
                    }}
                    className="flex w-20 shrink-0 flex-col items-center gap-1.5 lg:w-auto"
                    aria-label="Nueva categoría de gasto"
                  >
                    <span className="grid size-18 place-items-center rounded-full border-2 border-dashed border-border text-2xl text-muted-foreground">
                      +
                    </span>
                    <span className="text-xs text-muted-foreground">Nueva</span>
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
          (expenseCategories.find((c) => c.id === detail.id) ?? detail)
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
      <TransactionModal
        tx={detailTx}
        categories={budget.categories}
        accounts={accounts}
        onOpenChange={(o) => !o && setDetailTx(null)}
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

// Fila de INGRESO (fuente): cuándo llega, cuánto y su estado del mes. El aro es la categoría
// (tocarla la edita); el resto de la fila edita el ingreso — son entidades separadas. "Generar"
// crea el movimiento (idempotente en el backend); tocar "Recibido" lo deshace.
function IncomeRow({
  income,
  period,
  isCurrentMonth,
  onEdit,
  onOpenCategory,
}: {
  income: IncomeDTO
  period: { year: number; month: number }
  isCurrentMonth: boolean
  onEdit: () => void
  onOpenCategory: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function toggleGenerated() {
    if (busy) return
    setBusy(true)
    haptic("light")
    const res = await fetch(
      `/api/incomes/${income.id}/generate?year=${period.year}&month=${period.month}`,
      { method: income.generated ? "DELETE" : "POST" }
    )
    setBusy(false)
    if (!res.ok) {
      haptic("error")
      toast.error("No se pudo actualizar el ingreso")
      return
    }
    haptic("success")
    toast.success(income.generated ? "Ingreso deshecho" : "Ingreso recibido")
    router.refresh()
  }

  // Detalle de fecha: día absoluto siempre; en el mes actual, cuánto falta para que llegue.
  const day = income.dayOfMonth
  let when: string
  if (income.generated) {
    when = `Recibido · día ${day}`
  } else if (isCurrentMonth) {
    const diff = day - new Date().getDate()
    when =
      diff > 1
        ? `Llega el ${day} · en ${diff} días`
        : diff === 1
          ? `Llega el ${day} · mañana`
          : diff === 0
            ? "Llega hoy"
            : `Esperado el día ${day}`
  } else {
    when = `Llega el ${day} · ${income.accountName}`
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <button
        onClick={onOpenCategory}
        aria-label="Editar categoría"
        className="shrink-0"
      >
        <ProgressRing
          percent={income.generated ? 100 : 0}
          status="bueno"
          size={44}
        >
          <CategoryIcon
            icon={income.categoryIcon}
            size={16}
            color={income.categoryColor ?? undefined}
          />
        </ProgressRing>
      </button>
      <button
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{income.name}</div>
          <div className="truncate text-xs text-muted-foreground">{when}</div>
        </div>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular text-sm font-semibold text-success">
          +{formatMoney(income.amount, income.currency as CurrencyCode)}
        </span>
        <button
          onClick={toggleGenerated}
          disabled={busy}
          title={income.generated ? "Deshacer" : "Registrar el ingreso del mes"}
          className={cn(
            "flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition duration-150 ease-out active:scale-[0.97] disabled:opacity-50",
            income.generated
              ? "bg-success/10 text-success"
              : "bg-primary text-primary-foreground"
          )}
        >
          {income.generated && <Check className="size-3" />}
          {income.generated ? "Recibido" : "Generar"}
        </button>
      </div>
    </div>
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
