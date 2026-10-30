"use client"

import { Search, X, CalendarRange } from "lucide-react"
import type { DateRange } from "react-day-picker"
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
import { Segmented } from "./segmented"
import { formatCompact } from "@/lib/finance-format"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const RANGE_FMT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
})

// YYYY-MM-DD desde los componentes locales (sin corrimiento de zona horaria como toISOString).
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// Inverso de `ymd`: "2026-10-15" → fecha local de ese día (new Date("2026-10-15") sería UTC y en
// Chile mostraría el día anterior).
export function fromYmd(s: string | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export type Dir = "" | "debit" | "credit"
const DIRS: { value: "all" | "debit" | "credit"; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "debit", label: "Gastos" },
  { value: "credit", label: "Ingresos" },
]

export type FilterValues = {
  q: string
  direction: Dir
  categoryId: string // "all" = sin filtro
  bank: string // "all" = sin filtro
  range: DateRange | undefined
  amount: [number, number]
}

export function emptyFilters(bounds: AmountBoundsDTO): FilterValues {
  return {
    q: "",
    direction: "",
    categoryId: "all",
    bank: "all",
    range: undefined,
    amount: [bounds.min, bounds.max],
  }
}

// Los filtros como query params del buscador (los mismos nombres que lee /api/transactions/search
// y la página /movements). Los topes de monto solo van si el usuario acotó el slider: intacto no
// constriñe.
export function filtersToParams(
  v: FilterValues,
  bounds: AmountBoundsDTO
): URLSearchParams {
  const params = new URLSearchParams()
  if (v.q.trim()) params.set("q", v.q.trim())
  if (v.direction) params.set("direction", v.direction)
  if (v.categoryId !== "all") params.set("categoryId", v.categoryId)
  if (v.bank !== "all") params.set("bank", v.bank)
  if (v.range?.from) params.set("from", ymd(v.range.from))
  if (v.range?.to) params.set("to", ymd(v.range.to))
  if (bounds.max > bounds.min) {
    if (v.amount[0] > bounds.min) params.set("amountMin", String(v.amount[0]))
    if (v.amount[1] < bounds.max) params.set("amountMax", String(v.amount[1]))
  }
  return params
}

type FilterProps = {
  value: FilterValues
  onChange: (v: FilterValues) => void
  categories: CategoryDTO[]
  accounts: AccountDTO[]
  amountBounds: AmountBoundsDTO
}

// Cuántos filtros (fuera del texto) están puestos: el «Filtros (n)» de Movimientos en móvil.
export function activeFilterCount(v: FilterValues, bounds: AmountBoundsDTO) {
  const amountNarrowed =
    bounds.max > bounds.min &&
    (v.amount[0] > bounds.min || v.amount[1] < bounds.max)
  return [
    !!v.direction,
    v.categoryId !== "all",
    v.bank !== "all",
    !!v.range?.from,
    amountNarrowed,
  ].filter(Boolean).length
}

// Campo de búsqueda + filtros combinados (dirección, categoría, banco, fechas, monto). Controlado:
// quien lo usa decide qué hacer con los valores (el modal busca contra la API; la página
// /movements los escribe en la URL). Movimientos en móvil los usa por separado.
export function TransactionFilters({
  autoFocus,
  inputId,
  ...props
}: FilterProps & { autoFocus?: boolean; inputId?: string }) {
  return (
    <>
      <SearchField
        value={props.value}
        onChange={props.onChange}
        autoFocus={autoFocus}
        inputId={inputId}
      />
      <FilterControls {...props} />
    </>
  )
}

export function SearchField({
  value,
  onChange,
  autoFocus,
  inputId,
}: {
  value: FilterValues
  onChange: (v: FilterValues) => void
  autoFocus?: boolean
  inputId?: string
}) {
  const q = value.q
  const set = (patch: Partial<FilterValues>) => onChange({ ...value, ...patch })
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={inputId}
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => set({ q: e.target.value })}
        aria-label="Buscar movimientos por descripción o categoría"
        inputMode="search"
        placeholder="Buscar por descripción o categoría…"
        className="h-11 pr-10 pl-10 text-body"
      />
      {q && (
        <button
          type="button"
          onClick={() => set({ q: "" })}
          className="absolute top-1/2 right-0 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
          aria-label="Limpiar búsqueda"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

export function FilterControls({
  value,
  onChange,
  categories,
  accounts,
  amountBounds,
}: FilterProps) {
  const { q, direction, categoryId, bank, range, amount } = value
  const set = (patch: Partial<FilterValues>) => onChange({ ...value, ...patch })
  const isMobile = useIsMobile()

  // Slider de monto: solo si hay rango real (>1 monto distinto). El paso reparte el rango en ~100.
  const showAmount = amountBounds.max > amountBounds.min
  const amountStep = Math.max(
    1,
    Math.round((amountBounds.max - amountBounds.min) / 100)
  )
  const amountNarrowed =
    showAmount && (amount[0] > amountBounds.min || amount[1] < amountBounds.max)

  // Bancos únicos (deduplicados por nombre): si hay 2 "Banco de Chile", una sola opción.
  const banks = [...new Set(accounts.map((a) => a.bankName).filter(Boolean))]

  const hasFilters =
    !!q ||
    !!direction ||
    categoryId !== "all" ||
    bank !== "all" ||
    !!range?.from ||
    amountNarrowed

  return (
    <>
      {/* Tipo: segmentado de iOS, un solo estilo activo para las tres opciones. */}
      <Segmented
        label="Tipo de movimiento"
        value={direction === "" ? "all" : direction}
        onChange={(v) => set({ direction: v === "all" ? "" : v })}
        options={DIRS}
      />

      {/* Filtros combinados: envuelven en angosto. */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={categoryId}
          onValueChange={(v) => set({ categoryId: v })}
        >
          <SelectTrigger
            aria-label="Categoría"
            className="h-11 w-auto min-w-32 shrink-0"
          >
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

        <Select value={bank} onValueChange={(v) => set({ bank: v })}>
          <SelectTrigger
            aria-label="Banco"
            className="h-11 w-auto min-w-28 shrink-0"
          >
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
              aria-label={range?.from ? "Cambiar fechas" : "Filtrar por fechas"}
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
              onSelect={(r) => set({ range: r })}
              // Dos meses donde caben (md+); en el teléfono, uno.
              numberOfMonths={isMobile ? 1 : 2}
              autoFocus
            />
          </PopoverContent>
        </Popover>
        {hasFilters && (
          <button
            type="button"
            onClick={() => onChange(emptyFilters(amountBounds))}
            className="ml-auto h-11 shrink-0 text-subheadline text-primary"
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Rango de monto */}
      {showAmount && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between text-footnote text-muted-foreground">
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
            onValueChange={(v) => set({ amount: [v[0], v[1]] })}
            aria-label="Rango de monto"
          />
        </div>
      )}
    </>
  )
}
