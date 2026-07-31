"use client"

import { useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  Home,
  ListFilter,
  Plus,
  Repeat,
  Search,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import {
  Accounts,
  AddSheet,
  BudgetList,
  CategorySheet,
  InstallmentsView,
  MonthStatus,
  MovementSheet,
  Movements,
  RecurringView,
  ReviewBanner,
  ReviewSheet,
  SettingsView,
} from "./views"
import { CATS, MOVS, PENDING, RECURRING, type Cat, type Mov } from "./data"

type ViewKey = "inicio" | "movimientos" | "recurrentes" | "cuotas" | "ajustes"

const NAV: { key: ViewKey; label: string; Icon: typeof Home }[] = [
  { key: "inicio", label: "Inicio", Icon: Home },
  { key: "movimientos", label: "Movimientos", Icon: ListFilter },
  { key: "recurrentes", label: "Recurrentes", Icon: Repeat },
  { key: "cuotas", label: "Cuotas", Icon: CreditCard },
  { key: "ajustes", label: "Ajustes", Icon: Settings },
]

const TITLES: Record<ViewKey, string> = {
  inicio: "Julio 2026",
  movimientos: "Movimientos",
  recurrentes: "Recurrentes",
  cuotas: "Cuotas",
  ajustes: "Ajustes",
}

export default function UxAuditMock() {
  const [view, setView] = useState<ViewKey>("inicio")
  const [hidden, setHidden] = useState(false)
  const [cats, setCats] = useState(CATS)
  const [movs, setMovs] = useState(MOVS)
  const [pending, setPending] = useState(PENDING)
  const [recs, setRecs] = useState(RECURRING)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [bannerOff, setBannerOff] = useState(false)
  const [mov, setMov] = useState<Mov | null>(null)
  const [cat, setCat] = useState<Cat | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // Recategorizar mueve el gasto de una categoría a otra: el presupuesto se actualiza en vivo.
  function categorize(movId: string, catId: string | null) {
    const target = movs.find((m) => m.id === movId)
    if (!target) return
    const amount = Math.abs(target.amount)
    setCats((cs) =>
      cs.map((c) => {
        if (c.id === target.catId && target.amount < 0)
          return { ...c, spent: c.spent - amount }
        if (c.id === catId && target.amount < 0)
          return { ...c, spent: c.spent + amount }
        return c
      })
    )
    setMovs((ms) =>
      ms.map((m) => (m.id === movId ? { ...m, catId } : m))
    )
    setPending((p) => p.filter((id) => id !== movId))
    setMov((m) => (m && m.id === movId ? { ...m, catId } : m))
  }

  const committed = recs
    .filter((r) => r.active && !r.chargedThisMonth)
    .reduce((s, r) => s + r.amount, 0)

  return (
    <div className="min-h-dvh bg-background">
      {/* Escritorio: sidebar fija. La navegación no se esconde detrás de un menú. */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border/60 bg-sidebar px-3 py-4 lg:flex">
        <div className="flex items-center gap-2 px-2 pb-6">
          <span className="grid size-8 place-items-center rounded-lg bg-primary font-heading font-bold text-primary-foreground">
            L
          </span>
          <span className="font-heading text-lg font-bold">Luca Plan</span>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-current={view === key ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors",
                view === key
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-xl bg-secondary/60 p-3">
          <p className="text-xs text-muted-foreground">Saldo bancario</p>
          <p className="tabular text-lg font-bold">
            {hidden ? "••••••" : formatCLP(4_092_315)}
          </p>
          <button
            onClick={() => setHidden((v) => !v)}
            className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
            {hidden ? "Mostrar saldos" : "Ocultar saldos"}
          </button>
        </div>
      </aside>

      <div className="lg:pl-60">
        {/* Topbar: en escritorio las acciones viven aquí, no en botones flotantes que tapan datos. */}
        <header className="sticky top-0 z-20 flex min-h-16 items-center gap-3 border-b border-border/60 bg-background/85 px-4 backdrop-blur lg:px-8">
          <h1 className="font-heading truncate text-lg font-bold">
            {TITLES[view]}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-1 rounded-full bg-secondary px-1.5 py-1 sm:flex">
              <button
                className="grid size-8 place-items-center rounded-full transition-colors hover:bg-background"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="px-1 text-sm font-medium">Julio</span>
              <button
                className="grid size-8 place-items-center rounded-full transition-colors hover:bg-background"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <Button
              variant="secondary"
              className="hidden h-10 gap-2 rounded-full pr-2 pl-3.5 text-muted-foreground lg:flex"
              onClick={() => setView("movimientos")}
            >
              <Search className="size-4" />
              Buscar
              <kbd className="tabular rounded border border-border bg-background px-1.5 py-0.5 text-[11px]">
                ⌘K
              </kbd>
            </Button>
            <Button
              className="hidden h-10 rounded-full lg:flex"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-4" />
              Agregar
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 lg:px-8 lg:pb-10">
          {view === "inicio" && (
            <div className="flex flex-col gap-6">
              {!bannerOff && (
                <ReviewBanner
                  count={pending.length}
                  onOpen={() => setReviewOpen(true)}
                  onDismiss={() => setBannerOff(true)}
                />
              )}
              <MonthStatus cats={cats} committed={committed} />

              <section>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-heading text-lg font-bold">Cuentas</h2>
                  <button
                    onClick={() => setHidden((v) => !v)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground lg:hidden"
                  >
                    {hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                    {hidden ? "Mostrar" : "Ocultar"}
                  </button>
                </div>
                <Accounts hidden={hidden} />
              </section>

              <section>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-heading text-lg font-bold">
                    Presupuesto por categoría
                  </h2>
                  <button className="text-sm text-primary">Ajustar</button>
                </div>
                <BudgetList cats={cats} onOpen={setCat} />
              </section>

              <section>
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="font-heading text-lg font-bold">
                    Últimos movimientos
                  </h2>
                  <button
                    className="text-sm text-primary"
                    onClick={() => setView("movimientos")}
                  >
                    Ver los {movs.length}
                  </button>
                </div>
                <Movements
                  movs={movs.slice(0, 6)}
                  pending={pending}
                  onOpen={setMov}
                  compact
                />
              </section>
            </div>
          )}

          {view === "movimientos" && (
            <Movements movs={movs} pending={pending} onOpen={setMov} />
          )}
          {view === "recurrentes" && (
            <RecurringView
              recs={recs}
              onToggle={(id) =>
                setRecs((rs) =>
                  rs.map((r) => (r.id === id ? { ...r, active: !r.active } : r))
                )
              }
            />
          )}
          {view === "cuotas" && <InstallmentsView />}
          {view === "ajustes" && <SettingsView />}
        </main>
      </div>

      {/* Móvil: barra inferior fija. Los cinco destinos a un toque, sin abrir un menú. */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border/60 bg-background/95 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        {NAV.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
              view === key ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>

      {/* Móvil: un solo botón flotante, encima de la barra y sin tapar contenido de la derecha. */}
      <Button
        onClick={() => setAddOpen(true)}
        size="icon"
        aria-label="Agregar movimiento"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg lg:hidden"
      >
        <Plus className="size-6" />
      </Button>

      <MovementSheet
        mov={mov}
        cats={cats}
        onClose={() => setMov(null)}
        onCategorize={categorize}
      />
      <CategorySheet cat={cat} movs={movs} onClose={() => setCat(null)} />
      <ReviewSheet
        open={reviewOpen}
        movs={movs}
        pending={pending}
        cats={cats}
        onClose={() => setReviewOpen(false)}
        onResolve={categorize}
      />
      <AddSheet open={addOpen} cats={cats} onClose={() => setAddOpen(false)} />
    </div>
  )
}
