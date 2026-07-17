"use client"

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
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { MovementRow } from "./movement-row"
import { formatDateHeader } from "@/lib/finance-format"
import type {
  AccountDTO,
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
  open,
  onOpenChange,
  categories,
  accounts,
  onOpenTransaction,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  categories: CategoryDTO[]
  accounts: AccountDTO[]
  onOpenTransaction: (tx: TransactionDTO) => void
}) {
  // En móvil no autoenfocamos: el teclado abriéndose mientras el drawer anima se ve saltón.
  const isMobile = useIsMobile()
  const [q, setQ] = useState("")
  const [direction, setDirection] = useState<Dir>("")
  const [categoryId, setCategoryId] = useState("all")
  const [bank, setBank] = useState("all")
  const [range, setRange] = useState<DateRange | undefined>()

  // Bancos únicos (deduplicados por nombre): si hay 2 "Banco de Chile", una sola opción.
  const banks = [...new Set(accounts.map((a) => a.bankName).filter(Boolean))]
  const [results, setResults] = useState<TransactionDTO[]>([])
  const [loading, setLoading] = useState(false)

  // Debounce + abort: rearma la búsqueda 300ms después del último cambio de query o filtro.
  useEffect(() => {
    if (!open) return
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (direction) params.set("direction", direction)
    if (categoryId !== "all") params.set("categoryId", categoryId)
    if (bank !== "all") params.set("bank", bank)
    if (range?.from) params.set("from", ymd(range.from))
    if (range?.to) params.set("to", ymd(range.to))

    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`/api/transactions/search?${params.toString()}`, {
        signal: ctrl.signal,
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => setResults(Array.isArray(d) ? d : []))
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [open, q, direction, categoryId, bank, range])

  const hasFilters =
    !!q ||
    !!direction ||
    categoryId !== "all" ||
    bank !== "all" ||
    !!range?.from
  function clearAll() {
    setQ("")
    setDirection("")
    setCategoryId("all")
    setBank("all")
    setRange(undefined)
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
      className="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-3 px-4 pb-6">
        {/* Campo de búsqueda */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus={!isMobile}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por descripción o categoría…"
            className="h-12 pr-10 pl-10 text-base"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        {/* Filtros combinados */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-full border text-sm">
            {DIRS.map((d) => (
              <button
                key={d.label}
                onClick={() => setDirection(d.value)}
                className={cn(
                  "h-9 px-3.5 transition-colors",
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
            <SelectTrigger className="h-9 w-auto min-w-32 rounded-full">
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
            <SelectTrigger className="h-9 w-auto min-w-28 rounded-full">
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
        </div>

        {/* Rango de fechas (shadcn Calendar en Popover) */}
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "h-9 justify-start gap-2 rounded-full font-normal",
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
              onClick={clearAll}
              className="ml-auto shrink-0 text-sm text-muted-foreground hover:text-foreground"
            >
              Limpiar
            </button>
          )}
        </div>

        {/* Resultados */}
        <div className="min-h-40">
          {loading && results.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Sin resultados
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
    </ResponsiveModal>
  )
}
