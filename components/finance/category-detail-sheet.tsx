"use client"

import { Pencil } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { ProgressRing } from "./progress-ring"
import { MovementRow } from "./movement-row"
import { CategoryIcon } from "./category-icons"
import { formatCLP, statusVar } from "@/lib/finance-format"
import type {
  CategoryDTO,
  TransactionDTO,
} from "@/arch/v1/application/finance-use-cases/finance-read"

// Detalle de una categoría: anillo grande, usado/de/disponible, movimientos del mes y editar.
export function CategoryDetailSheet({
  category,
  transactions,
  onOpenChange,
  onEdit,
  onOpenTx,
}: {
  category: CategoryDTO | null
  transactions: TransactionDTO[]
  onOpenChange: (o: boolean) => void
  onEdit: (c: CategoryDTO) => void
  onOpenTx?: (t: TransactionDTO) => void
}) {
  const open = category !== null
  const pct =
    category && category.limit > 0 ? (category.used / category.limit) * 100 : 0
  const txs = category
    ? transactions.filter((t) => t.categoryId === category.id)
    : []

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={category?.name ?? ""}
      headerClassName="items-center"
    >
      {category && (
        <div>
          <div className="flex flex-col items-center gap-1 px-4">
            <ProgressRing
              percent={pct}
              committedPercent={
                category.limit > 0
                  ? (category.committed / category.limit) * 100
                  : 0
              }
              status={category.status}
              size={150}
              stroke={11}
            >
              <CategoryIcon
                icon={category.icon}
                size={44}
                color={category.color ?? undefined}
              />
            </ProgressRing>
            <div className="tabular mt-2 text-3xl font-bold">
              {formatCLP(category.used)}{" "}
              <span className="text-lg font-normal text-muted-foreground">
                de {formatCLP(category.limit)}
              </span>
            </div>
            {/* Mismo color que el anillo: en verde fijo, un disponible negativo se leía como
                "vas bien". El estado manda sobre el texto igual que sobre el arco. */}
            <div
              className="text-sm font-medium"
              style={{ color: statusVar(category.status) }}
            >
              <span className="tabular">{formatCLP(category.available)}</span>{" "}
              disponible
            </div>
            {category.committed > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="tabular">{formatCLP(category.committed)}</span>{" "}
                comprometido (recurrentes y cuotas por cobrar)
              </div>
            )}
            {/* Editar como acción con nombre, no como pastilla dentro del anillo. */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onEdit(category)}
              className="mt-2 rounded-full"
            >
              <Pencil className="size-3.5" />
              Editar categoría
            </Button>
          </div>
          <div className="mt-4 px-4 pb-6 md:pb-4">
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Movimientos del mes
            </div>
            {txs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin movimientos
              </p>
            ) : (
              // Escritorio: el diálogo mide lo que mide la lista, con un tope; sin él, dos
              // movimientos dejaban el 40 % del modal vacío.
              <div className="divide-y md:max-h-[45dvh] md:overflow-y-auto">
                {txs.map((t) => (
                  <MovementRow key={t.id} tx={t} onOpen={onOpenTx} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </ResponsiveModal>
  )
}
