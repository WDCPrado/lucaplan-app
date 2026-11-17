"use client"

import { useCallback, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react"
import { ResponsivePopover } from "@/components/ui/responsive-modal"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { haptic } from "@/lib/haptics"
import { currentPeriod, monthName } from "@/lib/finance-format"

// Etiqueta del período: el mes («Octubre») o, en modo tarjeta, el rango del ciclo
// («Ciclo 23 sep – 22 oct»). La misma en el selector y en el MonthNav deshabilitado.
const day = (key: string) =>
  `${key.slice(8, 10)} ${monthName(Number(key.slice(5, 7)))
    .slice(0, 3)
    .toLowerCase()}`
export function periodLabel(
  period: { month: number },
  cycleRange?: { start: string; end: string }
) {
  return cycleRange
    ? `Ciclo ${day(cycleRange.start)} – ${day(cycleRange.end)}`
    : monthName(period.month)
}

// Selector de mes: el botón del mes abre la grilla de 12 meses con navegación de año, en un popover
// en escritorio y en la hoja «Elegir mes» en móvil. El elegido va relleno en el acento; el mes en
// curso lleva un anillo, y «Ir a hoy» vuelve a él cuando se mira otro.
export function MonthPicker({
  period,
  onSelect,
  withYear,
  current,
  className,
  cycleRange,
}: {
  period: { year: number; month: number }
  onSelect: (year: number, month: number) => void
  withYear?: boolean // "octubre 2026" en vez de "octubre": fuera de la topbar el año no es obvio
  current?: { year: number; month: number } // mes en curso según el modo (tarjeta: el 28/09 ya es octubre)
  cycleRange?: { start: string; end: string } // muestra el rango real en modo tarjeta
  className?: string // estilo del botón que abre el selector
}) {
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(period.year)
  const now = current ?? currentPeriod()
  const selectedMonth = useRef<HTMLButtonElement>(null)
  // Estable: corre al montar el contenido (cada vez que se abre), no en cada render.
  const focusSelected = useCallback((el: HTMLDivElement | null) => {
    if (el) requestAnimationFrame(() => selectedMonth.current?.focus({ preventScroll: true }))
  }, [])

  return (
    <ResponsivePopover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setYear(period.year) // al abrir, arrancar en el año del período visible
      }}
      title="Elegir mes"
      align="center"
      className="w-64 p-3"
      trigger={
        <button
          type="button"
          className={cn(
            "press group/mp inline-flex min-h-(--ctl) max-w-full min-w-0 items-center justify-center gap-1.5 rounded-md px-3 text-center text-body font-semibold hover:bg-secondary",
            className
          )}
        >
          <span className="truncate">
            {periodLabel(period, cycleRange)}
            {withYear && <span className="tabular-nums"> {period.year}</span>}
          </span>
          <ChevronDown
            aria-hidden
            className="size-4 shrink-0 text-ink-3 transition-transform duration-180 ease-(--ease-out) group-data-[state=open]/mp:rotate-180 motion-reduce:transition-none"
          />
        </button>
      }
    >
      <div
        // Al abrir, el foco va al mes elegido (no al primer botón).
        ref={focusSelected}
      >
        <div className="mb-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setYear((y) => y - 1)}
            className="press grid size-(--ctl) place-items-center rounded-md text-ink-2 hover:bg-secondary hover:text-foreground"
            aria-label="Año anterior"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-body font-semibold">
            {year}
          </span>
          <button
            type="button"
            onClick={() => setYear((y) => y + 1)}
            className="press grid size-(--ctl) place-items-center rounded-md text-ink-2 hover:bg-secondary hover:text-foreground"
            aria-label="Año siguiente"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const selected = year === period.year && m === period.month
            const isNow = year === now.year && m === now.month
            return (
              <button
                type="button"
                ref={selected ? selectedMonth : undefined}
                aria-pressed={selected}
                aria-current={isNow ? "date" : undefined}
                aria-label={`${monthName(m)} ${year}`}
                key={m}
                onClick={() => {
                  haptic("light")
                  setOpen(false)
                  onSelect(year, m)
                }}
                className={cn(
                  "press min-h-(--ctl) rounded-md text-callout transition-colors max-md:min-h-12 max-md:text-body",
                  selected
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "bg-secondary hover:bg-surface-3",
                  !selected && isNow && "ring-2 ring-primary ring-inset"
                )}
              >
                {monthName(m).slice(0, 3)}
              </button>
            )
          })}
        </div>
        {(period.year !== now.year || period.month !== now.month) && (
          <Button
            type="button"
            variant="secondary"
            className="mt-3 w-full"
            onClick={() => {
              haptic("light")
              setOpen(false)
              onSelect(now.year, now.month)
            }}
          >
            Ir a hoy
          </Button>
        )}
      </div>
    </ResponsivePopover>
  )
}
