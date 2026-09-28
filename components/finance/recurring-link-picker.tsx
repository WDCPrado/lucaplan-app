"use client"

import { useState } from "react"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
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
 * abre carga los candidatos y hace el PATCH cuando se confirma la fila elegida.
 *
 * `items`: null = cargando, "error" = falló la carga.
 */
export function RecurringLinkPicker({
  open,
  onOpenChange,
  items,
  busy,
  onPick,
  onRetry,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  items: TransactionDTO[] | null | "error"
  busy: boolean
  onPick: (transactionId: string) => void
  onRetry: () => void
}) {
  // Fila tocada, esperando confirmación: vincular no se deshace desde aquí.
  const [pending, setPending] = useState<TransactionDTO | null>(null)

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="Elegir movimiento"
      className="sm:max-w-md"
    >
      <div className="flex flex-col px-4 pb-4">
        <p className="py-3 text-xs text-muted-foreground">
          Elige el cargo que corresponde a este período. No se crea nada nuevo:
          el movimiento pasa a ser el cobro de la recurrente.
        </p>

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
          <ul className="flex flex-col gap-0.5" aria-busy={busy}>
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
