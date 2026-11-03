import { ChevronRight, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCLP, monthName } from "@/lib/finance-format"
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

/**
 * Cuánto te pasaste este mes, en UNA línea. Es la ÚNICA superficie que dice la cifra del
 * excedente: el titular del mes no lo anuncia y las filas de categoría solo dicen lo suyo.
 *
 * Son DOS cifras distintas y la banda no las suma:
 * - **excedente del mes** (`monthOverspend`): gasto por sobre el tope de gasto global. Cuando existe,
 *   es la que se dice.
 * - **excedente de topes** (`capsOverspend`): lo que se pasó categoría por categoría.
 *
 * Sin excedente del mes pero con tope de gasto global, una línea secundaria aclara que el tope de gasto
 * del mes todavía alcanza (es un descuadre entre categorías). Sin tope global no se afirma: no hay
 * contra qué medir.
 *
 * Tocarla abre la categoría más pasada (el mismo detalle que abre su fila). Con ambos excedentes en
 * $0 no se renderiza nada.
 */
export function OverspendBanner({
  period,
  capsOverspend,
  monthOverspend,
  globalLimit,
  categories,
  onOpenCategory,
}: {
  period: { year: number; month: number }
  capsOverspend: number
  monthOverspend: number
  globalLimit: number | null // tope de gasto del mes; null = todavía sin definir
  categories: CategoryDTO[]
  onOpenCategory: (id: string) => void
}) {
  if (monthOverspend <= 0 && capsOverspend <= 0) return null

  const mes = monthName(period.month).toLowerCase()
  // Las culpables del excedente de topes, la más pasada primero (mismo criterio que la cifra:
  // gasto en el plan, también las sin tope, y solo lo confirmado).
  const culprits = categories
    .filter((c) => c.type === "expense" && c.inPlan && c.used > c.limit)
    .sort((a, b) => b.used - b.limit - (a.used - a.limit))
  const cuantas = `${culprits.length} ${culprits.length === 1 ? "categoría" : "categorías"}`
  const overMonth = monthOverspend > 0

  const worst = culprits[0]
  const headline = overMonth ? (
    <>
      Te pasaste{" "}
      <span className="tabular font-semibold">{formatCLP(monthOverspend)}</span>{" "}
      del tope de gasto de {mes}
    </>
  ) : (
    <>
      Te pasaste{" "}
      <span className="tabular font-semibold">{formatCLP(capsOverspend)}</span>{" "}
      de topes · {cuantas}
    </>
  )
  const text = (
    <>
      <span className="block">{headline}</span>
      {!overMonth && globalLimit !== null && (
        <span className="block text-footnote text-muted-foreground">
          El tope de gasto del mes todavía alcanza.
        </span>
      )}
    </>
  )
  const className = cn(
    "flex min-h-11 w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-subheadline",
    overMonth ? "bg-destructive/10" : "bg-warning/10"
  )
  // El color del estado vive en el ícono y el tinte: ámbar como texto sobre su tinte no llega a AA.
  const icon = (
    <TriangleAlert
      aria-hidden
      className={cn(
        "size-5 shrink-0",
        overMonth ? "text-destructive" : "text-warning"
      )}
    />
  )

  if (!worst)
    return (
      <p role="status" className={className}>
        {icon}
        <span className="min-w-0 flex-1">{text}</span>
      </p>
    )
  return (
    <button
      type="button"
      onClick={() => onOpenCategory(worst.id)}
      title={`Ver ${worst.name}`}
      className={cn("press", className)}
    >
      {icon}
      <span className="min-w-0 flex-1">{text}</span>
      <ChevronRight aria-hidden className="disclosure" />
    </button>
  )
}
