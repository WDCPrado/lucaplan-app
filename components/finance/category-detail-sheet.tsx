"use client";

import { ResponsiveModal } from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./progress-ring";
import { MovementRow } from "./movement-row";
import { CategoryIcon } from "./category-icons";
import { formatCLP } from "@/lib/finance-format";
import type { CategoryDTO, TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read";

// Detalle de una categoría: anillo grande, usado/de/disponible, movimientos del mes y editar.
export function CategoryDetailSheet({
  category,
  transactions,
  onOpenChange,
  onEdit,
}: {
  category: CategoryDTO | null;
  transactions: TransactionDTO[];
  onOpenChange: (o: boolean) => void;
  onEdit: (c: CategoryDTO) => void;
}) {
  const open = category !== null;
  const pct = category && category.limit > 0 ? (category.used / category.limit) * 100 : 0;
  const txs = category ? transactions.filter((t) => t.categoryId === category.id) : [];

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
      className={cn("md:flex md:flex-col md:overflow-hidden", txs.length > 0 && "md:h-[82dvh]")}
    >
        {category && (
          <div className="md:flex md:min-h-0 md:flex-1 md:flex-col">
            <div className="flex flex-col items-center gap-1 px-4">
              <ProgressRing percent={pct} status={category.status} size={150} stroke={11}>
                <CategoryIcon icon={category.icon} size={48} color={category.color ?? undefined} />
              </ProgressRing>
              <div className="tabular mt-2 text-3xl font-bold">
                {formatCLP(category.used)} <span className="text-lg font-normal text-muted-foreground">de {formatCLP(category.limit)}</span>
              </div>
              <div className="tabular text-sm font-medium" style={{ color: "var(--success)" }}>
                {formatCLP(category.available)} disponible
              </div>
              <Button variant="secondary" className="mt-3 rounded-full" onClick={() => onEdit(category)}>
                Editar
              </Button>
            </div>
            <div className="mt-4 px-4 pb-6 md:flex md:min-h-0 md:flex-1 md:flex-col md:pb-4">
              <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Movimientos del mes</div>
              {txs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos</p>
              ) : (
                // El viewport de Radix resuelve height:100% solo contra alturas definidas (la
                // flex no le basta), y su Root trae position:relative INLINE (imposible volverlo
                // absolute por clase) → el absolute inset-0 va en un div envolvente.
                <div className="md:relative md:min-h-0 md:flex-1">
                  <div className="md:absolute md:inset-0">
                    <ScrollArea className="md:h-full">
                      <div className="divide-y">
                        {txs.map((t) => (
                          <MovementRow key={t.id} tx={t} />
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
  );
}
