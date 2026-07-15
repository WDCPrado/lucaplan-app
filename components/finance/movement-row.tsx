import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import { formatCLP } from "@/lib/finance-format"
import { CategoryIcon } from "./category-icons"
import { ProgressRing } from "./progress-ring"

// Estado visual del arco por % usado — mismos umbrales que categoryStatus (budget-formulas.ts);
// replicado local porque la versión de dominio opera sobre Money y no vale acoplar el cliente.
function arcStatus(pct: number): string {
  if (pct <= 50) return "bueno"
  if (pct < 100) return "moderado"
  if (pct === 100) return "completado"
  return "excedido"
}

// Fila de movimiento "suelta" (clickable): icono de categoría, descripción, categoría (+ estado si
// pending), y monto con signo/color. Si el movimiento trae restante y límite, el icono va rodeado
// de un arco de presupuesto (mismo lenguaje que los anillos de Presupuestos). La fecha va en el
// encabezado del grupo, no aquí.
export function MovementRow({
  tx,
  onOpen,
}: {
  tx: TransactionDTO
  onOpen?: (tx: TransactionDTO) => void
}) {
  const income = tx.direction === "credit"
  const color = tx.categoryColor ?? "var(--muted-foreground)"
  const bg = tx.categoryColor ? tx.categoryColor + "26" : "var(--muted)"
  const pending = tx.status === "pending"

  const hasArc =
    tx.remaining !== null &&
    tx.remaining !== undefined &&
    tx.categoryLimit !== null
  // % usado en ese punto = (límite − quedan) / límite. Límite 0 con gasto ⇒ excedido, sin dividir.
  const pct = !hasArc
    ? 0
    : tx.categoryLimit! > 0
      ? ((tx.categoryLimit! - tx.remaining!) / tx.categoryLimit!) * 100
      : tx.remaining! < 0
        ? 101
        : 0

  return (
    <button
      type="button"
      onClick={() => onOpen?.(tx)}
      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60"
    >
      {hasArc ? (
        <div className="shrink-0">
          <ProgressRing
            percent={pct}
            status={arcStatus(pct)}
            size={44}
            stroke={3.5}
          >
            <div
              className="grid size-8 place-items-center rounded-full"
              style={{ background: bg }}
            >
              <CategoryIcon icon={tx.categoryIcon} size={17} color={color} />
            </div>
          </ProgressRing>
        </div>
      ) : (
        <div
          className="grid size-11 shrink-0 place-items-center rounded-full"
          style={{ background: bg }}
        >
          <CategoryIcon icon={tx.categoryIcon} size={20} color={color} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{tx.description}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{tx.categoryName ?? "Sin categoría"}</span>
          {pending && (
            <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
              Pendiente
            </span>
          )}
          {tx.isInternal && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              Ajuste de saldo
            </span>
          )}
        </div>
        {tx.remaining !== null && tx.remaining !== undefined && (
          <div className="tabular text-xs text-muted-foreground">
            Quedan {formatCLP(tx.remaining)}
          </div>
        )}
      </div>
      <div
        className={`tabular shrink-0 text-sm font-semibold ${income ? "text-success" : "text-foreground"}`}
      >
        {income ? "+" : "−"}
        {formatCLP(Math.abs(tx.amount))}
      </div>
    </button>
  )
}
