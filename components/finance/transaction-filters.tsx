"use client"

import { useId } from "react"
import { CalendarIcon } from "lucide-react"
import { SearchInput } from "@/components/ui/search-input"
import type { DateRange } from "react-day-picker"
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
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useIsMobile } from "@/hooks/use-mobile"
import { Segmented } from "./segmented"
import { formatCompact, ymd } from "@/lib/finance-format"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

const RANGE_FMT = new Intl.DateTimeFormat("es-CL", {
  day: "numeric",
  month: "short",
})

// Campo de filtro del sistema: etiqueta arriba (callout, tinta 2) y el control debajo a ancho
// completo, a la altura de control (--ctl).
const LABEL = "text-callout font-semibold text-ink-2"
const CONTROL = "w-full min-w-0"

export type Dir = "" | "debit" | "credit"
export const DIRS: { value: "all" | "debit" | "credit"; label: string }[] = [
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
    <SearchInput
      id={inputId}
      autoFocus={autoFocus}
      value={q}
      onValueChange={(q) => set({ q })}
      aria-label="Buscar movimientos por descripción o categoría"
      placeholder="Buscar"
      className="h-(--ctl) pointer-coarse:h-11"
    />
  )
}

export function FilterControls({
  value,
  onChange,
  categories,
  accounts,
  amountBounds,
  hideDirection = false,
}: FilterProps & {
  /** Movimientos en el celular ya muestra el tipo junto al buscador: la hoja no lo repite. */
  hideDirection?: boolean
}) {
  const { q, direction, categoryId, bank, range, amount } = value
  const id = useId()
  // Un mes en el teléfono (dos no caben a 360 px); dos en escritorio.
  const isMobile = useIsMobile()
  const set = (patch: Partial<FilterValues>) => onChange({ ...value, ...patch })

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
      {!hideDirection && (
        <Segmented
          label="Tipo de movimiento"
          value={direction === "" ? "all" : direction}
          onChange={(v) => set({ direction: v === "all" ? "" : v })}
          options={DIRS}
          className="w-full"
        />
      )}

      {/* Categoría y banco lado a lado cuando caben (hoja del teléfono); apilados en el panel angosto. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-3 gap-y-4">
      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={`${id}-cat`} className={LABEL}>
          Categoría
        </label>
        <Select
          value={categoryId}
          onValueChange={(v) => set({ categoryId: v })}
        >
          <SelectTrigger id={`${id}-cat`} className={CONTROL}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <label htmlFor={`${id}-bank`} className={LABEL}>
          Banco
        </label>
        <Select value={bank} onValueChange={(v) => set({ bank: v })}>
          <SelectTrigger id={`${id}-bank`} className={CONTROL}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {banks.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      </div>

      {/* Rango de fechas (shadcn Calendar en Popover). Un mes en el teléfono, dos desde md, con
          scroll dentro del popover si no caben. */}
      <div className="flex flex-col gap-2">
        <span id={`${id}-dates`} className={LABEL}>
          Fechas
        </span>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-labelledby={`${id}-dates ${id}-dates-value`}
              className="press flex h-(--ctl) w-full min-w-0 items-center gap-2 rounded-md bg-secondary px-3 text-left text-body hover:bg-surface-3 pointer-coarse:min-h-11"
            >
              <CalendarIcon aria-hidden className="size-4 shrink-0 text-ink-3" />
              <span
                id={`${id}-dates-value`}
                className={cn("min-w-0 flex-1 truncate", !range?.from && "text-ink-3")}
              >
                {range?.from
                  ? range.to
                    ? `${RANGE_FMT.format(range.from)} – ${RANGE_FMT.format(range.to)}`
                    : RANGE_FMT.format(range.from)
                  : "Todo el período"}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="max-h-(--radix-popover-content-available-height) w-auto overflow-y-auto p-0"
            align="start"
          >
            <Calendar
              mode="range"
              selected={range}
              onSelect={(r) => set({ range: r })}
              numberOfMonths={isMobile ? 1 : 2}
              autoFocus
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Rango de monto */}
      {showAmount && (
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className={LABEL}>Monto</span>
            <span className="text-callout whitespace-nowrap text-ink-2">
              {formatCompact(amount[0])} – {formatCompact(amount[1])}
            </span>
          </div>
          {/* Margen lateral para la sombra de la perilla: sin él, los extremos tocan el borde. */}
          <div className="px-2">
            <Slider
              min={amountBounds.min}
              max={amountBounds.max}
              step={amountStep}
              value={amount}
              onValueChange={(v) => set({ amount: [v[0], v[1]] })}
              aria-label="Rango de monto"
            />
          </div>
        </div>
      )}

      {hasFilters && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => onChange(emptyFilters(amountBounds))}
          className="w-full"
        >
          Limpiar filtros
        </Button>
      )}
    </>
  )
}
