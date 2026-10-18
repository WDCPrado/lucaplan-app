"use client"

import type { ReactNode } from "react"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { useIsMobile } from "@/hooks/use-mobile"
import { MovementRow } from "./movement-row"
import {
  TransactionFilters,
  emptyFilters,
  filtersToParams,
} from "./transaction-filters"
import { formatDateHeader } from "@/lib/finance-format"
import type {
  AccountDTO,
  AmountBoundsDTO,
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

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
  const [filters, setFilters] = useState(() => emptyFilters(amountBounds))
  const [results, setResults] = useState<TransactionDTO[]>([])
  const [loading, setLoading] = useState(false)

  // Debounce + abort: rearma la búsqueda 300ms después del último cambio de query o filtro.
  useEffect(() => {
    if (!open || detailOpen) return
    const params = filtersToParams(filters, amountBounds)
    const q = filters.q
    const ctrl = new AbortController()
    const t = setTimeout(
      () => {
        setLoading(true)
        fetch(`/api/transactions/search?${params.toString()}`, {
          signal: ctrl.signal,
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : []))
          // El endpoint responde una lista o, paginado, `{ items }`: se aceptan las dos.
          .then((d) =>
            setResults(Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : [])
          )
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
  }, [open, detailOpen, filters, amountBounds])

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
        <TransactionFilters
          value={filters}
          onChange={setFilters}
          categories={categories}
          accounts={accounts}
          amountBounds={amountBounds}
          autoFocus={!isMobile}
        />

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
