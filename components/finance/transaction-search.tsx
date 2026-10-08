"use client"

import type { ReactNode } from "react"

import { useEffect, useState } from "react"
import { Search, X, Loader2, CalendarRange } from "lucide-react"
import type { DateRange } from "react-day-picker"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { MovementRow } from "./movement-row"
import { formatDateHeader, formatCompact } from "@/lib/finance-format"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const RANGE_FMT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
})

// YYYY-MM-DD desde los componentes locales (sin corrimiento de zona horaria como toISOString).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type Dir = "" | "debit" | "credit"
const DIRS: { value: Dir; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "debit", label: "Gastos" },
  { value: "credit", label: "Ingresos" },
]

// Buscador de movimientos: filtros combinados (texto insensible, dirección, categoría, cuenta,
// rango de fechas) contra el backend con debounce (300ms) y cancelación de la petición anterior.
export function TransactionSearch({
  children,
  open,
  detailOpen,
  onOpenChange,
  categories,
  accounts,
  amountBounds,
  onOpenTransaction,
}: {
  children?: ReactNode
  open: boolean
  detailOpen: boolean
  onOpenChange: (o: boolean) => void
  categories: CategoryDTO[]
  accounts: AccountDTO[]
  amountBounds: AmountBoundsDTO
  onOpenTransaction: (tx: TransactionDTO) => void
}) {
  // En móvil no autoenfocamos: el teclado abriéndose mientras el drawer anima se ve saltón.
  const isMobile = useIsMobile()
  const [q, setQ] = useState("")
  const [direction, setDirection] = useState<Dir>("")
  const [categoryId, setCategoryId] = useState("all")
  const [bank, setBank] = useState("all")
  const [range, setRange] = useState<DateRange | undefined>()

  // Slider de monto: solo si hay rango real (>1 monto distinto). El paso reparte el rango en ~100.
  const showAmount = amountBounds.max > amountBounds.min
  const amountStep = Math.max(
    1,
    Math.round((amountBounds.max - amountBounds.min) / 100)
  )
  const [amount, setAmount] = useState<[number, number]>([
    amountBounds.min,
    amountBounds.max,
  ])
  const amountNarrowed =
    showAmount && (amount[0] > amountBounds.min || amount[1] < amountBounds.max)

  // Bancos únicos (deduplicados por nombre): si hay 2 "Banco de Chile", una sola opción.
  const banks = [...new Set(accounts.map((a) => a.bankName).filter(Boolean))]
  const [results, setResults] = useState<TransactionDTO[]>([])
  const [loading, setLoading] = useState(false)

  // Debounce + abort: rearma la búsqueda 300ms después del último cambio de query o filtro.
  useEffect(() => {
    if (!open || detailOpen) return
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (direction) params.set("direction", direction)
    if (categoryId !== "all") params.set("categoryId", categoryId)
    if (bank !== "all") params.set("bank", bank)
    if (range?.from) params.set("from", ymd(range.from))
    if (range?.to) params.set("to", ymd(range.to))
    // Solo enviamos los topes si el usuario acotó el rango (evita constreñir cuando está intacto).
    if (amountNarrowed && amount[0] > amountBounds.min)
      params.set("amountMin", String(amount[0]))
    if (amountNarrowed && amount[1] < amountBounds.max)
      params.set("amountMax", String(amount[1]))

    const ctrl = new AbortController()
    const t = setTimeout(
      () => {
        setLoading(true)
        fetch(`/api/transactions/search?${params.toString()}`, {
          signal: ctrl.signal,
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : []))
          .then((d) => setResults(Array.isArray(d) ? d : []))
          .catch(() => {})
          .finally(() => setLoading(false))
        // Debounce solo mientras se escribe: al abrir (sin texto) se pide de inmediato, para que el
        // buscador arranque con los últimos movimientos y no con un spinner.
      },
      q.trim() ? 300 : 0
    )
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [
    open,
    detailOpen,
    q,
    direction,
    categoryId,
    bank,
    range,
    amount,
    amountNarrowed,
  ])

  const hasFilters =
    !!q ||
    !!direction ||
    categoryId !== "all" ||
    bank !== "all" ||
    !!range?.from ||
    amountNarrowed
  function clearAll() {
    setQ("")
    setDirection("")
    setCategoryId("all")
    setBank("all")
    setRange(undefined)
    setAmount([amountBounds.min, amountBounds.max])
  }

  // Agrupa por fecha (resultados vienen más-nuevo primero).
  const groups: { header: string; txs: TransactionDTO[] }[] = []
  let lastKey = ""
  for (const tx of results) {
    const key = tx.date.slice(0, 10)
    if (key !== lastKey) {
      groups.push({ header: formatDateHeader(tx.date), txs: [] })
      lastKey = key
    }
    groups[groups.length - 1].txs.push(tx)
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar movimientos"
    >
      <div className="flex flex-col gap-6 px-5 pb-6">
        {/* Campo de búsqueda */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={!isMobile}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar movimientos por descripción o categoría"
            inputMode="search"
            placeholder="Buscar por descripción o categoría…"
            className="h-12 pr-10 pl-10 text-base"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Filtros combinados: una fila con scroll-x en móvil (cinco filas de filtros dejaban
            los resultados bajo el pliegue); en ancho envuelven. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex shrink-0 overflow-hidden rounded-lg border text-sm">
            {DIRS.map((d) => (
              <button
                type="button"
                key={d.label}
                onClick={() => setDirection(d.value)}
                className={cn(
                  "h-11 px-3.5 transition-colors",
                  direction === d.value
                    ? d.value === "credit"
                      ? "bg-success text-success-foreground"
                      : d.value === "debit"
                        ? "bg-destructive text-destructive-foreground"
                        : "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary"
                )}
              >
                {d.label}
              </button>
            ))}
          </div>

          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger className="h-11 w-auto min-w-32 shrink-0">
              <SelectValue placeholder="Categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las categorías</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={bank} onValueChange={setBank}>
            <SelectTrigger className="h-11 w-auto min-w-28 shrink-0">
              <SelectValue placeholder="Banco" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los bancos</SelectItem>
              {banks.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Rango de fechas (shadcn Calendar en Popover) */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  "h-11 shrink-0 justify-start gap-2 font-normal",
                  !range?.from && "text-muted-foreground"
                )}
              >
                <CalendarRange className="size-4 shrink-0" />
                {range?.from
                  ? range.to
                    ? `${RANGE_FMT.format(range.from)} – ${RANGE_FMT.format(range.to)}`
                    : RANGE_FMT.format(range.from)
                  : "Fechas"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={range}
                onSelect={setRange}
                numberOfMonths={1}
                autoFocus
              />
            </PopoverContent>
          </Popover>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              className="ml-auto shrink-0 text-sm text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Rango de monto */}
        {showAmount && (
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Monto</span>
              <span className="tabular-nums">
                {formatCompact(amount[0])} – {formatCompact(amount[1])}
              </span>
            </div>
            <Slider
              min={amountBounds.min}
              max={amountBounds.max}
              step={amountStep}
              value={amount}
              onValueChange={(v) => setAmount([v[0], v[1]])}
              aria-label="Rango de monto"
            />
          </div>
        )}

        {/* Resultados */}
        <div className="min-h-40">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No encontramos movimientos con estos filtros. Prueba otra
              descripción o cambia los filtros.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {groups.map((g) => (
                <div key={g.header}>
                  <div className="mb-1 px-3 text-xs font-medium text-muted-foreground">
                    {g.header}
                  </div>
                  <div className="flex flex-col">
                    {g.txs.map((tx) => (
                      <MovementRow
                        key={tx.id}
                        tx={tx}
                        onOpen={onOpenTransaction}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {children}
    </ResponsiveModal>
  )
}
