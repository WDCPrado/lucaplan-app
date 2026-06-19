"use client"

import { useMemo, useState } from "react"
import {
  ArrowUpRight,
  Bell,
  Car,
  ChevronRight,
  Clapperboard,
  Coffee,
  CreditCard,
  Fuel,
  Home,
  LogOut,
  Nfc,
  Plus,
  Receipt,
  ShoppingBag,
  Tags,
  Target,
  User,
  Wallet,
  Zap,
} from "lucide-react"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

const clp = (n: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    maximumFractionDigits: 0,
  }).format(n)

type IconType = React.ComponentType<{ className?: string }>

const CATEGORIES: Record<string, { icon: IconType; color: string }> = {
  Ingreso: { icon: Wallet, color: "#34d399" },
  Supermercado: { icon: ShoppingBag, color: "#c45cff" },
  Café: { icon: Coffee, color: "#fbbf24" },
  Combustible: { icon: Fuel, color: "#38bdf8" },
  Electricidad: { icon: Zap, color: "#7c5cff" },
  Entretenimiento: { icon: Clapperboard, color: "#c45cff" },
  Transporte: { icon: Car, color: "#38bdf8" },
  Otro: { icon: Receipt, color: "#a6a3b8" },
}
const BANKS = ["Banco de Chile", "BancoEstado", "Tenpo"]

const accounts = [
  { brand: "Banco de Chile", type: "Crédito", last4: "4821", balance: 1284500, featured: true },
  { brand: "BancoEstado", type: "Débito", last4: "0192", balance: 542300 },
  { brand: "Tenpo", type: "Prepago", last4: "7734", balance: 98750 },
]
const total = accounts.reduce((a, x) => a + x.balance, 0)

type Tx = {
  id: string
  description: string
  category: string
  bank: string
  amount: number
  date: "Hoy" | "Ayer"
}

const initialTx: Tx[] = [
  { id: "1", description: "Sueldo", category: "Ingreso", bank: "BancoEstado", amount: 1250000, date: "Hoy" },
  { id: "2", description: "Jumbo", category: "Supermercado", bank: "Banco de Chile", amount: -45990, date: "Hoy" },
  { id: "3", description: "Starbucks", category: "Café", bank: "Banco de Chile", amount: -5900, date: "Hoy" },
  { id: "4", description: "Copec", category: "Combustible", bank: "Banco de Chile", amount: -38000, date: "Ayer" },
  { id: "5", description: "Enel", category: "Electricidad", bank: "BancoEstado", amount: -32450, date: "Ayer" },
  { id: "6", description: "Netflix", category: "Entretenimiento", bank: "Tenpo", amount: -9300, date: "Ayer" },
  { id: "7", description: "Uber", category: "Transporte", bank: "Tenpo", amount: -6700, date: "Ayer" },
]

const goals = [
  { name: "Viaje a Brasil", current: 820000, target: 1500000, color: "#7c5cff" },
  { name: "Fondo de emergencia", current: 1100000, target: 2000000, color: "#34d399" },
  { name: "Notebook nuevo", current: 240000, target: 900000, color: "#38bdf8" },
]

type Tab = "inicio" | "movimientos" | "metas" | "perfil"

export default function DashboardMock() {
  const [tab, setTab] = useState<Tab>("inicio")
  const [txs, setTxs] = useState<Tx[]>(initialTx)
  const [open, setOpen] = useState(false)

  const [description, setDescription] = useState("")
  const [amount, setAmount] = useState("")
  const [type, setType] = useState<"gasto" | "ingreso">("gasto")
  const [category, setCategory] = useState("Supermercado")
  const [bank, setBank] = useState("Banco de Chile")

  const spentMonth = useMemo(
    () => txs.filter((t) => t.amount < 0).reduce((a, t) => a + t.amount, 0),
    [txs],
  )

  function resetForm() {
    setDescription("")
    setAmount("")
    setType("gasto")
    setCategory("Supermercado")
    setBank("Banco de Chile")
  }

  function addTx() {
    const n = Number(amount.replace(/\D/g, ""))
    if (!description.trim() || !n) return
    const tx: Tx = {
      id: String(Date.now()),
      description: description.trim(),
      category: type === "ingreso" ? "Ingreso" : category,
      bank,
      amount: type === "ingreso" ? n : -n,
      date: "Hoy",
    }
    setTxs((prev) => [tx, ...prev])
    setOpen(false)
    resetForm()
    setTab("movimientos")
  }

  return (
    <main className="relative min-h-svh overflow-hidden bg-background text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-72 w-2xl -translate-x-1/2 rounded-full bg-primary/25 blur-[120px]"
      />

      <div className="relative mx-auto max-w-md px-5 pb-28 pt-7">
        {tab === "inicio" && <Inicio txs={txs} onSeeAll={() => setTab("movimientos")} />}
        {tab === "movimientos" && <Movimientos txs={txs} spentMonth={spentMonth} />}
        {tab === "metas" && <Metas />}
        {tab === "perfil" && <Perfil />}
      </div>

      {/* Navegación inferior */}
      <nav className="fixed inset-x-0 bottom-0 z-50">
        <div className="mx-auto flex max-w-md items-center justify-around border-t border-border bg-card/80 px-6 pt-3 pb-5 backdrop-blur-xl">
          <NavItem icon={Home} label="Inicio" active={tab === "inicio"} onClick={() => setTab("inicio")} />
          <NavItem icon={Receipt} label="Movimientos" active={tab === "movimientos"} onClick={() => setTab("movimientos")} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="-mt-8 grid size-14 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/40 ring-4 ring-background transition-transform active:scale-95"
            aria-label="Agregar movimiento"
          >
            <Plus className="size-6" />
          </button>
          <NavItem icon={Target} label="Metas" active={tab === "metas"} onClick={() => setTab("metas")} />
          <NavItem icon={User} label="Perfil" active={tab === "perfil"} onClick={() => setTab("perfil")} />
        </div>
      </nav>

      {/* Agregar movimiento */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Agregar movimiento</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1">
              {(["gasto", "ingreso"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "rounded-lg py-2 text-sm font-medium capitalize transition-colors",
                    type === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="desc">Descripción</Label>
              <Input id="desc" placeholder="Ej. Supermercado" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="amount">Monto</Label>
              <Input id="amount" inputMode="numeric" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>

            {type === "gasto" && (
              <div className="grid gap-1.5">
                <Label>Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(CATEGORIES).filter((c) => c !== "Ingreso").map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label>Cuenta</Label>
              <Select value={bank} onValueChange={setBank}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BANKS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={addTx} className="w-full">Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function Inicio({ txs, onSeeAll }: { txs: Tx[]; onSeeAll: () => void }) {
  const recent = txs.slice(0, 4)
  return (
    <>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="size-11 border border-border">
            <AvatarFallback className="bg-secondary font-heading text-secondary-foreground">MC</AvatarFallback>
          </Avatar>
          <div className="leading-tight">
            <p className="text-sm text-muted-foreground">Buenas tardes,</p>
            <p className="font-medium">Matías</p>
          </div>
        </div>
        <button type="button" className="relative grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:text-foreground" aria-label="Notificaciones">
          <Bell className="size-4.5" />
          <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary ring-2 ring-card" />
        </button>
      </header>

      <section className="mt-8">
        <p className="text-sm text-muted-foreground">Balance total</p>
        <p className="mt-1 font-heading text-4xl font-bold tracking-tight tabular-nums">{clp(total)}</p>
        <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-success">
          <ArrowUpRight className="size-4" />+2,4%<span className="font-normal text-muted-foreground">este mes</span>
        </p>
      </section>

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Tus cuentas</h2>
          <span className="inline-flex items-center gap-1 text-sm text-muted-foreground"><Plus className="size-4" /> Agregar</span>
        </div>
        <div className="scrollbar-none -mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 [&::-webkit-scrollbar]:hidden">
          {accounts.map((a) => (
            <article key={a.last4} className={cn("flex h-44 w-66 shrink-0 snap-start flex-col justify-between rounded-3xl p-5", a.featured ? "bg-[linear-gradient(135deg,var(--primary)_0%,#9b6bff_45%,var(--chart-2)_100%)] text-white shadow-lg shadow-primary/25" : "border border-border bg-card")}>
              <div className="flex items-start justify-between">
                <div>
                  <p className={cn("text-sm font-medium", a.featured ? "text-white/90" : "text-foreground")}>{a.brand}</p>
                  <p className={cn("text-xs", a.featured ? "text-white/60" : "text-muted-foreground")}>{a.type}</p>
                </div>
                <Nfc className={cn("size-5", a.featured ? "text-white/70" : "text-muted-foreground")} />
              </div>
              <div>
                <p className={cn("text-xs", a.featured ? "text-white/60" : "text-muted-foreground")}>Saldo</p>
                <p className="font-heading text-2xl font-bold tabular-nums">{clp(a.balance)}</p>
              </div>
              <div className={cn("flex items-center gap-2 font-mono text-sm", a.featured ? "text-white/70" : "text-muted-foreground")}>
                <span>••••</span><span>{a.last4}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-heading text-base font-semibold">Movimientos</h2>
          <button type="button" onClick={onSeeAll} className="text-sm text-muted-foreground transition-colors hover:text-foreground">Ver todo</button>
        </div>
        <ul className="divide-y divide-border">
          {recent.map((tx) => <TxRow key={tx.id} tx={tx} />)}
        </ul>
      </section>
    </>
  )
}

function Movimientos({ txs, spentMonth }: { txs: Tx[]; spentMonth: number }) {
  const groups = (["Hoy", "Ayer"] as const)
    .map((label) => ({ label, items: txs.filter((t) => t.date === label) }))
    .filter((g) => g.items.length)
  return (
    <>
      <h1 className="font-heading text-2xl font-bold tracking-tight">Movimientos</h1>
      <div className="mt-4 rounded-2xl border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">Gastado este mes</p>
        <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{clp(Math.abs(spentMonth))}</p>
      </div>
      {groups.map((g) => (
        <div key={g.label} className="mt-5">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
          <ul className="divide-y divide-border">
            {g.items.map((tx) => <TxRow key={tx.id} tx={tx} />)}
          </ul>
        </div>
      ))}
    </>
  )
}

function Metas() {
  return (
    <>
      <h1 className="font-heading text-2xl font-bold tracking-tight">Metas de ahorro</h1>
      <p className="mt-1 text-sm text-muted-foreground">Tu progreso hacia cada objetivo</p>
      <div className="mt-5 space-y-4">
        {goals.map((g) => {
          const pct = Math.round((g.current / g.target) * 100)
          return (
            <div key={g.name} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-baseline justify-between">
                <p className="font-medium">{g.name}</p>
                <p className="text-sm font-medium tabular-nums" style={{ color: g.color }}>{pct}%</p>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: g.color }} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground tabular-nums">{clp(g.current)} de {clp(g.target)}</p>
            </div>
          )
        })}
      </div>
    </>
  )
}

function Perfil() {
  const options = [
    { icon: CreditCard, label: "Mis cuentas" },
    { icon: Tags, label: "Categorías" },
    { icon: Bell, label: "Notificaciones" },
    { icon: LogOut, label: "Cerrar sesión" },
  ]
  return (
    <>
      <div className="flex flex-col items-center pt-4">
        <Avatar className="size-20 border border-border">
          <AvatarFallback className="bg-secondary font-heading text-2xl text-secondary-foreground">MC</AvatarFallback>
        </Avatar>
        <p className="mt-3 font-heading text-xl font-bold">Matías Contreras</p>
        <p className="text-sm text-muted-foreground">matias@lucaplan.cl</p>
      </div>
      <div className="mt-8 space-y-2">
        {options.map((o) => {
          const Icon = o.icon
          return (
            <button key={o.label} type="button" className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40">
              <Icon className="size-5 text-muted-foreground" />
              <span className="flex-1 font-medium">{o.label}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          )
        })}
      </div>
    </>
  )
}

function TxRow({ tx }: { tx: Tx }) {
  const meta = CATEGORIES[tx.category] ?? CATEGORIES.Otro
  const Icon = meta.icon
  const income = tx.amount > 0
  return (
    <li className="flex items-center gap-3 py-3">
      <span className="grid size-11 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{tx.description}</p>
        <p className="truncate text-xs text-muted-foreground">{tx.category} · {tx.bank}</p>
      </div>
      <p className={cn("shrink-0 font-medium tabular-nums", income ? "text-success" : "text-foreground")}>
        {income ? "+" : "−"}{clp(Math.abs(tx.amount))}
      </p>
    </li>
  )
}

function NavItem({ icon: Icon, label, active, onClick }: { icon: IconType; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex w-14 flex-col items-center gap-1 text-[11px] font-medium transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
      <Icon className="size-5" />
      {label}
    </button>
  )
}
