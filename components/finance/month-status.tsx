"use client"

import { ChevronRight, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  currentPeriod,
  formatCLP,
  formatLongDate,
  monthName,
  usagePct,
} from "@/lib/finance-format"
import { dailyAllowance } from "@/lib/day-spend"

/**
 * Estado del mes convertido en UNA decisión: cuánto puedes gastar hoy. Es lo libre del mes
 * (presupuesto − gastado − comprometido) repartido en los días que quedan. En un mes pasado el
 * titular es con cuánto cerró; sin presupuesto, lo que corresponde es definirlo.
 *
 * Este bloque NO dice "te pasaste": ese aviso vive entero en la banda de excedente que va justo
 * debajo (WDC-73). Pasado el presupuesto, acá el número es $0 y punto. Si aún queda plata sin
 * repartir entre categorías, se avisa con un nudge que abre el plan.
 */
export function MonthStatus({
  period,
  isCurrentMonth,
  daysLeft,
  globalLimit,
  spent,
  committed,
  remainingToAllocate,
  onOpenPlan,
  children,
}: {
  period: { year: number; month: number }
  isCurrentMonth: boolean
  daysLeft: number // días que quedan, hoy incluido; 0 fuera del mes en curso
  globalLimit: number | null
  spent: number
  committed: number
  remainingToAllocate: number | null // lo que falta repartir entre categorías (null = sin presupuesto)
  onOpenPlan: () => void
  children?: React.ReactNode // la tira de días, debajo del titular
}) {
  const mes = monthName(period.month).toLowerCase()

  if (globalLimit === null) {
    return (
      <section className="glass rounded-2xl p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-heading text-lg font-bold">
              Define tu presupuesto de {mes}
            </h2>
            <p className="mt-1 text-sm text-pretty text-muted-foreground">
              Con un límite del mes podemos decirte cuánto puedes gastar hoy, ya
              descontando lo que está comprometido.
            </p>
          </div>
          <Button onClick={onOpenPlan} className="h-11 shrink-0 rounded-full">
            Definir presupuesto
          </Button>
        </div>
        {children && <div className="mt-5">{children}</div>}
      </section>
    )
  }

  const free = globalLimit - spent - committed
  const usedPct = usagePct(spent, globalLimit)
  const todayIso = `${period.year}-${String(period.month).padStart(2, "0")}-${String(
    currentPeriod().day
  ).padStart(2, "0")}T00:00:00.000Z`

  return (
    <section className="glass relative rounded-2xl p-5 lg:p-6">
      {/* Editar el plan (ingresos, presupuesto) vive acá: es el mismo lugar donde se ve su
          resultado. En móvil se ancla arriba a la derecha para no quitarle ancho al titular. */}
      <Button
        variant="secondary"
        onClick={onOpenPlan}
        aria-label="Ajustar el plan del mes"
        className="absolute top-5 right-5 z-10 rounded-full max-sm:size-10 max-sm:p-0 sm:h-10 lg:top-6 lg:right-6"
      >
        <SlidersHorizontal className="size-4" />
        <span className="max-sm:sr-only">Ajustar plan</span>
      </Button>

      <div className="max-sm:pr-12">
        {isCurrentMonth ? (
          <>
            <p className="text-sm text-muted-foreground">
              Hoy, {formatLongDate(todayIso)}
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                {formatCLP(dailyAllowance(free, daysLeft))}
              </span>
              <span className="font-heading text-lg font-semibold sm:text-xl">
                libre hoy
              </span>
            </p>
            <p className="tabular mt-2 text-sm text-pretty text-muted-foreground">
              {free > 0
                ? `${formatCLP(free)} libres para ${
                    daysLeft === 1 ? "el día que queda" : `los ${daysLeft} días que quedan`
                  }${committed > 0 ? `, ya descontado lo comprometido (${formatCLP(committed)})` : ""}. Cada día sin gastar suma al siguiente.`
                : "No queda presupuesto libre este mes."}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {monthName(period.month)} {period.year} cerró con
            </p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="tabular text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                {formatCLP(Math.max(0, free))}
              </span>
              <span className="font-heading text-lg font-semibold sm:text-xl">
                sin gastar
              </span>
            </p>
            <p className="tabular mt-2 text-sm text-muted-foreground">
              {usedPct === null
                ? `Gastaste ${formatCLP(spent)} de ${formatCLP(globalLimit)}`
                : `Gastaste ${formatCLP(spent)} de ${formatCLP(globalLimit)} · ${Math.round(usedPct)}%`}
            </p>
          </>
        )}
      </div>

      {children && <div className="mt-5">{children}</div>}

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
