"use client"

import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  formatCLP,
  formatCompact,
  monthName,
  quartileVar,
} from "@/lib/finance-format"

/**
 * Estado del mes en una línea: cuánto queda LIBRE de verdad, ya descontado lo gastado y lo que
 * está comprometido (recurrentes y cuotas que aún no se cobran). El "por presupuestar" responde
 * otra pregunta (cuánto falta repartir entre categorías) y vive en el panel del plan.
 */
export function MonthStatus({
  period,
  globalLimit,
  spent,
  committed,
  daysLeft,
  onOpenPlan,
}: {
  period: { year: number; month: number }
  globalLimit: number | null
  spent: number
  committed: number
  daysLeft: number | null // null = el mes no es el actual (no hay "por día" que calcular)
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
  const over = free < 0
  const usedPct = (spent / globalLimit) * 100
  const spentPct = Math.min(100, usedPct)
  // El comprometido ocupa lo que queda de barra: si ya no cabe, el mes está excedido igual.
  const commPct = Math.min(100 - spentPct, (committed / globalLimit) * 100)
  const perDay = daysLeft && daysLeft > 0 ? Math.round(free / daysLeft) : null

  return (
    <section className="glass relative rounded-2xl p-5 lg:p-6">
      {/* Móvil: siempre apilado (titular arriba, cifras debajo). Con flex-wrap las cifras podían
          subir a la fila del titular cuando este era corto, y quedaban bajo el botón anclado. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-8">
        <div className="min-w-0 max-sm:pr-12">
          <p className="text-sm text-muted-foreground">
            {over ? `Te pasaste en ${mes}` : `Te queda libre en ${mes}`}
          </p>
          <p
            className={cn(
              "tabular mt-1 text-3xl font-bold sm:text-4xl lg:text-5xl",
              over && "text-destructive"
            )}
          >
            {formatCLP(Math.abs(free))}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {over
              ? "sobre tu presupuesto del mes, contando lo comprometido"
              : daysLeft === null
                ? "en el presupuesto de este mes"
                : daysLeft <= 1
                  ? "para el último día del mes"
                  : perDay !== null
                    ? `para los ${daysLeft} días que quedan · ${formatCLP(perDay)} por día`
                    : `para los ${daysLeft} días que quedan`}
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
            <Stat label="Presupuesto" value={globalLimit} />
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
          style={{ width: `${spentPct}%`, background: quartileVar(usedPct) }}
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
            style={{ background: quartileVar(usedPct) }}
          />
          Gastado {Math.round(usedPct)}%
        </li>
        <Legend className="bg-committed">
          Comprometido (recurrentes y cuotas por cobrar)
        </Legend>
        <Legend className="bg-success/30">Libre</Legend>
      </ul>
    </section>
  )
}

// En móvil las tres cifras comparten el ancho de la pantalla: van abreviadas ($2.6M) para que
// ninguna se corte. Desde sm hay espacio para el monto completo.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="tabular font-semibold">
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
