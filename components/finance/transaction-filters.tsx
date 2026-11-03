"use client"

import { ChevronsUpDown } from "lucide-react"
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

// Fila de una lista agrupada de iOS con un botón emergente: el nombre a la izquierda, el valor
// elegido en gris a la derecha y `chevron.up.chevron.down`. Sin borde ni relleno propio: la celda
// es el grupo.
const ROW =
  "press flex h-11 w-full min-w-0 items-center gap-2 rounded-none border-0 bg-transparent px-4 text-left text-body shadow-none hover:bg-foreground/5 focus-visible:ring-inset data-[size=default]:h-11 dark:bg-transparent dark:hover:bg-foreground/5"
const ROW_VALUE = "ml-auto min-w-0 truncate text-right text-muted-foreground"

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
    <SearchInput
      id={inputId}
      autoFocus={autoFocus}
      value={q}
      onValueChange={(q) => set({ q })}
      aria-label="Buscar movimientos por descripción o categoría"
      placeholder="Buscar"
    />
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
      {/* Tipo: segmentado de iOS, un solo estilo activo para las tres opciones. */}
      <Segmented
        label="Tipo de movimiento"
        value={direction === "" ? "all" : direction}
        onChange={(v) => set({ direction: v === "all" ? "" : v })}
        options={DIRS}
      />

      {/* Filtros como una lista agrupada de iOS (HIG: dentro de una hoja, botones emergentes en
          las filas en vez de abrir otra vista). Un solo grupo con separadores; `glass` es la
          celda sólida en la página y en la hoja. */}
      <div>
        <div className="glass inset-list flex flex-col overflow-hidden rounded-xl">
          <Select
            value={categoryId}
            onValueChange={(v) => set({ categoryId: v })}
          >
            <SelectTrigger aria-label="Categoría" className={ROW}>
              <span className="shrink-0 text-foreground">Categoría</span>
              <span className={ROW_VALUE}>
                <SelectValue />
              </span>
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

          <Select value={bank} onValueChange={(v) => set({ bank: v })}>
            <SelectTrigger aria-label="Banco" className={ROW}>
              <span className="shrink-0 text-foreground">Banco</span>
              <span className={ROW_VALUE}>
                <SelectValue />
              </span>
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

          {/* Rango de fechas (shadcn Calendar en Popover). Dos meses siempre: lado a lado desde md,
              apilados en el teléfono, con scroll dentro del popover si no caben. */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={
                  range?.from ? "Cambiar fechas" : "Filtrar por fechas"
                }
                className={ROW}
              >
                <span className="shrink-0">Fechas</span>
                <span className={ROW_VALUE}>
                  {range?.from
                    ? range.to
                      ? `${RANGE_FMT.format(range.from)} – ${RANGE_FMT.format(range.to)}`
                      : RANGE_FMT.format(range.from)
                    : "Todas"}
                </span>
                <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
        {/* Acción del grupo en texto azul, como el pie de una sección de Ajustes. */}
        {hasFilters && (
          <div className="flex justify-end px-1">
            <button
              type="button"
              onClick={() => onChange(emptyFilters(amountBounds))}
              className="press h-11 px-3 text-body text-primary"
            >
              Limpiar filtros
            </button>
          </div>
        )}
      </div>

      {/* Rango de monto */}
      {showAmount && (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-center justify-between px-2 text-footnote text-muted-foreground">
            <span>Monto</span>
            <span className="tabular-nums">
              {formatCompact(amount[0])} – {formatCompact(amount[1])}
            </span>
          </div>
          {/* Margen lateral para la sombra de la perilla (size-7): sin él, los extremos tocan
              el borde. La cabecera lleva el mismo margen para que el rango quede alineado. */}
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
    </>
  )
}
