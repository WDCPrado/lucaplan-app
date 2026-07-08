import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP } from "@/lib/finance-format";

// Fila de movimiento: icono de categoría, categoría + descripción, disponible restante, monto con
// signo/color. `remaining` es el disponible de la categoría (opcional).
export function MovementRow({ tx, remaining }: { tx: TransactionDTO; remaining?: number }) {
  const income = tx.direction === "credit";
  return (
    <div className="flex items-center gap-3 py-3">
      <div
        className="grid size-11 shrink-0 place-items-center rounded-full text-lg"
        style={{ background: (tx.categoryColor ?? "var(--muted)") + "33" }}
      >
        {tx.categoryIcon ?? (income ? "💵" : "•")}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">{tx.categoryName ?? "Sin categoría"}</div>
        <div className="truncate font-medium">{tx.description}</div>
        {remaining !== undefined && (
          <div className="tabular text-xs text-muted-foreground">Quedan {formatCLP(remaining)}</div>
        )}
      </div>
      <div
        className={`tabular flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium ${
          income ? "bg-success/15 text-success" : "bg-secondary text-foreground"
        }`}
      >
        <span>{income ? "+" : "−"}</span>
        <span>{formatCLP(Math.abs(tx.amount))}</span>
      </div>
    </div>
  );
}
