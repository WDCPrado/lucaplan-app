import { CreditCard, Repeat } from "lucide-react"
import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { formatCLP, formatMoney } from "@/lib/finance-format"
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
//
// El arco/icono es un botón APARTE del resto de la fila (con `onOpenCategory`): tocarlo abre la
// categoría del movimiento, tocar el resto abre el movimiento. Por eso el contenedor es un div —
// no se pueden anidar botones. Sin `onOpenCategory` el icono no es interactivo (misma UI).
export function MovementRow({
  tx,
  onOpen,
  onOpenCategory,
}: {
  tx: TransactionDTO
  onOpen?: (tx: TransactionDTO) => void
  onOpenCategory?: (categoryId: string) => void
}) {
  const income = tx.direction === "credit"
  const color = tx.categoryColor ?? "var(--muted-foreground)"
  const bg = tx.categoryColor ? tx.categoryColor + "26" : "var(--muted)"
  const pending = tx.status === "pending"
  // Un `pending` de una plantilla o de una cuota es un gasto COMPROMETIDO (aún no lo cobra el
  // banco); un `pending` suelto es un cargo que el banco todavía no confirma. Se nombran distinto.
  const committed =
    pending && (!!tx.recurringTemplateId || !!tx.installmentForecast)

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

  // Sello de recurrente: va sobre la esquina inferior derecha del arco, sin desplazar la fila.
  const recurringBadge = tx.recurringTemplateId ? (
    <span
      className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background ring-2 ring-background"
      title="Gasto recurrente"
      aria-label="Gasto recurrente"
    >
      <Repeat className="size-3 text-primary" strokeWidth={3} />
    </span>
  ) : tx.installmentForecast || tx.installmentItemId ? (
    // Cuota de un plan: proyectada ("Por cobrar") o ya registrada/adoptada. El mismo sello en la
    // lista, la búsqueda y el detalle de categoría — todos pasan por esta fila.
    <span
      className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-background ring-2 ring-background"
      title={tx.installmentForecast ? "Cuota por cobrar" : "Cuota de un plan"}
      aria-label={tx.installmentForecast ? "Cuota por cobrar" : "Cuota de un plan"}
    >
      <CreditCard className="size-3 text-primary" strokeWidth={3} />
    </span>
  ) : null

  const icon = (
    <div className="relative">
      {hasArc ? (
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
      ) : (
        <div
          className="grid size-11 place-items-center rounded-full"
          style={{ background: bg }}
        >
          <CategoryIcon icon={tx.categoryIcon} size={20} color={color} />
        </div>
      )}
      {recurringBadge}
    </div>
  )

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-secondary/60">
      {onOpenCategory && tx.categoryId ? (
        <button
          type="button"
          onClick={() => onOpenCategory(tx.categoryId!)}
          aria-label={`Ver categoría ${tx.categoryName ?? ""}`.trim()}
          className="shrink-0 rounded-full"
        >
          {icon}
        </button>
      ) : (
        <div className="shrink-0">{icon}</div>
      )}
      <button
        type="button"
        onClick={() => onOpen?.(tx)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{tx.description}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">
              {tx.categoryName ?? "Sin categoría"}
            </span>
            {pending && (
              <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                {committed ? "Por cobrar" : "Pendiente"}
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
          className={`tabular shrink-0 text-right text-sm font-semibold ${income ? "text-success" : "text-foreground"}`}
        >
          <div>
            {income ? "+" : "−"}
            {tx.currency === "CLP"
              ? formatCLP(Math.abs(tx.amount))
              : formatMoney(Math.abs(tx.amount), tx.currency as CurrencyCode)}
          </div>
          {/* Moneda extranjera: equivalente CLP estimado (dólar del día) usado en los cálculos. */}
          {tx.amountClp != null && (
            <div className="text-[10px] font-normal text-muted-foreground">
              ≈ {formatCLP(Math.abs(tx.amountClp))}
            </div>
          )}
        </div>
      </button>
    </div>
  )
}
