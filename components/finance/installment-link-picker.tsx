"use client"

import { useEffect, useState } from "react"
import { Search } from "lucide-react"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"

type Candidate = {
  transactionId: string
  description: string
  amount: number
  currency: string
  date: string
  accountName: string
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

/**
 * Elige un movimiento YA EXISTENTE para asignarlo a una cuota. Es la pieza que faltaba: sin ella,
 * la única forma de saldar una cuota a mano era crear un movimiento, y en un crédito eso duplica el
 * gasto que el correo ya registró.
 *
 * Los candidatos llegan ordenados por cercanía al vencimiento, que es como uno busca un pago.
 */
export function InstallmentLinkPicker({
  open,
  onOpenChange,
  around,
  accountId,
  onPick,
  onCreate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  around: string // ISO del vencimiento de la cuota
  accountId?: string
  onPick: (transactionId: string) => void
  // Salida de último recurso: el pago no dejó rastro en la app y hay que fabricar el movimiento.
  onCreate?: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [query, setQuery] = useState("")

  // Efecto genuino: sincronización con un sistema externo (la API) al abrirse el selector. No hay
  // render del servidor aquí — el modal se abre desde una interacción del cliente.
  useEffect(() => {
    if (!open) return
    const params = new URLSearchParams({ around })
    if (accountId) params.set("accountId", accountId)
    let alive = true
    fetch(`/api/installments/candidates?${params}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => alive && setCandidates(data))
      .catch(() => alive && setCandidates([]))
    return () => {
      alive = false
    }
  }, [open, around, accountId])

  const filtered = (candidates ?? []).filter((c) =>
    c.description.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Asignar un movimiento"
    >
      <div className="flex flex-col px-4 pb-4">
        <p className="py-3 text-xs text-muted-foreground">
          Elige el gasto que corresponde a esta cuota. No se crea nada nuevo: el
          movimiento pasa a ser la cuota.
        </p>

        <div className="relative mb-2">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por descripción"
            aria-label="Buscar movimiento"
            className="h-10 w-full rounded-xl border border-border bg-transparent pr-3 pl-9 text-sm outline-none focus:border-primary"
          />
        </div>

        {candidates === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Buscando movimientos…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-balance text-muted-foreground">
            No hay movimientos sin asignar cerca de esa fecha.
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((c) => (
              <li key={c.transactionId}>
                <button
                  type="button"
                  onClick={() => onPick(c.transactionId)}
                  className="flex w-full items-center gap-3 border-b border-border/40 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {c.description}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {shortDate(c.date)} · {c.accountName}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-sm font-medium">
                    {formatMoney(c.amount, c.currency as CurrencyCode)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Deliberadamente al final y en tono secundario: crear un movimiento cuando el gasto ya
            existe lo contaría dos veces, así que primero hay que haber buscado. */}
        {onCreate && (
          <button
            type="button"
            onClick={onCreate}
            className="mt-4 w-full rounded-xl border border-dashed border-border py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            El pago no está en mis movimientos · crear uno
          </button>
        )}
      </div>
    </ResponsiveModal>
  )
}
