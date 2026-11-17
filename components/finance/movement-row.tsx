import type { TransactionDTO } from "@/arch/v1/application/finance-use-cases/finance-read"
import type { CurrencyCode } from "@/arch/v1/domain/finance/money"
import { formatCLP, formatMoney } from "@/lib/finance-format"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { IconTile } from "./blocks"
import { CategoryIcon } from "./category-icons"

// Fila de movimiento (lenguaje «Finanzas en calma»): cuadro de categoría de 36, descripción en
// semibold, debajo la categoría y sus etiquetas de estado, y el monto con signo a la derecha en
// columna tabular. La fecha va en el encabezado del grupo, no aquí.
//
// El cuadro es un botón APARTE del resto de la fila (con `onOpenCategory`): tocarlo abre la
// categoría del movimiento, tocar el resto abre el movimiento. Por eso el contenedor es un div —
// no se pueden anidar botones. Sin `onOpenCategory` el cuadro no es interactivo (misma UI).
//
// No sangra por sí sola: dentro de una tarjeta, quien la usa le pasa `-mx-3 w-[calc(100%+1.5rem)]`
// para que el cuadro quede a ras del contenido de la tarjeta.
export function MovementRow({
  tx,
  onOpen,
  onOpenCategory,
  showRemaining = false,
  className,
}: {
  tx: TransactionDTO
  onOpen?: (tx: TransactionDTO) => void
  onOpenCategory?: (categoryId: string) => void
  showRemaining?: boolean // la landing muestra también el restante positivo (como antes del rediseño)
  className?: string // estilo de la fila según la lista que la contiene
}) {
  const income = tx.direction === "credit"
  const pending = tx.status === "pending"
  // Un `pending` de una plantilla o de una cuota es un gasto COMPROMETIDO (aún no lo cobra el
  // banco); un `pending` suelto es un cargo que el banco todavía no confirma. Se nombran distinto.
  const committed =
    pending && (!!tx.recurringTemplateId || !!tx.installmentForecast)

  // Etiquetas de estado en texto (no sellos sobre el icono): se leen sin depender del color.
  const tags: { label: string; tone: "warning" | "secondary" | "default" }[] = []
  if (pending) tags.push({ label: committed ? "Por cobrar" : "Pendiente", tone: "warning" })
  if (tx.recurringTemplateId) tags.push({ label: "Recurrente", tone: "secondary" })
  else if (tx.installmentForecast) tags.push({ label: "Cuota por cobrar", tone: "secondary" })
  else if (tx.installmentItemId) tags.push({ label: "Cuota", tone: "secondary" })
  if (tx.reimbursementCount) tags.push({ label: "Con reembolso", tone: "default" })
  if (tx.isInternal) tags.push({ label: "Ajuste de saldo", tone: "secondary" })

  const tile = (
    <IconTile color={tx.categoryColor ?? undefined}>
      <CategoryIcon icon={tx.categoryIcon} size={18} />
    </IconTile>
  )

  return (
    <div
      className={cn(
        "flex w-full items-center gap-2 rounded-lg pr-3 pl-2 text-left transition-colors hover:bg-secondary",
        className
      )}
    >
      {onOpenCategory && tx.categoryId ? (
        <button
          type="button"
          onClick={() => onOpenCategory(tx.categoryId!)}
          aria-label={`Ver categoría ${tx.categoryName ?? ""}`.trim()}
          className="press grid h-12 w-11 shrink-0 place-items-center rounded-lg hover:bg-surface-3"
        >
          {tile}
        </button>
      ) : (
        <span className="grid h-12 w-11 shrink-0 place-items-center">{tile}</span>
      )}
      <button
        type="button"
        onClick={() => onOpen?.(tx)}
        className="press flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg py-2 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-semibold">{tx.description}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-callout text-ink-2">
            <span className="min-w-0 truncate">
              {tx.categoryName ?? "Sin categoría"}
            </span>
            {tags.map((t) => (
              <Badge key={t.label} variant={t.tone}>
                {t.label}
              </Badge>
            ))}
          </span>
          {/* En la app, solo cuando la categoría quedó en negativo: es lo único que pide atención.
              La landing lo muestra siempre (`showRemaining`). */}
          {tx.remaining != null && (tx.remaining < 0 || showRemaining) && (
            <span
              className={cn(
                "text-caption",
                tx.remaining < 0 ? "text-destructive" : "text-ink-3"
              )}
            >
              Quedan {formatCLP(tx.remaining)}
            </span>
          )}
        </span>
        <span className="flex min-w-24 shrink-0 flex-col items-end text-right whitespace-nowrap">
          <span className={cn("font-semibold", income && "text-success")}>
            {income ? "+" : "−"}
            {tx.currency === "CLP"
              ? formatCLP(Math.abs(tx.amount))
              : formatMoney(Math.abs(tx.amount), tx.currency as CurrencyCode)}
          </span>
          {/* Moneda extranjera: equivalente CLP estimado (dólar del día) usado en los cálculos. */}
          {tx.amountClp != null && (
            <span className="text-caption text-ink-3">
              ≈ {formatCLP(Math.abs(tx.amountClp))}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}
