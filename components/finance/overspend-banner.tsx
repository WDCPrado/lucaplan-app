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
  // Título corto, que nunca parte la cifra; el contexto va debajo (al lado desde 768 px).
  const title = overMonth ? (
    <>
      Te pasaste <span className="whitespace-nowrap">{formatCLP(monthOverspend)}</span> del tope
    </>
  ) : (
    <>
      Te pasaste <span className="whitespace-nowrap">{formatCLP(capsOverspend)}</span> de topes
    </>
  )
  const sub = overMonth
    ? `Tope de gasto de ${mes}${globalLimit !== null ? ` · ${formatCLP(globalLimit)}` : ""}`
    : `${cuantas}${globalLimit !== null ? " · el tope de gasto del mes todavía alcanza" : ""}`
  const text = (
    <span className="flex min-w-0 flex-1 flex-col md:flex-row md:flex-wrap md:items-baseline md:gap-x-3">
      <span className="text-body font-semibold text-balance">{title}</span>
      <span className="text-caption text-ink-2">{sub}</span>
    </span>
  )
  // Óxido: te pasaste del tope del mes. Ámbar: solo un descuadre entre categorías.
  const className = cn(
    "flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
    overMonth ? "bg-destructive-soft text-destructive" : "bg-warning-soft text-warning"
  )
  const icon = <TriangleAlert aria-hidden className="size-5 shrink-0" />

  if (!worst)
    return (
      <p role="status" className={className}>
        {icon}
        {text}
      </p>
    )
  return (
    <button
      type="button"
      onClick={() => onOpenCategory(worst.id)}
      title={`Ver ${worst.name}`}
      className={cn("press hover:brightness-97", className)}
    >
      {icon}
      {text}
      <ChevronRight aria-hidden className="size-4 shrink-0" />
    </button>
  )
}
