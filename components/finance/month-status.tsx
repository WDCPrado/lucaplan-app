"use client"

import { ChevronRight, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  formatCLP,
  formatCompact,
  monthName,
  quartileVar,
  usageBarPct,
  usagePct,
} from "@/lib/finance-format"

/**
 * Estado del mes en una línea: el PRESUPUESTO de gasto como titular, con el avance de lo gastado
 * debajo. Las tres cifras de apoyo (gastado, comprometido y lo que queda libre) y la barra
 * completan el detalle. Si aún queda plata sin repartir entre categorías, se avisa con un nudge
 * que abre el plan ("por presupuestar" ya no vive en el panel ni en el modal).
 *
 * Este card NO dice "te pasaste": ese aviso vive entero en la banda de excedente que va justo
 * debajo (WDC-73). Acá el mes es cuánto es y cuánto llevas; el "Libre" en negativo ya marca solo
 * cuando la cuenta no da.
 */
export function MonthStatus({
  period,
  globalLimit,
  spent,
  committed,
  remainingToAllocate,
  onOpenPlan,
}: {
  period: { year: number; month: number }
  globalLimit: number | null
  spent: number
  committed: number
  remainingToAllocate: number | null // lo que falta repartir entre categorías (null = sin presupuesto)
  onOpenPlan: () => void
}) {
  const mes = monthName(period.month).toLowerCase()

  // Sin presupuesto no hay estado que mostrar: lo que corresponde es definirlo.
  if (globalLimit === null) {
    return (
      <section className="glass rounded-2xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold">
              Define tu presupuesto de {mes}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Con un límite del mes podemos decirte cuánto te queda libre, ya
              descontando lo que está comprometido.
            </p>
          </div>
          <Button onClick={onOpenPlan} className="h-11 shrink-0 rounded-full">
            Definir presupuesto
          </Button>
        </div>
      </section>
    )
  }

  const free = globalLimit - spent - committed
  // Un presupuesto de $0 es válido, y ahí no hay porcentaje: gastar sobre un tope de cero es "te
  // pasaste", no una proporción (mismo criterio que `categoryStatus` para los topes en 0). El
  // texto y la leyenda omiten el % (`usedPct === null`); la barra igual necesita un número, y con
  // límite 0 se llena si hay gasto y queda vacía si no.
  const usedPct = usagePct(spent, globalLimit)
  const spentPct = usageBarPct(spent, globalLimit)
  // El comprometido ocupa lo que queda de barra: si ya no cabe, el mes está excedido igual.
  const commPct = Math.min(100 - spentPct, usageBarPct(committed, globalLimit))

  return (
    <section className="glass relative rounded-2xl p-5 lg:p-6">
      {/* Móvil: siempre apilado (titular arriba, cifras debajo). Con flex-wrap las cifras podían
          subir a la fila del titular cuando este era corto, y quedaban bajo el botón anclado. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-8">
        <div className="min-w-0 max-sm:pr-12">
          <p className="text-sm text-muted-foreground">
            Presupuesto de {mes}
          </p>
          <p className="tabular mt-1 text-3xl font-bold sm:text-4xl lg:text-5xl">
            {formatCLP(globalLimit)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {usedPct === null
              ? `Llevas gastado ${formatCLP(spent)}`
              : `Llevas gastado ${formatCLP(spent)} · ${Math.round(usedPct)}%`}
          </p>
        </div>

        <div className="flex flex-1 items-start gap-4 sm:flex-none sm:gap-8">
          {/* Móvil: columnas con el monto abreviado (cabe sin cortar); desde sm, cifra completa.
              El comprometido solo aparece si existe: en $0 solo gasta espacio. */}
          <dl
            className={cn(
              "grid flex-1 gap-3 text-sm sm:flex sm:flex-none sm:gap-8",
              committed > 0 ? "grid-cols-3" : "grid-cols-2"
            )}
          >
            <Stat label="Gastado" value={spent} />
            {committed > 0 && <Stat label="Comprometido" value={committed} />}
            <Stat
              label="Libre"
              value={free}
              valueClassName={cn(free < 0 && "text-destructive")}
            />
          </dl>
          {/* Editar el plan (ingresos, presupuesto, categorías de ingreso) vive acá: es el mismo
              lugar donde se ve su resultado. En móvil se ancla arriba a la derecha, fuera del
              flujo, para que las cifras no tengan que dejarle espacio en su fila. */}
          <Button
            variant="secondary"
            onClick={onOpenPlan}
            aria-label="Ajustar el plan del mes"
            className="shrink-0 rounded-full max-sm:absolute max-sm:top-5 max-sm:right-5 max-sm:z-10 max-sm:size-10 max-sm:p-0 sm:h-10"
          >
            <SlidersHorizontal className="size-4" />
            <span className="max-sm:sr-only">Ajustar plan</span>
          </Button>
        </div>
      </div>

      {/* El gastado usa el mismo semáforo por cuartil que las categorías (verde → rojo): un solo
          código de color en toda la app. El comprometido queda fuera de esa escala para que se
          distinga del gastado en cualquier nivel de uso. */}
      <div className="mt-5 flex h-3 w-full overflow-hidden rounded-full bg-success/20">
        <div
          className="h-full transition-[width] duration-500 ease-out"
          style={{ width: `${spentPct}%`, background: quartileVar(spentPct) }}
        />
        <div
          className="bg-committed h-full border-l border-background transition-[width] duration-500 ease-out"
          style={{ width: `${Math.max(0, commPct)}%` }}
        />
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-[3px]"
            style={{ background: quartileVar(spentPct) }}
          />
          {usedPct === null ? "Gastado" : `Gastado ${Math.round(usedPct)}%`}
        </li>
        <Legend className="bg-committed">
          Comprometido (recurrentes y cuotas por cobrar)
        </Legend>
        <Legend className="bg-success/30">Libre</Legend>
      </ul>

      {/* Nudge de asignación: solo aparece cuando hay algo que hacer (falta repartir o te pasaste
          asignando). Abre el plan, que es donde se reparte. En $0 no molesta. */}
      {remainingToAllocate !== null && remainingToAllocate !== 0 && (
        <button
          onClick={onOpenPlan}
          className={cn(
            "mt-4 flex w-full items-center justify-between gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-colors",
            remainingToAllocate < 0
              ? "bg-destructive/10 text-destructive hover:bg-destructive/15"
              : "bg-secondary/50 hover:bg-accent"
          )}
        >
          <span className="min-w-0">
            {remainingToAllocate < 0
              ? `Sobre-asignado ${formatCLP(Math.abs(remainingToAllocate))} en categorías`
              : `Te falta repartir ${formatCLP(remainingToAllocate)} en categorías`}
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-60" />
        </button>
      )}
    </section>
  )
}

// En móvil las tres cifras comparten el ancho de la pantalla: van abreviadas ($2.6M) para que
// ninguna se corte. Desde sm hay espacio para el monto completo.
function Stat({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: number
  valueClassName?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className={cn("tabular font-semibold", valueClassName)}>
        <span className="sm:hidden">{formatCompact(value)}</span>
        <span className="max-sm:hidden">{formatCLP(value)}</span>
      </dd>
    </div>
  )
}

function Legend({
  className,
  children,
}: {
  className: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-[3px]", className)} />
      {children}
    </li>
  )
}
