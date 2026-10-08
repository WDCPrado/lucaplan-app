"use client"

import type { ReactNode } from "react"

import { Pencil } from "lucide-react"
import { ModalFooter, ResponsiveModal } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
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
    >
      {category && (
        <>
          <div className="space-y-8 px-5">
            <section>
              <div className="mb-4 flex items-center gap-3">
                <span className="grid size-11 place-items-center rounded-lg bg-muted">
                  <CategoryIcon
                    icon={category.icon}
                    size={22}
                    color={category.color ?? undefined}
                  />
                </span>
                <span className="text-sm text-muted-foreground">
                  {category.type === "income"
                    ? "Recibido en el período"
                    : "Disponible en el período"}
                </span>
              </div>
              <p
                className="tabular text-3xl font-semibold"
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
                <dl className="mt-6 grid grid-cols-3 gap-3 border-t pt-4">
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      Presupuesto
                    </dt>
                    <dd className="tabular mt-1 text-base font-medium break-all">
                      {formatCLP(category.limit)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Gastado</dt>
                    <dd className="tabular mt-1 text-base font-medium break-all">
                      {formatCLP(category.used)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      Comprometido
                    </dt>
                    <dd className="tabular mt-1 text-base font-medium break-all">
                      {formatCLP(category.committed)}
                    </dd>
                  </div>
                </dl>
              )}
              {category.committed > 0 && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  El comprometido reserva recurrentes y cuotas por cobrar.
                </p>
              )}
            </section>
            <section>
              <h3 className="mb-3 text-base font-semibold">
                Movimientos del período
              </h3>
              {txs.length === 0 ? (
                <p className="py-4 text-base leading-relaxed text-muted-foreground">
                  Todavía no hay movimientos en esta categoría.
                </p>
              ) : (
                <div className="divide-y">
                  {txs.map((tx) => (
                    <MovementRow key={tx.id} tx={tx} onOpen={onOpenTx} />
                  ))}
                </div>
              )}
            </section>
          </div>
          <ModalFooter className="px-5">
            <Button
              type="button"
              variant="outline"
              className="h-12 text-base"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onEdit(category)}
              className="h-12 flex-1 text-base"
            >
              <Pencil className="size-4" />
              Editar categoría
            </Button>
          </ModalFooter>
        </>
      )}
      {children}
    </ResponsiveModal>
  )
}
