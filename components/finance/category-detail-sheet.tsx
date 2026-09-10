"use client"

import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
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
      // Solo escritorio (md:): cabecera fija y la lista absorbe el overflow (el mismo className
      // llega al drawer móvil, que conserva su scroll full-height — por eso todo va con md:).
      // Con movimientos, altura explícita: el área de lista (absolute) no aporta altura
      // intrínseca y sin esto el dialog colapsaría al alto de la cabecera.
      className={cn(
        "md:flex md:flex-col md:overflow-hidden",
        txs.length > 0 && "md:h-[82dvh]"
      )}
    >
      {category && (
        <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
          <div className="flex flex-col items-center gap-1 px-4">
            {/* El aro ES el botón de editar: icono + "Editar" adentro. */}
            <button
              onClick={() => onEdit(category)}
              aria-label="Editar categoría"
              className="transition-transform duration-150 ease-out active:scale-[0.98]"
            >
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
                <span className="flex flex-col items-center gap-1">
                  <CategoryIcon
                    icon={category.icon}
                    size={44}
                    color={category.color ?? undefined}
                  />
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Editar
                  </span>
                </span>
              </ProgressRing>
            </button>
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
          </div>
          <div className="mt-4 px-4 pb-6 md:flex md:min-h-0 md:flex-1 md:flex-col md:pb-4">
            <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Movimientos del mes
            </div>
            {txs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin movimientos
              </p>
            ) : (
              // El viewport de Radix resuelve height:100% solo contra alturas definidas (la
              // flex no le basta), y su Root trae position:relative INLINE (imposible volverlo
              // absolute por clase) → el absolute inset-0 va en un div envolvente.
              <div className="md:relative md:min-h-0 md:flex-1">
                <div className="md:absolute md:inset-0">
                  <ScrollArea className="md:h-full">
                    <div className="divide-y">
                      {txs.map((t) => (
                        <MovementRow key={t.id} tx={t} onOpen={onOpenTx} />
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </ResponsiveModal>
  )
}
