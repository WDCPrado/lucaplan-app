"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ProgressRing } from "./progress-ring";
import { MovementRow } from "./movement-row";
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-3xl">
        {category && (
          <>
            <SheetHeader className="items-center">
              <SheetTitle>{category.name}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-col items-center gap-1 px-4">
              <ProgressRing percent={pct} status={category.status} size={150} stroke={11}>
                <span className="text-4xl">{category.icon}</span>
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
            <div className="mt-4 px-4 pb-6">
              <div className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Movimientos del mes</div>
              {txs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Sin movimientos</p>
              ) : (
                <div className="divide-y">
                  {txs.map((t) => (
                    <MovementRow key={t.id} tx={t} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
