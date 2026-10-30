"use client"

import type { ReactNode } from "react"

import { Pencil } from "lucide-react"
import { ResponsiveModal } from "@/components/ui/responsive-modal"
import { MovementRow } from "./movement-row"
import { CategoryIcon } from "./category-icons"
import { formatCLP, statusVar } from "@/lib/finance-format"
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
  return (
    <ResponsiveModal
      open={category !== null}
      onOpenChange={onOpenChange}
      title={category?.name ?? "Categoría"}
      primary={
        category
          ? {
              label: (
                <>
                  <Pencil className="size-4" />
                  Editar categoría
                </>
              ),
              mobileLabel: "Editar",
              onClick: () => onEdit(category),
            }
          : undefined
      }
    >
      {category && (
        <>
          <div className="space-y-8 px-5">
            <section className="sheet-group p-4">
              <div className="mb-4 flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-lg bg-muted">
                  <CategoryIcon
                    icon={category.icon}
                    size={22}
                    color={category.color ?? undefined}
                  />
                </span>
                <span className="text-subheadline text-muted-foreground">
                  {category.type === "income"
                    ? "Recibido en el período"
                    : "Disponible en el período"}
                </span>
              </div>
              <p
                className="tabular text-title-1 font-semibold"
                style={{
                  color:
                    category.type === "income"
                      ? undefined
                      : statusVar(category.status),
                }}
              >
                {formatCLP(
                  category.type === "income"
                    ? category.used
                    : category.available
                )}
              </p>
              {category.type !== "income" && (
                <dl className="mt-5 grid grid-cols-3 gap-3 border-t pt-4">
                  <div>
                    <dt className="text-footnote text-muted-foreground">
                      Presupuesto
                    </dt>
                    <dd className="tabular mt-1 text-body font-medium break-all">
                      {formatCLP(category.limit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-footnote text-muted-foreground">
                      Comprometido
                    </dt>
                    <dd className="tabular mt-1 text-body font-medium break-all">
                      {formatCLP(category.committed)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-footnote text-muted-foreground">Gastado</dt>
                    <dd className="tabular mt-1 text-body font-medium break-all">
                      {formatCLP(category.used)}
                    </dd>
                  </div>
                </dl>
              )}
              {category.committed > 0 && (
                <p className="mt-3 text-footnote text-muted-foreground">
                  El comprometido reserva recurrentes y cuotas por cobrar.
                </p>
              )}
            </section>
            <section>
              <h3 className="mb-2 px-4 text-headline font-semibold">
                Movimientos del período
              </h3>
              {txs.length === 0 ? (
                <p className="px-4 py-4 text-body text-muted-foreground">
                  Todavía no hay movimientos en esta categoría.
                </p>
              ) : (
                <div className="sheet-group inset-list flex flex-col overflow-hidden [--inset:4.25rem]">
                  {txs.map((tx) => (
                    <MovementRow key={tx.id} tx={tx} onOpen={onOpenTx} />
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}
      {children}
    </ResponsiveModal>
  )
}
