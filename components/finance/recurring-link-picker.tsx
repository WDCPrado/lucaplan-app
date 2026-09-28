"use client"

import { useState } from "react"
import { Search, X } from "lucide-react"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { formatCLP, formatDateHeader, formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { Chip } from "./transaction-modal"

// Filtros del pedido de candidatos. La categoría no es filtro: el backend siempre trae solo los
// cargos de la categoría de la recurrente.
export type CandidateFilters = { q: string; days: number }

const DAY_PRESETS = [5, 10, 15, 20]
const MAX_DAYS = 365

// Monto con signo como en MovementRow: hay plantillas de ingreso.
function signedAmount(tx: TransactionDTO): string {
  const abs = Math.abs(tx.amount)
  return (
    (tx.direction === "credit" ? "+" : "−") +
    (tx.currency === "CLP"
      ? formatCLP(abs)
      : formatMoney(abs, tx.currency as CurrencyCode))
  )
}

/**
 * Elige un movimiento YA EXISTENTE como el cobro del período en curso de una recurrente: el cargo
 * a veces llega antes o después de su fecha y no se engancha solo. No hace fetch ni muta: quien lo
 * abre carga los candidatos (con los filtros que se le devuelven) y hace el PATCH cuando se confirma
 * la fila elegida.
 *
 * `items`: null = cargando, "error" = falló la carga.
 */
export function RecurringLinkPicker({
  open,
  onOpenChange,
  items,
  filters,
  onFiltersChange,
  busy,
  onPick,
  onRetry,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  items: TransactionDTO[] | null | "error"
  filters: CandidateFilters
  // debounce: el cambio viene de algo que se escribe y espera a que se deje de escribir.
  onFiltersChange: (f: CandidateFilters, debounce?: boolean) => void
  busy: boolean
  onPick: (transactionId: string) => void
  onRetry: () => void
}) {
  // Fila tocada, esperando confirmación: vincular no se deshace desde aquí.
  const [pending, setPending] = useState<TransactionDTO | null>(null)
  // Texto del campo de días propio; null = se usa uno de los atajos. Solo un valor en rango
  // llega a los filtros: mientras está fuera de rango la lista se queda con el último válido, y
  // el error lo dice. Vacío también es error: Personalizado se abre con los días actuales, así
  // que vacío solo ocurre si se borró.
  const [customDays, setCustomDays] = useState<string | null>(null)
  const customN = Number(customDays)
  const customInvalid =
    customDays !== null && (!customDays || customN < 1 || customN > MAX_DAYS)

  function changeCustomDays(raw: string) {
    // Solo dígitos y hasta 3: lo que no cabe no se alcanza a escribir.
    const v = raw.replace(/\D/g, "").slice(0, 3)
    setCustomDays(v)
    const n = Number(v)
    if (v && n >= 1 && n <= MAX_DAYS && n !== filters.days)
      onFiltersChange({ ...filters, days: n }, true)
  }

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Elegir movimiento"
      className="sm:max-w-md"
    >
      <div className="flex flex-col px-4 pb-4">
        <p className="py-3 text-xs text-muted-foreground">
          Cargos del banco en la categoría de esta recurrente. Elige el que
          corresponde a este período: no se crea nada nuevo, el movimiento pasa
          a ser el cobro.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="recurring-link-q"
            value={filters.q}
            onChange={(e) => onFiltersChange({ ...filters, q: e.target.value })}
            placeholder="Buscar por descripción…"
            aria-label="Buscar movimiento"
            className="h-11 pr-10 pl-10 text-base"
          />
          {filters.q && (
            <button
              type="button"
              onClick={() => onFiltersChange({ ...filters, q: "" })}
              className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
              aria-label="Limpiar búsqueda"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <FilterGroup label="Días hacia atrás">
          <ChipScroller>
            {DAY_PRESETS.map((n) => (
              <Chip
                key={n}
                active={customDays === null && filters.days === n}
                onClick={() => {
                  setCustomDays(null)
                  if (filters.days !== n) onFiltersChange({ ...filters, days: n })
                }}
              >
                {n}
              </Chip>
            ))}
            <Chip
              active={customDays !== null}
              onClick={() =>
                customDays === null && setCustomDays(String(filters.days))
              }
            >
              Personalizado
            </Chip>
          </ChipScroller>
          {customDays !== null && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  id="recurring-link-days"
                  inputMode="numeric"
                  maxLength={3}
                  value={customDays}
                  onChange={(e) => changeCustomDays(e.target.value)}
                  aria-label="Días hacia atrás"
                  aria-invalid={customInvalid}
                  aria-describedby={
                    customInvalid ? "recurring-link-days-error" : undefined
                  }
                  className="tabular h-11 w-24 text-base"
                />
                <span className="text-sm text-muted-foreground">días</span>
              </div>
              {customInvalid && (
                <p
                  id="recurring-link-days-error"
                  className="text-xs text-destructive"
                >
                  Escribe entre 1 y {MAX_DAYS} días.
                </p>
              )}
            </div>
          )}
        </FilterGroup>

        {items === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Buscando movimientos…
          </p>
        ) : items === "error" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No se pudieron cargar los movimientos.
            </p>
            <Button variant="outline" onClick={onRetry} className="h-11">
              Reintentar
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-balance text-muted-foreground">
            No hay movimientos para elegir.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-0.5" aria-busy={busy}>
            {items.map((tx) => (
              <li key={tx.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPending(tx)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors outline-none hover:bg-secondary/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {tx.description}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatDateHeader(tx.date)}
                      {tx.categoryName ? ` · ${tx.categoryName}` : ""}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold">
                    {signedAmount(tx)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AlertDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Usar este movimiento?</AlertDialogTitle>
            <AlertDialogDescription>
              Queda como el cobro del período en curso y adopta la categoría de
              la recurrente. No se puede deshacer desde aquí.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {pending && (
            <div className="flex items-center gap-3 rounded-xl bg-secondary/50 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {pending.description}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatDateHeader(pending.date)}
                </span>
              </span>
              <span className="tabular shrink-0 text-sm font-semibold">
                {signedAmount(pending)}
              </span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => pending && onPick(pending.id)}
            >
              Vincular
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ResponsiveModal>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mt-4 space-y-2">
      <span className="block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

// Chips en una fila con scroll horizontal que sangra hasta los bordes del modal, sin envolver.
function ChipScroller({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 pb-1">
      {children}
    </div>
  )
}
