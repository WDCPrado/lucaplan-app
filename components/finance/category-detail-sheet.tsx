"use client"

import type { ReactNode } from "react"
import { Pencil } from "lucide-react"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { MovementRow } from "./movement-row"
import { ProgressBar, statusTone } from "./blocks"
import { cn } from "@/lib/utils"
import { formatCLP } from "@/lib/finance-format"
import type {
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

export function CategoryDetailSheet({
  children,
  category,
  transactions,
  onOpenChange,
  onEdit,
  onOpenTx,
}: {
  children?: ReactNode
  category: CategoryDTO | null
  transactions: TransactionDTO[]
  onOpenChange: (open: boolean) => void
  onEdit: (category: CategoryDTO) => void
  onOpenTx?: (transaction: TransactionDTO) => void
}) {
  const txs = category
    ? transactions.filter((tx) => tx.categoryId === category.id)
    : []
  // En el plan sin tope es tope $0 (como en la fila del Inicio): lo usado llena la barra.
  const capped = !!category && (category.limit > 0 || category.inPlan)
  // Mismo semáforo de antes (bueno / moderado / completado o excedido), en los tonos de estado.
  const tone = category ? statusTone(category.status) : "default"
  return (
    <ResponsiveModal
      open={category !== null}
      onOpenChange={onOpenChange}
      title={category?.name ?? "Categoría"}
      cancel={{ label: "Cerrar", onClick: () => onOpenChange(false) }}
      primary={
        category
          ? {
              label: "Editar",
              plain: true,
              icon: Pencil,
              onClick: () => onEdit(category),
            }
          : undefined
      }
    >
      {category && (
        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-1">
            <p className="text-callout text-ink-2">
              {category.type === "income"
                ? "Recibido en el período"
                : "Disponible en el período"}
            </p>
            <p
              className={cn(
                "text-title font-semibold whitespace-nowrap",
                category.type !== "income" && tone === "warn" && "text-warning",
                category.type !== "income" && tone === "alert" && "text-destructive"
              )}
            >
              {formatCLP(
                category.type === "income"
                  ? category.used
                  : category.free
              )}
            </p>
            {category.type !== "income" &&
              (capped ? (
                <ProgressBar
                  value={category.used}
                  committed={category.committed}
                  max={category.limit}
                  tone={tone}
                  label={`Uso del presupuesto: ${formatCLP(category.used)} gastados y ${formatCLP(category.committed)} comprometidos de ${formatCLP(category.limit)}.`}
                  className="mt-3"
                />
              ) : (
                <p className="mt-1 text-callout text-ink-2">Sin tope definido</p>
              ))}
          </section>
          {category.type !== "income" && (
            <section className="flex flex-col gap-2">
              <dl className="rounded-lg bg-secondary px-4 py-1">
                {[
                  ["Presupuesto", category.limit],
                  ["Comprometido", category.committed],
                  ["Gastado", category.used],
                ].map(([label, value]) => (
                  <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2">
                    <dt className="text-callout text-ink-2">{label}</dt>
                    <dd className="font-semibold whitespace-nowrap">{formatCLP(value as number)}</dd>
                  </div>
                ))}
              </dl>
              {category.committed > 0 && (
                <p className="text-caption text-ink-3">
                  El tramo gris a la derecha reserva recurrentes y cuotas por cobrar; no está disponible para gastar.
                </p>
              )}
            </section>
          )}
          <section className="flex flex-col gap-2 pb-6">
            <h3 className="flex items-baseline gap-2 text-callout font-semibold text-ink-2">
              Movimientos del período
              <span className="text-caption font-normal text-ink-3">{txs.length}</span>
            </h3>
            {txs.length === 0 ? (
              <p className="py-2 text-callout text-ink-2">
                Todavía no hay movimientos en esta categoría.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {txs.map((tx) => (
                  <MovementRow
                    key={tx.id}
                    tx={tx}
                    onOpen={onOpenTx}
                    className="-mx-3 w-[calc(100%+1.5rem)]"
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
      {children}
    </ResponsiveModal>
  )
}
