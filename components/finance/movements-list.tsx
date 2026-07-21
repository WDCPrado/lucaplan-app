"use client"

import { useRef, useState } from "react"
import { flushSync } from "react-dom"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { MovementRow } from "./movement-row"
import { formatCLP, formatDateHeader } from "@/lib/finance-format"
import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

const PAGE_SIZE = 20

// Total NETO del día (ingresos − gastos) en CLP, para el encabezado de fecha. Los ajustes de saldo
// (internos) no cuentan, igual que en el presupuesto. En moneda extranjera usa el equivalente CLP.
function dayTotal(items: TransactionDTO[]): number {
  return items.reduce((sum, t) => {
    if (t.isInternal) return sum
    const clp = Math.abs(t.amountClp ?? t.amount)
    return sum + (t.direction === "credit" ? clp : -clp)
  }, 0)
}

// Agrupa por fecha (los movimientos ya vienen ordenados de más nuevo a más viejo).
function groupByDate(
  txs: TransactionDTO[]
): { date: string; items: TransactionDTO[] }[] {
  const groups: { date: string; items: TransactionDTO[] }[] = []
  for (const t of txs) {
    const key = t.date.slice(0, 10) // YYYY-MM-DD (UTC)
    const last = groups[groups.length - 1]
    if (last && last.date === key) last.items.push(t)
    else groups.push({ date: key, items: [t] })
  }
  return groups
}

// Lista de movimientos del mes: sueltos (no tabla), separados por encabezado de fecha, y paginados
// con un paginador abajo. El padre la remonta por mes (key) para reiniciar la página.
export function MovementsList({
  transactions,
  onOpen,
  onOpenCategory,
}: {
  transactions: TransactionDTO[]
  onOpen: (tx: TransactionDTO) => void
  onOpenCategory?: (categoryId: string) => void
}) {
  const [page, setPage] = useState(1)
  const topRef = useRef<HTMLDivElement>(null)
  const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const groups = groupByDate(transactions.slice(start, start + PAGE_SIZE))

  // Cambiar de página vuelve al inicio de la lista (scroll-mt compensa el header sticky).
  // flushSync: commit del nuevo layout ANTES de scrollear, o el smooth scroll queda corto.
  function goPage(p: number) {
    flushSync(() => setPage(p))
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <>
      <div ref={topRef} className="flex scroll-mt-20 flex-col gap-5">
        {groups.map((g) => {
          const total = dayTotal(g.items)
          return (
            <div key={g.date}>
              {/* Fecha y total del día en la misma línea (justify-between). */}
              <div className="mb-1.5 flex items-center justify-between gap-3 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                <span className="truncate">
                  {formatDateHeader(`${g.date}T00:00:00.000Z`)}
                </span>
                <span className="tabular shrink-0">
                  {total >= 0 ? "+" : "−"}
                  {formatCLP(Math.abs(total))}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {g.items.map((t) => (
                  <MovementRow
                    key={t.id}
                    tx={t}
                    onOpen={onOpen}
                    onOpenCategory={onOpenCategory}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Página {safePage} de {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            {safePage > 1 && (
              <button
                type="button"
                onClick={() => goPage(1)}
                className="h-9 rounded-full border px-3.5 text-sm font-medium transition-colors hover:bg-secondary"
              >
                Hoy
              </button>
            )}
            <button
              type="button"
              onClick={() => goPage(safePage - 1)}
              disabled={safePage <= 1}
              className="grid size-9 place-items-center rounded-full border transition-colors hover:bg-secondary disabled:opacity-40"
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => goPage(safePage + 1)}
              disabled={safePage >= totalPages}
              className="grid size-9 place-items-center rounded-full border transition-colors hover:bg-secondary disabled:opacity-40"
              aria-label="Página siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}
