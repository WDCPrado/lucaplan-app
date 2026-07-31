"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CreditCard,
  Info,
  Pause,
  Play,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { CategoryIcon } from "@/components/finance/category-icons"
import { formatCLP, formatMoney, quartileVar } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import {
  ACCOUNTS,
  CATS,
  GLOBAL_LIMIT,
  PERIOD,
  PLANS,
  SUGGESTED,
  catById,
  dayLabel,
  type Cat,
  type Mov,
  type Rec,
} from "./data"

/* ────────────────────────────── primitivas ────────────────────────────── */

function Surface({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("glass rounded-2xl", className)}>{children}</section>
  )
}

function Title({
  children,
  action,
}: {
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-heading text-lg font-bold">{children}</h2>
      {action}
    </div>
  )
}

/** Barra de una categoría: el color viene del cuartil de uso, nunca solo del color de la marca. */
function Bar({ pct, tone }: { pct: number; tone?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{
          width: `${Math.min(100, Math.max(2, pct))}%`,
          background: tone ?? quartileVar(pct),
        }}
      />
    </div>
  )
}

/* ─────────────────────────── estado del mes ─────────────────────────── */

export function MonthStatus({
  cats,
  committed,
}: {
  cats: Cat[]
  committed: number
}) {
  const spent = cats.reduce((s, c) => s + c.spent, 0)
  const free = GLOBAL_LIMIT - spent - committed
  const daysLeft = PERIOD.daysInMonth - PERIOD.today + 1
  const perDay = Math.round(free / daysLeft)
  const spentPct = (spent / GLOBAL_LIMIT) * 100
  const commPct = (committed / GLOBAL_LIMIT) * 100

  return (
    <Surface className="p-5 lg:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Te queda libre en julio
          </p>
          <p className="tabular mt-1 text-4xl font-bold lg:text-5xl">
            {formatCLP(free)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {daysLeft === 1
              ? "para el último día del mes"
              : `para los ${daysLeft} días que quedan · ${formatCLP(perDay)} por día`}
          </p>
        </div>
        <dl className="flex gap-6 text-sm sm:gap-8">
          <div>
            <dt className="text-muted-foreground">Gastado</dt>
            <dd className="tabular font-semibold">{formatCLP(spent)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Comprometido</dt>
            <dd className="tabular font-semibold">{formatCLP(committed)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Presupuesto</dt>
            <dd className="tabular font-semibold">{formatCLP(GLOBAL_LIMIT)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-success/20">
        <div
          className="h-full bg-foreground/85"
          style={{ width: `${spentPct}%` }}
        />
        <div
          className="h-full border-l border-background bg-foreground/30"
          style={{ width: `${commPct}%` }}
        />
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Legend className="bg-foreground/85">
          Gastado {Math.round(spentPct)}%
        </Legend>
        <Legend className="bg-foreground/30">
          Comprometido (cuotas y recurrentes por cobrar)
        </Legend>
        <Legend className="bg-success/30">Libre</Legend>
      </ul>
    </Surface>
  )
}

function Legend({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} />
      {children}
    </li>
  )
}

/* ───────────────────────────── cuentas ───────────────────────────── */

export function Accounts({ hidden }: { hidden: boolean }) {
  return (
    <div className="-mx-4 grid auto-cols-[17rem] grid-flow-col gap-3 overflow-x-auto scroll-smooth px-4 pb-2 scrollbar-none snap-x snap-mandatory md:mx-0 md:grid-flow-row md:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] md:overflow-visible md:px-0 md:pb-0">
      {ACCOUNTS.map((a) => {
        const used = Math.abs(a.balance)
        const pct = a.limit ? (used / a.limit) * 100 : 0
        return (
          <article
            key={a.id}
            className="glass flex snap-center flex-col justify-between gap-3 rounded-2xl p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate font-medium">{a.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {a.kind} · {a.currency}
                </p>
              </div>
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full"
                style={{ background: a.color }}
                aria-hidden
              />
            </div>
            <p
              className={cn(
                "tabular text-2xl font-bold",
                a.balance < 0 && "text-destructive"
              )}
            >
              {hidden
                ? "••••••"
                : formatMoney(a.balance, a.currency as "CLP" | "USD")}
            </p>
            {a.limit ? (
              <div>
                <Bar pct={pct} />
                <p className="tabular mt-1.5 text-xs text-muted-foreground">
                  {hidden ? "•••" : formatMoney(used, a.currency as "CLP" | "USD")} usado de{" "}
                  {formatMoney(a.limit, a.currency as "CLP" | "USD")}
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Disponible al día de hoy
              </p>
            )}
          </article>
        )
      })}
    </div>
  )
}

/* ──────────────────────────── presupuesto ──────────────────────────── */

export function BudgetList({
  cats,
  onOpen,
}: {
  cats: Cat[]
  onOpen: (c: Cat) => void
}) {
  // Primero lo que necesita decisión: excedidas y en riesgo arriba, holgadas abajo.
  const sorted = [...cats].sort(
    (a, b) => b.spent / (b.limit || 1) - a.spent / (a.limit || 1)
  )
  return (
    <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2">
      {sorted.map((c) => {
        const pct = c.limit ? (c.spent / c.limit) * 100 : 0
        const left = c.limit - c.spent
        return (
          <li key={c.id}>
            <button
              onClick={() => onOpen(c)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-accent/60"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full"
                style={{ background: `${c.color}1f` }}
              >
                <CategoryIcon icon={c.icon} size={18} color={c.color} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span
                    className={cn(
                      "tabular shrink-0 text-sm font-semibold",
                      left < 0 ? "text-destructive" : "text-foreground"
                    )}
                  >
                    {left < 0 ? formatCLP(left) : formatCLP(left)}
                  </span>
                </span>
                <span className="mt-1.5 block">
                  <Bar pct={pct} />
                </span>
                <span className="tabular mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>
                    {formatCLP(c.spent)} de {formatCLP(c.limit)}
                  </span>
                  <span>{left < 0 ? "excedido" : "por gastar"}</span>
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/* ──────────────────────────── movimientos ──────────────────────────── */

export function Movements({
  movs,
  pending,
  onOpen,
  compact = false,
}: {
  movs: Mov[]
  pending: string[]
  onOpen: (m: Mov) => void
  compact?: boolean
}) {
  const [q, setQ] = useState("")
  const [seg, setSeg] = useState<"todos" | "gastos" | "ingresos">("todos")

  const filtered = useMemo(
    () =>
      movs.filter((m) => {
        if (seg === "gastos" && m.amount >= 0) return false
        if (seg === "ingresos" && m.amount < 0) return false
        if (!q) return true
        const cat = catById(m.catId)?.name ?? ""
        return (m.desc + " " + cat).toLowerCase().includes(q.toLowerCase())
      }),
    [movs, q, seg]
  )

  const byDay = useMemo(() => {
    const map = new Map<number, Mov[]>()
    for (const m of filtered) map.set(m.day, [...(map.get(m.day) ?? []), m])
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [filtered])

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar comercio o categoría"
            className="h-11 rounded-full pl-9 text-base md:h-10 md:text-sm"
          />
        </div>
        <div className="flex shrink-0 rounded-full bg-secondary p-1 text-sm">
          {(["todos", "gastos", "ingresos"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSeg(s)}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 capitalize transition-colors sm:flex-none",
                seg === s
                  ? "bg-background font-medium shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Surface className="p-10 text-center">
          <p className="text-sm font-medium">Sin resultados para “{q}”</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Prueba con el nombre del comercio, por ejemplo “jumbo”.
          </p>
          <Button
            variant="secondary"
            className="mt-4 rounded-full"
            onClick={() => {
              setQ("")
              setSeg("todos")
            }}
          >
            Limpiar filtros
          </Button>
        </Surface>
      ) : (
        <Surface className="divide-y divide-border/50 px-4">
          {byDay.map(([day, items]) => {
            const total = items.reduce((s, m) => s + m.amount, 0)
            return (
              <div key={day} className="py-2">
                <div className="flex items-baseline justify-between py-1.5">
                  <h3 className="text-xs font-medium text-muted-foreground">
                    {dayLabel(day)}
                  </h3>
                  <span
                    className={cn(
                      "tabular text-xs",
                      total >= 0 ? "text-success" : "text-muted-foreground"
                    )}
                  >
                    {total >= 0 ? "+" : ""}
                    {formatCLP(total)}
                  </span>
                </div>
                <ul>
                  {items.map((m) => (
                    <MovRow
                      key={m.id}
                      m={m}
                      needsReview={pending.includes(m.id)}
                      onOpen={onOpen}
                      compact={compact}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </Surface>
      )}
    </div>
  )
}

function MovRow({
  m,
  needsReview,
  onOpen,
  compact,
}: {
  m: Mov
  needsReview: boolean
  onOpen: (m: Mov) => void
  compact: boolean
}) {
  const cat = catById(m.catId)
  return (
    <li>
      <button
        onClick={() => onOpen(m)}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent/60"
      >
        <span
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{
            background: cat
              ? `${cat.color}1f`
              : m.amount >= 0
                ? "color-mix(in oklch, var(--success) 12%, transparent)"
                : "var(--muted)",
          }}
        >
          {cat ? (
            <CategoryIcon icon={cat.icon} size={17} color={cat.color} />
          ) : m.amount >= 0 ? (
            <ArrowDownLeft className="size-4 text-success" />
          ) : (
            <AlertTriangle className="size-4 text-warning" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{m.desc}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {needsReview ? (
              <span className="font-medium text-warning">Por revisar</span>
            ) : (
              <span className="truncate">
                {cat?.name ?? (m.amount >= 0 ? "Ingreso" : "Sin categoría")}
              </span>
            )}
            {m.tag && (
              <span className="rounded-full bg-secondary px-1.5 py-px text-[11px]">
                {m.tag === "cuota"
                  ? "Cuota"
                  : m.tag === "recurrente"
                    ? "Recurrente"
                    : "Entre mis cuentas"}
              </span>
            )}
            {!compact && (
              <span className="truncate max-md:hidden">{m.account}</span>
            )}
          </span>
        </span>
        <span
          className={cn(
            "tabular shrink-0 text-sm font-semibold",
            m.amount >= 0 && "text-success"
          )}
        >
          {m.amount >= 0 ? "+" : ""}
          {formatCLP(m.amount)}
        </span>
      </button>
    </li>
  )
}

/* ──────────────────────── detalle de movimiento ──────────────────────── */

export function MovementSheet({
  mov,
  cats,
  onClose,
  onCategorize,
}: {
  mov: Mov | null
  cats: Cat[]
  onClose: () => void
  onCategorize: (movId: string, catId: string) => void
}) {
  const cat = catById(mov?.catId ?? null)
  const gasto = (mov?.amount ?? 0) < 0
  const monto = Math.abs(mov?.amount ?? 0)
  const after = cat ? cat.limit - cat.spent : null

  return (
    <ResponsiveModal
      open={!!mov}
      onOpenChange={(o) => !o && onClose()}
      title="Movimiento"
    >
      {mov && (
        <div className="flex flex-col gap-5 px-4">
          <div>
            <p className="text-sm text-muted-foreground">{mov.desc}</p>
            <p
              className={cn(
                "tabular text-3xl font-bold",
                !gasto && "text-success"
              )}
            >
              {gasto ? "-" : "+"}
              {formatCLP(monto)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {dayLabel(mov.day)} · {mov.account}
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Categoría</p>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onCategorize(mov.id, c.id)}
                  className={cn(
                    "flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors",
                    c.id === mov.catId
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border hover:bg-accent"
                  )}
                >
                  <CategoryIcon icon={c.icon} size={16} color={c.color} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {cat && after !== null && (
            <p className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                En <strong>{cat.name}</strong> llevas{" "}
                <span className="tabular">{formatCLP(cat.spent)}</span> de{" "}
                <span className="tabular">{formatCLP(cat.limit)}</span>:{" "}
                {after >= 0 ? (
                  <>
                    te quedan{" "}
                    <span className="tabular font-semibold">
                      {formatCLP(after)}
                    </span>{" "}
                    este mes.
                  </>
                ) : (
                  <>
                    vas{" "}
                    <span className="tabular font-semibold text-destructive">
                      {formatCLP(Math.abs(after))}
                    </span>{" "}
                    sobre el límite.
                  </>
                )}
              </span>
            </p>
          )}

          <ModalFooter>
            <Button onClick={onClose} className="h-11 flex-1 rounded-full">
              Listo
            </Button>
            <Button
              variant="ghost"
              className="h-11 rounded-full text-muted-foreground"
            >
              <Trash2 className="size-4" />
              Eliminar
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

/* ─────────────────── revisión de movimientos sin categoría ─────────────────── */

export function ReviewSheet({
  open,
  movs,
  pending,
  cats,
  onClose,
  onResolve,
}: {
  open: boolean
  movs: Mov[]
  pending: string[]
  cats: Cat[]
  onClose: () => void
  onResolve: (movId: string, catId: string | null) => void
}) {
  const [i, setI] = useState(0)
  const list = movs.filter((m) => pending.includes(m.id))
  const mov = list[Math.min(i, list.length - 1)]
  const hint = mov ? SUGGESTED[mov.id] : undefined
  const hintCat = hint ? cats.find((c) => c.id === hint.catId) : undefined

  function next(catId: string | null) {
    if (!mov) return
    onResolve(mov.id, catId)
    setI((v) => (v + 1 >= list.length ? 0 : v))
  }

  return (
    <ResponsiveModal
      open={open && list.length > 0}
      onOpenChange={(o) => !o && onClose()}
      title={`Por revisar · ${list.length} ${list.length === 1 ? "movimiento" : "movimientos"}`}
    >
      {mov && (
        <div className="flex flex-col gap-4 px-4">
          <div className="flex items-center gap-1.5" aria-hidden>
            {list.map((m, idx) => (
              <span
                key={m.id}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  idx === i ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          <div>
            <p className="tabular text-3xl font-bold">
              {mov.amount >= 0 ? "+" : "-"}
              {formatCLP(Math.abs(mov.amount))}
            </p>
            <p className="text-sm font-medium">{mov.desc}</p>
            <p className="text-sm text-muted-foreground">
              {dayLabel(mov.day)} · {mov.account}
            </p>
          </div>

          {hint && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                <Sparkles className="size-4" />
                {hintCat
                  ? `Parece ${hintCat.name}`
                  : hint.catId === "interno"
                    ? "Parece un traspaso entre tus cuentas"
                    : "Parece un ingreso tuyo"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{hint.why}</p>
              <Button
                className="mt-3 h-10 rounded-full"
                onClick={() => next(hintCat ? hintCat.id : null)}
              >
                <Check className="size-4" />
                Confirmar
              </Button>
            </div>
          )}

          <div>
            <p className="mb-2 text-sm font-medium">O elige otra categoría</p>
            <div className="flex flex-wrap gap-2">
              {cats.map((c) => (
                <button
                  key={c.id}
                  onClick={() => next(c.id)}
                  className="flex h-11 items-center gap-2 rounded-full border border-border px-3.5 text-sm transition-colors hover:bg-accent"
                >
                  <CategoryIcon icon={c.icon} size={16} color={c.color} />
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <ModalFooter>
            <Button
              variant="secondary"
              className="h-11 flex-1 rounded-full"
              onClick={() => setI((v) => (v + 1) % list.length)}
            >
              Saltar por ahora
            </Button>
            <Button
              variant="ghost"
              className="h-11 rounded-full"
              onClick={onClose}
            >
              Cerrar
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

/* ───────────────────────────── recurrentes ───────────────────────────── */

const catByName = (name: string) => CATS.find((c) => c.name === name)

export function RecurringView({
  recs,
  onToggle,
}: {
  recs: Rec[]
  onToggle: (id: string) => void
}) {
  const active = recs.filter((r) => r.active)
  const total = active.reduce((s, r) => s + r.amount, 0)
  const pending = active.filter((r) => !r.chargedThisMonth)
  const pendingTotal = pending.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0">
        <Title>Pagos recurrentes</Title>
        <Surface className="divide-y divide-border/50 px-4">
          {recs.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-3">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full"
                style={{
                  background: catByName(r.cat)
                    ? `${catByName(r.cat)!.color}1f`
                    : "var(--secondary)",
                }}
              >
                {catByName(r.cat) ? (
                  <CategoryIcon
                    icon={catByName(r.cat)!.icon}
                    size={17}
                    color={catByName(r.cat)!.color}
                  />
                ) : (
                  <CreditCard className="size-4 text-muted-foreground" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    !r.active && "text-muted-foreground line-through"
                  )}
                >
                  {r.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {r.cat} · {r.account}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-sm font-semibold">
                  {formatCLP(r.amount)}
                </p>
                <p className="text-xs whitespace-nowrap text-muted-foreground">
                  {!r.active
                    ? "en pausa"
                    : r.chargedThisMonth
                      ? `cobrado el ${r.day}`
                      : `cobra el ${r.day}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 rounded-full"
                aria-label={r.active ? `Pausar ${r.name}` : `Reanudar ${r.name}`}
                onClick={() => onToggle(r.id)}
              >
                {r.active ? (
                  <Pause className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
              </Button>
            </div>
          ))}
        </Surface>
      </div>

      <div>
        <Title>Este mes</Title>
        <Surface className="p-4 lg:sticky lg:top-24">
          <p className="text-sm text-muted-foreground">Total recurrente</p>
          <p className="tabular text-2xl font-bold">{formatCLP(total)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {active.length} de {recs.length} activos
          </p>
          <div className="mt-4 border-t border-border/60 pt-3">
            <p className="text-sm font-medium">Por cobrar</p>
            {pending.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Todo cobrado este mes.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {pending.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between gap-2 text-sm"
                  >
                    <span className="truncate text-muted-foreground">
                      {r.name} · día {r.day}
                    </span>
                    <span className="tabular shrink-0">
                      {formatCLP(r.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {pendingTotal > 0 && (
              <p className="mt-2 text-sm">
                Reserva{" "}
                <strong className="tabular font-semibold">
                  {formatCLP(pendingTotal)}
                </strong>{" "}
                antes de fin de mes.
              </p>
            )}
          </div>
        </Surface>
      </div>
    </div>
  )
}

/* ─────────────────────────────── cuotas ─────────────────────────────── */

export function InstallmentsView() {
  const monthTotal = PLANS.reduce((s, p) => s + p.monthly, 0)
  const restTotal = PLANS.reduce(
    (s, p) => s + p.monthly * (p.total - p.paid),
    0
  )

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="min-w-0">
        <Title>Compras en cuotas</Title>
        <Surface className="divide-y divide-border/50 px-4">
          {PLANS.map((p) => {
            const pct = (p.paid / p.total) * 100
            return (
              <div key={p.id} className="flex gap-3 py-3.5">
                <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-secondary">
                  <CreditCard className="size-4 text-muted-foreground" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium">
                      {p.name}
                    </p>
                    <p className="shrink-0 text-sm">
                      <span className="tabular font-semibold">
                        {formatCLP(p.monthly)}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">
                        al mes
                      </span>
                    </p>
                  </div>
                  <div className="mt-2">
                    <Bar pct={pct} tone="var(--primary)" />
                  </div>
                  <div className="mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground">
                    <span>
                      Cuota {p.paid} de {p.total} · cobra el {p.nextDay} ·
                      termina en {p.endsOn}
                    </span>
                    <span>
                      quedan{" "}
                      <span className="tabular">
                        {formatCLP(p.monthly * (p.total - p.paid))}
                      </span>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </Surface>
      </div>

      <div>
        <Title>Este mes</Title>
        <Surface className="p-4 lg:sticky lg:top-24">
          <p className="text-sm text-muted-foreground">Pagas en cuotas</p>
          <p className="tabular text-2xl font-bold">{formatCLP(monthTotal)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {PLANS.length} compras activas
          </p>
          <div className="mt-4 border-t border-border/60 pt-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Deuda total restante</span>
              <span className="tabular font-semibold">
                {formatCLP(restTotal)}
              </span>
            </div>
            <p className="mt-2 text-muted-foreground">
              La última cuota vence en enero 2027.
            </p>
          </div>
        </Surface>
      </div>
    </div>
  )
}

/* ────────────────────────────── ajustes ────────────────────────────── */

const PRESETS = [50, 75, 80, 90, 100, 120]

export function SettingsView() {
  const [alerts, setAlerts] = useState<number[]>([50, 80])
  const [days, setDays] = useState(2)

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <Surface className="p-5">
        <h2 className="font-heading text-lg font-bold">
          Alertas de presupuesto
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Te avisamos cuando una categoría cruza estos porcentajes de su límite.
          Llega un solo aviso por categoría: el del umbral más alto que cruzó.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const on = alerts.includes(p)
            return (
              <button
                key={p}
                aria-pressed={on}
                onClick={() =>
                  setAlerts((v) =>
                    on ? v.filter((x) => x !== p) : [...v, p].sort((a, b) => a - b)
                  )
                }
                className={cn(
                  "tabular h-11 rounded-full border px-4 text-sm transition-colors",
                  on
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {on && <Check className="mr-1.5 inline size-3.5" />}
                {p}%
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {alerts.length === 0
            ? "Sin alertas: no te avisaremos por presupuesto."
            : `Avisaremos al ${alerts.join("%, ")}% del límite de cada categoría.`}
        </p>
      </Surface>

      <Surface className="p-5">
        <h2 className="font-heading text-lg font-bold">Pagos por vencer</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Con cuánta anticipación te avisamos de recurrentes y cuotas.
        </p>
        <div className="mt-4 flex items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            className="size-11 rounded-full"
            aria-label="Menos días"
            onClick={() => setDays((d) => Math.max(0, d - 1))}
          >
            -
          </Button>
          <p className="tabular w-28 text-center text-xl font-semibold">
            {days === 0 ? "El mismo día" : `${days} ${days === 1 ? "día" : "días"}`}
          </p>
          <Button
            variant="secondary"
            size="icon"
            className="size-11 rounded-full"
            aria-label="Más días"
            onClick={() => setDays((d) => Math.min(7, d + 1))}
          >
            +
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {days === 0
            ? "Recibirás el aviso el día del cobro."
            : `Tu arriendo del día 5 se avisaría el día ${5 - days}.`}
        </p>
      </Surface>
    </div>
  )
}

/* ──────────────────────── detalle de categoría ──────────────────────── */

export function CategorySheet({
  cat,
  movs,
  onClose,
}: {
  cat: Cat | null
  movs: Mov[]
  onClose: () => void
}) {
  const list = movs.filter((m) => m.catId === cat?.id)
  const pct = cat ? (cat.spent / cat.limit) * 100 : 0
  const left = cat ? cat.limit - cat.spent : 0

  return (
    <ResponsiveModal
      open={!!cat}
      onOpenChange={(o) => !o && onClose()}
      title={cat?.name ?? ""}
    >
      {cat && (
        <div className="flex flex-col gap-4 px-4">
          <div>
            <p
              className={cn(
                "tabular text-3xl font-bold",
                left < 0 && "text-destructive"
              )}
            >
              {formatCLP(Math.abs(left))}
            </p>
            <p className="text-sm text-muted-foreground">
              {left < 0 ? "sobre el límite del mes" : "por gastar este mes"}
            </p>
            <div className="mt-3">
              <Bar pct={pct} />
            </div>
            <p className="tabular mt-1.5 text-xs text-muted-foreground">
              {formatCLP(cat.spent)} de {formatCLP(cat.limit)} ·{" "}
              {Math.round(pct)}%
            </p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">
              {list.length} movimientos en julio
            </p>
            <ul className="divide-y divide-border/50">
              {list.slice(0, 6).map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">{m.desc}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {formatCLP(m.amount)}
                  </span>
                </li>
              ))}
            </ul>
            {list.length > 6 && (
              <button className="mt-2 flex items-center gap-1 text-sm text-primary">
                Ver los {list.length} movimientos <ChevronRight className="size-4" />
              </button>
            )}
          </div>
          <ModalFooter>
            <Button className="h-11 flex-1 rounded-full" onClick={onClose}>
              Listo
            </Button>
            <Button variant="secondary" className="h-11 rounded-full">
              Editar límite
            </Button>
          </ModalFooter>
        </div>
      )}
    </ResponsiveModal>
  )
}

/* ─────────────────── aviso de revisión (no bloqueante) ─────────────────── */

export function ReviewBanner({
  count,
  onOpen,
  onDismiss,
}: {
  count: number
  onOpen: () => void
  onDismiss: () => void
}) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3">
      <AlertTriangle className="size-5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-sm">
        <strong className="font-semibold">
          {count} {count === 1 ? "movimiento" : "movimientos"} sin categoría
        </strong>{" "}
        <span className="text-muted-foreground">
          no entran en tu presupuesto hasta que los revises.
        </span>
      </p>
      <Button size="sm" className="h-9 shrink-0 rounded-full" onClick={onOpen}>
        Revisar
        <ArrowRight className="size-4" />
      </Button>
      <button
        onClick={onDismiss}
        aria-label="Descartar aviso"
        className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

/* ────────────────────── nuevo movimiento a mano ────────────────────── */

export function AddSheet({
  open,
  cats,
  onClose,
}: {
  open: boolean
  cats: Cat[]
  onClose: () => void
}) {
  const [kind, setKind] = useState<"gasto" | "ingreso">("gasto")
  const [amount, setAmount] = useState("")
  const [desc, setDesc] = useState("")
  const [catId, setCatId] = useState<string | null>(null)
  const [account, setAccount] = useState(ACCOUNTS[0].id)
  const monto = Number(amount.replace(/\D/g, ""))
  const falta = monto <= 0 ? "Escribe el monto" : !desc ? "Escribe una descripción" : null

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Nuevo movimiento"
    >
      <div className="flex flex-col gap-4 px-4">
        <div className="flex rounded-full bg-secondary p-1 text-sm">
          {(["gasto", "ingreso"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={cn(
                "h-9 flex-1 rounded-full capitalize transition-colors",
                kind === k
                  ? "bg-background font-medium shadow-xs"
                  : "text-muted-foreground"
              )}
            >
              {k}
            </button>
          ))}
        </div>

        <div>
          <label htmlFor="mock-monto" className="mb-1.5 block text-sm font-medium">
            Monto
          </label>
          <div className="relative">
            <span className="tabular absolute top-1/2 left-3.5 -translate-y-1/2 text-lg text-muted-foreground">
              $
            </span>
            <Input
              id="mock-monto"
              inputMode="numeric"
              value={amount}
              onChange={(e) =>
                setAmount(
                  e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
                )
              }
              placeholder="0"
              className={cn(
                "tabular h-14 rounded-xl pl-8 text-2xl font-bold",
                kind === "ingreso" && "text-success"
              )}
            />
          </div>
        </div>

        <div>
          <label htmlFor="mock-desc" className="mb-1.5 block text-sm font-medium">
            Descripción
          </label>
          <Input
            id="mock-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="Feria de la esquina"
            className="h-12 rounded-xl text-base"
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">Cuenta</p>
          <div className="flex flex-wrap gap-2">
            {ACCOUNTS.filter((a) => a.currency === "CLP").map((a) => (
              <button
                key={a.id}
                onClick={() => setAccount(a.id)}
                className={cn(
                  "h-11 rounded-full border px-3.5 text-sm transition-colors",
                  account === a.id
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border hover:bg-accent"
                )}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">
            Categoría{" "}
            <span className="font-normal text-muted-foreground">(opcional)</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {cats.map((c) => (
              <button
                key={c.id}
                onClick={() => setCatId(c.id === catId ? null : c.id)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors",
                  catId === c.id
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border hover:bg-accent"
                )}
              >
                <CategoryIcon icon={c.icon} size={16} color={c.color} />
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <ModalFooter className="flex-col items-stretch gap-1.5">
          <Button
            disabled={!!falta}
            onClick={onClose}
            className="h-12 rounded-full text-base"
          >
            Guardar {kind}
          </Button>
          {falta && (
            <p className="text-center text-xs text-muted-foreground">{falta}</p>
          )}
        </ModalFooter>
      </div>
    </ResponsiveModal>
  )
}
