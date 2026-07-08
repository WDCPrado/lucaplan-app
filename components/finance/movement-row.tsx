import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read";
import { formatCLP, formatShortDate } from "@/lib/finance-format";
import { CategoryIcon } from "./category-icons";

// Fila de movimiento: icono de categoría, categoría · fecha, descripción, disponible histórico
// (lo que quedaba tras este movimiento), y monto con signo/color.
export function MovementRow({ tx, remaining }: { tx: TransactionDTO; remaining?: number | null }) {
  const income = tx.direction === "credit";
  const color = tx.categoryColor ?? "var(--muted-foreground)";
  const bg = tx.categoryColor ? tx.categoryColor + "26" : "var(--muted)";
  const rest = remaining ?? tx.remaining;

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="grid size-11 shrink-0 place-items-center rounded-full" style={{ background: bg }}>
        <CategoryIcon icon={tx.categoryIcon} size={20} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground">
          {tx.categoryName ?? "Sin categoría"} · {formatShortDate(tx.date)}
        </div>
        <div className="truncate font-medium">{tx.description}</div>
        {rest !== null && rest !== undefined && (
          <div className="tabular text-xs text-muted-foreground">Quedan {formatCLP(rest)}</div>
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
