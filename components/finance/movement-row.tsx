import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP } from "@/lib/finance-format";
import { CategoryIcon } from "./category-icons";

// Fila de movimiento "suelta" (clickable): icono de categoría, descripción, categoría (+ estado si
// pending), y monto con signo/color. La fecha va en el encabezado del grupo, no aquí.
export function MovementRow({ tx, onOpen }: { tx: TransactionDTO; onOpen?: (tx: TransactionDTO) => void }) {
  const income = tx.direction === "credit";
  const color = tx.categoryColor ?? "var(--muted-foreground)";
  const bg = tx.categoryColor ? tx.categoryColor + "26" : "var(--muted)";
  const pending = tx.status === "pending";

  return (
    <button
      type="button"
      onClick={() => onOpen?.(tx)}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
    >
      <div className="grid size-11 shrink-0 place-items-center rounded-full" style={{ background: bg }}>
        <CategoryIcon icon={tx.categoryIcon} size={20} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{tx.description}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{tx.categoryName ?? "Sin categoría"}</span>
          {pending && (
            <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">Pendiente</span>
          )}
        </div>
        {tx.remaining !== null && tx.remaining !== undefined && (
          <div className="tabular text-xs text-muted-foreground">Quedan {formatCLP(tx.remaining)}</div>
        )}
      </div>
      <div className={`tabular shrink-0 text-sm font-semibold ${income ? "text-success" : "text-foreground"}`}>
        {income ? "+" : "−"}
        {formatCLP(Math.abs(tx.amount))}
      </div>
    </button>
  );
}
