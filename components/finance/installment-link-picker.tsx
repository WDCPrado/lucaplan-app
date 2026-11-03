"use client"

import { useEffect, useState } from "react"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { SearchInput } from "@/components/ui/search-input"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/finance-format"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"

type Candidate = {
  transactionId: string
  description: string
  amount: number
  currency: string
  date: string
  accountName: string
  categoryId: string | null
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC", // @db.Date es medianoche UTC: en local (Chile) mostraría el día anterior
  })
}

/**
 * Elige un movimiento YA EXISTENTE para asignarlo a una cuota. Es la pieza que faltaba: sin ella,
 * la única forma de saldar una cuota a mano era crear un movimiento, y en un crédito eso duplica el
 * gasto que el correo ya registró.
 *
 * Los candidatos llegan ordenados por cercanía al vencimiento y se filtran por lo que se sabe de
 * la cuota: la categoría del plan y el monto esperado con un umbral ajustable. Buscar por texto
 * apaga ambos filtros — quien escribe está buscando explícitamente.
 */
export function InstallmentLinkPicker({
  open,
  onOpenChange,
  around,
  accountId,
  expectedAmount,
  categoryId,
  categoryName,
  onPick,
  onCreate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  around: string // ISO del vencimiento de la cuota
  accountId?: string
  expectedAmount?: number | null // monto de la cuota según el cronograma
  categoryId?: string | null // categoría del plan, para filtrar candidatos
  categoryName?: string | null
  onPick: (transactionId: string) => void
  // Salida de último recurso: el pago no dejó rastro en la app y hay que fabricar el movimiento.
  onCreate?: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [query, setQuery] = useState("")
  // ±20% por defecto: más ancho que la tolerancia de matching automático (10%), porque aquí hay
  // un humano mirando la lista y conviene errar por mostrar de más.
  const [tolerance, setTolerance] = useState(20)
  const [onlyCategory, setOnlyCategory] = useState(true)

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

  const q = query.trim().toLowerCase()
  const filtered = (candidates ?? []).filter((c) => {
    // El texto manda: al escribir, los filtros no esconden nada.
    if (q) return c.description.toLowerCase().includes(q)
    if (onlyCategory && categoryId && c.categoryId !== categoryId) return false
    if (expectedAmount)
      return (
        Math.abs(c.amount - expectedAmount) <=
        (expectedAmount * tolerance) / 100
      )
    return true
  })

  const hasFilters = !q && (!!categoryId || !!expectedAmount)

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Asignar un movimiento"
    >
      <div className="flex flex-col px-5 pb-4">
        <p className="py-3 text-footnote text-muted-foreground">
          Elige el gasto que corresponde a esta cuota. No se crea nada nuevo: el
          movimiento pasa a ser la cuota.
        </p>

        <div className="relative mb-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Buscar por descripción"
            aria-label="Buscar movimiento"
          />
        </div>

        {/* Filtros de cercanía: se atenúan mientras hay texto porque el texto manda. */}
        {(!!categoryId || !!expectedAmount) && (
          <div
            className={cn(
              "mb-2 flex items-center gap-3",
              q && "pointer-events-none opacity-40"
            )}
          >
            {categoryId && categoryName && (
              <button
                type="button"
                onClick={() => setOnlyCategory(!onlyCategory)}
                aria-pressed={onlyCategory}
                disabled={!!q}
                className={cn(
                  "h-11 shrink-0 rounded-lg border px-3 text-footnote whitespace-nowrap transition-colors",
                  onlyCategory
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                )}
              >
                Solo {categoryName}
              </button>
            )}
            {expectedAmount ? (
              <label className="flex min-w-0 flex-1 items-center gap-2 text-footnote text-muted-foreground">
                <span className="tabular shrink-0 whitespace-nowrap">
                  Monto ±{tolerance}%
                </span>
                <Slider
                  value={[tolerance]}
                  onValueChange={([v]) => setTolerance(v)}
                  min={0}
                  max={100}
                  step={5}
                  aria-label="Umbral de monto"
                  aria-valuetext={`Más o menos ${tolerance} por ciento`}
                  disabled={!!q}
                  className="min-w-0 flex-1"
                />
              </label>
            ) : null}
          </div>
        )}

        {candidates === null ? (
          <p className="py-8 text-center text-subheadline text-muted-foreground">
            Buscando movimientos…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-subheadline text-balance text-muted-foreground">
            {hasFilters
              ? "Nada calza con los filtros. Sube el umbral de monto, quita la categoría o busca por texto."
              : "No hay movimientos sin asignar cerca de esa fecha."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {filtered.map((c) => (
              <li key={c.transactionId}>
                <button
                  type="button"
                  onClick={() => onPick(c.transactionId)}
                  className="press flex min-h-11 w-full items-center gap-3 border-b border-border/40 py-2.5 text-left transition-colors hover:bg-secondary/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-subheadline font-medium">
                      {c.description}
                    </span>
                    <span className="block truncate text-footnote text-muted-foreground">
                      {shortDate(c.date)} · {c.accountName}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-subheadline font-medium">
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
            className="mt-4 min-h-11 w-full rounded-lg py-2.5 text-subheadline text-primary"
          >
            El pago no está en mis movimientos · crear uno
          </button>
        )}
      </div>
    </ResponsiveModal>
  )
}
