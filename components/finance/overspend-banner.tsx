import { TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import { CategoryIcon } from "./category-icons"
import { formatCLP, monthName } from "@/lib/finance-format"
import type { CategoryDTO } from "@/arch/v1/application/finance-use-cases/finance-read"

/**
 * Cuánto te pasaste este mes, en una sola cifra. El dashboard ya avisa categoría por categoría
 * ("$3.379 sobre el tope"), pero sumarlas de cabeza no es tarea del usuario.
 *
 * Esta banda es la ÚNICA superficie que dice "te pasaste": el card de presupuesto de arriba se
 * queda con cuánto es y cuánto llevas gastado. Un mismo aviso repetido dos veces, uno encima del
 * otro, no avisa el doble.
 *
 * Son DOS cifras distintas y la banda no las suma:
 * - **excedente del mes** (`monthOverspend`): gasto por sobre el presupuesto global. Plata que no
 *   había. Es la que duele, así que cuando existe es la cifra grande.
 * - **excedente de topes** (`capsOverspend`): lo que se pasó categoría por categoría. Es un
 *   descuadre del reparto: puede ser alto con presupuesto del mes de sobra, y ahí la banda lo dice
 *   con todas sus letras para que nadie lea "me pasé $68.120" como "debo $68.120".
 *
 * Sin presupuesto del mes (`globalLimit === null`) esa tranquilidad no se puede afirmar: no hay
 * contra qué medir, y decir "el presupuesto todavía alcanza" contradiría al card de arriba, que
 * justo está pidiendo definirlo.
 *
 * Con ambos excedentes en $0 no se renderiza nada: un mes cuadrado no necesita aviso.
 */
export function OverspendBanner({
  period,
  globalLimit,
  capsOverspend,
  monthOverspend,
  categories,
}: {
  period: { year: number; month: number }
  globalLimit: number | null // presupuesto del mes; null = todavía sin definir
  capsOverspend: number
  monthOverspend: number
  categories: CategoryDTO[]
}) {
  if (monthOverspend <= 0 && capsOverspend <= 0) return null

  const mes = monthName(period.month).toLowerCase()
  // Las culpables del excedente de topes, la más pasada primero (mismo criterio que la cifra:
  // gasto con tope y solo lo confirmado).
  const culprits = categories
    .filter((c) => c.type === "expense" && c.limit > 0 && c.used > c.limit)
    .sort((a, b) => b.used - b.limit - (a.used - a.limit))
  const cuantas = `${culprits.length} ${culprits.length === 1 ? "categoría" : "categorías"}`
  const overMonth = monthOverspend > 0

  return (
    <section
      aria-label="Cuánto te pasaste este mes"
      className={cn(
        "mt-4 flex items-start gap-3 rounded-2xl border p-4 lg:p-5",
        overMonth
          ? "border-destructive/30 bg-destructive/10"
          : "border-warning/40 bg-warning/10"
      )}
    >
      {/* El color del estado vive en el ícono y el borde. En la cifra no: ámbar sobre su propio
          tinte da 1.95:1 en tema claro, y es el contenido principal de la banda. Decorativo
          (aria-hidden) porque el texto ya dice todo lo que el color insinúa. */}
      <TriangleAlert
        aria-hidden
        className={cn(
          "mt-0.5 size-5 shrink-0",
          overMonth ? "text-destructive" : "text-warning"
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {overMonth
            ? `Te pasaste del presupuesto de ${mes}`
            : `Te pasaste de los topes de ${cuantas}`}
        </p>
        <p className="tabular mt-0.5 text-2xl font-bold sm:text-3xl">
          {formatCLP(overMonth ? monthOverspend : capsOverspend)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {overMonth
            ? // Con el mes excedido, el descuadre entre categorías pasa a ser el detalle.
              capsOverspend > 0
              ? `Es gasto que el presupuesto del mes ya no cubre. Además hay ${formatCLP(capsOverspend)} sobre los topes de ${cuantas}:`
              : "Es gasto que el presupuesto del mes ya no cubre."
            : globalLimit === null
              ? // Sin presupuesto del mes no hay tranquilidad que dar: solo se puede decir qué mide
                // la cifra. Afirmar que "alcanza" chocaría con el "Define tu presupuesto" de arriba.
                `Es solo lo que se pasó de los topes: ${mes} todavía no tiene un presupuesto del mes contra el cual medirlo.`
              : `El presupuesto de ${mes} todavía alcanza: es un descuadre entre categorías, no plata que te falte.`}
        </p>
        {culprits.length > 0 && (
          // Scroll-x sin wrap: con seis categorías reventadas la banda no puede crecer hacia abajo
          // hasta empujar las cuentas fuera de pantalla.
          <ul className="-mx-1 mt-2.5 flex scrollbar-none gap-2 overflow-x-auto px-1 py-0.5">
            {culprits.map((c) => (
              <li
                key={c.id}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-background/60 px-2.5 py-1 text-xs"
              >
                <CategoryIcon
                  icon={c.icon}
                  size={14}
                  color={c.color ?? undefined}
                />
                <span className="font-medium">{c.name}</span>
                {/* El "+" evita leer la cifra como lo gastado: es lo que se pasó del tope. */}
                <span className="tabular text-muted-foreground">
                  +{formatCLP(c.used - c.limit)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
